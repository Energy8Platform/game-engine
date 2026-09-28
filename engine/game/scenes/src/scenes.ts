/**
 * The scenes runtime: documents (`SceneDoc`, a tree of typed nodes) mounted
 * into pixi `Container`s through the node-type registry, shown and hidden
 * through transitions, their assets loaded before they show and unloaded
 * once nothing visible needs them.
 *
 * Every document gets a top-level mount at `replace`; a `scene` node
 * mounts the referenced document AGAIN, as its own subtree (`mountDoc`),
 * so nesting is by copy, not by reference — `views()` lists every copy of
 * a node (any depth, any host), `view()` picks the one on screen (its doc
 * has the rule). `show(id)` of a document some visible scene nests just
 * flips that node visible; otherwise the document's own view joins
 * `container`.
 *
 * `mountCell` is the third kind, and the odd one out: a private copy for
 * ONE cell of a reel board (a symbol state of type `scene`), with its own
 * entry list and no `Mount` at all — `view`/`setProps`/`refresh` never
 * find it, nothing shows or hides it, it is never `fit`, and it dies with
 * the cell rather than with a scene on screen. Its roots take the
 * `portrait` override in force AT MOUNT TIME and never flip afterwards:
 * `applyVariant` walks the mounts, and the copy is in none of them — a
 * cell that outlives a rotation is redrawn by the board, not re-laid-out
 * here.
 *
 * A `pin` (COMMON) applies to a document's OWN top-level mount; an
 * embedded copy is laid out by its host — the safe rect is in the outer
 * root's coordinates, which a `scene` node's subtree does not share. The
 * `portrait` variant (spec §6) is NOT: a document's ROOTS take
 * `portrait.nodes[id]` while the safe rect is taller than wide
 * (`applyVariant`) in the document's own mount AND in every embedded
 * copy — the copy is what is on screen when a host shows it (`big_win`
 * is only ever shown through `base_game`'s `scene` node). A `pin` in that
 * override stays inert on the copy, as any pin of an embedded root.
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
  cellProps,
  isCellBinding,
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

/**
 * One document mounted for ONE cell — a private copy, no part of any
 * `Mount`: nothing addresses it by id (`view`/`setProps` never find it),
 * nothing shows or hides it, and it lives and dies with the cell that
 * asked for it rather than with a scene on screen.
 */
export interface CellMount {
  view: Container;
  /** Whether any node of the copy carries a `$cell` prop — `false` means `bind` has nothing to do, and a caller can skip it (and whatever it does around it). */
  readonly bound: boolean;
  /** Re-resolves every `$cell` prop of the copy against `data` (`update` + the common pass). */
  bind(data: Record<string, unknown>): void;
  /** Every node's `once` (a strip, a spritesheet, a spine) awaited together; resolves at once when none has one. Answers whether any node HAD one — a caller showing the copy for a while (`@energy8engine/symbols`' `playState`) floors it instead. */
  once(): Promise<boolean>;
  destroy(): void;
}

