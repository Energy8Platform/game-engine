/**
 * One symbol's `SymbolView` — the legacy contract a reel board's
 * `SymbolCell` drives (`@energy8platform/game-engine/slot`): a `Container`
 * centred on `(0, 0)`, `resize`d to the cell, `playWin`'d on a win,
 * destroyed on every `setData`. Built here out of `symbols.yml`'s
 * `static`/`idle`/`win` nodes through `@energy8engine/scenes`' node
 * types, one *wrapper* per state: a `Container` holding the type's view,
 * scaled and pivoted so the view's local bounds fill the cell (`fit:
 * contain`) or just sit centred (`fit: none`).
 *
 * The view shows ONE wrapper at rest (`idle ?? static`, or the `only`
 * state a preview pins). `playWin` — defined only when the def has `win`
 * and no `only`, so the cell's own scale pop stands in otherwise — hides
 * the rest wrapper, mounts `win`, awaits the type's `once` (600 ms for a
 * type without one), unmounts `win` and shows the rest wrapper again.
 * `showStatic` tears a `win` in flight down early; the `once` it was
 * awaiting then resolves into a no-op (the wrapper it would restore is
 * not the current one).
 *
 * A state's props may read the data of the cell the symbol landed in:
 * `'$cell.<field>'` (an orb's `text: '$cell.multiplier'`). `bind(data)` —
 * the reels board calls it on every seated cell — resolves those against
 * that data and re-runs the type's `update`; until then each stands at its
 * prop's empty, so no type and no schema ever sees the raw string.
 *
 * Every call into a node type's `update`/`once`/`unmount` is guarded:
 * slice 20's lesson — a throwing type is one report per wrapper (until a
 * remount rebuilds it), never a board that fails to draw.
 */
import type { Context } from 'cordis';
import { Container } from 'pixi.js';
import type { SymbolDef, SymbolNode, SymbolState } from '@energy8engine/contracts';
import {
  applyCommon,
  cellField,
  COMMON,
  emptyProp,
  isCellBinding,
  type NodeType,
  type NodeTypesService,
} from '@energy8engine/scenes';
import type { SymbolView } from '@energy8platform/game-engine/slot';
import { fallbackBox } from './fallback';

export interface ViewDeps {
  ctx: Context;
  /** Looked up per mount, not once: the registry may not exist yet when the row applies. */
  nodeTypes(): NodeTypesService | undefined;
  report(where: string, message: string): void;
}

/** The legacy view plus `bind`: what the reels board calls on every cell it has just seated. */
export type BoundSymbolView = SymbolView & { bind(data: Record<string, unknown>): void };

export interface SymbolHandle {
  readonly id: string;
  /** Centred `Container`; `playWin` present iff the def has `win` (and no `only`). */
  readonly view: BoundSymbolView;
  /** Remounts the wrappers unless `def` is JSON-equal to the current one; `undefined` → the fallback box. */
  apply(def: SymbolDef | undefined): void;
  /** `type.update` on the rest wrapper, then fit — after an asset load. */
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
  /** `raw` holds at least one `$cell.<field>` string; nothing else is worth re-resolving. */
  bound?: boolean;
  /** Reported once; a remount rebuilds the wrapper and clears it. */
  failed?: boolean;
}

const DEFAULT_SIZE = { width: 96, height: 96 };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const dictOf = (schema: unknown): Record<string, { type?: string } | undefined> =>
  (schema as { dict?: Record<string, { type?: string }> }).dict ?? {};

/** A bound prop's value: the cell's field coerced to the prop's schema type — the way a flow's `prop` coerces. */
function boundValue(field: unknown, type?: string): unknown {
  if (field === undefined || field === null) return emptyProp(type);
  if (type === 'number') {
    const n = Number(field);
    return Number.isNaN(n) ? 0 : n;
  }
  if (type === 'boolean') return typeof field === 'string' ? field === 'true' : Boolean(field);
  return type === 'string' ? String(field) : field;
}

