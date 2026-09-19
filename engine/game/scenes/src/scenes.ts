/**
 * The scenes runtime: documents (`SceneDoc`, a tree of typed nodes) mounted
 * into pixi `Container`s through the node-type registry, shown and hidden
 * through transitions, their assets loaded before they show and unloaded
 * once nothing visible needs them.
 *
 * Every document gets a top-level mount at `replace`; a `scene` node
 * mounts the referenced document AGAIN, as its own subtree (`mountDoc`),
 * so nesting is by copy, not by reference — `view()` addresses top-level
 * nodes only. `show(id)` of a document some visible scene nests just flips
 * that node visible; otherwise the document's own view joins `container`.
 *
 * Like `stage` before it, this is unit-testable end to end: `Container`,
 * `Sprite` and `Graphics` all build headlessly in plain Node.
 */
import type { Context } from 'cordis';
import { Container, Graphics } from 'pixi.js';
import {
  diagnostic,
  type Diagnostic,
  type SceneDoc,
  type SceneNode,
} from '@energy8engine/contracts';
import { fitStage, type Fit, type Size } from './fit';
import { createTransitions, cut, type TickerLike, type TransitionsService } from './transitions';
import { applyCommon, type NodeType, type NodeTypesService } from './node-types';
import type { AssetLoader } from './builtin';

export interface CreateScenesOptions {
  /** Parent to mount the runtime's container into — typically a renderer's `app.stage`. */
  root: Container;
  design: Size;
  mode?: 'contain' | 'cover';
  /** Default transition id; `cut` when absent. */
  transition?: string;
  transitionMs?: number;
  /** Where transition ids resolve; a private registry holding `cut` when absent. */
  transitions?: TransitionsService;
  nodeTypes: NodeTypesService;
  loader: AssetLoader;
  ticker?: TickerLike | null;
  /** What node types mount against; `scenes` and `assetLoader` answer from here even when the context provides neither. */
  ctx: Context;
  report?: (d: Diagnostic) => void;
}

export interface SceneRef {
  scene: string;
  node: string;
}

export interface ScenesService {
  show(id: string, opts?: { transition?: string }): Promise<void>;
  hide(id: string): Promise<void>;
  /** Top-level scenes shown, in show order; a nested show is not listed. */
  visible(): string[];
  docs(): ReadonlyMap<string, SceneDoc>;
  /** Swaps the documents; only changed ones (and the ones nesting them) remount. */
  replace(docs: SceneDoc[]): void;
  highlight(ref: SceneRef | null): void;
  /** Every asset path the document (and its nested scenes) needs. */
  assetsOf(id: string): string[];
  /** Mounts `id`'s tree into a fresh container for a `scene` node; `null` on a cycle or a missing id. Internal to `scene` nodes. */
  mountDoc(id: string, chain: string[]): Container | null;
  sceneView(id: string): Container | undefined;
  /** A node's view by id, top-level or nested under a `container`/another node — the top-level map first (the common case, O(1)), `all` otherwise. */
  view(ref: SceneRef): Container | undefined;
  readonly container: Container;
  /**
   * Settles once the boot document set is in: the runtime's `/api/scenes`
   * GET has `replace`d (or a frame's `replace` landed first); REJECTS when
   * the GET failed and nothing replaced. Already resolved here — the
   * runtime half (`./runtime`) is what defers it.
   */
  ready: Promise<void>;
  resize(viewportWidth: number, viewportHeight: number): Fit;
  destroy(): void;
}

interface Entry {
  view: Container;
  node: SceneNode;
  /** The node's own props, through the type's schema. */
  props: Record<string, unknown>;
  type: NodeType;
  /** `<scene>/<node id>` — where a throwing `update` is reported. */
  where: string;
  /** `refresh()` already reported this entry once; suppresses repeats until the next remount rebuilds it. */
  failed?: boolean;
}