export interface ScenesService {
  /**
   * `preview`: the IDE looking at a document, not the game showing it. It
   * skips exactly one shown-time check — the `$cell` no-cell warning — for
   * this show and for any remount while it stays shown, so a cell scene
   * previewed without a cell is not called a mistake. An unregistered node
   * type is still reported: that is what an author previewing wants to see.
   */
  show(id: string, opts?: { transition?: string; preview?: boolean }): Promise<void>;
  hide(id: string): Promise<void>;
  /** Top-level scenes shown, in show order; a nested show is not listed. */
  visible(): string[];
  docs(): ReadonlyMap<string, SceneDoc>;
  /** Swaps the documents; only changed ones (and the ones nesting them) remount. */
  replace(docs: SceneDoc[]): void;
  highlight(ref: SceneRef | null): void;
  /** Every asset path the document (and its nested scenes) needs. */
  assetsOf(id: string): string[];
  /**
   * Paths a ROW draws with that no document names — a step handler's
   * textures, a plugin's spritesheets, anything named in TypeScript
   * instead of in `scenes/*.scene.yml`. Without this a row's sheets
   * silently resolve to nothing, since the loader only ever fetches what
   * `assetsOf` found.
   *
   * Every call takes a batch of its own, always — it never waits to join
   * a `show`'s. A composition that shows no document at all (a row used
   * only for `mountCell`, or for symbols) has no batch to join, and a
   * `require` that loaded only sometimes is no contract anyone can hold.
   * The batches run in order on the runtime's own queue, so a path an
   * earlier one already took is skipped rather than fetched twice:
   * registered twice, a path is still loaded once. It survives a `hide`'s
   * orphan sweep for as long as any registration lives.
   *
   * A path must live where the BUILD ships it, not merely where dev
   * serves it: `e8 build` copies the project's `assets/` wholesale and
   * nothing else, so art kept beside a plugin resolves in dev and 404s in
   * `dist`.
   *
   * This returns a disposer, not a promise — there is no awaiting the
   * batch. The requiring row must tolerate `loader.get(path) === undefined`
   * until it lands and draw itself again when it has; the `refresh()` the
   * batch ends with helps no view here, since by definition no document
   * names a required path.
   *
   * The disposer drops the claim, nothing more — NOTHING IS UNLOADED when
   * the last holder goes. The next `hide` whose sweep finds the path
   * unneeded is what unloads it. A disposer that runs before its own
   * batch does cancels it: nothing is fetched for a claim already gone.
   */
  require(paths: string[]): () => void;
  /**
   * `fn` runs once per tick with the ticker's `deltaMS` — for code with no
   * node of its own to hang an `update` off (paper-duel's tier overlay
   * follows falling cells this way, the one place that migration reaches
   * a renderer's `app.ticker` directly). No ticker (`options.ticker` is
   * absent or `null`, a headless composition) and the registration is
   * still accepted, just never fires; the returned disposer is a no-op
   * either way. One ticker callback fans out to every registration —
   * hooked on the FIRST `onFrame`, unhooked once the LAST disposer runs,
   * so a composition that never calls this adds no per-frame work. A
   * throwing `fn` is unhooked and reported once (`scenes`, `onFrame`);
   * its siblings keep firing.
   */
  onFrame(fn: (dt: number) => void): () => void;
  /** Mounts `id`'s tree into a fresh container for a `scene` node; `null` on a cycle or a missing id. Internal to `scene` nodes. */
  mountDoc(id: string, chain: string[]): Container | null;
  /**
   * A private copy of `id` for one cell, its `$cell.<field>` props
   * resolved against `data` — what a symbol state of type `scene` mounts.
   * `null` when nothing declares `id`.
   */
  mountCell(id: string, data?: Record<string, unknown>): CellMount | null;
  sceneView(id: string): Container | undefined;
  /**
   * THE copy of this node that is ON SCREEN, not just A copy of it.
   * Nesting is by copy (the module doc): a document some visible `scene`
   * node embeds is mounted TWICE, once as its own (usually hidden)
   * top-level mount and once as the host's subtree, and only one of those
   * is what the player sees. Among every mounted copy (`views`), this
   * answers the one whose HOST — the document whose own top-level mount
   * holds it — is currently shown (`visible()`), preferring the host
   * shown LATEST when more than one qualifies (a document embedded in two
   * shown hosts, or embedded in one and ALSO shown on its own). No shown
   * host holds a copy → the copy in a host `load`ed for a show still to
   * come (the latest `load` first; `hide` drops a host from that list, and
   * so does a `replace` that no longer declares it): a pose set between
   * `load(host)` and `show(host)` lands on the copy that show puts on
   * screen. Neither → the document's own top-level mount, same as every
   * version of this before nesting-awareness existed.
   * `undefined` when nothing mounted the node. A plugin animating a view
   * (`@energy8engine/flow-fx`'s `tween`) wants exactly this, never a copy
   * nobody can see: tweening the wrong one moves numbers, not pixels.
   */
  view(ref: SceneRef): Container | undefined;
  /**
   * Every mounted copy of the node — the document's own top-level mount
   * and any copy a `scene` node embedded it as — in `Mount` order: the
   * order the top-level mounts were last (re)built. A `replace` builds
   * them in declaration order and a remount moves a document to the end,
   * so the own mount is NOT reliably first — pick a copy by where it sits
   * (its host's `sceneView`), never by index. `[]` when nothing mounted
   * it. `view` picks the one of these that is actually on screen; this is
   * every candidate it picked from.
   */
  views(ref: SceneRef): Container[];
  /**
   * Loads what `id` needs — its own `assetsOf`, and anything a row
   * `require`d — skipping whatever is already loaded. `show(id)` calls
   * this itself, so calling it ahead of time (a preload, or posing a view
   * before the game ever shows the document) makes the `show` that
   * follows ask the loader for nothing new — and makes `id` a pending
   * host for `view()` until it is hidden (`view`'s doc). The refresh this
   * ends with is NARROW: only the nodes fed by what THIS call loaded
   * re-run their `update` (`refresh`'s own doc has the exact rule) — a
   * pose on any other view, in any other document, is left alone. An
   * undeclared `id` is `show`'s own diagnostic, and resolves.
   */
  load(id: string): Promise<void>;
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
   * Plays every mounted copy of the node once through its type's `once` (a
   * strip's one-shot) and settles when the last one ends: `true` when the
   * type has a `once` and a copy played, `false` otherwise. Every copy,
   * the way `setProps` patches every copy — nesting is by copy, and only
   * one of them is on screen. `visible` is the caller's: a node of a hidden
   * document plays unseen. A node nothing mounted is `false` with an error;
   * a copy whose `once` throws is reported at its `where`, and the others
   * still play.
   */
  once(ref: SceneRef): Promise<boolean>;
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
  /** The node's own props, through the type's schema — of the LAYERED dict (`rawOf`), not the document's alone, with any `$cell` binding resolved over the top (`bound`). */
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
   * bookkeeping — and nothing holds a destroyed entry alive. The one
   * remount that keeps it is `setProps`' own (an own prop of a type
   * without `update`): the fresh entry is mounted with it.
   */
  live?: Record<string, unknown>;
  /** The document this node is declared in (`where`'s left half) and the host chain it was mounted under (`[]` for the document's own mount) — what a per-node remount needs. */
  scene: string;
  chain: string[];
  /** A root of its DOCUMENT — of the own top-level mount (`top`) or of an embedded copy — the entries a `portrait` override addresses. */
  root: boolean;
  /**
   * The document's `portrait.nodes[id]` while it is APPLIED to this entry
   * (portrait, and the override validated); a layer under `live`, so a
   * `setProps` patch still wins. `root` entries only.
   */
  variant?: Record<string, unknown>;
  /** The props that carried a `$cell.<field>` binding — the only ones a `CellMount.bind` re-resolves. */
  bound?: string[];
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

