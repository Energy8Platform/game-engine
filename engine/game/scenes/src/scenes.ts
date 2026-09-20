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
 * A `pin` (COMMON) applies to a document's OWN top-level mount; an
 * embedded copy is laid out by its host — the safe rect is in the outer
 * root's coordinates, which a `scene` node's subtree does not share. The
 * `portrait` variant (spec §6) is the same story: a document's top-level
 * entries take `portrait.nodes[id]` while the safe rect is taller than
 * wide (`applyVariant`), an embedded copy keeps its host's layout.
 *
 * Like `stage` before it, this is unit-testable end to end: `Container`,
 * `Sprite` and `Graphics` all build headlessly in plain Node.
 */
import type { Context } from 'cordis';
import { Container, Graphics } from 'pixi.js';
import Schema from 'schemastery';
import {
  diagnostic,
  type Diagnostic,
  type SafeArea,
  type SceneDoc,
  type SceneNode,
} from '@energy8engine/contracts';
import { fitStage, safeSize, type Fit, type Size } from './fit';
import { createTransitions, cut, type TickerLike, type TransitionsService } from './transitions';
import {
  COMMON,
  applyCommon,
  commonProps,
  place,
  type NodeType,
  type NodeTypesService,
} from './node-types';
import type { AssetLoader } from './builtin';

export interface CreateScenesOptions {
  /** Parent to mount the runtime's container into — typically a renderer's `app.stage`. */
  root: Container;
  design: Size;
  /** The design in portrait (a taller-than-wide safe rect); absent = `design` rotated. */
  portrait?: Size;
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
  /**
   * Patches a mounted node's props for THE MOUNTS, not the document: the
   * merge (document props + earlier patches + `patch`) goes back through
   * the type's schema, `update` re-applies it and the common pass runs
   * again. Every copy of the node is patched — nesting is by copy, so a
   * document another scene embeds is mounted more than once and only one
   * of those copies is the one on screen. A remount — a document edit, a
   * hot re-apply — drops it. `false` (with a diagnostic) for a node
   * nothing mounted, and for a value the schema or the apply refuses, in
   * which case the patch is not kept (by any copy).
   */
  setProps(ref: SceneRef, patch: Record<string, unknown>): boolean;
  /**
   * A mounted node's full prop schema — `COMMON` with the type's own dict
   * merged over it, so a type owning `width`/`height` wins the name the
   * same way `applyCommon` lets it. What a caller coercing a literal reads:
   * `nodeSchema(ref)?.dict?.[prop]?.type`.
   */
  nodeSchema(ref: SceneRef): Schema | undefined;
  readonly container: Container;
  /**
   * Settles once the boot document set is in: the runtime's `/api/scenes`
   * GET has `replace`d (or a frame's `replace` landed first); REJECTS when
   * the GET failed and nothing replaced. Already resolved here — the
   * runtime half (`./runtime`) is what defers it.
   */
  ready: Promise<void>;
  /**
   * Fits the design into the viewport minus `insets` (a shell's bar; see
   * `fitStage`) and re-places every top-level node with a `pin` against
   * the new safe rect. When the safe rect's orientation flips, every
   * top-level entry with a `portrait` override takes (or drops) it —
   * `applyVariant`; nothing else re-applies.
   */
  resize(viewportWidth: number, viewportHeight: number, insets?: SafeArea): Fit;
  /** The last `resize`'s fit; `null` before the first — pinned nodes sit at their bare x/y until then. */
  fit(): Fit | null;
  /** The last `resize`'s verdict on the safe rect (`portrait` = taller than wide); `landscape` before the first. */
  orientation(): Orientation;
  destroy(): void;
}

export type Orientation = 'landscape' | 'portrait';

