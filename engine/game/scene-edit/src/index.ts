/**
 * `scene-edit`: the canvas plugin the IDE's editor page applies on top of
 * a project's own composition (spec §4). Shows one scene, picks and
 * transforms its top-level nodes with the gizmo, draws a grid, and talks
 * to the IDE over the `e8:ide:*` postMessage wire. It never writes a
 * file — the parent is the one writer. Which mode: `config` first, the
 * page's own address for whatever `config` leaves out (`pageMode`, slice
 * 43). With `symbol !== undefined` (an id, or `''` for none picked yet) it
 * shows one `symbols.yml` state instead — no scene, no
 * gizmo/grid/keyboard/drop. With `reels === true` it shows the project's
 * reel board alone instead, the same no-scene shape, fitted to the screen.
 */
import type { Context } from 'cordis';
import {
  sceneRounding,
  type RevealWinsStep,
  type SafeArea,
  type SceneDoc,
  type SpinToStep,
  type SymbolsDoc,
  type SymbolState,
  type TumbleStep,
} from '@energy8engine/contracts';
import type {} from '@energy8engine/scenes/runtime';
import { COMMON, pinPoint, type Fit, type Orientation, type Pin } from '@energy8engine/scenes';
import { resolveFrameStyle, type CellFrameStyle } from '@energy8engine/reel-core';
import { Container, Graphics, type FederatedPointerEvent } from 'pixi.js';
import { createGizmo, type GizmoTarget } from './gizmo';
import { clusterTumble, lineWin, randomBoard, scatterBoard, type Rand, type Shape } from './lab';
import { pickAt } from './pick';
import { snapPoint } from './snap';
import { createWire, type WireOptions } from './wire';

export * from './wire';
export * from './snap';
export * from './pick';
export * from './gizmo';

export const name = 'scene-edit';
export const inject = ['scenes', 'nodeTypes', 'renderer'];

export interface SceneEditConfig {
  /**
   * Scene mode: which document to show. Left out (and `symbol`/`reels` left
   * out too), read off the page's own `?scene=` (slice 43) — a project's
   * `editor.ts` need not parse the address at all.
   */
  scene?: string;
  /**
   * Where events go, and the only origin requests are taken from (`'*'` for
   * any). Left out, read off the page's own `document.referrer` origin
   * (`'*'` with no referrer).
   */
  parentOrigin?: string;
  /** Tests: the transport; `window.parent.postMessage` / `window`'s `message` otherwise. */
  post?: WireOptions['post'];
  listen?: WireOptions['listen'];
  /** Tests: where `dragover`/`drop` are listened for; the renderer's canvas otherwise. */
  dropTarget?: HTMLElement;
  /**
   * Symbol mode: show this `symbols.yml` id's state instead of `scene`.
   * `scene`, the gizmo, the grid, the keyboard and the drop handler are all
   * skipped whenever this is anything other than `undefined` — `''`
   * included, which means "symbol mode, nothing picked yet" (the Symbols
   * document's canvas before any chip is selected) and boots to the
   * frame only, waiting for the first `symbol` call. Left out here, read
   * off the page's own `?symbol=` (`has` vs `get` — present-but-empty is
   * still symbol mode); `undefined` from both is the only value that means
   * scene mode.
   */
  symbol?: string;
  /**
   * Reels mode: show the project's reel board alone instead of `scene` —
   * `scene`, the gizmo, the grid, the keyboard and the drop handler are all
   * skipped, same as symbol mode. Checked BEFORE `symbol` in `apply`
   * (`editor.html?reels=` sets it — the Reels document's canvas; unlike
   * symbol mode there is no id to pick, one project has one board). Left
   * out here, read off the page's own `?reels=`.
   */
  reels?: boolean;
  /** Tests only; the page's own `location.search` otherwise. */
  search?: string;
  /** Tests only; the page's own `document.referrer` otherwise. */
  referrer?: string;
}

/** What the page asks for — the project's config first, the page's own address for whatever it left out (slice 43). */
export function pageMode(
  config: Pick<SceneEditConfig, 'scene' | 'symbol' | 'reels' | 'parentOrigin'>,
  search: string,
  referrer: string,
): { scene: string; symbol: string | undefined; reels: boolean; parentOrigin: string } {
  const p = new URLSearchParams(search);
  return {
    scene: config.scene || (p.get('scene') ?? ''),
    symbol: config.symbol !== undefined ? config.symbol : p.has('symbol') ? p.get('symbol')! : undefined,
    reels: config.reels !== undefined ? config.reels : p.has('reels'),
    parentOrigin: config.parentOrigin ?? (referrer ? new URL(referrer).origin : '*'),
  };
}

export interface Bounds { x: number; y: number; w: number; h: number }
export interface Snapshot { scene: string; selected: string | null; bounds: Record<string, Bounds> }
/**
 * What symbol mode's `snapshot` answers instead — no nodes, one preview.
 * `w`/`h` are the previewed view's own bounds in design units (unaffected by
 * zoom); `cell` is the board's cell size (design units) and `screen` that
 * same cell at the current zoom's on-screen size.
 */
export interface SymbolSnapshot {
  symbol: string | null;
  state: SymbolState | null;
  w: number;
  h: number;
  cell: { width: number; height: number };
  screen: { w: number; h: number };
}

/**
 * What reels mode's `snapshot` answers instead — no nodes, the project's
 * board alone. `rows` is per-reel row counts (`rowsPerReel` when the grid
 * sets it, else `cols` copies of the uniform `rows`); `fitted` is the
 * board's current on-screen size (its measured local bounds times the
 * fit's own scale); `busy` mirrors the lab's own serial gate (Task 4) —
 * true for the duration of whichever `spin`/`scatters`/`win`/`tumble` is
 * in flight.
 */
export interface ReelsSnapshot {
  mode: 'reels';
  cols: number;
  rows: number[];
  fitted: { w: number; h: number };
  busy: boolean;
  /** What each cell of the live board holds, `board[col][row]` (`null` empty); `null` for a board with no `grid` to read. */
  symbols: (string | null)[][] | null;
  /** The board's first cell's currently-drawn frame alpha — the `frameStyle`-alpha e2e's
   * only window onto the live draw call; `null` for a board with no `grid` (or a cell whose
   * frame Graphics isn't reachable — a test fake, say). See `idleAlphaOf` below. */
  frame: { idleAlpha: number } | null;
}

/** Which layer of the document an edit lands in: the node's own props (`null`), or `portrait.nodes[<id>]` while the safe rect is portrait (spec §7). */
export type Variant = 'portrait' | null;
/** The `edit` event's payload: `x`/`y` are OFFSETS from the pin point when the node's merged props carry a `pin`. */
export interface EditPayload { node: string; props: Record<string, number>; variant: Variant }

