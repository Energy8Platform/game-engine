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
 * Every call into a node type's `update`/`once`/`unmount` is guarded:
 * slice 20's lesson — a throwing type is one report per wrapper (until a
 * remount rebuilds it), never a board that fails to draw.
 */
import type { Context } from 'cordis';
import { Container } from 'pixi.js';
import type { SymbolDef, SymbolNode, SymbolState } from '@energy8engine/contracts';
import { applyCommon, type NodeType, type NodeTypesService } from '@energy8engine/scenes';
import type { SymbolView } from '@energy8platform/game-engine/slot';
import { fallbackBox } from './fallback';

export interface ViewDeps {
  ctx: Context;
  /** Looked up per mount, not once: the registry may not exist yet when the row applies. */
  nodeTypes(): NodeTypesService | undefined;
  report(where: string, message: string): void;
}

export interface SymbolHandle {
  readonly id: string;
  /** Centred `Container`; `playWin` present iff the def has `win` (and no `only`). */
  readonly view: SymbolView;
  /** Remounts the wrappers unless `def` is JSON-equal to the current one; `undefined` → the fallback box. */
  apply(def: SymbolDef | undefined): void;
  /** `type.update` on every mounted wrapper, then fit — after an asset load. */
  refresh(): void;
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
  const view = new Container() as SymbolView;
  view.label = `symbol:${id}`;
  let size = DEFAULT_SIZE;
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

  function fit(w: Wrapper): void {
    const b = w.container.getLocalBounds();
    if (!b.width || !b.height) return;
    const s = def?.fit === 'none' ? 1 : Math.min(size.width / b.width, size.height / b.height);
    w.container.scale.set(s);
    w.container.pivot.set(b.x + b.width / 2, b.y + b.height / 2);
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
      try {
        w.props = type.schema(node.props) as Record<string, unknown>;
        w.child = type.mount(w.props, deps.ctx);
        applyCommon(w.child, node.props);
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
    refresh() {
      if (rest) update(rest);
      if (win) update(win);
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
  // The cell destroys the view itself on every `setData`: the teardown hangs off pixi's own
  // `destroyed` event so both roads (`handle.destroy()`, `view.destroy()`) end the same way.
  view.once('destroyed', () => {
    clear();
    opts.onDestroy?.();
  });
  return handle;
}