/**
 * The type's schema over a state's props, with every `$cell.<field>`
 * string resolved against `data` (its own prop's type when the type
 * declares it, `COMMON`'s otherwise — a `$cell.*` on `x` is a number too).
 * The schema never sees a binding: that prop's EMPTY stands in for the
 * validation, which is what makes a binding valid whatever the prop's type
 * (the host's `checkNode` does the same), and the resolved value — never
 * validated, like a flow's `$path` — is put back on top.
 */
function resolveProps(
  type: NodeType,
  raw: Record<string, unknown>,
  data?: Record<string, unknown>,
): Record<string, unknown> {
  const own = dictOf(type.schema);
  const common = dictOf(COMMON);
  const input: Record<string, unknown> = {};
  const bound: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isCellBinding(value)) {
      input[key] = value;
      continue;
    }
    const kind = (own[key] ?? common[key])?.type;
    input[key] = emptyProp(kind);
    bound[key] = data ? boundValue(data[cellField(value)], kind) : input[key];
  }
  return { ...(type.schema(input) as Record<string, unknown>), ...bound };
}

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
  let win: Wrapper | null = null;
  let fallback: Container | null = null;

  const fail = (w: Wrapper, what: string, e: unknown) => {
    if (w.failed) return;
    w.failed = true;
    deps.report(
      `symbols/${id}/${w.state}`,
      `${w.type?.type ?? '?'} failed to ${what}: ${e instanceof Error ? e.message : String(e)}`,
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

  function mount(state: SymbolState, node: SymbolNode): Wrapper {
    const w: Wrapper = { state, container: new Container() };
    w.container.label = state;
    const type = deps.nodeTypes()?.get(node.type);
    if (!type) {
      deps.report(`symbols/${id}/${state}`, `unknown node type "${node.type}"`);
    } else {
      w.type = type;
      w.raw = node.props;
      w.bound = Object.values(node.props).some(isCellBinding);
      try {
        w.props = resolveProps(type, node.props, cell);
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
    if (w.child) {
      try {
        w.type?.unmount?.(w.child);
      } catch (e) {
        fail(w, 'unmount', e);
      }
    }
    w.container.destroy({ children: true });
  }

  /** Tears down a `win` in flight; the awaited `once` finds `win !== w` and does nothing more. */
  function showStatic(): void {
    if (!win) return;
    unmount(win);
    win = null;
    if (rest) rest.container.visible = true;
  }

  async function playWin(): Promise<void> {
    if (win || !def?.win) return;
    if (rest) rest.container.visible = false;
    const w = mount('win', def.win);
    win = w;
    try {
      await (w.type?.once && w.child ? w.type.once(w.child, w.props!, deps.ctx) : wait(600));
    } catch (e) {
      fail(w, 'play once', e);
    }
    if (win === w) showStatic();
  }

  function clear(): void {
    showStatic();
    if (rest) unmount(rest);
    rest = null;
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
        return;
      }
      const state = opts.only ?? (def.idle ? 'idle' : 'static');
      rest = mount(state, def[state] ?? def.static);
      if (def.win && !opts.only) view.playWin = playWin;
      else delete view.playWin;
    },
    // `rest` only: a `win` wrapper is either mounted from loaded assets or a placeholder whose
    // `once` resolved at once — and `spritesheet.update` resetting `loop` on a win in flight
    // would leave the awaited `once` never completing.
    refresh() {
      if (rest) update(rest);
    },
    // Every mounted wrapper, `win` included: a win state reads the same cell.
    bind(data) {
      cell = data;
      for (const w of [rest, win]) {
        if (!w?.bound || !w.type || !w.child) continue;
        try {
          w.props = resolveProps(w.type, w.raw!, data);
          applyCommon(w.child, w.props, w.type);
        } catch (e) {
          fail(w, 'bind', e);
          continue;
        }
        update(w);
      }
    },
    resize(next) {
      size = next;
      if (rest) fit(rest);
      if (win) fit(win);
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