interface Entry {
  view: Container;
  node: SceneNode;
  /** The node's own props, through the type's schema — of the LAYERED dict (`rawOf`), not the document's alone. */
  props: Record<string, unknown>;
  type: NodeType;
  /** `<scene>/<node id>` — where a throwing `update` is reported. */
  where: string;
  /**
   * A root of the OUTERMOST document (`mountTop`'s own list) — the only
   * place a `pin` means anything, since the safe rect is in that root's
   * coordinates. A child, and every node of an embedded copy (`mountDoc`),
   * is laid out by its parent/host: absolute placement.
   */
  top: boolean;
  /**
   * What `setProps` patched on top of the node's document props, for this
   * mount only. It lives on the ENTRY rather than in a side map keyed by
   * one: a remount builds fresh entries, so the patch is gone with no
   * bookkeeping — and nothing holds a destroyed entry alive.
   */
  live?: Record<string, unknown>;
  /**
   * The document's `portrait.nodes[id]` while it is APPLIED to this entry
   * (portrait, and the override validated); a layer under `live`, so a
   * `setProps` patch still wins. Top-level entries only, like `pin`.
   */
  variant?: Record<string, unknown>;
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
const OWN = new Set(['container', 'image', 'scene', 'shape', 'text']);

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Which prop a refusal is about. Schemastery says `$.tint expect …`, so
 * the key is in the message — but only name it when the PATCH is where it
 * came from; a value carried in from the document is not the patch's to
 * blame, and then every key the caller sent is the honest answer.
 */
const offending = (e: unknown, patch: Record<string, unknown>): string => {
  const named = /^\$\.([^\s.[]+)/.exec(why(e))?.[1];
  return `prop ${named && named in patch ? named : Object.keys(patch).join(', ')}`;
};

export function createScenes(options: CreateScenesOptions): ScenesService {
  const { nodeTypes, loader, report = () => {} } = options;
  const error = (where: string, message: string, fix?: string) =>
    report(diagnostic('error', 'scenes', where, message, fix));
  const warn = (where: string, message: string, fix?: string) =>
    report(diagnostic('warning', 'scenes', where, message, fix));
  const nestedPin = (where: string, id: string) =>
    warn(where, `pin on a nested node "${id}" is ignored`, 'pin only top-level nodes');
  /**
   * `base ⊕ patch` through the type's schema AND the common pass — the two
   * verdicts `setProps` asks before it touches a view — or `null` with a
   * `portrait …` diagnostic that blames `blame` (the override, normally).
   */
  const tryVariant = (
    where: string,
    type: NodeType,
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
    blame = patch,
  ): { raw: Record<string, unknown>; props: Record<string, unknown> } | null => {
    const raw = { ...base, ...patch };
    try {
      const props = type.schema(raw as never) as Record<string, unknown>;
      commonProps(raw, type);
      return { raw, props };
    } catch (err) {
      error(where, `portrait ${offending(err, blame)}: ${why(err)}`, 'fix the override');
      return null;
    }
  };
  /** The values of the props the TYPE declares, as a comparable string — the schema passes common keys through, so `props` alone would say a moved node changed. */
  const ownOf = (type: NodeType, props: Record<string, unknown>): string =>
    JSON.stringify(Object.keys(type.schema.dict ?? {}).map((k) => props[k]));
  /** The document's override for a top-level node, while portrait; `undefined` otherwise. */
  const overrideOf = (sceneId: string, id: string): Record<string, unknown> | undefined =>
    orientation === 'portrait' ? docs.get(sceneId)?.portrait?.nodes?.[id] : undefined;
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
  /** The last `resize`; what a top-level node's `pin` is placed against. */
  let lastFit: Fit | null = null;
  let orientation: Orientation = 'landscape';
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
    /** A root of the outermost document; `false` for children (the recursive call below) and for an embedded copy (`mountDoc`). */
    top = true,
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
    const failed = (e: unknown) =>
      error(
        where,
        `${node.type} "${node.id}" failed to mount: ${e instanceof Error ? e.message : String(e)}`,
      );
    // A top-level node mounted while portrait takes its override now (a
    // document shown after the flip is right from the start). Refused, it
    // is the OVERRIDE's diagnostic and the node mounts with its document
    // props — the same verdict `applyVariant` gives a flip. `node.props`
    // itself is never written: `replace()`'s diff reads it.
    let variant = top ? overrideOf(sceneId, node.id) : undefined;
    const merged = variant && tryVariant(where, type, node.props, variant);
    if (variant && !merged) variant = undefined;
    const raw = merged ? merged.raw : node.props;
    let view: Container;
    let props: Record<string, unknown>;
    let masks = false;
    try {
      props = merged ? merged.props : (type.schema(node.props) as Record<string, unknown>);
      view = type.mount(props, mountCtx([...chain, sceneId]));
      // Inside the try: a common prop off its type (`x: 'abc'`) is this
      // node's failure, not the whole set's.
      // `mask` is a COMMON prop, read off the dict the pass itself applied
      // — the same one, STRIPPED of the `width`/`height` the type owns, so
      // a type whose own `width` is not a number never fails here.
      masks = applyCommon(view, raw, type, top ? lastFit : null).mask === true;
    } catch (e) {
      failed(e);
      return;
    }
    // A pinned CHILD is a warning — once, in the document's own mount
    // (`chain` empty): an embedded copy's children are the same nodes,
    // reported there already, and an embedded ROOT is silent on purpose —
    // the same document pins fine in its own top-level mount.
    if (!top && chain.length === 0 && node.props?.pin) nestedPin(where, node.id);
    view.label = node.id;
    parent.addChild(view);
    // After `addChild`: pixi wants the mask in the same tree it masks.
    // The node still draws its own children — only its PARENT is clipped.
    // A parent has ONE mask: the first sibling asking for it keeps it, and
    // the next one is a diagnostic rather than a silent overwrite.
    if (masks) {
      if (parent.mask)
        error(
          where,
          `"${(parent.mask as unknown as Container).label}" is already the mask of ${parent.label}`,
          'one `mask: true` per parent',
        );
      else parent.mask = view;
    }
    const entry: Entry = { view, node, props, type, where, top, variant };
    building?.all.push(entry);
    if (building && chain.length === 0) building.nodes.set(node.id, entry);
    for (const child of node.children ?? []) mountNode(child, view, sceneId, chain, seen, false);
    // A `container`'s local bounds ARE its children's: the pass above ran
    // before they mounted, read 0, and left `scale` at 1 — so a node
    // carrying `width`/`height` gets the pass again now that there is
    // something to measure. Idempotent for a `Sprite`/`Graphics`, whose
    // bounds never depended on a child.
    if (raw?.width !== undefined || raw?.height !== undefined) {
      // Same guard as the first pass: a throw down here is this node's
      // diagnostic, not the whole set's. It is already on screen, so the
      // node stays — only its size went unapplied.
      try {
        applyCommon(view, raw, type, top ? lastFit : null);
      } catch (e) {
        failed(e);
      }
    }
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
    const doc = docs.get(id)!;
    building = m;
    try {
      const seen = new Set<string>();
      for (const node of doc.nodes) mountNode(node, view, id, [], seen);
    } finally {
      building = null;
    }
    // Once per mount, whatever the orientation: the block names roots only.
    for (const key of Object.keys(doc.portrait?.nodes ?? {}))
      if (!doc.nodes.some((n) => n.id === key))
        warn(
          `${id}/${key}`,
          `portrait override for unknown node "${key}"`,
          'name a top-level node of this scene',
        );
    mounted.set(id, m);
    showHosts(m);
    if (!visibleIds.includes(id)) return;
    const gap = vanished?.get(id);
    reportMissing(gap ? { ...m, missing: m.missing.filter((x) => !gap.has(x.type)) } : m);
  }

  /** A nested scene `show()`n stays shown across a (re)mount of its host: the common pass put the document's `visible` back. */
  const showHosts = (m: Mount) => {
    for (const e of m.all)
      if (e.type.type === 'scene' && shownNested.has(e.props.scene as string))
        e.view.visible = true;
  };

  function unmountEntry(e: Entry): void {
    // A FOREIGN parent survives this unmount (the runtime only detaches
    // what it did not build): drop its `mask` before the masking view
    // goes, or it keeps clipping against a destroyed one.
    if (e.view.parent?.mask === e.view) e.view.parent.mask = null;
    e.type.unmount?.(e.view);
    e.view.parent?.removeChild(e.view);
    if (OWN.has(e.type.type)) e.view.destroy({ children: false });
  }

  function unmountTop(id: string): void {
    const m = mounted.get(id);
    if (!m) return;
    for (const e of [...m.all].reverse()) unmountEntry(e);
    m.view.parent?.removeChild(m.view);
    m.view.destroy({ children: false });
    mounted.delete(id);
  }

  /**
   * ONE top-level node mounted again in place, for a type without
   * `update` whose own props the variant changed: its subtree (children,
   * an embedded copy — every entry whose view sits under it) is unmounted
   * the way `unmountTop` does, `mountNode` rebuilds it from the document
   * (reading the current orientation's override itself) and the new view
   * goes back at the old child index — `remount`'s `wasAt` precedent, one
   * level down. The entry is replaced in `nodes`/`all`; a live patch on
   * the subtree goes with the old one, as with any remount.
   */
  function remountNode(m: Mount, sceneId: string, e: Entry): void {
    const parent = e.view.parent;
    if (!parent) return;
    const at = parent.getChildIndex(e.view);
    const under = (v: Container): boolean => {
      for (let p = v.parent; p; p = p.parent) if (p === e.view) return true;
      return false;
    };
    const gone = new Set(m.all.filter((x) => x === e || under(x.view)));
    for (const x of [...gone].reverse()) unmountEntry(x);
    m.all = m.all.filter((x) => !gone.has(x));
    m.nodes.delete(e.node.id);
    building = m;
    try {
      mountNode(e.node, parent, sceneId, [], new Set());
    } finally {
      building = null;
    }
    const fresh = m.nodes.get(e.node.id);
    if (fresh) parent.setChildIndex(fresh.view, at);
  }

  /**
   * The orientation flipped: every top-level entry with a `portrait`
   * override takes it (or, on the way back, drops the one it holds) — the
   * `setProps` machinery with the variant as a layer UNDER the live
   * patches. Per entry: validate (schema + common pass) — a refusal is a
   * diagnostic and the entry keeps what it has — then `update` + the
   * common pass; a type without `update` gets the common pass alone when
   * its own props did not change (a `container`, a `scene` host moved or
   * hidden — its children keep their live patches), a remount otherwise.
   * An entry with neither an override nor a held variant is not touched.
   */
  function applyVariant(): void {
    for (const [id, m] of mounted)
      for (const e of [...m.nodes.values()]) {
        const next = overrideOf(id, e.node.id);
        if (!next && !e.variant) continue;
        // On the way back there is no override to blame: the live patch is what is left.
        const blame = next ?? e.live ?? {};
        const merged = tryVariant(e.where, e.type, e.node.props, { ...next, ...e.live }, blame);
        if (!merged) continue;
        if (!e.type.update && ownOf(e.type, merged.props) !== ownOf(e.type, e.props)) {
          remountNode(m, id, e);
          continue;
        }
        try {
          e.type.update?.(e.view, merged.props, mountCtx([]));
          applyCommon(e.view, merged.raw, e.type, lastFit);
        } catch (err) {
          error(e.where, `portrait ${offending(err, blame)}: ${why(err)}`, 'fix the override');
          continue;
        }
        e.props = merged.props;
        e.variant = next;
        e.failed = false;
      }
    // The common pass (and a remount) put the document's `visible` back on a host: a nested scene `show()`n stays shown.
    for (const m of mounted.values()) showHosts(m);
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
    // Both layers: a root's portrait override may name another `src`, and
    // it is loaded whatever the orientation (a flip must not wait on a load).
    const walk = (nodes: SceneNode[], overrides?: Record<string, Record<string, unknown>>) => {
      for (const n of nodes) {
        const type = nodeTypes.get(n.type);
        for (const p of type?.assets?.(n.props) ?? []) out.add(p);
        const o = overrides?.[n.id];
        if (o) for (const p of type?.assets?.({ ...n.props, ...o }) ?? []) out.add(p);
        if (n.type === 'scene' && typeof n.props.scene === 'string')
          for (const p of assetsOf(n.props.scene, seen)) out.add(p);
        walk(n.children ?? []);
      }
    };
    walk(doc.nodes, doc.portrait?.nodes);
    return [...out];
  }

  /**
   * A node's entry by ref. `all` also carries an embedded `scene` node's OWN nested doc
   * (`mountDoc` files its entries into the same top-level `Mount` — see `building` above),
   * so a bare id search would find scene `b`'s `x` while looking up `a`'s. `where` is
   * `<scene>/<node>` already: scope the fallback to entries actually declared in `ref.scene`.
   */
  const entryOf = (ref: SceneRef): Entry | undefined => {
    const m = mounted.get(ref.scene);
    return (
      m?.nodes.get(ref.node) ??
      m?.all.find((e) => e.node.id === ref.node && e.where.startsWith(`${ref.scene}/`))
    );
  };

  /**
   * EVERY mounted copy of a node, not just the one `entryOf` answers:
   * nesting is by copy, so a document that some visible scene embeds is
   * mounted twice — its own (off-screen) top-level mount and the host's
   * subtree. `show()` of it flips the EMBEDDED copy, so patching only
   * `entryOf`'s would write to the copy nobody can see. `where` is
   * `<scene>/<node>`, which is exactly the identity wanted.
   */
  const entriesOf = (ref: SceneRef): Entry[] => {
    const where = `${ref.scene}/${ref.node}`;
    return [...mounted.values()].flatMap((m) => m.all.filter((e) => e.where === where));
  };

  /** A node's document props, its applied portrait override over them, its live `setProps` patch on top — what the common pass reads. */
  const rawOf = (e: Entry): Record<string, unknown> =>
    e.variant || e.live ? { ...e.node.props, ...e.variant, ...e.live } : e.node.props;

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
      applyCommon(e.view, rawOf(e), e.type, e.top ? lastFit : null);
      e.view.visible = visible;
    }
  };

  /**
   * Every top-level entry with a `pin`, POSITIONED again against
   * `lastFit` — the one thing a resize re-applies. Position only, never
   * the whole common pass: that would put the document's `visible` back
   * over a `show()`n host and its `alpha` over a running tween.
   */
  function placePinned(): void {
    for (const m of mounted.values())
      for (const e of m.all) {
        const raw = rawOf(e);
        if (e.top && raw.pin) place(e.view, commonProps(raw, e.type).common, lastFit);
      }
  }

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
      // An embedded copy: its host lays it out, so no node in it is `top`.
      for (const node of doc.nodes) mountNode(node, view, id, chain, seen, false);
      return view;
    },
    sceneView: (id) => mounted.get(id)?.view,
    view: (ref) => entryOf(ref)?.view,
    setProps(ref, patch) {
      const entries = entriesOf(ref);
      if (entries.length === 0) {
        error(
          `${ref.scene}/${ref.node}`,
          `node "${ref.node}" is not mounted in scene "${ref.scene}" — nothing to set`,
          'check the scene and node ids',
        );
        return false;
      }
      // Everything is validated (and applied) from the MERGE, never from
      // the patch alone: a type's schema fills its defaults from a whole
      // dict, and the common pass needs the node's own `x`/`alpha` too.
      // EVERY copy is validated before ANY of them is touched — this is
      // the whole atomicity argument. `type.update` mutates the view (a
      // `shape` redraws at the new width), so a common prop the runtime
      // would reject (`x: 'abc'`, a colour `Color` refuses) has to be
      // caught here and not one step later, or a refused patch lands in
      // halves — across the copies as much as across the two passes.
      const plan: { e: Entry; merged: Record<string, unknown>; props: Record<string, unknown> }[] =
        [];
      for (const e of entries) {
        const merged = { ...rawOf(e), ...patch };
        try {
          const props = e.type.schema(merged as never) as Record<string, unknown>;
          commonProps(merged, e.type);
          plan.push({ e, merged, props });
        } catch (err) {
          error(e.where, `${offending(err, patch)}: ${why(err)}`, 'fix the value');
          return false;
        }
      }
      // A pin patched onto a CHILD: one warning per call, judged from the
      // document's own mount (`entryOf`), where `top` says whether the
      // node is a root — every copy shares that, so not per copy.
      if (patch.pin && entryOf(ref)?.top === false) nestedPin(`${ref.scene}/${ref.node}`, ref.node);
      for (const { e, merged, props } of plan) {
        try {
          e.type.update?.(e.view, props, mountCtx([]));
          applyCommon(e.view, merged, e.type, e.top ? lastFit : null);
        } catch (err) {
          // Not a validation failure any more (both passes said yes): a type
          // whose `update` throws for a reason of its own. Reported the same
          // way, but the view may have moved — nothing more this can do.
          error(e.where, `${offending(err, patch)}: ${why(err)}`, 'fix the value');
          return false;
        }
      }
      // Only a patch that actually landed is remembered — a refused one
      // must not poison the next `refresh()` (or the next patch's merge).
      // Committed in a pass of its OWN, after every copy's apply came back
      // clean: a throw on the LAST copy would otherwise leave the earlier
      // ones remembering a patch this call goes on to answer `false` for,
      // and `refresh()` re-applying it forever. The throwing copy's view
      // may still have moved — the single-copy caveat above, unchanged.
      for (const { e, props } of plan) {
        e.live = { ...e.live, ...patch };
        e.props = props;
        e.failed = false;
      }
      return true;
    },
    nodeSchema(ref) {
      const e = entryOf(ref);
      if (!e) return undefined;
      return Schema.object({ ...COMMON.dict, ...(e.type.schema.dict ?? {}) });
    },
    resize(viewportWidth, viewportHeight, insets) {
      // Orientation is the SAFE rect's, in pixels, decided BEFORE the fit
      // — the fit's design depends on it, so it cannot come from the fit.
      const viewport = { width: viewportWidth, height: viewportHeight };
      const safe = safeSize(viewport, insets);
      const next: Orientation = safe.height > safe.width ? 'portrait' : 'landscape';
      const design =
        next === 'portrait'
          ? (options.portrait ?? { width: options.design.height, height: options.design.width })
          : options.design;
      const fit = fitStage(viewport, design, options.mode, insets);
      container.scale.set(fit.scale);
      container.position.set(fit.x, fit.y);
      lastFit = fit;
      if (next !== orientation) {
        orientation = next;
        applyVariant();
      }
      placePinned();
      redraw();
      return fit;
    },
    fit: () => lastFit,
    orientation: () => orientation,
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