/** `window.__e8edit` on the editor page — test hooks, like `__e8` on the game page. Symbol mode exposes only `emitted`/`snapshot`/`frameOf` (no node to `select`, no `grid`, nothing to `pickAndSelect`); reels mode exposes only `emitted`/`snapshot` (nothing to pick, nothing frame-animated at this level). */
export interface SceneEdit {
  snapshot(): Snapshot | SymbolSnapshot | ReelsSnapshot;
  select(node: string | null): void;
  grid(on: boolean, step: number): void;
  /** Screen coords — what a `pointerdown` on the stage does. */
  pickAndSelect(x: number, y: number): void;
  /** The last 100 events sent to the IDE. */
  emitted(): { event: string; payload?: unknown }[];
  /** The node's view's `currentFrame` (an `AnimatedSprite`, or the gif wrapper's child); `null` for a still or unknown node. */
  frameOf(node: string): number | null;
  /** The scenes runtime's verdict on the safe rect — what `variant` on an edit follows. */
  orientation(): Orientation;
  /** The last fit: the safe rect in design units, what the second frame is drawn from. */
  fit(): Fit | null;
}

const isField = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/**
 * An 8px two-tone checkerboard filling the screen — the "nothing to look
 * at here" backdrop both symbol mode and reels mode draw under their
 * preview. `resize` redraws only when the size actually changed: a zoom or
 * a board swap that leaves the screen alone must not repaint it.
 */
function makeChecker(label: string): { graphics: Graphics; resize(w: number, h: number): void; destroy(): void } {
  const graphics = new Graphics();
  graphics.label = label;
  const CHECK = 8;
  let laid = { w: -1, h: -1 };
  return {
    graphics,
    resize(w, h) {
      if (laid.w === w && laid.h === h) return;
      laid = { w, h };
      graphics.clear();
      graphics.rect(0, 0, w, h).fill({ color: 0x2a2f3a });
      for (let y = 0; y < h; y += CHECK)
        for (let x = (y / CHECK) % 2 === 0 ? 0 : CHECK; x < w; x += CHECK * 2)
          graphics.rect(x, y, Math.min(CHECK, w - x), Math.min(CHECK, h - y));
      graphics.fill({ color: 0x3a4152 });
    },
    destroy() {
      graphics.destroy();
    },
  };
}

