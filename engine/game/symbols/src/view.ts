/**
 * One symbol's `SymbolView` — the legacy contract a reel board's
 * `SymbolCell` drives (`@energy8platform/game-engine/slot`): a `Container`
 * centred on `(0, 0)`, `resize`d to the cell, `playWin`'d on a win,
 * destroyed on every `setData`. Built here out of `symbols.yml`'s states
 * — `static`/`idle`/`win` and every name under `states` — through
 * `@energy8engine/scenes`' node types, one *wrapper* per state: a
 * `Container` holding the type's view, scaled and pivoted so the view's
 * local bounds fill the cell (`fit: contain`) or just sit centred (`fit:
 * none`).
 *
 * A state whose node is `{ type: scene }` is not mounted by a node type
 * at all: it is a whole document mounted as a PRIVATE copy for this cell
 * (`scenes.mountCell`), which owns the binding, the `once` and its own
 * teardown. Without a scenes runtime, or for a document nothing declares,
 * the wrapper stays empty and says so once — as an unknown node type does.
 *
 * The view shows ONE wrapper at rest (`idle ?? static`, or the `only`
 * state a preview pins). `playState(name)` — `view.playState`, with
 * `playWin` as its `'win'` shorthand where the def has one, so the cell's
 * own scale pop stands in otherwise — hides the rest wrapper, mounts the
 * state, awaits its `once` — the copy's for a scene, and 600 ms wherever
 * nothing had one at all (a type without `once`, a copy of nodes that
 * carry none), so the state is seen — unmounts it and shows the rest
 * wrapper again. A state already playing is replaced rather than queued
 * (and its promise settles then, whatever its own `once` does), and a
 * state the def does not declare resolves at once against one `info`: a
 * mechanic names `death` for every loser, and not every symbol dies.
 * `showStatic` tears a state in flight down early; the `once` it was
 * awaiting then resolves into a no-op (the wrapper it would restore is not
 * the current one).
 *
 * A state's props may read the data of the cell the symbol landed in:
 * `'$cell.<field>'` (an orb's `text: '$cell.multiplier'`), or any
 * expression over it (`'x{$cell.mv}'`) — `cellProps` decides, and reports
 * one that does not parse against this symbol's state. `bind(data)` —
 * the reels board calls it on every seated cell — resolves those against
 * that data (`cellProps`) and re-runs the type's `update`, or hands the
 * data to the cell copy — a copy with no `$cell` prop in it is left
 * alone, as a wrapper with no binding is; until then each stands at its
 * prop's empty, so no type and no schema ever sees the raw string.
 *
 * Every call into a node type's `update`/`once`/`unmount` is guarded:
 * slice 20's lesson — a throwing type is one report per wrapper (until a
 * remount rebuilds it), never a board that fails to draw.
 */
import type { Context } from 'cordis';
import { Container } from 'pixi.js';
import {
  stateNode,
  type Severity,
  type SymbolDef,
  type SymbolNode,
  type SymbolState,
} from '@energy8engine/contracts';
import {
  applyCommon,
  cellProps,
  type CellMount,
  type NodeType,
  type NodeTypesService,
  type ScenesService,
} from '@energy8engine/scenes';
import type { SymbolView } from '@energy8platform/game-engine/slot';
import { fallbackBox } from './fallback';

export interface ViewDeps {
  ctx: Context;
  /** Looked up per mount, not once: the registry may not exist yet when the row applies. */
  nodeTypes(): NodeTypesService | undefined;
  /** `'error'` when absent; a state the def simply has not got is an `'info'`, and `cellProps` names its own (a `warning`, with a fix). */
  report(where: string, message: string, fix?: string, severity?: Severity): void;
}

/** The legacy view plus `bind` and `playState`: what the reels board calls on every cell it has just seated. */
export type BoundSymbolView = SymbolView & {
  bind(data: Record<string, unknown>): void;
  /** Plays any state of the def (`playWin` generalised); absent for a preview's pinned state and for a symbol with no def. */
  playState?(state: SymbolState): Promise<void>;
};

