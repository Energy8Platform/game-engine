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
  view(ref: SceneRef): Container | undefined;
  readonly container: Container;
  resize(viewportWidth: number, viewportHeight: number): Fit;
  destroy(): void;
}

interface Entry {
  view: Container;
  node: SceneNode;
  /** The node's own props, through the type's schema. */
  props: Record<string, unknown>;
  type: NodeType;
}

interface Mount {
  view: Container;
  /** Top-level nodes by id — what `view()` answers. */
  nodes: Map<string, Entry>;
  /** Every entry, nested ones included, in mount order — what unmount walks. */
  all: Entry[];
  /** Type identities at mount time, unknown ones as `undefined` — a change remounts. */
  types: Map<string, NodeType | undefined>;
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
      error(
        where,
        `node type "${node.type}" is not registered — the node is skipped`,
        'register it, or pick a type that is',
      );
      return;
    }
    let view: Container;
    let props: Record<string, unknown>;
    try {
      props = type.schema(node.props) as Record<string, unknown>;
      view = type.mount(props, mountCtx([...chain, sceneId]));
    } catch (e) {
      error(
        where,
        `${node.type} "${node.id}" failed to mount: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    applyCommon(view, node.props);
    view.label = node.id;
    parent.addChild(view);
    const entry: Entry = { view, node, props, type };
    building?.all.push(entry);
    if (building && chain.length === 0) building.nodes.set(node.id, entry);
    for (const child of node.children ?? []) mountNode(child, view, sceneId, chain, seen);
  }

  function mountTop(id: string): void {
    const view = new Container();
    view.label = id;
    const m: Mount = { view, nodes: new Map(), all: [], types: new Map() };
    building = m;
    const seen = new Set<string>();
    for (const node of docs.get(id)!.nodes) mountNode(node, view, id, [], seen);
    building = null;
    mounted.set(id, m);
    for (const e of m.all)
      if (e.type.type === 'scene' && shownNested.has(e.props.scene as string))
        e.view.visible = true;
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
    for (const id of ids) {
      unmountTop(id);
      if (!docs.has(id)) {
        const at = visibleIds.indexOf(id);
        if (at >= 0) visibleIds.splice(at, 1);
        shownNested.delete(id);
        continue;
      }
      mountTop(id);
      if (visibleIds.includes(id)) {
        container.addChild(mounted.get(id)!.view);
        container.addChild(highlightBox);
      }
    }
    refresh();
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

  /** Lets every mounted node re-read what it depends on (a texture after a load or an unload). */
  function refresh(): void {
    for (const m of mounted.values())
      for (const e of m.all) e.type.update?.(e.view, e.props, mountCtx([]));
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
    for (const c of [...run.from, ...run.to]) c.alpha = 1;
  }

  const enqueue = (run: () => Promise<void>): Promise<void> => (queue = queue.then(run, run));

  async function show(id: string, opts?: { transition?: string }): Promise<void> {
    if (!docs.has(id)) {
      error(id, `scene "${id}" is not declared`, `add scenes/${id}.scene.yml`);
      return;
    }
    if (visibleIds.includes(id) || shownNested.has(id)) return;
    const need = assetsOf(id).filter((p) => !loaded.has(p));
    if (need.length > 0) {
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
    }
    const hosts = nestingEntries(id);
    let to: Container[];
    if (hosts.length > 0) {
      to = hosts.map((e) => e.view);
      shownNested.add(id);
    } else {
      const view = mounted.get(id)!.view;
      container.addChild(view);
      container.addChild(highlightBox);
      visibleIds.push(id);
      to = [view];
    }
    for (const c of to) c.visible = true;
    await runTransition(opts?.transition ?? options.transition ?? 'cut', { from: [], to });
  }

  async function hide(id: string): Promise<void> {
    let from: Container[];
    if (visibleIds.includes(id)) {
      from = [mounted.get(id)!.view];
    } else if (shownNested.has(id)) {
      from = nestingEntries(id).map((e) => e.view);
    } else return;
    await runTransition(options.transition ?? 'cut', { from, to: [] });
    if (visibleIds.includes(id)) {
      visibleIds.splice(visibleIds.indexOf(id), 1);
      container.removeChild(from[0]);
    } else {
      shownNested.delete(id);
      for (const c of from) c.visible = false;
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
    const stale = [...mounted]
      .filter(([, m]) => [...m.types].some(([t, was]) => nodeTypes.get(t) !== was))
      .map(([id]) => id);
    remount(stale);
  });

  const service: ScenesService = {
    container,
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
      highlightBox.clear();
      const view = ref && service.view(ref);
      highlightBox.visible = !!view;
      if (!view) return;
      const b = view.getBounds();
      const tl = container.toLocal({ x: b.minX, y: b.minY });
      const br = container.toLocal({ x: b.maxX, y: b.maxY });
      highlightBox.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y).stroke({ width: 2, color: 0x38bdf8 });
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
    view: (ref) => mounted.get(ref.scene)?.nodes.get(ref.node)?.view,
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