interface Mount {
  view: Container;
  /** Top-level nodes by id — what `view()` answers. */
  nodes: Map<string, Entry>;
  /** Every entry, nested ones included, in mount order — what unmount walks. */
  all: Entry[];
  /** Type identities at mount time, unknown ones as `undefined` — a change remounts. */
  types: Map<string, NodeType | undefined>;
  /**
   * Nodes skipped because their type was not registered when this mount
   * was built. Reported when the scene is ON SCREEN (`show`, or a remount
   * while visible) — never at mount time: a row registers its type
   * whenever `nodeTypes` appears (`@energy8engine/reels`' `ctx.inject`),
   * which is after `replace` has already mounted the boot set, and the
   * registry change remounts (measured: every boot of `first-slot` said
   * `reels` was unregistered, then drew the board anyway).
   */
  missing: { where: string; type: string }[];
}

/** Views this package builds itself, so destroys itself. */
const OWN = new Set(['container', 'image', 'scene']);

export function createScenes(options: CreateScenesOptions): ScenesService {
  const { nodeTypes, loader, report = () => {} } = options;
  const error = (where: string, message: string, fix?: string) =>
    report(diagnostic('error', 'scenes', where, message, fix));
  const container = new Container();
  container.label = 'scenes';
  options.root.addChild(container);
  const highlightBox = new Graphics();
  highlightBox.label = 'highlight';
  highlightBox.visible = false;
  container.addChild(highlightBox);
  const transitions = options.transitions ?? createTransitions(report);
  if (!transitions.get('cut')) transitions.register(cut);

  const docs = new Map<string, SceneDoc>();
  const mounted = new Map<string, Mount>();
  const visibleIds: string[] = [];
  const shownNested = new Set<string>();
  const loaded = new Set<string>();
  /** The top-level mount under construction — nested `mountDoc` calls file their entries here. */
  let building: Mount | null = null;
  let queue: Promise<void> = Promise.resolve();

  const mountCtx = (chain: string[]): Context =>
    Object.create(options.ctx, {
      __sceneChain: { value: chain },
      reflect: {
        value: Object.create(options.ctx.reflect, {
          get: {
            value: (name: string, strict?: boolean) =>
              name === 'scenes'
                ? service
                : name === 'assetLoader'
                  ? loader
                  : options.ctx.reflect.get(name, strict),
          },
        }),
      },
    }) as Context;

  function mountNode(
    node: SceneNode,
    parent: Container,
    sceneId: string,
    chain: string[],
    seen: Set<string>,
  ): void {
    const where = `${sceneId}/${node.id}`;
    if (seen.has(node.id)) {
      error(
        where,
        `node id "${node.id}" is declared twice — the later one is skipped`,
        'give it an id of its own',
      );
      return;
    }
    seen.add(node.id);
    const type = nodeTypes.get(node.type);
    building?.types.set(node.type, type);
    if (!type) {
      building?.missing.push({ where, type: node.type });
      return;
    }
    let view: Container;
    let props: Record<string, unknown>;
    try {
      props = type.schema(node.props) as Record<string, unknown>;
      view = type.mount(props, mountCtx([...chain, sceneId]));
      // Inside the try: a common prop off its type (`x: 'abc'`) is this
      // node's failure, not the whole set's.
      applyCommon(view, node.props);
    } catch (e) {
      error(
        where,
        `${node.type} "${node.id}" failed to mount: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    view.label = node.id;
    parent.addChild(view);
    const entry: Entry = { view, node, props, type, where };
    building?.all.push(entry);
    if (building && chain.length === 0) building.nodes.set(node.id, entry);
    for (const child of node.children ?? []) mountNode(child, view, sceneId, chain, seen);
  }

  /** The skipped nodes of a mount that is on screen: each one an error, now that a person can see the gap. */
  const reportMissing = (m: Mount) => {
    for (const { where, type } of m.missing)
      error(
        where,
        `node type "${type}" is not registered — the node is skipped`,
        'register it, or pick a type that is',
      );
  };

  /**
   * Types a mount had that a registry change took away, by scene id. A
   * hot re-apply of the row owning a type (`reels1`) unregisters, then
   * registers again a few microtasks later: the remount in between must
   * not say the type is missing. It is reported only if it was ALSO
   * missing at the previous mount; the next `show()` still reports it if
   * it truly stays gone (`reportMissing` reads the mount's own list).
   */
  let vanished: Map<string, Set<string>> | null = null;

  function mountTop(id: string): void {
    const view = new Container();
    view.label = id;
    const m: Mount = { view, nodes: new Map(), all: [], types: new Map(), missing: [] };
    building = m;
    try {
      const seen = new Set<string>();
      for (const node of docs.get(id)!.nodes) mountNode(node, view, id, [], seen);
    } finally {
      building = null;
    }
    mounted.set(id, m);
    for (const e of m.all)
      if (e.type.type === 'scene' && shownNested.has(e.props.scene as string))
        e.view.visible = true;
    if (!visibleIds.includes(id)) return;
    const gap = vanished?.get(id);
    reportMissing(gap ? { ...m, missing: m.missing.filter((x) => !gap.has(x.type)) } : m);
  }

  function unmountTop(id: string): void {
    const m = mounted.get(id);
    if (!m) return;
    for (const e of [...m.all].reverse()) {
      e.type.unmount?.(e.view);
      e.view.parent?.removeChild(e.view);
      if (OWN.has(e.type.type)) e.view.destroy({ children: false });
    }
    m.view.parent?.removeChild(m.view);
    m.view.destroy({ children: false });
    mounted.delete(id);
  }

  /** Unmounts and mounts `ids` again; a visible one stays visible. */
  function remount(ids: Iterable<string>): void {
    const shown: string[] = [];
    for (const id of ids) {
      const wasAt = visibleIds.includes(id) ? container.getChildIndex(mounted.get(id)!.view) : -1;
      unmountTop(id);
      if (!docs.has(id)) {
        if (wasAt >= 0) visibleIds.splice(visibleIds.indexOf(id), 1);
        shownNested.delete(id);
        continue;
      }
      mountTop(id);
      if (wasAt >= 0) {
        container.addChildAt(mounted.get(id)!.view, wasAt);
        shown.push(id);
      }
    }
    refresh();
    redraw();
    // A visible document may now name assets nothing loaded yet (an edited `src`).
    if (shown.length > 0)
      void enqueue(async () => {
        for (const id of shown) if (docs.has(id)) await load(id);
      });
  }

  /** Scene ids a document's tree references, one level deep. */
  const refsOf = (doc: SceneDoc): Set<string> => {
    const out = new Set<string>();
    const walk = (nodes: SceneNode[]) => {
      for (const n of nodes) {
        if (n.type === 'scene' && typeof n.props.scene === 'string') out.add(n.props.scene);
        walk(n.children ?? []);
      }
    };
    walk(doc.nodes);
    return out;
  };

  /**
   * Lets every mounted node re-read what it depends on (a texture after a
   * load or an unload). A throwing `update` (a media type filling itself
   * in once its asset lands) must not stop the loop: every sibling still
   * needs its own refresh, and the scene must still show. Reported once
   * per entry — `failed` is cleared only by a remount, which rebuilds the
   * entry from scratch.
   */
  function refresh(): void {
    for (const m of mounted.values())
      for (const e of m.all) {
        try {
          e.type.update?.(e.view, e.props, mountCtx([]));
        } catch (err) {
          if (e.failed) continue;
          e.failed = true;
          error(
            e.where,
            `${e.node.type} "${e.node.id}" failed to refresh: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
  }

  function assetsOf(id: string, seen = new Set<string>()): string[] {
    const doc = docs.get(id);
    if (!doc || seen.has(id)) return [];
    seen.add(id);
    const out = new Set<string>();
    const walk = (nodes: SceneNode[]) => {
      for (const n of nodes) {
        for (const p of nodeTypes.get(n.type)?.assets?.(n.props) ?? []) out.add(p);
        if (n.type === 'scene' && typeof n.props.scene === 'string')
          for (const p of assetsOf(n.props.scene, seen)) out.add(p);
        walk(n.children ?? []);
      }
    };
    walk(doc.nodes);
    return [...out];
  }

  /** Entries in visible top-level scenes whose `scene` node points at `id`. */
  const nestingEntries = (id: string): Entry[] =>
    visibleIds.flatMap((v) =>
      mounted.get(v)!.all.filter((e) => e.type.type === 'scene' && e.props.scene === id),
    );

  async function runTransition(
    wanted: string,
    run: { from: Container[]; to: Container[] },
  ): Promise<void> {
    let transition = transitions.get(wanted);
    if (!transition) {
      report(
        diagnostic(
          'warning',
          'scenes',
          wanted,
          `transition "${wanted}" is not registered — cut instead`,
          'register it, or pick one that is',
        ),
      );
      transition = cut;
    }
    try {
      await transition.run({
        ...run,
        ticker: options.ticker ?? null,
        ms: options.transitionMs ?? 300,
      });
    } catch (e) {
      error(
        transition.id,
        `transition "${transition.id}" failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const enqueue = (run: () => Promise<void>): Promise<void> => (queue = queue.then(run, run));

  /** What `highlight` last asked for; redrawn after a remount or a load, since the view (and its bounds) may be new. */
  let current: SceneRef | null = null;
  function redraw(): void {
    highlightBox.clear();
    const view = current && service.view(current);
    highlightBox.visible = !!view;
    if (!view) return;
    const b = view.getBounds();
    const tl = container.toLocal({ x: b.minX, y: b.minY });
    const br = container.toLocal({ x: b.maxX, y: b.maxY });
    highlightBox.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y).stroke({ width: 2, color: 0x38bdf8 });
  }

  /** Loads what `id` needs and is not loaded yet; a failure is reported per path, never thrown. */
  async function load(id: string): Promise<void> {
    const need = assetsOf(id).filter((p) => !loaded.has(p));
    if (need.length === 0) return;
    try {
      await loader.load(need);
      for (const p of need) loaded.add(p);
    } catch (e) {
      // ponytail: the loader fails as one batch, so every path in it is named — per-path precision needs a per-path loader.
      const why = e instanceof Error ? e.message : String(e);
      for (const p of need)
        error(id, `asset "${p}" failed to load: ${why}`, 'check the path under the project');
    }
    refresh();
    redraw();
  }

  const notDeclared = (id: string) =>
    error(id, `scene "${id}" is not declared`, `add scenes/${id}.scene.yml`);

  /** A nested host keeps its own common props (alpha above all) once a transition is over. */
  const settleHosts = (hosts: Entry[], visible: boolean) => {
    for (const e of hosts) {
      applyCommon(e.view, e.node.props);
      e.view.visible = visible;
    }
  };

  async function show(id: string, opts?: { transition?: string }): Promise<void> {
    if (!docs.has(id)) return notDeclared(id);
    if (visibleIds.includes(id) || shownNested.has(id)) return;
    await load(id);
    // `replace` may have run during the load: read everything again.
    if (!docs.has(id)) return notDeclared(id);
    const wanted = opts?.transition ?? options.transition ?? 'cut';
    const hosts = nestingEntries(id);
    if (hosts.length > 0) {
      shownNested.add(id);
      for (const e of hosts) e.view.visible = true;
      await runTransition(wanted, { from: [], to: hosts.map((e) => e.view) });
      if (shownNested.has(id)) settleHosts(nestingEntries(id), true);
      return;
    }
    reportMissing(mounted.get(id)!);
    const view = mounted.get(id)!.view;
    container.addChildAt(view, container.getChildIndex(highlightBox));
    visibleIds.push(id);
    view.visible = true;
    await runTransition(wanted, { from: [], to: [view] });
    if (visibleIds.includes(id)) mounted.get(id)!.view.alpha = 1;
  }

  async function hide(id: string): Promise<void> {
    const nested = shownNested.has(id);
    if (!nested && !visibleIds.includes(id)) return;
    const from = nested ? nestingEntries(id).map((e) => e.view) : [mounted.get(id)!.view];
    await runTransition(options.transition ?? 'cut', { from, to: [] });
    // `replace` may have remounted (or dropped) the document meanwhile: act on what is mounted NOW.
    if (nested) {
      if (shownNested.has(id)) settleHosts(nestingEntries(id), false);
      shownNested.delete(id);
    } else if (visibleIds.includes(id)) {
      visibleIds.splice(visibleIds.indexOf(id), 1);
      const view = mounted.get(id)!.view;
      container.removeChild(view);
      view.alpha = 1;
    }
    const needed = new Set(visibleIds.flatMap((v) => assetsOf(v)));
    const orphans = [...loaded].filter((p) => !needed.has(p));
    if (orphans.length === 0) return;
    for (const p of orphans) loaded.delete(p);
    try {
      await loader.unload(orphans);
    } catch (e) {
      error(id, `unloading assets failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    refresh();
  }

  const offTypes = nodeTypes.subscribe(() => {
    const stale = [...mounted].filter(([, m]) =>
      [...m.types].some(([t, was]) => nodeTypes.get(t) !== was),
    );
    vanished = new Map(
      stale.map(([id, m]) => [
        id,
        new Set([...m.types].filter(([t, was]) => was && !nodeTypes.get(t)).map(([t]) => t)),
      ]),
    );
    try {
      remount(stale.map(([id]) => id));
    } finally {
      vanished = null;
    }
  });

  const service: ScenesService = {
    container,
    ready: Promise.resolve(),
    show: (id, opts) => enqueue(() => show(id, opts)),
    hide: (id) => enqueue(() => hide(id)),
    visible: () => [...visibleIds],
    docs: () => docs,
    replace(next) {
      const nextById = new Map(next.map((d) => [d.id, d]));
      const changed = new Set<string>();
      for (const [id, doc] of docs)
        if (JSON.stringify(nextById.get(id)) !== JSON.stringify(doc)) changed.add(id);
      for (const id of nextById.keys()) if (!docs.has(id)) changed.add(id);
      // A document nesting a changed one carries a copy of it: it remounts too, transitively.
      for (let grew = true; grew;) {
        grew = false;
        for (const doc of next) {
          if (changed.has(doc.id) || ![...refsOf(doc)].some((r) => changed.has(r))) continue;
          changed.add(doc.id);
          grew = true;
        }
      }
      docs.clear();
      for (const doc of next) docs.set(doc.id, doc);
      remount([...changed]);
    },
    highlight(ref) {
      current = ref;
      redraw();
    },
    assetsOf: (id) => assetsOf(id),
    mountDoc(id, chain) {
      const doc = docs.get(id);
      if (!doc || chain.includes(id)) return null;
      const view = new Container();
      view.label = id;
      const seen = new Set<string>();
      for (const node of doc.nodes) mountNode(node, view, id, chain, seen);
      return view;
    },
    sceneView: (id) => mounted.get(id)?.view,
    view(ref) {
      const m = mounted.get(ref.scene);
      return m?.nodes.get(ref.node)?.view ?? m?.all.find((e) => e.node.id === ref.node)?.view;
    },
    resize(viewportWidth, viewportHeight) {
      const fit = fitStage(
        { width: viewportWidth, height: viewportHeight },
        options.design,
        options.mode,
      );
      container.scale.set(fit.scale);
      container.position.set(fit.x, fit.y);
      return fit;
    },
    destroy() {
      offTypes();
      for (const id of [...mounted.keys()]) unmountTop(id);
      container.removeChildren();
      options.root.removeChild(container);
      container.destroy();
    },
  };
  return service;
}