export interface SymbolHandle {
  readonly id: string;
  /** Centred `Container`; `playState` present iff there is a def (and no `only`), `playWin` iff it has `win`. */
  readonly view: BoundSymbolView;
  /** Remounts the wrappers unless `def` is JSON-equal to the current one; `undefined` → the fallback box. */
  apply(def: SymbolDef | undefined): void;
  /**
   * `type.update` on the rest wrapper, then fit — after an asset load. A
   * `scene` state is skipped: a cell copy has no `refresh` of its own, so
   * art that lands after it mounted reaches it only through a remount
   * (the board's `repaint`, or the next `apply`).
   */
  refresh(): void;
  /** Resolves every `$cell.<field>` prop against this cell's data; kept for a wrapper mounted later (a `win`). */
  bind(data: Record<string, unknown>): void;
  resize(size: { width: number; height: number }): void;
  /** Unmounts the wrappers, destroys the view, calls `onDestroy` — what the view's own `destroy()` does too. */
  destroy(): void;
}

interface Wrapper {
  state: SymbolState;
  container: Container;
  type?: NodeType;
  child?: Container;
  props?: Record<string, unknown>;
  /** The state's props as written — re-resolved on every `bind`. */
  raw?: Record<string, unknown>;
  /** A `scene` state: the private copy of the document, which owns its binding, `once` and teardown. */
  cell?: CellMount;
  /** A `scene` state: the document the copy is of — what a diagnostic names, there being no node type. */
  scene?: string;
  /** The props that carried a `$cell.<field>` — the only ones a `bind` re-resolves. */
  bound?: string[];
  /** Reported once; a remount rebuilds the wrapper and clears it. */
  failed?: boolean;
}