/**
 * `cellProps` for a mount: the type's props, the keys that carried a
 * `$cell` binding, and the RAW dict the common pass reads with those keys
 * resolved in place — `applyCommon` must never see a binding string on a
 * COMMON prop (`alpha: '$cell.hot'` would fail the whole node).
 *
 * `report` is the node's own diagnostic sink (`cellProps` says what it
 * reports). A call with no cell passes none: with no data nothing is
 * evaluated, so there is nothing to report.
 */
function resolveCell(
  type: NodeType,
  base: Record<string, unknown>,
  cell?: Record<string, unknown>,
  report?: (message: string, fix?: string, severity?: 'error' | 'warning') => void,
): { props: Record<string, unknown>; bound: string[]; raw: Record<string, unknown> } {
  const { props, bound } = cellProps(type, base, cell, report);
  return {
    props,
    bound,
    raw:
      bound.length === 0
        ? base
        : { ...base, ...Object.fromEntries(bound.map((k) => [k, props[k]])) },
  };
}

export function createScenes(options: CreateScenesOptions): ScenesService {
  const { nodeTypes, loader, report = () => {} } = options;
  const error = (where: string, message: string, fix?: string) =>
    report(diagnostic('error', 'scenes', where, message, fix));
  const warn = (where: string, message: string, fix?: string) =>
    report(diagnostic('warning', 'scenes', where, message, fix));
  /** `resolveCell`'s sink for the node at `where`: `cellProps` names the severity, an error by default. */
  const cellReport =
    (where: string) =>
    (message: string, fix?: string, severity: 'error' | 'warning' = 'error') =>
      report(diagnostic(severity, 'scenes', where, message, fix));
  const nestedPin = (where: string, id: string) =>
    warn(where, `pin on a nested node "${id}" is ignored`, 'pin only top-level nodes');
  /**
   * `base ⊕ patch` through the type's schema AND the common pass — the two
   * verdicts `setProps` asks before it touches a view — or `null` with a
   * `portrait …` diagnostic that blames `blame` (the override, normally).
   * Through `resolveCell`, so a `$cell` binding in the merge stands at its
   * empty for both verdicts instead of failing an override that is fine.
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
      const r = resolveCell(type, raw);
      commonProps(r.raw, type);
      return { raw, props: r.props };
    } catch (err) {
      error(where, `portrait ${offending(err, blame)}: ${why(err)}`, 'fix the override');
      return null;
    }
  };
  /** The values of the props the TYPE declares, as a comparable string — the schema passes common keys through, so `props` alone would say a moved node changed. */
  const ownOf = (type: NodeType, props: Record<string, unknown>): string =>
    JSON.stringify(Object.keys(type.schema.dict ?? {}).map((k) => props[k]));
  /** The document's override for one of its roots, while portrait; `undefined` otherwise. */
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
  /** Documents the public `load` readied for a show still to come, the latest last — `view()`'s second choice of host. */
  let pendingIds: string[] = [];
  const shownNested = new Set<string>();
  const loaded = new Set<string>();
  /** One entry per live `require` registration — a path two rows ask for is held until both disposers ran. */
  const required = new Set<{ paths: string[] }>();
  const requiredPaths = (): string[] => [...new Set([...required].flatMap((h) => h.paths))];
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
    /** A root of ITS document — `top`, or a root `mountDoc` mounts; `false` for children. */
    root = top,
    /** A `setProps` patch the node carries into a remount (`remountNode` from `setProps`): the layer OVER the override. */
    live?: Record<string, unknown>,
    /** The cell `mountCell` is mounting for; `undefined` for every other caller, and a `$cell` prop then stands at its empty. */
    cell?: Record<string, unknown>,
  ): Entry | undefined {
    const where = `${sceneId}/${node.id}`;
    if (seen.has(node.id)) {
      error(
        where,
        `node id "${node.id}" is declared twice in "${sceneId}" — ids are unique per document, not per parent, and the later one is skipped`,
        'prefix them, e.g. "rock_bar" and "paper_bar"',
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
    // A root mounted while portrait takes its override now (a document
    // shown after the flip is right from the start). Refused, it is the
    // OVERRIDE's diagnostic and the node mounts with its document props —
    // the same verdict `applyVariant` gives a flip. `node.props` itself is
    // never written: `replace()`'s diff reads it.
    let variant = root ? overrideOf(sceneId, node.id) : undefined;
    // `live` was validated by `setProps` already; only the override can be
    // the one refused — and then the patch still lands, alone, or the
    // fresh host would point at a document it does not show.
    let merged =
      (variant || live) &&
      tryVariant(where, type, node.props, { ...variant, ...live }, variant ?? live);
    if (variant && !merged) {
      variant = undefined;
      if (live) merged = tryVariant(where, type, node.props, live);
    }
    // The variant/live merge first, then the cell resolution over what it
    // produced: `tryVariant` validates the document's own strings, and a
    // binding among them stands at its empty there as it does here.
    const base = merged ? merged.raw : node.props;
    let view: Container;
    let props: Record<string, unknown>;
    let bound: string[];
    let raw = base;
    let masks = false;
    try {
      ({ props, bound, raw } = resolveCell(type, base, cell, cellReport(where)));
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
    const entry: Entry = {
      view,
      node,
      props,
      type,
      where,
      scene: sceneId,
      chain,
      top,
      root,
      variant,
      live,
      bound,
    };
    building?.all.push(entry);
    if (building && chain.length === 0) building.nodes.set(node.id, entry);
    for (const child of node.children ?? [])
      mountNode(child, view, sceneId, chain, seen, false, false, undefined, cell);
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
    return entry;
  }

  /**
   * What a shown mount has to say, now that the game has shown it: each
   * skipped node an error, and each `$cell` binding still in the node's
   * layered props (`rawOf` — a `setProps` literal over it silences it) a
   * warning: a `mounted` document has no cell, so the prop stands at its
   * empty (a built dist may never have run the host's static check). Every
   * document is mounted hidden at `replace`, cell scenes included, which is
   * why this waits for a `show` (or a remount of a shown one). "Shown", not
   * "on screen": a `visible: false` node inside a shown document still
   * warns, rightly. Only a show or a remount checks — a portrait flip or a
   * live `setProps` does not re-check. A preview `show` (`opts.preview`,
   * the IDE looking at a document) passes `preview` and skips only the
   * `$cell` warning; the missing types are always said. A `mountCell` copy is never
   * in `mounted`, so it never comes through here. A repeat on the next
   * `show` is byte-identical, and the diagnostics service collapses it.
   */
  const reportShown = (m: Mount, preview = false) => {
    for (const { where, type } of m.missing)
      error(
        where,
        `node type "${type}" is not registered — the node is skipped`,
        'register it, or pick a type that is',
      );
    if (preview) return;
    for (const e of m.all)
      for (const [k, v] of Object.entries(rawOf(e)))
        if (isCellBinding(v))
          warn(
            e.where,
            `"${k}" reads $cell, but this document was not mounted for a cell`,
            "only a symbol state's own document is mounted per cell",
          );
  };

  /**
   * Types a mount had that a registry change took away, by scene id. A
   * hot re-apply of the row owning a type (`reels1`) unregisters, then
   * registers again a few microtasks later: the remount in between must
   * not say the type is missing. It is reported only if it was ALSO
   * missing at the previous mount; the next `show()` still reports it if
   * it truly stays gone (`reportShown` reads the mount's own list).
   */
  let vanished: Map<string, Set<string>> | null = null;

  /** Top-level ids shown with `preview` — `reportShown` skips their `$cell` warning until they are hidden. */
  const previewed = new Set<string>();

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
    reportShown(
      gap ? { ...m, missing: m.missing.filter((x) => !gap.has(x.type)) } : m,
      previewed.has(id),
    );
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
   * ONE root mounted again in place, for a type without `update` whose
   * own props the variant changed. The FRESH subtree is mounted first,
   * from the document, in the entry's own context (`scene`/`chain`/`top`
   * — `mountNode` reads the current orientation's override itself) and
   * moved to the old child index — `remount`'s `wasAt` precedent, one
   * level down; only once it landed is the old subtree (children, an
   * embedded copy — every entry whose view sits under it) unmounted the
   * way `unmountTop` does. A throwing `mount` (an override `scene: 'nope'`)
   * is `mountNode`'s diagnostic and the old entry stays as it was, its
   * variant unset. The entry is replaced in `nodes`/`all`; a live patch on
   * the subtree goes with the old one, as with any remount. `live` is the
   * patch the NODE itself keeps through the remount (`setProps` of an own
   * prop — a `scene` host pointed at another document). Answers the fresh
   * entry, or `undefined` when the old one stays.
   */
  function remountNode(m: Mount, e: Entry, live?: Record<string, unknown>): Entry | undefined {
    const parent = e.view.parent;
    if (!parent) return;
    const at = parent.getChildIndex(e.view);
    building = m;
    let fresh: Entry | undefined;
    try {
      fresh = mountNode(e.node, parent, e.scene, e.chain, new Set(), e.top, e.root, live);
    } finally {
      building = null;
    }
    if (!fresh) return;
    parent.setChildIndex(fresh.view, at);
    const under = (v: Container): boolean => {
      for (let p = v.parent; p; p = p.parent) if (p === e.view) return true;
      return false;
    };
    const gone = new Set(m.all.filter((x) => x === e || under(x.view)));
    for (const x of [...gone].reverse()) unmountEntry(x);
    m.all = m.all.filter((x) => !gone.has(x));
    // ponytail: the fresh subtree may list a skipped node the old one listed too — dedupe by `where`; an entry the OTHER orientation's subtree alone had stays (it names a real skipped node of that layout).
    m.missing = m.missing.filter((x, i, a) => a.findIndex((y) => y.where === x.where) === i);
    return fresh;
  }

  /**
   * The orientation flipped: every `root` entry with a `portrait` override
   * takes it (or, on the way back, drops the one it holds) — the
   * `setProps` machinery with the variant as a layer UNDER the live
   * patches. Per entry: validate (schema + common pass) — a refusal is a
   * diagnostic and the entry keeps what it has — then `update` + the
   * common pass; a type without `update` gets the common pass alone when
   * its own props did not change (a `container`, a `scene` host moved or
   * hidden — its children keep their live patches), a remount otherwise.
   * An entry with neither an override nor a held variant is not touched.
   *
   * Known debt: a `text` whose override adds or removes `font` keeps its
   * class — `update` cannot swap `Text`↔`BitmapText` (the same limit
   * `setProps` has), so it renders with the fallback family until a
   * `replace` remounts it.
   */
  function applyVariant(): void {
    for (const m of mounted.values())
      for (const e of m.all.filter((x) => x.root)) {
        // A host remounted earlier in this pass took its old copy's roots with it.
        if (!m.all.includes(e)) continue;
        const next = overrideOf(e.scene, e.node.id);
        if (!next && !e.variant) continue;
        // On the way back there is no override to blame: the live patch is what is left.
        const blame = next ?? e.live ?? {};
        const merged = tryVariant(e.where, e.type, e.node.props, { ...next, ...e.live }, blame);
        if (!merged) continue;
        if (!e.type.update && ownOf(e.type, merged.props) !== ownOf(e.type, e.props)) {
          remountNode(m, e);
          continue;
        }
        // The merge again, resolved: `tryVariant` keeps `raw` as written
        // (`mountNode` needs the bindings to resolve against a cell), and
        // the common pass must not be handed one.
        const r = resolveCell(e.type, merged.raw);
        try {
          e.type.update?.(e.view, r.props, mountCtx([]));
          applyCommon(e.view, r.raw, e.type, e.top ? lastFit : null);
        } catch (err) {
          error(e.where, `portrait ${offending(err, blame)}: ${why(err)}`, 'fix the override');
          continue;
        }
        e.props = r.props;
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
        previewed.delete(id);
        shownNested.delete(id);
        pendingIds = pendingIds.filter((p) => p !== id);
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

  /** The scene a root's portrait override points a `scene` node at, when it does. */
  const overrideScene = (doc: SceneDoc, n: SceneNode): string | undefined => {
    const s = n.type === 'scene' ? doc.portrait?.nodes?.[n.id]?.scene : undefined;
    return typeof s === 'string' ? s : undefined;
  };

  /** Scene ids a document's tree references, one level deep — a root's portrait `scene` override included, whatever the orientation. */
  const refsOf = (doc: SceneDoc): Set<string> => {
    const out = new Set<string>();
    const walk = (nodes: SceneNode[], roots = false) => {
      for (const n of nodes) {
        if (n.type === 'scene' && typeof n.props.scene === 'string') out.add(n.props.scene);
        const o = roots && overrideScene(doc, n);
        if (o) out.add(o);
        walk(n.children ?? []);
      }
    };
    walk(doc.nodes, true);
    return out;
  };

  /**
   * Lets every mounted node re-read what it depends on (a texture after a
   * load or an unload). With `paths`, this is NARROW: an entry whose type
   * DECLARES `assets` only re-runs when its current ones (`e.props`, the
   * live-patched props — a `setProps` patch is not undone by this) meet
   * `paths`; everything else is skipped rather than re-run for nothing —
   * a pose on a view belonging to some other document must survive a load
   * that has nothing to do with it (F16: `loadPaths` used to end in a
   * blanket sweep, wiping any pose anywhere on every load). A type that
   * never declares `assets` has no way to say "not me", so it stays in
   * the sweep regardless of `paths` — the same every-entry pass this
   * always was for `container`/`scene`/anything whose `update` does not
   * depend on a loaded asset. `hide`'s post-unload sweep passes the paths
   * it unloaded, the same way. No `paths` at all (a remount, the one
   * caller left) is that same original blanket sweep, unfiltered — every
   * entry there is fresh anyway. A throwing `update` (a media type filling itself
   * in once its asset lands) must not stop the loop: every sibling still
   * needs its own refresh, and the scene must still show. Reported once
   * per entry — `failed` is cleared only by a remount, which rebuilds the
   * entry from scratch.
   */
  function refresh(paths?: string[]): void {
    for (const m of mounted.values())
      for (const e of m.all) {
        const need = e.type.assets?.(e.props);
        if (paths && need && !need.some((p) => paths.includes(p))) continue;
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
        const swapped = overrides && overrideScene(doc, n);
        if (swapped) for (const p of assetsOf(swapped, seen)) out.add(p);
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

  /**
   * The document whose OWN top-level mount holds `e` — its own id for its
   * own mount, the embedding document's id for a copy a `scene` node made.
   * O(1), off the entry itself: `chain` is the host chain the copy was
   * mounted under, outermost first, and its head is the top-level mount
   * the entries were filed into (`mountTop` builds with `[]`, a `scene`
   * node hands `mountDoc` `[...chain, scene]`); an own-mount entry has an
   * empty chain and is its own host. (`scene-edit` calls `view()` every
   * frame.) A `mountCell` copy answers its own id, but belongs to no
   * `Mount` and never reaches here through `entriesOf`.
   */
  const hostOf = (e: Entry): string => e.chain[0] ?? e.scene;

  /**
   * `ScenesService.view` — see its doc for the contract. Shown hosts
   * first, then pending ones; each list walked from the END, so the
   * LATEST shown (then the latest `load`ed) host wins when more than one
   * of `entriesOf(ref)`'s hosts qualifies.
   */
  const viewOf = (ref: SceneRef): Container | undefined => {
    const entries = entriesOf(ref);
    for (const hosts of [visibleIds, pendingIds])
      for (let i = hosts.length - 1; i >= 0; i--) {
        const found = entries.find((e) => hostOf(e) === hosts[i]);
        if (found) return found.view;
      }
    return entryOf(ref)?.view;
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

  /**
   * One batch, blamed on `where`; a failure is reported per path, never
   * thrown. The refresh at the end is scoped to `need` — only the nodes
   * THIS batch fed re-run (`refresh`'s own doc has the exact rule); a
   * pose on a view this batch had nothing to do with is left alone.
   */
  async function loadPaths(where: string, need: string[]): Promise<void> {
    if (need.length === 0) return;
    try {
      await loader.load(need);
      for (const p of need) loaded.add(p);
    } catch (e) {
      // ponytail: the loader fails as one batch, so every path in it is named — per-path precision needs a per-path loader.
      const why = e instanceof Error ? e.message : String(e);
      for (const p of need)
        error(where, `asset "${p}" failed to load: ${why}`, 'check the path under the project');
    }
    refresh(need);
    redraw();
  }

  /** Loads what `id` needs — and what any row requires — and is not loaded yet. */
  async function load(id: string): Promise<void> {
    const want = new Set([...assetsOf(id), ...requiredPaths()]);
    await loadPaths(id, [...want].filter((p) => !loaded.has(p)));
  }

  /** Live `onFrame` registrations — holder objects, so the same function registered twice is two entries, not one collapsed by `Set` identity. */
  const frameHolders = new Set<{ fn: (dt: number) => void }>();
  /** The one ticker callback every `onFrame` fans out through; hooked only while `frameHolders` is non-empty. */
  const onTick = (t: { deltaMS: number }) => {
    for (const h of [...frameHolders])
      try {
        h.fn(t.deltaMS);
      } catch (e) {
        // Unhooked before it can throw again; the siblings in this same
        // tick (the snapshot above) still get their call.
        frameHolders.delete(h);
        error('onFrame', `onFrame callback failed: ${why(e)}`, 'fix the callback, or stop registering it');
        if (frameHolders.size === 0) options.ticker?.remove(onTick);
      }
  };

  /** `ScenesService.onFrame` — see its doc for the lazy-hook contract. */
  function onFrame(fn: (dt: number) => void): () => void {
    const holder = { fn };
    frameHolders.add(holder);
    if (options.ticker && frameHolders.size === 1) options.ticker.add(onTick);
    return () => {
      if (!frameHolders.delete(holder)) return;
      if (frameHolders.size === 0) options.ticker?.remove(onTick);
    };
  }

  /** `ScenesService.require` — see its doc for what a holder is worth. */
  function requireAssets(paths: string[]): () => void {
    const holder = { paths: [...new Set(paths)] };
    required.add(holder);
    loader.expect?.(holder.paths);
    // `e8 build` copies `assets/` and nothing else, and cannot see a path
    // that lives in TypeScript — so the runtime says it, and still asks for
    // it (dev serves it fine). A repeat is collapsed by the diagnostics service.
    // A document naming the path would not ship it either. `./assets/x`
    // ships; `/assets/x` is root-relative, not the project folder.
    for (const p of holder.paths)
      if (!p.replace(/^\.\//, '').startsWith('assets/'))
        warn(
          'assetLoader',
          `"${p}" is outside assets/ — a built dist will not carry it`,
          'move it under assets/',
        );
    // ALWAYS its own batch, never a merge into a `load()` on its way: a
    // composition that never shows a document (a row used only for
    // `mountCell`) has no `load()` to join, and "sometimes it loads" is no
    // contract. `need` is re-read inside the queued task — the queue is
    // serial, so a path an earlier batch already took is skipped rather
    // than fetched twice — and a holder whose disposer ran first is not
    // loaded for at all.
    void enqueue(() =>
      required.has(holder)
        ? loadPaths('require', holder.paths.filter((p) => !loaded.has(p)))
        : Promise.resolve(),
    );
    return () => void required.delete(holder);
  }

  const notDeclared = (id: string) =>
    error(id, `scene "${id}" is not declared`, `add scenes/${id}.scene.yml`);

  /** `ScenesService.load`: `load`, plus what only the public call does — `show`'s check for an undeclared id, and `id` becoming the latest pending host (no duplicates). */
  async function preload(id: string): Promise<void> {
    if (!docs.has(id)) return notDeclared(id);
    pendingIds = [...pendingIds.filter((p) => p !== id), id];
    await load(id);
  }

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

  async function show(id: string, opts?: { transition?: string; preview?: boolean }): Promise<void> {
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
    if (opts?.preview) previewed.add(id);
    reportShown(mounted.get(id)!, !!opts?.preview);
    const view = mounted.get(id)!.view;
    container.addChildAt(view, container.getChildIndex(highlightBox));
    visibleIds.push(id);
    view.visible = true;
    await runTransition(wanted, { from: [], to: [view] });
    if (visibleIds.includes(id)) mounted.get(id)!.view.alpha = 1;
  }

  async function hide(id: string): Promise<void> {
    // Shown or not: a host loaded and then hidden is no show to come.
    pendingIds = pendingIds.filter((p) => p !== id);
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
      previewed.delete(id);
      const view = mounted.get(id)!.view;
      container.removeChild(view);
      view.alpha = 1;
    }
    // What a row still requires is needed too — its holder outlives any one scene.
    const needed = new Set([...visibleIds.flatMap((v) => assetsOf(v)), ...requiredPaths()]);
    const orphans = [...loaded].filter((p) => !needed.has(p));
    if (orphans.length === 0) return;
    for (const p of orphans) loaded.delete(p);
    try {
      await loader.unload(orphans);
    } catch (e) {
      error(id, `unloading assets failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Narrow, like a load's: only what drew with an unloaded path re-reads it.
    refresh(orphans);
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
      // Every path a declared document names is one something WILL load (on
      // its `show`), so the loader must not call it "nothing loaded" when a
      // hidden mount draws it first. Before the remount: mounting calls `get`.
      loader.expect?.([...new Set(next.flatMap((d) => assetsOf(d.id)))]);
      remount([...changed]);
    },
    highlight(ref) {
      current = ref;
      redraw();
    },
    assetsOf: (id) => assetsOf(id),
    require: (paths) => requireAssets(paths),
    load: (id) => enqueue(() => preload(id)),
    onFrame: (fn) => onFrame(fn),
    mountDoc(id, chain) {
      const doc = docs.get(id);
      if (!doc || chain.includes(id)) return null;
      const view = new Container();
      view.label = id;
      const seen = new Set<string>();
      // An embedded copy: its host lays it out, so no node in it is `top` — but its roots are the document's, and take its variant.
      for (const node of doc.nodes) mountNode(node, view, id, chain, seen, false, true);
      return view;
    },
    mountCell(id, data) {
      const doc = docs.get(id);
      if (!doc) return null;
      const view = new Container();
      view.label = id;
      const entries: Entry[] = [];
      // Its own entry list: a cell copy belongs to no `Mount` — `setProps`
      // must never find it, `refresh` must never walk it, and it dies with
      // one cell rather than with a shown scene. Swapping `building` is
      // safe because every `mountNode` below is synchronous (children and
      // a nested `mountDoc` file into the same list, which is what
      // `destroy` wants); the PREVIOUS value is put back rather than
      // cleared, since a node type's own `mount` may be what called us,
      // mid-`mountTop`.
      const prev = building;
      const m: Mount = { view, nodes: new Map(), all: entries, types: new Map(), missing: [] };
      building = m;
      try {
        // Not `top` — nothing pins a cell copy — but its roots are the
        // document's. `[id]` as the host chain keeps the copy out of
        // `building.nodes`, silences the nested-pin warning the document's
        // own mount already gave, and refuses a `scene` node nesting the
        // document inside itself.
        const seen = new Set<string>();
        for (const node of doc.nodes)
          mountNode(node, view, id, [id], seen, false, true, undefined, data);
      } finally {
        building = prev;
      }
      // A copy is never shown, so `reportShown`'s "wait until it is
      // shown" rule has nothing to wait for: an unregistered type is a hole
      // in what the cell draws, now. One diagnostic per type per call — a
      // grid of 30 cells asks for this document 30 times.
      for (const type of new Set(m.missing.map((x) => x.type)))
        error(
          id,
          `node type "${type}" is not registered — the node is skipped`,
          'register it, or pick a type that is',
        );
      const ctx = mountCtx([id]);
      return {
        view,
        bound: entries.some((e) => e.bound?.length),
        bind(next) {
          for (const e of entries) {
            if (!e.bound?.length) continue;
            try {
              const r = resolveCell(e.type, rawOf(e), next, cellReport(e.where));
              // A copy has no remount path (`setProps`' own is for mounted
              // nodes), so a type with no `update` can never show a new own
              // prop: `scene: '$cell.kind'` would swap in silence. One report
              // per entry, like the catch below.
              if (
                !e.failed &&
                !e.type.update &&
                ownOf(e.type, r.props) !== ownOf(e.type, e.props)
              ) {
                e.failed = true;
                const dict = e.type.schema.dict ?? {};
                const own = (e.bound ?? []).filter((k) => Object.hasOwn(dict, k));
                error(
                  e.where,
                  `${e.node.type} "${e.node.id}" cannot take a new ${own.join(', ')}: the type has no update`,
                  'bind a prop the runtime applies itself, or give the type an update',
                );
              }
              e.type.update?.(e.view, r.props, ctx);
              // No `fit`: a cell copy is never `top`, so its `pin` is inert.
              applyCommon(e.view, r.raw, e.type);
              e.props = r.props;
            } catch (err) {
              // `refresh`'s rule: one report per entry, and the siblings
              // still get their value — a cell must still draw.
              if (e.failed) continue;
              e.failed = true;
              error(e.where, `${e.node.type} "${e.node.id}" failed to bind: ${why(err)}`);
            }
          }
        },
        async once() {
          const ran = entries.filter((e) => e.type.once);
          await Promise.all(
            ran.map(async (e) => {
              try {
                await e.type.once!(e.view, e.props, ctx);
              } catch (err) {
                error(e.where, `${e.node.type} "${e.node.id}" failed to play: ${why(err)}`);
              }
            }),
          );
          return ran.length > 0;
        },
        destroy() {
          // `unmountTop`'s order, on the copy's own list: deepest first,
          // then the container this built itself.
          for (const e of [...entries].reverse()) unmountEntry(e);
          entries.length = 0;
          view.destroy({ children: true });
        },
      };
    },
    sceneView: (id) => mounted.get(id)?.view,
    view: (ref) => viewOf(ref),
    views: (ref) => entriesOf(ref).map((e) => e.view),
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
      for (const p of plan) {
        const { e, merged, props } = p;
        // A type without `update` whose OWN prop changed (a `scene` host's
        // `scene`) can only be remounted — `applyVariant`'s device, with the
        // patch carried into the fresh entry. A mount that throws is its
        // own diagnostic and the old entry stays; the call answers `false`
        // (a copy remounted before it stays remounted — the caveat below).
        if (!e.type.update && ownOf(e.type, props) !== ownOf(e.type, e.props)) {
          const m = [...mounted.values()].find((x) => x.all.includes(e))!;
          const fresh = remountNode(m, e, { ...e.live, ...patch });
          if (!fresh) return false;
          // The common pass of the mount put the document's `visible` back on a host: a nested scene `show()`n stays shown.
          showHosts(m);
          p.e = fresh;
          continue;
        }
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
    async once(ref) {
      const entries = entriesOf(ref);
      if (entries.length === 0) {
        error(
          `${ref.scene}/${ref.node}`,
          `node "${ref.node}" is not mounted in scene "${ref.scene}" — nothing to play`,
          'check the scene and node ids',
        );
        return false;
      }
      const ran = entries.filter((e) => e.type.once);
      await Promise.all(
        ran.map(async (e) => {
          try {
            await e.type.once!(e.view, e.props, mountCtx([]));
          } catch (err) {
            error(e.where, `${e.node.type} "${e.node.id}" failed to play: ${why(err)}`);
          }
        }),
      );
      return ran.length > 0;
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
      // Nothing left to unhook FOR (`frameHolders` is this composition's
      // own state), but the ticker is the renderer's and outlives us —
      // leaving the hook would call `onTick` forever against a torn-down
      // scope.
      if (frameHolders.size > 0) {
        frameHolders.clear();
        options.ticker?.remove(onTick);
      }
    },
  };
  return service;
}