export function apply(ctx: Context, config: SceneEditConfig): void {
  // "an editor canvas is on this page" — the scenes runtime reads it to
  // suppress its own `ui.tap` emit (see that row's `onDown`). The editor
  // page composes the project's whole bundle, flow row included, so a
  // click to select a node must not advance a `wait { event: ui.tap }`.
  ctx.provide('sceneEdit', true);
  const g = globalThis as { location?: { search?: string }; document?: { referrer?: string } };
  const mode = pageMode(config, config.search ?? g.location?.search ?? '', config.referrer ?? g.document?.referrer ?? '');
  const { scene } = mode;
  const { scenes } = ctx;
  const app = ctx.renderer.app;
  const wire = createWire({
    parentOrigin: mode.parentOrigin,
    post: config.post ?? ((msg, origin) => window.parent.postMessage(msg, origin)),
    listen: config.listen ?? ((fn) => {
      const on = (e: MessageEvent) => fn(e);
      window.addEventListener('message', on);
      return () => window.removeEventListener('message', on);
    }),
  });
  const emitted: { event: string; payload?: unknown }[] = [];
  const emit = (event: string, payload?: unknown) => {
    if (emitted.push({ event, payload }) > 100) emitted.shift();
    wire.emit(event, payload);
  };
  let alive = true;
  ctx.effect(() => () => { alive = false; wire.dispose(); }, 'scene-edit:wire');

  // Mod+Z / Mod+Shift+Z / Mod+Y forwarded to the IDE as `undo`/`redo` (no
  // payload) — set up here, ahead of the mode branch below, so it runs for
  // scene, symbol AND reels mode alike. scene-edit cannot import the IDE
  // client's `historyAction`, so its key test is re-stated in these few
  // lines: Alt held, or no Mod at all, is not a chord; the letter is `key`
  // when the layout produced a Latin one (QWERTZ's Ctrl+Y sits on the
  // physical Z key and is a redo), and the physical `code` only when it did
  // not (a Russian layout's Ctrl+Z is `key: 'я'`, `code: 'KeyZ'`).
  // A field's own undo (an `<input>` — scene mode's own `onKey` below uses
  // the same `isField`) is left alone, and so is everything else, in
  // particular scene mode's own Ctrl/Meta-free nudge keys.
  const onHistoryKey = (e: KeyboardEvent) => {
    if (e.altKey || (!e.metaKey && !e.ctrlKey) || isField(e.target)) return;
    const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : '';
    const action = k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : k === 'y' ? 'redo' : null;
    if (!action) return;
    e.preventDefault();
    emit(action);
  };
  window.addEventListener('keydown', onHistoryKey);
  ctx.effect(() => () => window.removeEventListener('keydown', onHistoryKey), 'scene-edit:history-keys');

  // Into the same safe rect the scenes runtime fits into: the editor page
  // provides `safeArea` (the IDE's preset band, `?safeBottom=`), and a
  // resize here without it would undo that fit until the next one.
  scenes.resize(app.screen.width, app.screen.height, ctx.reflect.get('safeArea', false) as SafeArea | undefined);

  // Reels mode: the project's board alone, no scene/gizmo/grid/keyboard/drop.
  // Checked before `symbol` — a page never sets both, but the board is the
  // one this canvas exists to show if it somehow did.
  if (mode.reels === true) {
    bootReels();
    return;
  }

  // Symbol mode: one symbols.yml state on the canvas, nothing scene-shaped
  // armed. Gated on `!== undefined`, not truthiness: `''` is a real symbol
  // mode request — the Symbols document's canvas is always
  // `editor.html?symbol=` (the selection arrives as a `symbol` call), so it
  // must boot symbol mode (frame only, waiting for that first call), not
  // fall through to scene mode with `scene: ''`.
  if (mode.symbol !== undefined) {
    bootSymbol(mode.symbol);
    return;
  }

  // Every canvas edit is applied HERE first (`scenes.replace` with the node's
  // props merged), then told to the IDE, whose answer comes back as a
  // `replace` of the same set — JSON-equal, so nothing remounts under a
  // gesture in flight. Until it does, the edit is `pending`: the IDE's echo
  // of an OLDER edit (key repeat outruns the round trip) must not snap the
  // node back, so an incoming set acknowledges the latest pending edit it
  // reflects and the ones after it are laid over it again. A set that
  // reflects none (a refused write, another writer) is taken as is.
  //
  // `variant` picks the layer: `'portrait'` writes `portrait.nodes[node]`
  // (creating the block), `null` the node's own props — and `reflects`
  // reads the same layer back.
  const pending: EditPayload[] = [];
  const patch = (docs: SceneDoc[], node: string, props: Record<string, number>, variant: Variant): SceneDoc[] =>
    docs.map((d) => {
      if (d.id !== scene) return d;
      if (variant) return { ...d, portrait: { nodes: { ...d.portrait?.nodes, [node]: { ...d.portrait?.nodes?.[node], ...props } } } };
      return { ...d, nodes: d.nodes.map((n) => (n.id === node ? { ...n, props: { ...n.props, ...props } } : n)) };
    });
  const reflects = (docs: SceneDoc[], e: EditPayload): boolean => {
    const d = docs.find((x) => x.id === scene);
    const layer = e.variant ? d?.portrait?.nodes?.[e.node] : d?.nodes.find((x) => x.id === e.node)?.props;
    return !!layer && Object.entries(e.props).every(([k, v]) => layer[k] === v);
  };
  // The IDE's documents, on every change: this page composes no `ide-bridge`
  // (its `scene-preview` handler would switch the scene shown here), so the
  // parent is the one source of edits after the boot GET. Handled before
  // `ready`: a `replace` that beats the GET is the fresher fact (the runtime
  // then drops the GET's own answer).
  wire.handle('replace', (p) => {
    let docs = (p as { docs?: SceneDoc[] })?.docs ?? [];
    const acked = pending.map((e) => reflects(docs, e)).lastIndexOf(true);
    pending.splice(0, acked >= 0 ? acked + 1 : pending.length);
    for (const e of pending) docs = patch(docs, e.node, e.props, e.variant);
    scenes.replace(docs);
    return {};
  });

  // The documents land after apply (`scenes`' boot GET, or the IDE's own `replace`): decide once they have.
  void scenes.ready.then(
    () => {
      if (!alive) return;
      if (scenes.docs().has(scene)) boot();
      else emit('error', { message: `scene "${scene}" is not declared` });
    },
    (e: unknown) => { if (alive) emit('error', { message: e instanceof Error ? e.message : String(e) }); },
  );

  /**
   * `mode.symbol` set: no scene document, no gizmo/grid/keyboard/drop — just
   * one `symbols.yml` state on a checkerboard, framed by the board's own idle
   * cell frame (`@energy8engine/reel-core`'s `SymbolCell` style; 96×96 /
   * `DEFAULT_CELL_FRAME_STYLE` when there is no reel board), centred on the
   * screen at a zoom (`fit` / `1:1` / `2x`) the IDE drives over the wire —
   * `fit` sizes the cell to 60% of the screen's smaller side. The composed
   * game (`flow1`'s `boot → show base_game`) still mounts under
   * `scenes.container` — `board.cellSize` and the symbols live set need it —
   * but is hidden; the preview sits on `app.stage` above it, so its own bounds
   * are measurable and `snapshot` still reads them back in design units.
   */
  function bootSymbol(id: string): void {
    const root = scenes.container;
    type SymbolsLike = {
      replace(doc: SymbolsDoc | null): void;
      ready: Promise<void>;
      preview(symId: string, state: SymbolState, size: { width: number; height: number }): Container | null;
    };
    const symbols = ctx.reflect.get('symbols', false) as SymbolsLike | undefined;
    if (!symbols) { emit('error', { message: 'no "symbols" service' }); return; }
    root.visible = false;

    // Read fresh every `layout()` tick, not once here: a hot `reels1`
    // re-apply (`gameRows.update`) swaps the `board` service for a new one
    // (a different cell size, a different frame style), and this preview
    // has no other way to notice — it is not the one that applied `board`.
    const boardStyle = () => {
      const board = ctx.reflect.get('board', false) as
        | { cellSize?: { width: number; height: number }; config?: { grid?: { frameStyle?: CellFrameStyle } } }
        | undefined;
      return {
        cellSize: board?.cellSize ?? { width: 96, height: 96 },
        // `resolveFrameStyle` (not a shallow `{ ...DEFAULT, ...frameStyle }`): a colour-only `idle`
        // (exactly what the Reels document's colour picker writes) must keep its default alpha
        // instead of losing it to a replaced `idle` object — see `SymbolCell.ts`.
        frameStyle: resolveFrameStyle(board?.config?.grid?.frameStyle),
      };
    };
    let { cellSize, frameStyle } = boardStyle();
    type Zoom = 'fit' | '1:1' | '2x';
    const ZOOMS: readonly Zoom[] = ['fit', '1:1', '2x'];
    let zoom: Zoom = 'fit';

    const previewBox = new Container();
    previewBox.label = 'symbol-preview';
    const frameG = new Graphics();
    frameG.label = 'symbol-frame';
    previewBox.addChild(frameG); // replaces the old outline; the view is added after it
    app.stage.addChild(previewBox);
    const checker = makeChecker('symbol-checker');
    app.stage.addChildAt(checker.graphics, 0); // under the preview box
    ctx.effect(() => () => {
      app.stage.removeChild(previewBox);
      app.stage.removeChild(checker.graphics);
      previewBox.destroy({ children: true });
      checker.destroy();
      root.visible = true;
    }, 'scene-edit:symbol-preview');

    const drawFrame = () => {
      frameG
        .clear()
        .roundRect(-cellSize.width / 2, -cellSize.height / 2, cellSize.width, cellSize.height, frameStyle.radius)
        .fill({ color: frameStyle.idle.color, alpha: frameStyle.idle.alpha });
      frameG.tint = frameStyle.idle.color; // what SymbolCell stores, read by tests
    };
    const scaleFor = (w: number, h: number) =>
      zoom === '1:1' ? 1 : zoom === '2x' ? 2
        : (Math.min(w, h) * 0.6) / Math.max(cellSize.width, cellSize.height);
    let laidOutScreen = { w: -1, h: -1 };
    let laidOutZoom = '' as string;
    // The last drawn cellSize/frameStyle, field by field — see `boardStyle`
    // above. Only the fields `drawFrame` actually reads: the idle look is
    // the only one a board-less preview frame ever shows.
    let laidOutStyle = { w: -1, h: -1, radius: -1, color: -1, alpha: -1 };
    const layout = () => {
      const { width: w, height: h } = app.screen;
      checker.resize(w, h); // redraws only on a size change
      const screenChanged = laidOutScreen.w !== w || laidOutScreen.h !== h;
      if (screenChanged) laidOutScreen = { w, h };
      const style = boardStyle();
      const styleChanged =
        laidOutStyle.w !== style.cellSize.width ||
        laidOutStyle.h !== style.cellSize.height ||
        laidOutStyle.radius !== style.frameStyle.radius ||
        laidOutStyle.color !== style.frameStyle.idle.color ||
        laidOutStyle.alpha !== style.frameStyle.idle.alpha;
      if (styleChanged) {
        laidOutStyle = { w: style.cellSize.width, h: style.cellSize.height, radius: style.frameStyle.radius, color: style.frameStyle.idle.color, alpha: style.frameStyle.idle.alpha };
        ({ cellSize, frameStyle } = style);
        drawFrame();
      }
      if (!screenChanged && !styleChanged && laidOutZoom === zoom) return;
      laidOutZoom = zoom;
      previewBox.position.set(w / 2, h / 2);
      previewBox.scale.set(scaleFor(w, h));
    };
    layout();
    app.ticker.add(layout);
    ctx.effect(() => () => app.ticker.remove(layout), 'scene-edit:symbol-layout');
    wire.handle('zoom', (p) => {
      const mode = (p as { mode?: unknown })?.mode;
      zoom = ZOOMS.includes(mode as Zoom) ? (mode as Zoom) : 'fit';
      layout();
      return { mode: zoom };
    });

    let current: { id: string; state: SymbolState } | null = null;
    let view: Container | null = null;

    /** Swaps the shown state: destroys the old view (drops it from the runtime's live set), previews the new one. */
    const showSymbol = (symId: string, state: SymbolState): boolean => {
      if (view) { view.destroy({ children: true }); view = null; }
      current = { id: symId, state };
      view = symbols.preview(symId, state, cellSize);
      if (view) previewBox.addChild(view);
      return view !== null;
    };

    wire.handle('symbol', (p) => {
      const { id: symId, state } = p as { id: string; state: SymbolState };
      return { shown: showSymbol(symId, state) };
    });
    wire.handle('replaceSymbols', (p) => {
      symbols.replace((p as { doc: SymbolsDoc | null }).doc);
      if (current) showSymbol(current.id, current.state);
      return {};
    });
    const snapshot = (): SymbolSnapshot => {
      let w = 0;
      let h = 0;
      if (view) {
        // Measured in `previewBox`'s OWN space, not the scene root's: its
        // scale is the zoom now, not the design→screen scale, so mapping
        // through it (not `root`) divides the zoom back out — `w`/`h` read
        // the same at `fit`, `1:1` and `2x`.
        const b = view.getBounds();
        const tl = previewBox.toLocal({ x: b.minX, y: b.minY });
        const br = previewBox.toLocal({ x: b.maxX, y: b.maxY });
        w = br.x - tl.x;
        h = br.y - tl.y;
      }
      return {
        symbol: current?.id ?? null,
        state: current?.state ?? null,
        w, h,
        cell: { ...cellSize },
        screen: { w: cellSize.width * previewBox.scale.x, h: cellSize.height * previewBox.scale.y },
      };
    };
    wire.handle('snapshot', () => snapshot());

    /** Walks the current preview view's descendants for the first numeric `currentFrame` — same idea as `boot()`'s `frameOf`, just not limited to one level. */
    const frameOf = (_node: string): number | null => {
      if (!view) return null;
      const stack: Container[] = [view];
      while (stack.length) {
        const n = stack.shift()!;
        const cf = (n as unknown as { currentFrame?: unknown }).currentFrame;
        if (typeof cf === 'number') return cf;
        stack.push(...n.children);
      }
      return null;
    };
    // Same test-hook slot scene mode uses, `emitted`/`snapshot`/`frameOf` only — no node
    // to `select`, no `grid`, nothing to `pickAndSelect`. The browser e2e reads
    // `emitted()` for `ready` and `snapshot()` for the bounds, same as the scene canvas.
    const winHook = window as unknown as { __e8edit?: Pick<SceneEdit, 'emitted' | 'snapshot' | 'frameOf'> };
    winHook.__e8edit = { emitted: () => [...emitted], snapshot, frameOf };
    ctx.effect(() => () => { if (winHook.__e8edit?.frameOf === frameOf) delete winHook.__e8edit; }, 'scene-edit:hook');

    void symbols.ready.catch(() => {}).then(() => { if (alive) emit('ready', { symbol: id }); });
  }

  /**
   * `mode.reels === true`: the project's reel board alone, fitted to the
   * screen with a margin — same idle-canvas shape as `bootSymbol` (composed
   * game hidden, checkerboard backdrop), but nothing to pick: what shows is
   * whatever the `board` service (the `reels1` row's `ReelsBoard`)
   * currently provides. Nothing else mounts `board.view` on this page — no
   * flow runs (`editorPage: true`), no scene is shown — so this mode is the
   * one place it reaches the screen. `currentBoard()` is read fresh every
   * tick, not once here: a hot `reels1` re-apply (`gameRows.update`)
   * disposes the old board and `ctx.provide`s a new one, and `layout()`
   * follows it, swapping `box`'s child without tearing the mode down — the
   * old view is only removed, never destroyed; its owner (the row) does
   * that. `rows` is the one write this mode makes, and it is not a second
   * writer: it hands each row's config straight to `gameRows.update`, the
   * same door `ide-bridge` uses for a hot row edit from the IDE side.
   *
   * `spin`/`scatters`/`win`/`tumble` (Task 4) are the reel lab's own test
   * actions — synthetic results built from the project's symbol ids
   * (`./lab`), played through `board.spinTo`/`revealWins`/`tumble`
   * directly. No mechanic runs and nothing reaches a server; see the
   * `runStep` helper below for the shared busy/board/symbols gate every
   * one of them answers through.
   */
  function bootReels(): void {
    const root = scenes.container;
    root.visible = false;
    const checker = makeChecker('reels-checker');
    const box = new Container();
    box.label = 'reels-box';
    app.stage.addChild(checker.graphics, box);

    /**
     * The slice of `ReelsBoard` (`@energy8engine/game-reels`) this mode
     * reads — not a dependency of this package, so declared structurally
     * instead of imported. `spinTo`/`revealWins`/`tumble` are the board
     * steps Task 4's lab actions below play (`BoardApi`,
     * `@energy8engine/play-loop`); `symbols` is NOT part of that contract
     * — an optional escape hatch a test board can offer so `win()`/
     * `tumble()` have something to read before any lab `spin()` has run.
     * The real board has none, so on it those two always need a `spin()`
     * first. `grid` is only read by `snapshot` (what the cells hold — a
     * painted start board included, plus one cell's drawn frame alpha —
     * never by an action. A real cell (`@energy8engine/reel-core`'s
     * `SymbolCell`) is a `Container` whose first child is its frame
     * `Graphics` — public at runtime even though `CellLike`
     * (`@energy8engine/reels`) never names it; `children` here is that
     * same reachable shape, typed just enough for `idleAlphaOf` below. A
     * test fake with no `children` on its cells answers `null`, same as no
     * `grid` at all.
     */
    interface ReelsBoardLike {
      readonly view: Container;
      readonly config?: { grid?: { cols?: number; rows?: number; rowsPerReel?: number[] } };
      readonly grid?: {
        getCell(col: number, row: number): {
          data: { symbol: string | null };
          children?: readonly { context?: { instructions?: readonly { action: string; data?: { style?: { alpha: number } } }[] } }[];
        } | undefined;
      };
      spinTo(step: SpinToStep): Promise<void>;
      /** Collapses whatever `spinTo`/`revealWins`/`tumble` is mid-flight to its end state at once — the real board's own hurry-up (`@energy8engine/reels`). `fillIfEmpty` calls it right after `spinTo` so an empty board shows landed reels, not a spin in progress. */
      skip?(opts?: { overlays?: boolean }): void;
      revealWins(step: RevealWinsStep): Promise<void>;
      tumble(step: TumbleStep): Promise<void>;
      symbols?(): string[][];
    }
    const currentBoard = () => ctx.reflect.get('board', false) as ReelsBoardLike | undefined;

    /** The alpha off a cell's own frame Graphics (its first child) — the fill instruction's
     * style, same as `boardStyle`'s draw above and `plugin.test.ts`'s own checks. `null` when
     * the cell has no reachable frame (no `children[0]`, or it never drew a `fill`). */
    const idleAlphaOf = (cell: NonNullable<ReturnType<NonNullable<ReelsBoardLike['grid']>['getCell']>> | undefined): number | null => {
      const fill = cell?.children?.[0]?.context?.instructions?.find((i) => i.action === 'fill');
      return fill?.data?.style?.alpha ?? null;
    };

    /**
     * The reel lab's test actions: synthetic spins, scatters, a win and a
     * tumble (`./lab`), built from the project's own symbol ids and played
     * through the board's real steps — no mechanic, no server. `last` is
     * what the last spin or tumble left showing, and ON WHICH board: read
     * back by `win`/`tumble` so they act on what is actually there, and
     * ignored once `currentBoard()` is a different one (a `reels1`
     * re-apply rebuilt it — its cells are the start board now, which the
     * lab cannot read, so `'spin first'`; an EMPTY rebuilt board is filled
     * instead, with this same grid when its shape allows — `fillIfEmpty`).
     * `busy` serialises the four actions one at a time (like a real spin)
     * and is what `snapshot` reports below. `Math.random` here;
     * `lab.test.ts` is where a seeded `Rand` proves the shapes without one.
     */
    let last: { board: ReelsBoardLike; grid: string[][] } | null = null;
    const showing = (board: ReelsBoardLike) => (last?.board === board ? last.grid : board.symbols?.() ?? null);
    let busy = false;
    const rand: Rand = Math.random;

    /** The symbols row's known ids (`symbols.yml`, parsed) — `undefined` with no `symbols` service on `ctx` at all. */
    const symbolIds = (): string[] | undefined =>
      (ctx.reflect.get('symbols', false) as { doc(): SymbolsDoc | null } | undefined)?.doc()?.symbols.map((s) => s.id);

    const shapeOf = (board: ReelsBoardLike | undefined): Shape => {
      const grid = board?.config?.grid;
      const cols = grid?.cols ?? 0;
      return { cols, rows: grid?.rowsPerReel ?? Array.from({ length: cols }, () => grid?.rows ?? 0) };
    };

    /** Boards this mode already looked at for emptiness — a board is filled (or reported) at most once. */
    const seen = new WeakSet<ReelsBoardLike>();
    const isEmpty = (board: ReelsBoardLike) => {
      const { cols, rows } = shapeOf(board);
      if (!board.grid || cols === 0) return false;
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < (rows[c] ?? 0); r++) if (board.grid.getCell(c, r)?.data.symbol) return false;
      return true;
    };
    /**
     * An empty board — no `reels1.board`, symbols a flow step would have
     * seeded (the editor page runs no flow) — gets a board at once: the
     * lab's own spin, skipped to its end, so the canvas shows reels, not
     * frames. Runs from `layout` (every tick) until the board is judged once.
     *
     * The board it lands is the grid the last one showed (`last.grid`) when
     * the new board has that grid's shape and knows its symbols — a
     * `reels1` re-apply for a colour or a gap rebuilds the board, and that
     * must not reshuffle what is on it; any other board gets a random one.
     *
     * `busy` is held from `spinTo` until its promise settles. A SYNCHRONOUS
     * throw out of `spinTo` (a board fake, or a real board that validates
     * its input eagerly) clears it at once, or every lab action would stay
     * disabled; `skip` is guarded on its own, after the promise already has
     * its handlers, so a throwing `skip` neither frees `busy` while the
     * spin still runs nor leaves the promise's rejection unhandled. Every
     * failure reports through `fail`, which stays quiet for a board no
     * longer current (a `reels1` re-apply swapped it mid-step, the same
     * "board replaced" idea `runStep` has) and otherwise tells the IDE.
     */
    const fillIfEmpty = (board: ReelsBoardLike) => {
      if (busy || seen.has(board)) return;
      const symbols = symbolIds();
      if (symbols === undefined) return; // symbols.yml not read yet: judge on a later tick
      seen.add(board);
      if (!isEmpty(board)) return;
      if (symbols.length === 0) {
        emit('error', { message: 'the board is empty and the project has no symbols to fill it with' });
        return;
      }
      const shape = shapeOf(board);
      const prev = last?.grid;
      const kept =
        prev?.length === shape.cols &&
        prev.every((col, c) => col.length === shape.rows[c] && col.every((s) => symbols.includes(s)));
      const built = kept ? prev : randomBoard(shape, symbols, rand);
      const fail = (e: unknown) => {
        if (currentBoard() !== board) return; // a rebuild already moved on — nothing to tell
        emit('error', { message: `couldn't fill the board: ${e instanceof Error ? e.message : String(e)}` });
      };
      busy = true;
      let done: Promise<void>;
      try {
        done = board.spinTo({ kind: 'spinTo', board: built });
      } catch (e) {
        busy = false;
        fail(e);
        return;
      }
      void done
        .then(() => { if (currentBoard() === board) last = { board, grid: built }; })
        .catch(fail)
        .finally(() => { busy = false; });
      try {
        board.skip?.();
      } catch (e) {
        fail(e);
      }
    };

    let mounted: Container | null = null;
    const MARGIN = 24;
    // `bw`/`bh` are the measurement the CURRENT fit was taken from — read by
    // `snapshot` below. Re-measured only when `view`/`w`/`h` change (a new
    // mounted view, or a screen resize), never every tick: a spin's
    // overshoot or a win glow bleeding past the grid changes the SAME
    // view's `getLocalBounds()` frame to frame, and re-fitting on that
    // would pulse the box mid-spin. A grid change rebuilds the board (a
    // `reels1` re-apply), which IS a new `view` — covered below.
    let laid = { w: -1, h: -1, view: null as Container | null, bw: -1, bh: -1 };
    const layout = () => {
      const board = currentBoard();
      // A destroyed view is as good as none: `getLocalBounds()` on one is
      // not safe to trust, and it must not linger in `box` either.
      const view = board && !board.view.destroyed ? board.view : null;
      if (view !== mounted) {
        if (mounted && mounted.parent === box) box.removeChild(mounted);
        mounted = view;
        if (view) box.addChild(view);
      }
      const { width: w, height: h } = app.screen;
      checker.resize(w, h); // redraws only on a size change
      if (!view) return;
      if (!(laid.w === w && laid.h === h && laid.view === view)) {
        const b = view.getLocalBounds();
        laid = { w, h, view, bw: b.width, bh: b.height };
        const s = Math.min((w - 2 * MARGIN) / b.width, (h - 2 * MARGIN) / b.height);
        box.scale.set(s);
        box.position.set(w / 2 - (b.x + b.width / 2) * s, h / 2 - (b.y + b.height / 2) * s);
      }
      // Every tick, once the fit above (if any) has had its say — an empty
      // board (no flow ran to seed it) is filled at once; see `fillIfEmpty`.
      if (board) fillIfEmpty(board);
    };
    app.ticker.add(layout);
    ctx.effect(() => () => {
      app.ticker.remove(layout);
      if (mounted?.parent === box) box.removeChild(mounted);
      box.destroy();
      checker.destroy();
      root.visible = true;
    }, 'scene-edit:reels');

    /** The one `gameRows` method reels mode calls — see `@energy8engine/game-runtime`'s `GameRowsService`; not a dependency of this package either. */
    interface GameRowsUpdater {
      update(id: string, config: Record<string, unknown>): Promise<'updated' | 'unknown' | 'failed'>;
    }

    /**
     * One lab action end to end: refuses a second one while `busy`, then
     * with no board or no symbol vocabulary to draw a board from, then
     * hands `run` a live board and the project's symbol ids. Whatever `run`
     * throws — its board step's promise rejecting, or the `board replaced`
     * it raises itself when a hot `reels1` re-apply swapped the board
     * mid-step — lands here as `{ ok: false, reason: <message> }`; the rpc
     * call itself never rejects.
     *
     * A board torn down mid-step can reject through either door: the
     * handler's own post-await identity check, or the real board's own
     * teardown message (`ReelSystem`'s "board destroyed — reels1 was
     * re-applied…", or anything else a disposed board throws on its way
     * out). Both mean the same thing to the caller, so this is the one
     * place that normalizes them: whatever `e` says, a board swap detected
     * AT CATCH TIME answers `'board replaced'` — one reason, not whichever
     * of the two happened to fire first.
     */
    const runStep = async (
      run: (board: ReelsBoardLike, symbols: string[]) => Promise<void>,
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (busy) return { ok: false, reason: 'busy' };
      const board = currentBoard();
      if (!board) return { ok: false, reason: 'no board' };
      const symbols = symbolIds();
      if (!symbols || symbols.length === 0) return { ok: false, reason: 'no symbols' };
      busy = true;
      try {
        await run(board, symbols);
        return { ok: true };
      } catch (e) {
        if (currentBoard() !== board) return { ok: false, reason: 'board replaced' };
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      } finally {
        busy = false;
      }
    };

    wire.handle('spin', () =>
      runStep(async (board, symbols) => {
        const built = randomBoard(shapeOf(board), symbols, rand);
        await board.spinTo({ kind: 'spinTo', board: built });
        if (currentBoard() !== board) throw new Error('board replaced');
        last = { board, grid: built };
      }),
    );
    wire.handle('scatters', (p) => {
      const { triggers, threshold } = (p ?? {}) as { triggers?: string[]; threshold?: number };
      // Nothing to seed the first reels with — `scatterBoard` would drop `undefined` cells.
      if (!triggers?.length) return { ok: false, reason: 'no trigger symbols' };
      return runStep(async (board, symbols) => {
        const built = scatterBoard(shapeOf(board), symbols, triggers, threshold ?? 0, rand);
        await board.spinTo({ kind: 'spinTo', board: built });
        if (currentBoard() !== board) throw new Error('board replaced');
        last = { board, grid: built };
      });
    });
    wire.handle('win', () =>
      runStep(async (board) => {
        const grid = showing(board);
        if (!grid) throw new Error('spin first');
        await board.revealWins(lineWin(grid, rand));
        if (currentBoard() !== board) throw new Error('board replaced');
      }),
    );
    wire.handle('tumble', () =>
      runStep(async (board, symbols) => {
        const grid = showing(board);
        if (!grid) throw new Error('spin first');
        const step = clusterTumble(grid, symbols, rand);
        await board.tumble(step);
        if (currentBoard() !== board) throw new Error('board replaced');
        // `clusterTumble` builds `settled` from these same string ids.
        last = { board, grid: step.settled as string[][] };
      }),
    );

    wire.handle('rows', async (p) => {
      const rows = (p as { rows?: { id: string; config: Record<string, unknown> }[] })?.rows ?? [];
      const gameRows = ctx.reflect.get('gameRows', false) as GameRowsUpdater | undefined;
      const results = await Promise.all(
        rows.map(async ({ id, config }) => ({
          id,
          result: gameRows ? await gameRows.update(id, config) : ('unknown' as const),
        })),
      );
      return { results };
    });
    const snapshot = (): ReelsSnapshot => {
      const board = currentBoard();
      const { cols, rows } = shapeOf(board);
      const grid = board?.grid;
      const symbols = grid
        ? rows.map((height, col) => Array.from({ length: height }, (_, row) => grid.getCell(col, row)?.data.symbol ?? null))
        : null;
      const idleAlpha = grid ? idleAlphaOf(grid.getCell(0, 0)) : null;
      const frame = idleAlpha === null ? null : { idleAlpha };
      return { mode: 'reels', cols, rows, fitted: { w: laid.bw * box.scale.x, h: laid.bh * box.scale.y }, busy, symbols, frame };
    };
    wire.handle('snapshot', () => snapshot());
    // Same test-hook slot symbol/scene mode install (`emitted`/`snapshot`
    // only — no node to `select`, no `frameOf`): a browser e2e reads
    // `emitted()` for `ready` and `snapshot()` for the live board shape and cells,
    // independently of the `rows`/`spin`/… wire calls the real
    // `ReelsDocument` drives it with.
    const winHook = window as unknown as { __e8edit?: Pick<SceneEdit, 'emitted' | 'snapshot'> };
    winHook.__e8edit = { emitted: () => [...emitted], snapshot };
    ctx.effect(() => () => { if (winHook.__e8edit?.snapshot === snapshot) delete winHook.__e8edit; }, 'scene-edit:reels-hook');
    emit('ready', { reels: true });
    // The first layout only after `ready`: `ready` clears the IDE's canvas
    // status, and the first fill may already have something to report.
    layout();
  }

  function boot(): void {
    const root = scenes.container;
    const doc = () => scenes.docs().get(scene);
    const views = () =>
      (doc()?.nodes ?? []).flatMap((n) => { const view = scenes.view({ scene, node: n.id }); return view ? [{ node: n.id, view }] : []; });
    /**
     * The design size (the current orientation's), read off the fit: the
     * design is centred in the safe rect, so `left + right` is its width
     * — right under insets and a portrait design alike, where the screen
     * centre is no longer the design centre. Before a fit, the old rule.
     */
    const design = () => {
      const v = scenes.fit()?.viewport;
      // Rounded: `479.99999999999994` would lose the grid's last line.
      if (v) return { width: Math.round(v.left + v.right), height: Math.round(v.top + v.bottom) };
      const c = root.toLocal({ x: app.screen.width / 2, y: app.screen.height / 2 });
      return { width: c.x * 2, height: c.y * 2 };
    };
    const toDesign = (p: { x: number; y: number }) => root.toLocal(p);
    /** A top-level node's props as the runtime reads them: the portrait override laid over its own while the safe rect is portrait. */
    const merged = (node: string): Record<string, unknown> | undefined => {
      const d = doc();
      const n = d?.nodes.find((x) => x.id === node);
      return n && { ...n.props, ...(scenes.orientation() === 'portrait' ? d?.portrait?.nodes?.[node] : undefined) };
    };
    const variant = (): Variant => (scenes.orientation() === 'portrait' ? 'portrait' : null);

    // Grid: design space, under the scene root.
    const gridGfx = new Graphics();
    gridGfx.label = 'grid';
    root.addChildAt(gridGfx, 0);
    let gridOn = false;
    let gridStep = 16;
    const grid = (on: boolean, step: number) => {
      gridOn = on; gridStep = Math.max(1, step || 16);
      gridGfx.clear();
      if (!on) return;
      const d = design();
      for (let x = 0; x <= d.width; x += gridStep) gridGfx.moveTo(x, 0).lineTo(x, d.height);
      for (let y = 0; y <= d.height; y += gridStep) gridGfx.moveTo(0, y).lineTo(d.width, y);
      gridGfx.stroke({ width: 1, color: 0xffffff, alpha: 0.15, pixelLine: true });
    };
    ctx.effect(() => () => { root.removeChild(gridGfx); gridGfx.destroy(); }, 'scene-edit:grid');

    // Two frames in design space, over the grid: the design box, and the
    // safe rect (`fit.viewport`) a `pin` measures from — with the band the
    // shell's bar would take (below `viewport.bottom`, to the screen's
    // bottom) hatched. Redrawn with the grid whenever the fit changes.
    const frames = new Container();
    frames.label = 'frames';
    const designFrame = new Graphics();
    designFrame.label = 'design-frame';
    const safeRect = new Graphics();
    safeRect.label = 'safe-rect';
    const safeBand = new Graphics();
    safeBand.label = 'safe-band';
    frames.addChild(designFrame, safeRect, safeBand);
    root.addChildAt(frames, 1);
    ctx.effect(() => () => { root.removeChild(frames); frames.destroy({ children: true }); }, 'scene-edit:frames');
    const drawFrames = () => {
      const d = design();
      designFrame.clear().rect(0, 0, d.width, d.height).stroke({ width: 1, color: 0xffffff, alpha: 0.35, pixelLine: true });
      safeRect.clear();
      safeBand.clear();
      const v = scenes.fit()?.viewport;
      if (!v) return;
      safeRect.rect(v.left, v.top, v.right - v.left, v.bottom - v.top).stroke({ width: 1, color: 0xffb84d, alpha: 0.9, pixelLine: true });
      const screenBottom = toDesign({ x: 0, y: app.screen.height }).y;
      if (v.bottom >= screenBottom) return;
      const x0 = toDesign({ x: 0, y: 0 }).x;
      const w = toDesign({ x: app.screen.width, y: 0 }).x - x0;
      const h = screenBottom - v.bottom;
      safeBand.rect(x0, v.bottom, w, h).fill({ color: 0xffb84d, alpha: 0.08 });
      // 45° hatching, each line clipped to the band: `x - x0 - (y - v.bottom) = d`.
      const step = 12 / (scenes.fit()?.scale ?? 1);
      for (let dd = -h; dd < w; dd += step) {
        const p1 = dd >= 0 ? { x: x0 + dd, y: v.bottom } : { x: x0, y: v.bottom - dd };
        const p2 = dd + h <= w ? { x: x0 + dd + h, y: v.bottom + h } : { x: x0 + w, y: v.bottom + w - dd };
        safeBand.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y);
      }
      safeBand.stroke({ width: 1, color: 0xffb84d, alpha: 0.35, pixelLine: true });
    };
    let drawnFit: Fit | null = null;
    let told: Orientation = scenes.orientation();
    /**
     * The fit is a new object per `resize`: on the frame that sees one, the
     * grid and the frames follow it — and a flipped orientation is told to
     * the IDE (`orientation` event; `ready` carries the first). The page is
     * the one source of which layer an edit goes to: the IDE never
     * computes it from its preset.
     */
    const refit = () => {
      if (scenes.fit() === drawnFit) return;
      drawnFit = scenes.fit();
      grid(gridOn, gridStep);
      drawFrames();
      if (scenes.orientation() !== told) emit('orientation', { orientation: (told = scenes.orientation()) });
    };
    refit();

    // Gizmo: screen space, above everything.
    const layer = new Container();
    layer.label = 'gizmo';
    app.stage.addChild(layer);
    let selected: string | null = null;
    let target: GizmoTarget | null = null;
    const gizmo = createGizmo({
      layer,
      // `getGlobalTransform`, not `worldTransform`: the latter is only refreshed by a render pass.
      designPerPixel: () => 1 / root.getGlobalTransform().a,
      // A pinned node's file value is its OFFSET from the pin point, so
      // that is what lands on the grid — the absolute would put the offset
      // off-grid by the pin point's own fraction. The centre snap is an
      // absolute matter and does not apply to an offset.
      snap: (p, alt) => {
        if (alt) return p;
        const o = { on: gridOn, step: gridStep, design: design() };
        const at = pinOf(target?.node);
        if (!at) return snapPoint(p, o);
        const s = snapPoint({ x: p.x - at.x, y: p.y - at.y }, { ...o, centre: false });
        return { x: s.x + at.x, y: s.y + at.y };
      },
      onEdit: applyEdit,
      onBodyClick: (x, y) => pickAndSelect(x, y),
    });
    ctx.effect(() => () => { gizmo.destroy(); app.stage.removeChild(layer); layer.destroy(); }, 'scene-edit:gizmo');

    const targetOf = (node: string): GizmoTarget | null => {
      const view = scenes.view({ scene, node });
      const props = merged(node);
      return view && props ? { node, view, props: COMMON(props as never) as GizmoTarget['props'] } : null;
    };
    const select = (node: string | null) => {
      target = node === null ? null : targetOf(node);
      gizmo.attach(target);
      if (node === selected) return;
      selected = node;
      // A node with no top-level view (nested, or not mounted) is the IDE's pick, not the canvas': kept, not echoed.
      if (node === null || target) emit('selected', { node });
    };
    const pickAndSelect = (x: number, y: number) => select(pickAt(views(), { x, y }));

    /** The pin point a node's `x`/`y` are offsets from — `null` for an unpinned node, or before the first fit. */
    const pinOf = (node: string | null | undefined): { x: number; y: number } | null => {
      const pin = node ? (merged(node)?.pin as Pin | '' | undefined) : undefined;
      const fit = scenes.fit();
      return pin && fit ? pinPoint(pin, fit.viewport) : null;
    };

    /**
     * Rounded as the file should read (`sceneRounding` — the IDE rounds by
     * the same table, so its echo matches and acknowledges the edit),
     * applied here, then told. The gizmo hands over the view's ABSOLUTE
     * position; a pinned node's file value is the offset from its pin
     * point, so `x`/`y` are converted before either. Into the current
     * variant's layer.
     */
    function applyEdit(node: string, props: Partial<GizmoTarget['props']>): void {
      const at = pinOf(node) ?? { x: 0, y: 0 };
      const rounded: Record<string, number> = {};
      for (const [k, v] of Object.entries(props) as [string, number][]) {
        const value = k === 'x' ? v - at.x : k === 'y' ? v - at.y : v;
        const by = sceneRounding[k];
        rounded[k] = by ? Math.round(value * by) / by : value;
      }
      const edit: EditPayload = { node, props: rounded, variant: variant() };
      if (pending.push(edit) > 100) pending.shift();
      scenes.replace(patch([...scenes.docs().values()], node, rounded, edit.variant));
      retarget();
      emit('edit', edit);
    }

    // A `replace` remounts: the selected node's view is a new object — follow it, or drop a node that is gone.
    const retarget = () => {
      if (!target) return;
      const view = scenes.view({ scene, node: target.node });
      if (!view) select(null);
      else if (view !== target.view) gizmo.attach((target = { ...target, view }));
    };
    const frame = () => { refit(); retarget(); gizmo.refresh(); };
    app.ticker.add(frame);
    ctx.effect(() => () => app.ticker.remove(frame), 'scene-edit:frame');

    // Picking: the whole screen, on the stage; node views stay non-interactive.
    const was = { eventMode: app.stage.eventMode, hitArea: app.stage.hitArea };
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    const onDown = (e: FederatedPointerEvent) => pickAndSelect(e.global.x, e.global.y);
    app.stage.on('pointerdown', onDown);
    ctx.effect(() => () => { app.stage.off('pointerdown', onDown); Object.assign(app.stage, was); }, 'scene-edit:pick');

    const onKey = (e: KeyboardEvent) => {
      if (!selected || e.metaKey || e.ctrlKey || isField(e.target)) return;
      const n = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowLeft': gizmo.nudge(-n, 0); break;
        case 'ArrowRight': gizmo.nudge(n, 0); break;
        case 'ArrowUp': gizmo.nudge(0, -n); break;
        case 'ArrowDown': gizmo.nudge(0, n); break;
        case 'Delete': case 'Backspace': emit('remove', { node: selected }); break;
        case ']': case '[': emit('zorder', { node: selected, delta: e.key === ']' ? 1 : -1 }); break;
        case 'Escape': select(null); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    ctx.effect(() => () => window.removeEventListener('keydown', onKey), 'scene-edit:keys');

    const dropTarget = config.dropTarget ?? app.canvas;
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      const path = e.dataTransfer?.getData('text/x-e8-path') || undefined;
      const file = e.dataTransfer?.files?.[0];
      if (!path && !file) return; // not ours: a stray text drag, a URL
      e.preventDefault();
      const rect = dropTarget.getBoundingClientRect();
      const { x, y } = toDesign({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      emit('drop', { path, file, x, y });
    };
    dropTarget.addEventListener('dragover', onDragOver);
    dropTarget.addEventListener('drop', onDrop);
    ctx.effect(() => () => { dropTarget.removeEventListener('dragover', onDragOver); dropTarget.removeEventListener('drop', onDrop); }, 'scene-edit:drop');

    const snapshot = (): Snapshot => ({
      scene,
      selected,
      bounds: Object.fromEntries(views().map(({ node, view }) => {
        const b = view.getBounds();
        const tl = toDesign({ x: b.minX, y: b.minY });
        const br = toDesign({ x: b.maxX, y: b.maxY });
        return [node, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }];
      })),
    });

    const frameOf = (node: string): number | null => {
      const view = scenes.view({ scene, node });
      const animated = [view, view?.children[0]].find((v) => typeof (v as { currentFrame?: unknown } | undefined)?.currentFrame === 'number');
      return animated ? (animated as unknown as { currentFrame: number }).currentFrame : null;
    };

    wire.handle('select', (p) => { select((p as { node?: string | null })?.node ?? null); return {}; });
    wire.handle('grid', (p) => { const { on, step } = p as { on?: boolean; step?: number }; grid(!!on, step ?? 16); return {}; });
    wire.handle('snapshot', () => snapshot());

    const api: SceneEdit = { snapshot, select, grid, pickAndSelect, emitted: () => [...emitted], frameOf, orientation: () => scenes.orientation(), fit: () => scenes.fit() };
    const w = window as unknown as { __e8edit?: SceneEdit };
    w.__e8edit = api;
    ctx.effect(() => () => { if (w.__e8edit === api) delete w.__e8edit; }, 'scene-edit:hook');

    void scenes.show(scene, { preview: true }).then(() => { if (alive) emit('ready', { scene, orientation: scenes.orientation() }); });
  }
}