const DEFAULT_SIZE = { width: 96, height: 96 };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createSymbolHandle(
  id: string,
  deps: ViewDeps,
  opts: { only?: SymbolState; onDestroy?(): void } = {},
): SymbolHandle {
  const view = new Container() as BoundSymbolView;
  view.label = `symbol:${id}`;
  let size = DEFAULT_SIZE;
  /** The last `bind` — replayed onto a wrapper mounted after it (a `win`). */
  let cell: Record<string, unknown> | undefined;
  let def: SymbolDef | undefined;
  let json = '';
  let rest: Wrapper | null = null;
  /** The state `playState` is running over `rest`, if any — a `win`, a `death`. */
  let playing: Wrapper | null = null;
  /** Settles the promise of the state a newer `playState` replaces; see there. */
  let supersede: (() => void) | undefined;
  let fallback: Container | null = null;
  /** States already reported absent; cleared when a new def arrives — it may declare them. */
  const noState = new Set<SymbolState>();

  const fail = (w: Wrapper, what: string, e: unknown) => {
    if (w.failed) return;
    w.failed = true;
    // A cell wrapper has no node type to name — the document it copied is
    // what a person can go and look at.
    const who = w.type?.type ?? (w.scene === undefined ? '?' : `scene "${w.scene}"`);
    deps.report(
      `symbols/${id}/${w.state}`,
      `${who} failed to ${what}: ${e instanceof Error ? e.message : String(e)}`,
    );
  };

  // The CHILD's local bounds, not the wrapper's: the wrapper's would already carry the
  // child's own `x`/`y`/`scale`/`rotation` (`applyCommon`), and pivoting to their centre
  // subtracts the nudge back out and cancels the scale under `contain`. Fitting the unscaled
  // art and pivoting to its centre mapped through the child's LINEAR transform (scale and
  // rotation, not the translation) leaves those props free to move/shrink/turn it in the cell.
  function fit(w: Wrapper): void {
    if (!w.child) return;
    const bounds = w.child.getLocalBounds();
    if (!bounds.width || !bounds.height) return;
    const s =
      def?.fit === 'none' ? 1 : Math.min(size.width / bounds.width, size.height / bounds.height);
    w.container.scale.set(s);
    w.child.updateLocalTransform();
    const { a, b, c, d } = w.child.localTransform;
    const mx = bounds.x + bounds.width / 2;
    const my = bounds.y + bounds.height / 2;
    w.container.pivot.set(a * mx + c * my, b * mx + d * my);
    w.container.position.set(0, 0);
  }

  function update(w: Wrapper): void {
    if (!w.type || !w.child) return;
    try {
      w.type.update?.(w.child, w.props!, deps.ctx);
    } catch (e) {
      fail(w, 'refresh', e);
    }
    fit(w);
  }

  /**
   * A `scene` state: the document mounted as a private copy for THIS cell,
   * never through the `scene` node type — that one nests a document inside
   * another document (`mountDoc`), with no cell to resolve against.
   */
  function mountCell(w: Wrapper, node: SymbolNode): void {
    const where = `symbols/${id}/${w.state}`;
    const scene = String(node.props.scene ?? '');
    w.scene = scene;
    const scenes = deps.ctx.reflect.get('scenes', false) as ScenesService | undefined;
    if (!scenes) {
      deps.report(where, `no scenes runtime to mount the scene "${scene}"`);
      return;
    }
    const mounted = scenes.mountCell(scene, cell);
    if (!mounted) {
      deps.report(where, `unknown scene "${scene}"`);
      return;
    }
    w.cell = mounted;
    w.child = mounted.view;
    w.container.addChild(mounted.view);
    fit(w);
  }

  function mount(state: SymbolState, node: SymbolNode): Wrapper {
    const w: Wrapper = { state, container: new Container() };
    w.container.label = state;
    if (node.type === 'scene') {
      mountCell(w, node);
      view.addChild(w.container);
      return w;
    }
    const type = deps.nodeTypes()?.get(node.type);
    if (!type) {
      deps.report(`symbols/${id}/${state}`, `unknown node type "${node.type}"`);
    } else {
      w.type = type;
      w.raw = node.props;
      try {
        const resolved = cellProps(type, node.props, cell, (m, fix, sev) =>
          deps.report(`symbols/${id}/${state}`, m, fix, sev),
        );
        w.props = resolved.props;
        w.bound = resolved.bound;
        w.child = type.mount(w.props, deps.ctx);
        applyCommon(w.child, w.props, type);
        w.container.addChild(w.child);
      } catch (e) {
        w.child = undefined;
        fail(w, 'mount', e);
      }
      update(w);
    }
    view.addChild(w.container);
    return w;
  }

  function unmount(w: Wrapper): void {
    try {
      // The copy tears its own nodes down; a node type's view is the wrapper's to unmount.
      if (w.cell) w.cell.destroy();
      else if (w.child) w.type?.unmount?.(w.child);
    } catch (e) {
      fail(w, 'unmount', e);
    }
    w.container.destroy({ children: true });
  }

  /** Tears down a state in flight; the awaited `once` finds `playing !== w` and does nothing more. */
  function showStatic(): void {
    if (!playing) return;
    unmount(playing);
    playing = null;
    if (rest) rest.container.visible = true;
  }

  async function playState(state: SymbolState): Promise<void> {
    const node = def && stateNode(def, state);
    if (!node) {
      if (!noState.has(state)) {
        noState.add(state);
        // An `info`, not an error: a mechanic names `death` for every loser and not every symbol dies.
        deps.report(`symbols/${id}`, `no state "${state}"`, undefined, 'info');
      }
      return;
    }
    // A state already playing is replaced, not queued — and the caller
    // awaiting THAT one is let go of here: its `once` may never settle on
    // its own (a stuck media load, a custom type), and the wrapper it was
    // waiting for is about to be torn down. It resolves into the same no-op
    // as any other late `once` (`playing !== w` below).
    supersede?.();
    showStatic();
    if (rest) rest.container.visible = false;
    const w = mount(state, node);
    playing = w;
    const replaced = new Promise<void>((resolve) => {
      supersede = resolve;
    });
    // A node type's `once` that never settles (a stuck media load, a bug in a
    // custom type) must not hang the whole reveal step forever: raced against
    // the view's own pixi `'destroyed'` event (fired by `Container.destroy()`
    // — the same signal the handle's teardown listener below reacts to), so a
    // cell torn down mid-state still lets this promise resolve.
    let onDestroyed: (() => void) | undefined;
    const destroyed = new Promise<void>((resolve) => {
      onDestroyed = () => resolve();
      view.once('destroyed', onDestroyed);
    });
    try {
      const once = w.cell
        ? // `false`: no node of the copy had an `once` of its own, so it would
          // mount and unmount inside one microtask — the same 600 ms floor a
          // node type without an `once` gets. A copy that DID run one ends with it.
          w.cell.once().then((ran) => (ran ? undefined : wait(600)))
        : w.type?.once && w.child
          ? w.type.once(w.child, w.props!, deps.ctx)
          : wait(600);
      await Promise.race([once, destroyed, replaced]);
    } catch (e) {
      fail(w, 'play once', e);
    } finally {
      if (onDestroyed) view.off('destroyed', onDestroyed);
    }
    if (playing === w) showStatic();
  }

  const playWin = () => playState('win');

  function clear(): void {
    showStatic();
    if (rest) unmount(rest);
    rest = null;
    noState.clear();
    fallback?.destroy({ children: true });
    fallback = null;
  }

  const handle: SymbolHandle = {
    id,
    view,
    apply(next) {
      const nextJson = next ? JSON.stringify(next) : '';
      if (nextJson === json && (next ? rest : fallback)) return;
      clear();
      def = next;
      json = nextJson;
      if (!def) {
        fallback = view.addChild(fallbackBox(id, size));
        delete view.playWin;
        delete view.playState;
        return;
      }
      const state = opts.only ?? (def.idle ? 'idle' : 'static');
      rest = mount(state, stateNode(def, state) ?? def.static);
      // A pinned state is a preview standing still: nothing plays over it.
      if (opts.only) {
        delete view.playWin;
        delete view.playState;
      } else {
        view.playState = playState;
        if (def.win) view.playWin = playWin;
        else delete view.playWin;
      }
    },
    // `rest` only: a state wrapper in flight is either mounted from loaded assets or a
    // placeholder whose `once` resolved at once — and `spritesheet.update` resetting `loop`
    // mid-play would leave the awaited `once` never completing.
    refresh() {
      if (rest) update(rest);
    },
    // Every mounted wrapper, the one in flight included: it reads the same cell.
    bind(data) {
      cell = data;
      for (const w of [rest, playing]) {
        if (!w) continue;
        try {
          // A cell copy resolves its own nodes; a wrapper with no binding is
          // left alone — a copy included, whose `fit` below would otherwise
          // walk every node of it on every seated cell.
          if (w.cell) {
            if (!w.cell.bound) continue;
            w.cell.bind(data);
          } else if (!w.bound?.length || !w.type || !w.child) continue;
          else {
            w.props = cellProps(w.type, w.raw!, data, (m, fix, sev) =>
              deps.report(`symbols/${id}/${w.state}`, m, fix, sev),
            ).props;
            applyCommon(w.child, w.props, w.type);
          }
        } catch (e) {
          fail(w, 'bind', e);
          continue;
        }
        if (w.cell) fit(w);
        else update(w);
      }
    },
    resize(next) {
      size = next;
      if (rest) fit(rest);
      if (playing) fit(playing);
      if (fallback) {
        fallback.destroy({ children: true });
        fallback = view.addChild(fallbackBox(id, size));
      }
    },
    destroy: () => view.destroy(),
  };

  view.resize = (s) => handle.resize(typeof s === 'number' ? { width: s, height: s } : s);
  view.showStatic = showStatic;
  view.bind = (data) => handle.bind(data);
  // The cell destroys the view itself on every `setData`: the teardown hangs off pixi's own
  // `destroyed` event so both roads (`handle.destroy()`, `view.destroy()`) end the same way.
  view.once('destroyed', () => {
    clear();
    opts.onDestroy?.();
  });
  return handle;
}
