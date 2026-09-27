// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { Container, Graphics, Texture, type FederatedPointerEvent } from 'pixi.js';
import Schema from 'schemastery';
import type { SceneDoc, SymbolsDoc } from '@energy8engine/contracts';
import { container, createNodeTypes, createScenes, image, type AssetLoader, type NodeType } from '@energy8engine/scenes';
import * as plugin from '../src/index';

const loader: AssetLoader = { load: async () => {}, unload: async () => {}, get: () => Texture.EMPTY };
/** A 40×40 filled square — `container` is empty and picks nothing. */
const box: NodeType = { type: 'box', schema: Schema.object({}), mount: () => new Graphics().rect(0, 0, 40, 40).fill(0xffffff) };
/** `AnimatedSprite`-shaped (a numeric `currentFrame`), and the gif wrapper's shape: a plain container whose child is. */
const anim: NodeType = { type: 'anim', schema: Schema.object({}), mount: () => Object.assign(new Container(), { currentFrame: 3 }) };
const wrapped: NodeType = { type: 'wrapped', schema: Schema.object({}), mount: () => { const c = new Container(); c.addChild(Object.assign(new Container(), { currentFrame: 5 })); return c; } };

// Design 960×576 on a 480×288 screen: scale 0.5, no letterbox. `lo` covers design 100..140, `hi` 120..160.
const DOCS: SceneDoc[] = [
  { id: 'a', nodes: [{ id: 'lo', type: 'box', props: { x: 100, y: 100 } }, { id: 'hi', type: 'box', props: { x: 120, y: 120 } }] },
  { id: 'b', nodes: [{ id: 'only', type: 'box', props: {} }, { id: 'spin', type: 'anim', props: {} }, { id: 'pic', type: 'wrapped', props: {} }] },
];

type Frame = { type: string; id?: number; event?: string; payload?: unknown; ok?: boolean; result?: unknown };

function boot(scene = 'a', docs = DOCS, docsReady?: Promise<void>, safeArea?: { top: number; right: number; bottom: number; left: number }) {
  const ctx = new Context();
  const app = { stage: new Container(), ticker: { add: vi.fn(), remove: vi.fn() }, canvas: document.createElement('canvas'), screen: { width: 480, height: 288 } };
  ctx.provide('renderer', { app });
  if (safeArea) ctx.provide('safeArea', safeArea);
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, box, anim, wrapped]) nodeTypes.register(t);
  ctx.provide('nodeTypes', nodeTypes);
  const scenes = createScenes({ root: app.stage, design: { width: 960, height: 576 }, nodeTypes, loader, ctx });
  scenes.replace(docs);
  if (docsReady) scenes.ready = docsReady;
  ctx.provide('scenes', scenes);
  const posted: Frame[] = [];
  let listener: ((e: { data: unknown; origin: string }) => void) | undefined;
  const dropTarget = document.createElement('div');
  let id = 0;
  const fiber = ctx.plugin(plugin, {
    scene, parentOrigin: 'http://ide', dropTarget,
    post: (msg: unknown) => posted.push(msg as Frame),
    listen: (fn) => { listener = fn; return () => { listener = undefined; }; },
  });
  const events = () => posted.filter((m) => m.type === 'e8:ide:evt').map(({ event, payload }) => ({ event, payload }));
  const call = async (method: string, params: unknown = {}) => {
    const reqId = ++id;
    listener?.({ data: { type: 'e8:ide:req', id: reqId, method, params }, origin: 'http://ide' });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'e8:ide:res' && m.id === reqId)).toBe(true));
    return posted.find((m) => m.type === 'e8:ide:res' && m.id === reqId)!;
  };
  const ready = () => vi.waitFor(() => expect(events().some((e) => e.event === 'ready')).toBe(true));
  const frame = () => (app.ticker.add.mock.calls[0][0] as () => void)();
  const gizmoLayer = () => app.stage.children.find((c) => c.label === 'gizmo');
  const gizmoShown = () => !!gizmoLayer()?.children.some((c) => c.visible);
  const key = (k: string, init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true, ...init }));
  const edit = () => (window as unknown as { __e8edit: plugin.SceneEdit }).__e8edit;
  return { ctx, app, scenes, fiber, posted, events, call, ready, frame, gizmoLayer, gizmoShown, key, dropTarget, edit };
}

/**
 * A minimal `SymbolsService` fake. `preview` answers, for id "coin": a
 * 40×40-bounded `Graphics` view for `state: 'static'` (known bounds, no
 * `currentFrame` anywhere — the "still" fixture), or for `state: 'idle'` a
 * wrapper → wrapper → `{ currentFrame: 3 }` view two levels deep (`frameOf`'s
 * BFS has to actually walk, not just check the view and its first child).
 * `null` for any other id (the "unknown symbol" path).
 */
function fakeSymbols() {
  const previewCalls: { id: string; state: string }[] = [];
  const views: Container[] = [];
  const symbols = {
    replace: vi.fn(),
    ready: Promise.resolve(),
    preview: vi.fn((id: string, state: string) => {
      previewCalls.push({ id, state });
      if (id !== 'coin') return null;
      const c = new Container();
      if (state === 'idle') {
        const wrapper = new Container();
        wrapper.addChild(Object.assign(new Container(), { currentFrame: 3 }));
        c.addChild(wrapper);
      } else {
        c.addChild(new Graphics().rect(0, 0, 40, 40).fill(0xffffff));
      }
      views.push(c);
      return c;
    }),
  };
  return { symbols, previewCalls, views };
}

/** Same fake-wire harness as `boot()`, wired for `symbol: 'coin'` (or `symbol` when given) instead of a scene. `symbols` is `ctx.provide`d only when given — omit it to test the no-service path. `board` is `ctx.provide`d only when given, same rule. */
function bootSymbol(symbols?: unknown, symbol = 'coin', board?: unknown) {
  const ctx = new Context();
  const app = { stage: new Container(), ticker: { add: vi.fn(), remove: vi.fn() }, canvas: document.createElement('canvas'), screen: { width: 480, height: 288 } };
  ctx.provide('renderer', { app });
  const nodeTypes = createNodeTypes();
  ctx.provide('nodeTypes', nodeTypes);
  const scenes = createScenes({ root: app.stage, design: { width: 960, height: 576 }, nodeTypes, loader, ctx });
  ctx.provide('scenes', scenes);
  if (symbols !== undefined) ctx.provide('symbols', symbols);
  if (board !== undefined) ctx.provide('board', board);
  const posted: Frame[] = [];
  let listener: ((e: { data: unknown; origin: string }) => void) | undefined;
  let id = 0;
  const fiber = ctx.plugin(plugin, {
    scene: 'a', symbol, parentOrigin: 'http://ide',
    post: (msg: unknown) => posted.push(msg as Frame),
    listen: (fn) => { listener = fn; return () => { listener = undefined; }; },
  });
  const events = () => posted.filter((m) => m.type === 'e8:ide:evt').map(({ event, payload }) => ({ event, payload }));
  const call = async (method: string, params: unknown = {}) => {
    const reqId = ++id;
    listener?.({ data: { type: 'e8:ide:req', id: reqId, method, params }, origin: 'http://ide' });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'e8:ide:res' && m.id === reqId)).toBe(true));
    return posted.find((m) => m.type === 'e8:ide:res' && m.id === reqId)!;
  };
  const ready = () => vi.waitFor(() => expect(events().some((e) => e.event === 'ready')).toBe(true));
  const frame = () => (app.ticker.add.mock.calls[0][0] as () => void)();
  const edit = () => (window as unknown as { __e8edit: Pick<plugin.SceneEdit, 'emitted' | 'snapshot' | 'frameOf'> }).__e8edit;
  return { ctx, app, scenes, fiber, events, call, ready, frame, edit };
}

describe('symbol mode', () => {
  it('emits ready (with the symbol id) once symbols.ready settles', async () => {
    const { symbols } = fakeSymbols();
    const { events, ready } = bootSymbol(symbols);
    await ready();
    expect(events()[0]).toEqual({ event: 'ready', payload: { symbol: 'coin' } });
  });

  it('hides the composed game under the preview: scenes.container is invisible, the preview sits centred on app.stage at the fit zoom', async () => {
    const { symbols } = fakeSymbols();
    const { app, scenes, ready, fiber } = bootSymbol(symbols);
    await ready();
    expect(scenes.container.visible).toBe(false);
    const preview = app.stage.getChildByLabel('symbol-preview')!;
    expect(preview.parent).toBe(app.stage);
    expect(preview.position).toMatchObject({ x: 240, y: 144 });
    // fit: the 96×96 default cell's larger side is 60% of the 288 screen's smaller side.
    expect(preview.scale.x).toBeCloseTo((288 * 0.6) / 96, 5);
    const layout = app.ticker.add.mock.calls[0][0];
    await fiber.dispose();
    expect(scenes.container.visible).toBe(true);
    expect(app.stage.getChildByLabel('symbol-preview')).toBeNull();
    expect(app.stage.getChildByLabel('symbol-checker')).toBeNull();
    expect(app.ticker.remove).toHaveBeenCalledWith(layout);
  });

  it('symbol previews a state and answers shown; snapshot reports the view bounds in design space', async () => {
    const { symbols } = fakeSymbols();
    const { call, ready } = bootSymbol(symbols);
    await ready();
    const res = await call('symbol', { id: 'coin', state: 'static' });
    expect(res.result).toEqual({ shown: true });
    const snap = await call('snapshot');
    // `w`/`h` are the view's own design-space bounds (the 40×40 fixture) —
    // unaffected by zoom; `screen` is the cell at the current (fit) zoom.
    expect(snap.result).toEqual({ symbol: 'coin', state: 'static', w: 40, h: 40, cell: { width: 96, height: 96 }, screen: { w: 288 * 0.6, h: 288 * 0.6 } });
  });

  it('an unknown id answers shown: false and snapshot reports no bounds', async () => {
    const { symbols } = fakeSymbols();
    const { call, ready } = bootSymbol(symbols);
    await ready();
    const res = await call('symbol', { id: 'nope', state: 'static' });
    expect(res.result).toEqual({ shown: false });
    const snap = await call('snapshot');
    expect(snap.result).toEqual({ symbol: 'nope', state: 'static', w: 0, h: 0, cell: { width: 96, height: 96 }, screen: { w: 288 * 0.6, h: 288 * 0.6 } });
  });

  it('a second symbol call destroys the previous view before previewing the new one', async () => {
    const { symbols, views } = fakeSymbols();
    const { call, ready } = bootSymbol(symbols);
    await ready();
    await call('symbol', { id: 'coin', state: 'static' });
    const first = views[0]!;
    expect(first.destroyed).toBe(false);
    await call('symbol', { id: 'coin', state: 'idle' });
    expect(first.destroyed).toBe(true);
    expect(views).toHaveLength(2);
  });

  it('replaceSymbols replaces the doc then re-previews the current symbol', async () => {
    const { symbols, previewCalls } = fakeSymbols();
    const { call, ready } = bootSymbol(symbols);
    await ready();
    await call('symbol', { id: 'coin', state: 'static' });
    const doc: SymbolsDoc = { version: 1, symbols: [] };
    const res = await call('replaceSymbols', { doc });
    expect(res.result).toEqual({});
    expect(symbols.replace).toHaveBeenCalledWith(doc);
    expect(previewCalls.at(-1)).toEqual({ id: 'coin', state: 'static' });
  });

  it('replaceSymbols with nothing shown yet does not preview', async () => {
    const { symbols, previewCalls } = fakeSymbols();
    const { call, ready } = bootSymbol(symbols);
    await ready();
    await call('replaceSymbols', { doc: null });
    expect(symbols.replace).toHaveBeenCalledWith(null);
    expect(previewCalls).toHaveLength(0);
  });

  it('select and grid are unregistered — the wire answers unknown method', async () => {
    const { symbols } = fakeSymbols();
    const { call, ready } = bootSymbol(symbols);
    await ready();
    const select = await call('select', { node: 'x' });
    expect(select.ok).toBe(false);
    expect(String((select as { error?: unknown }).error)).toContain('unknown method "select"');
    const grid = await call('grid', { on: true, step: 8 });
    expect(grid.ok).toBe(false);
    expect(String((grid as { error?: unknown }).error)).toContain('unknown method "grid"');
  });

  it("symbol: '' still boots symbol mode (frame only, no initial preview); a select request answers unknown method; ready carries ''", async () => {
    const { symbols } = fakeSymbols();
    const { call, ready, events } = bootSymbol(symbols, '');
    await ready();
    expect(events()[0]).toEqual({ event: 'ready', payload: { symbol: '' } });
    const select = await call('select', { node: 'x' });
    expect(select.ok).toBe(false);
    expect(String((select as { error?: unknown }).error)).toContain('unknown method "select"');
    const snap = await call('snapshot');
    expect(snap.result).toEqual({ symbol: null, state: null, w: 0, h: 0, cell: { width: 96, height: 96 }, screen: { w: 288 * 0.6, h: 288 * 0.6 } });
  });

  it('no symbols service on ctx emits error and leaves the composed game visible', async () => {
    const { events, scenes } = bootSymbol(undefined);
    await vi.waitFor(() => expect(events().some((e) => e.event === 'error')).toBe(true));
    expect(scenes.container.visible).toBe(true);
  });

  it("__e8edit.frameOf('symbol') walks the preview view's descendants; null for a still view", async () => {
    const { symbols } = fakeSymbols();
    const { call, ready, edit } = bootSymbol(symbols);
    await ready();
    await call('symbol', { id: 'coin', state: 'idle' }); // wrapper -> wrapper -> { currentFrame: 3 }
    expect(edit().frameOf('symbol')).toBe(3);
    await call('symbol', { id: 'coin', state: 'static' }); // Graphics only, no currentFrame anywhere
    expect(edit().frameOf('symbol')).toBeNull();
  });

  it('__e8edit exposes emitted (ready included) and snapshot matching the wire', async () => {
    const { symbols } = fakeSymbols();
    const { call, ready, edit } = bootSymbol(symbols);
    await ready();
    await call('symbol', { id: 'coin', state: 'static' });
    expect(edit().emitted().some((e) => e.event === 'ready')).toBe(true);
    const wireSnap = (await call('snapshot')).result;
    expect(edit().snapshot()).toEqual(wireSnap);
  });

  it('draws a checkerboard over the whole screen and the default frame at 96×96 with no board', async () => {
    const { symbols } = fakeSymbols();
    const { app, ready } = bootSymbol(symbols);
    await ready();
    const checker = app.stage.getChildByLabel('symbol-checker')!;
    const b = checker.getBounds();
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 480, 288]);
    const frame = app.stage.getChildByLabel('symbol-frame', true) as Graphics;
    expect(frame.tint).toBe(0x223047);
  });

  it("fit: the cell's larger side is 60% of the screen's smaller side; 1:1 and 2x follow", async () => {
    const { symbols } = fakeSymbols();
    const { call, ready } = bootSymbol(symbols);
    await ready();
    await call('symbol', { id: 'coin', state: 'static' });
    const screenOf = async () => ((await call('snapshot')).result as { screen: { w: number; h: number } }).screen;
    expect((await screenOf()).w).toBeCloseTo(288 * 0.6, 3); // 96 → 172.8
    expect((await call('zoom', { mode: '1:1' })).result).toEqual({ mode: '1:1' });
    expect((await screenOf()).w).toBeCloseTo(96, 3);
    await call('zoom', { mode: '2x' });
    expect((await screenOf()).w).toBeCloseTo(192, 3);
    expect((await call('zoom', { mode: 'bogus' })).result).toEqual({ mode: 'fit' });
  });

  it('takes the cell size and the idle frame style from the board', async () => {
    const board = { cellSize: { width: 120, height: 80 }, config: { grid: { frameStyle: { radius: 4, idle: { color: 0x112233, alpha: 0.5 } } } } };
    const { symbols } = fakeSymbols();
    const { app, call, ready } = bootSymbol(symbols, 'coin', board);
    await ready();
    const snap = (await call('snapshot')).result as { cell: { width: number; height: number } };
    expect(snap.cell).toEqual({ width: 120, height: 80 });
    const frame = app.stage.getChildByLabel('symbol-frame', true) as Graphics;
    expect(frame.tint).toBe(0x112233);
    // M9: the earlier version of this test only asserted the colour (via
    // `tint`) — alpha and radius come from the same `board.config` and were
    // unchecked. Read them off the drawn fill/path instructions rather than
    // any new test-only field, so this stays a check of the real draw call.
    const fill = (frame.context as unknown as { instructions: { action: string; data: { style: { alpha: number }; path: { instructions: { action: string; data: unknown[] }[] } } }[] })
      .instructions.find((i) => i.action === 'fill')!;
    expect(fill.data.style.alpha).toBe(0.5);
    const roundRect = fill.data.path.instructions.find((i) => i.action === 'roundRect')!;
    expect(roundRect.data[4]).toBe(4); // [x, y, w, h, radius]
  });

  it('a board provided AFTER boot updates the cell size and redraws the frame on the next frame (slice 40 debt: cellSize/frameStyle used to be read once, at boot)', async () => {
    const { symbols } = fakeSymbols();
    const { ctx, app, call, ready, frame } = bootSymbol(symbols);
    await ready();
    ctx.provide('board', { cellSize: { width: 120, height: 120 } });
    frame();
    const snap = (await call('snapshot')).result as { cell: { width: number; height: number } };
    expect(snap.cell).toEqual({ width: 120, height: 120 });
    const frameG = app.stage.getChildByLabel('symbol-frame', true) as Graphics;
    expect(frameG.getLocalBounds().width).toBe(120);
  });

  it('a screen resize re-lays out on the next frame: checker covers it, the cell stays centred', async () => {
    const { symbols } = fakeSymbols();
    const { app, frame, ready } = bootSymbol(symbols);
    await ready();
    app.screen.width = 800; app.screen.height = 600;
    frame();
    const b = app.stage.getChildByLabel('symbol-checker')!.getBounds();
    expect([b.maxX, b.maxY]).toEqual([800, 600]);
    const box = app.stage.getChildByLabel('symbol-preview')!;
    expect([box.position.x, box.position.y]).toEqual([400, 300]);
    expect(box.scale.x).toBeCloseTo((600 * 0.6) / 96, 5);
  });

  it('the frame is the cell\'s size whatever the art: a large view under fit none does not grow it', async () => {
    const symbols = {
      replace: vi.fn(),
      ready: Promise.resolve(),
      // what `symbols.preview` returns for a `fit: none` symbol with 400×400 art: the view at its own size
      preview: vi.fn(() => {
        const c = new Container();
        c.addChild(new Graphics().rect(-200, -200, 400, 400).fill(0xffffff));
        return c;
      }),
    };
    const { app, call, ready } = bootSymbol(symbols, 'big');
    await ready();
    await call('symbol', { id: 'big', state: 'static' });
    const frame = app.stage.getChildByLabel('symbol-frame', true)!;
    expect(frame.getLocalBounds().width).toBe(96);
    const snap = (await call('snapshot')).result as { screen: { w: number } };
    expect(snap.screen.w).toBeCloseTo(288 * 0.6, 3); // the zoom is about the cell, not the art
  });

  it("snapshot's w/h are the view's own design-space bounds, unaffected by zoom", async () => {
    const { symbols } = fakeSymbols();
    const { call, ready } = bootSymbol(symbols);
    await ready();
    await call('symbol', { id: 'coin', state: 'static' });
    const wh = async () => {
      const r = (await call('snapshot')).result as { w: number; h: number };
      return { w: r.w, h: r.h };
    };
    expect(await wh()).toEqual({ w: 40, h: 40 }); // fit
    await call('zoom', { mode: '1:1' });
    expect(await wh()).toEqual({ w: 40, h: 40 });
    await call('zoom', { mode: '2x' });
    expect(await wh()).toEqual({ w: 40, h: 40 });
  });

  it('a zoom change re-scales the preview but does not redraw the checkerboard; a screen resize does', async () => {
    const { symbols } = fakeSymbols();
    const { app, call, frame, ready } = bootSymbol(symbols);
    await ready();
    const checker = app.stage.getChildByLabel('symbol-checker') as Graphics;
    const clear = vi.spyOn(checker, 'clear');
    await call('zoom', { mode: '1:1' });
    expect(clear).not.toHaveBeenCalled();
    app.screen.width = 800; app.screen.height = 600;
    frame();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('fit on a 120×80 board cell: screen is the cell scaled to 60% of the smaller screen side', async () => {
    const board = { cellSize: { width: 120, height: 80 } };
    const { symbols } = fakeSymbols();
    const { call, ready } = bootSymbol(symbols, 'coin', board);
    await ready();
    const snap = (await call('snapshot')).result as { screen: { w: number; h: number } };
    expect(snap.screen.w).toBeCloseTo(172.8, 3);
    expect(snap.screen.h).toBeCloseTo(115.2, 3);
  });
});

/** A `ReelsBoard`-shaped fake: a `w×h` `Graphics` child under `view`, a 5×3 grid, and the three step methods a real board has (unused by reels mode itself — Task 4's test actions call them). */
function fakeBoard(w = 500, h = 300) {
  const view = new Container();
  view.addChild(new Graphics().rect(0, 0, w, h).fill(0xffffff));
  return {
    view,
    cellSize: { width: 96, height: 96 },
    config: { grid: { cols: 5, rows: 3 } as { cols: number; rows: number; rowsPerReel?: number[] } },
    spinTo: vi.fn(async () => {}),
    revealWins: vi.fn(async () => {}),
    tumble: vi.fn(async () => {}),
  };
}

/** Same fake-wire harness as `boot()`, wired for `reels: true`. `board`/`gameRows` are `ctx.provide`d only when given. */
function bootReels(board?: unknown, gameRows?: unknown) {
  const ctx = new Context();
  const app = { stage: new Container(), ticker: { add: vi.fn(), remove: vi.fn() }, canvas: document.createElement('canvas'), screen: { width: 480, height: 288 } };
  ctx.provide('renderer', { app });
  const nodeTypes = createNodeTypes();
  ctx.provide('nodeTypes', nodeTypes);
  const scenes = createScenes({ root: app.stage, design: { width: 960, height: 576 }, nodeTypes, loader, ctx });
  ctx.provide('scenes', scenes);
  if (board !== undefined) ctx.provide('board', board);
  if (gameRows !== undefined) ctx.provide('gameRows', gameRows);
  const posted: Frame[] = [];
  let listener: ((e: { data: unknown; origin: string }) => void) | undefined;
  let id = 0;
  const fiber = ctx.plugin(plugin, {
    scene: 'a', reels: true, parentOrigin: 'http://ide',
    post: (msg: unknown) => posted.push(msg as Frame),
    listen: (fn) => { listener = fn; return () => { listener = undefined; }; },
  });
  const events = () => posted.filter((m) => m.type === 'e8:ide:evt').map(({ event, payload }) => ({ event, payload }));
  const call = async (method: string, params: unknown = {}) => {
    const reqId = ++id;
    listener?.({ data: { type: 'e8:ide:req', id: reqId, method, params }, origin: 'http://ide' });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'e8:ide:res' && m.id === reqId)).toBe(true));
    return posted.find((m) => m.type === 'e8:ide:res' && m.id === reqId)!;
  };
  const ready = () => vi.waitFor(() => expect(events().some((e) => e.event === 'ready')).toBe(true));
  const frame = () => (app.ticker.add.mock.calls[0][0] as () => void)();
  return { ctx, app, scenes, fiber, events, call, ready, frame };
}

describe('reels mode', () => {
  it('emits ready ({ reels: true }); reels-box holds board.view; the scenes root is hidden; reels-checker covers the screen', async () => {
    const board = fakeBoard();
    const { app, scenes, events, ready } = bootReels(board);
    await ready();
    expect(events()[0]).toEqual({ event: 'ready', payload: { reels: true } });
    expect(scenes.container.visible).toBe(false);
    const box = app.stage.getChildByLabel('reels-box')!;
    expect(box.children).toContain(board.view);
    const checker = app.stage.getChildByLabel('reels-checker')!;
    const b = checker.getBounds();
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 480, 288]);
  });

  it('fits the board to the screen with a 24px margin, centred; snapshot reports mode/cols/rows/fitted/busy', async () => {
    const board = fakeBoard(500, 300);
    const { app, call, ready } = bootReels(board);
    await ready();
    // min((480-48)/500, (288-48)/300) = min(0.864, 0.8) = 0.8
    const s = Math.min((480 - 48) / 500, (288 - 48) / 300);
    const box = app.stage.getChildByLabel('reels-box')!;
    expect(box.scale.x).toBeCloseTo(s, 5);
    expect(box.position.x).toBeCloseTo(240 - (500 / 2) * s, 5);
    expect(box.position.y).toBeCloseTo(144 - (300 / 2) * s, 5);
    const snap = (await call('snapshot')).result;
    expect(snap).toEqual({ mode: 'reels', cols: 5, rows: [3, 3, 3, 3, 3], fitted: { w: s * 500, h: s * 300 }, busy: false });
  });

  it('a new board (the old provider disposed, a second provided) replaces the mounted view — the old one only removed, not destroyed', async () => {
    const { ctx, app, ready, frame } = bootReels();
    const first = fakeBoard();
    const disposeFirst = ctx.provide('board', first);
    await ready();
    const box = app.stage.getChildByLabel('reels-box')!;
    expect(box.children).toContain(first.view);
    disposeFirst();
    const second = fakeBoard();
    ctx.provide('board', second);
    frame();
    expect(box.children).toContain(second.view);
    expect(box.children).not.toContain(first.view);
    expect(first.view.destroyed).toBe(false); // the row's own `board.destroy()` does that, not this mode
  });

  it("rows hands each row's config to gameRows.update and reports its verdict; no gameRows answers unknown for every row", async () => {
    const gameRows = { update: vi.fn(async () => 'updated' as const) };
    const { call, ready } = bootReels(fakeBoard(), gameRows);
    await ready();
    const res = await call('rows', { rows: [{ id: 'reels1', config: { grid: { cols: 6 } } }] });
    expect(gameRows.update).toHaveBeenCalledWith('reels1', { grid: { cols: 6 } });
    expect(res.result).toEqual({ results: [{ id: 'reels1', result: 'updated' }] });

    const { call: callNoRows, ready: readyNoRows } = bootReels(fakeBoard());
    await readyNoRows();
    const noGameRows = await callNoRows('rows', { rows: [{ id: 'reels1', config: {} }, { id: 'reels2', config: {} }] });
    expect(noGameRows.result).toEqual({ results: [{ id: 'reels1', result: 'unknown' }, { id: 'reels2', result: 'unknown' }] });
  });

  it('a screen resize re-fits on the next frame', async () => {
    const board = fakeBoard(500, 300);
    const { app, call, frame, ready } = bootReels(board);
    await ready();
    app.screen.width = 960; app.screen.height = 576;
    frame();
    const s = Math.min((960 - 48) / 500, (576 - 48) / 300);
    const snap = (await call('snapshot')).result as { fitted: { w: number; h: number } };
    expect(snap.fitted.w).toBeCloseTo(s * 500, 5);
    expect(snap.fitted.h).toBeCloseTo(s * 300, 5);
    const checker = app.stage.getChildByLabel('reels-checker')!;
    expect([checker.getBounds().maxX, checker.getBounds().maxY]).toEqual([960, 576]);
  });
});

describe('scene-edit plugin', () => {
  it('provides `sceneEdit` — what the scenes runtime reads to swallow its own ui.tap here', async () => {
    const { ctx, fiber } = boot();
    await fiber;
    expect(ctx.reflect.get('sceneEdit', false)).toBe(true);
    await fiber.dispose();
    expect(ctx.reflect.get('sceneEdit', false)).toBeUndefined();
  });

  it('shows the scene, emits ready, and answers snapshot with per-node bounds in design space', async () => {
    const { scenes, events, call, ready } = boot();
    await ready();
    expect(scenes.visible()).toEqual(['a']);
    expect(events()[0]).toEqual({ event: 'ready', payload: { scene: 'a', orientation: 'landscape' } });
    const res = await call('snapshot');
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ scene: 'a', selected: null, bounds: { lo: { x: 100, y: 100, w: 40, h: 40 }, hi: { x: 120, y: 120, w: 40, h: 40 } } });
  });

  it('shows its scene as a preview — the IDE looking at a document, not the game showing it', async () => {
    const { scenes, ready } = boot();
    const show = vi.spyOn(scenes, 'show');
    await ready();
    expect(show).toHaveBeenCalledWith('a', { preview: true });
  });

  it('a pointerdown over a node selects it (event selected) and the gizmo attaches; over nothing clears', async () => {
    const { edit, events, ready, gizmoShown, app } = boot();
    await ready();
    expect(app.stage.eventMode).toBe('static');
    edit().pickAndSelect(65, 65); // lo and hi overlap here: topmost wins
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: 'hi' } });
    expect(gizmoShown()).toBe(true);
    edit().pickAndSelect(52, 52);
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: 'lo' } });
    edit().pickAndSelect(200, 200);
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: null } });
    expect(gizmoShown()).toBe(false);
    expect((edit().snapshot() as plugin.Snapshot).selected).toBe(null);
  });

  it('select over the wire moves the gizmo without re-emitting selected', async () => {
    const { edit, events, call, ready, gizmoShown, gizmoLayer } = boot();
    await ready();
    edit().pickAndSelect(65, 65);
    const n = events().length;
    expect((await call('select', { node: 'hi' })).ok).toBe(true);
    expect(events()).toHaveLength(n); // unchanged: nothing re-emitted
    await call('select', { node: 'nested' }); // no top-level view: gizmo hides, id kept, nothing echoed
    expect(events()).toHaveLength(n);
    expect(gizmoShown()).toBe(false);
    expect((edit().snapshot() as plugin.Snapshot).selected).toBe('nested');
    await call('select', { node: 'lo' });
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: 'lo' } });
    expect(gizmoShown()).toBe(true);
    const frame = gizmoLayer()!.getChildByLabel('gizmo-frame')!;
    expect(frame.getBounds().x).toBeLessThanOrEqual(50);
    expect(edit().emitted().at(-1)).toEqual({ event: 'selected', payload: { node: 'lo' } });
  });

  it('the gizmo re-targets the new view after a remount, and clears when the node is gone', async () => {
    const { edit, scenes, ready, frame, gizmoLayer, events } = boot();
    await ready();
    edit().pickAndSelect(52, 52);
    scenes.replace([{ id: 'a', nodes: [{ id: 'lo', type: 'box', props: { x: 600, y: 100 } }] }, DOCS[1]]);
    frame();
    expect(gizmoLayer()!.getChildByLabel('gizmo-frame')!.getBounds().x).toBeGreaterThanOrEqual(290);
    scenes.replace([{ id: 'a', nodes: [] }, DOCS[1]]);
    frame();
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: null } });
  });

  // The IDE answers every edit with a `replace` of the set — the round trip
  // that used to remount the node under the NEXT gesture, or snap it back
  // under key repeat. Pointer gestures are driven as pixi delivers them: a
  // `pointerdown` on the gizmo's body (`layer.children[1]`), then the
  // layer's `globalpointermove` / `pointerup`.
  const ev = (x: number, y: number) => ({ global: { x, y }, stopPropagation() {}, shiftKey: false, altKey: false }) as unknown as FederatedPointerEvent;
  const withHi = (props: Record<string, number>): SceneDoc[] => [
    { id: 'a', nodes: [DOCS[0].nodes[0], { id: 'hi', type: 'box', props }] },
    DOCS[1],
  ];

  it('an edit is applied locally (rounded) before it is told; the IDE echo between two drags does not cut the second', async () => {
    const { edit, scenes, events, ready, frame, gizmoLayer, call } = boot();
    await ready();
    edit().pickAndSelect(65, 65); // hi, at design (120,120)
    const layer = gizmoLayer()!;
    const body = layer.children[1];
    // +20 screen px is +40 design at scale 0.5 — arriving as a float, written rounded.
    body.emit('pointerdown', ev(70, 70));
    layer.emit('globalpointermove', ev(89.999999, 70));
    layer.emit('pointerup', ev(89.999999, 70));
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 160, y: 120 }, variant: null } });
    expect(scenes.docs().get('a')!.nodes[1].props).toEqual({ x: 160, y: 120 });
    expect(scenes.view({ scene: 'a', node: 'hi' })!.position.x).toBe(160);
    // The second drag starts on the fresh view; the IDE's echo of the first lands mid-way.
    body.emit('pointerdown', ev(90, 70));
    layer.emit('globalpointermove', ev(110, 70));
    const view = scenes.view({ scene: 'a', node: 'hi' });
    await call('replace', { docs: withHi({ x: 160, y: 120 }) });
    frame();
    expect(scenes.view({ scene: 'a', node: 'hi' })).toBe(view); // JSON-equal: no remount
    layer.emit('pointerup', ev(110, 70));
    expect(events().filter((e) => e.event === 'edit')).toHaveLength(2);
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 200, y: 120 }, variant: null } });
  });

  it('a stale echo of an earlier nudge does not snap the node back under key repeat; a refused write does', async () => {
    const { edit, scenes, events, ready, frame, key, call } = boot();
    await ready();
    edit().pickAndSelect(65, 65);
    key('ArrowRight');
    key('ArrowRight');
    await call('replace', { docs: withHi({ x: 121, y: 120 }) }); // the first nudge's answer, the second's still out
    frame();
    key('ArrowRight');
    const xs = () => events().filter((e) => e.event === 'edit').map((e) => (e.payload as { props: { x: number } }).props.x);
    expect(xs()).toEqual([121, 122, 123]);
    expect(scenes.view({ scene: 'a', node: 'hi' })!.position.x).toBe(123);
    // The last nudge's answer: acknowledged, nothing remounts.
    const view = scenes.view({ scene: 'a', node: 'hi' });
    await call('replace', { docs: withHi({ x: 123, y: 120 }) });
    frame();
    expect(scenes.view({ scene: 'a', node: 'hi' })).toBe(view);
    // A refusal: the IDE tells the set as it stands, and the canvas takes it as is.
    key('ArrowRight');
    await call('replace', { docs: DOCS });
    frame();
    expect(scenes.view({ scene: 'a', node: 'hi' })!.position.x).toBe(120);
    expect((edit().snapshot() as plugin.Snapshot).selected).toBe('hi');
  });

  it('a replace request from the IDE swaps the document set — before ready too', async () => {
    let settle!: () => void;
    const { scenes, call, ready } = boot('a', [], new Promise<void>((r) => { settle = r; }));
    await new Promise((r) => setTimeout(r, 0)); // the fiber applies asynchronously
    // The IDE's set lands ahead of the boot GET: it is what the page shows.
    const res = await call('replace', { docs: DOCS });
    expect(res.ok).toBe(true);
    expect([...scenes.docs().keys()]).toEqual(['a', 'b']);
    settle();
    await ready();
    // And after: a reorder remounts, so the topmost node under a point changes.
    const reordered = { id: 'a', nodes: [DOCS[0].nodes[1], DOCS[0].nodes[0]] };
    await call('replace', { docs: [reordered, DOCS[1]] });
    expect(scenes.docs().get('a')).toEqual(reordered);
    const snap = (await call('snapshot')).result as { bounds: Record<string, unknown> };
    expect(Object.keys(snap.bounds)).toEqual(['hi', 'lo']);
  });

  it('Delete emits remove; ] emits zorder +1; arrows emit one edit; Escape clears', async () => {
    const { edit, events, ready, key, gizmoShown } = boot();
    await ready();
    key('Delete');
    expect(events().some((e) => e.event === 'remove')).toBe(false); // nothing selected
    edit().pickAndSelect(65, 65);
    key('Delete');
    expect(events().at(-1)).toEqual({ event: 'remove', payload: { node: 'hi' } });
    key(']');
    expect(events().at(-1)).toEqual({ event: 'zorder', payload: { node: 'hi', delta: 1 } });
    key('[');
    expect(events().at(-1)).toEqual({ event: 'zorder', payload: { node: 'hi', delta: -1 } });
    key('ArrowRight');
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 121, y: 120 }, variant: null } });
    key('ArrowDown', { shiftKey: true });
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 121, y: 130 }, variant: null } });
    key('ArrowLeft', { metaKey: true }); // a browser chord, not a nudge
    key('ArrowLeft', { ctrlKey: true });
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 121, y: 130 }, variant: null } });
    const input = document.body.appendChild(document.createElement('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(events().at(-1)?.event).toBe('edit'); // typing in a field is not a canvas key
    key('Escape');
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: null } });
    expect(gizmoShown()).toBe(false);
  });

  it('a drop with the Explorer type emits drop with design coords; a foreign drop is ignored', async () => {
    const { events, ready, dropTarget } = boot();
    await ready();
    const drop = (dataTransfer: unknown) => {
      const e = new Event('drop', { cancelable: true });
      Object.assign(e, { clientX: 65, clientY: 65, dataTransfer });
      dropTarget.dispatchEvent(e);
      return e;
    };
    const over = new Event('dragover', { cancelable: true });
    dropTarget.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const e = drop({ getData: (t: string) => (t === 'text/x-e8-path' ? 'assets/logo.png' : ''), files: [] });
    expect(e.defaultPrevented).toBe(true);
    expect(events().at(-1)).toEqual({ event: 'drop', payload: { path: 'assets/logo.png', file: undefined, x: 130, y: 130 } });
    const file = new File(['x'], 'k.png');
    drop({ getData: () => '', files: [file] });
    expect(events().at(-1)).toEqual({ event: 'drop', payload: { path: undefined, file, x: 130, y: 130 } });
    const n = events().length;
    drop({ getData: () => '', files: [] });
    expect(events()).toHaveLength(n);
  });

  it('frameOf reads currentFrame off the view or its child; null for a still or unknown node', async () => {
    const { edit, ready } = boot('b');
    await ready();
    expect(edit().frameOf('spin')).toBe(3);
    expect(edit().frameOf('pic')).toBe(5);
    expect(edit().frameOf('only')).toBeNull();
    expect(edit().frameOf('nope')).toBeNull();
  });

  it('grid on/off redraws; an unknown scene emits error and no gizmo', async () => {
    const { scenes, call, ready } = boot();
    await ready();
    const grid = scenes.container.getChildByLabel('grid') as Graphics;
    expect(scenes.container.getChildIndex(grid)).toBe(0);
    expect(grid.getBounds().width).toBe(0);
    await call('grid', { on: true, step: 32 });
    expect(grid.getBounds().width).toBeGreaterThan(0);
    await call('grid', { on: false, step: 32 });
    expect(grid.getBounds().width).toBe(0);
    await call('grid', { on: true, step: -1 }); // a bad step falls back to 16 rather than looping forever
    expect(grid.getBounds().width).toBeGreaterThan(0);

    const bad = boot('zzz');
    await vi.waitFor(() => expect(bad.events().at(-1)?.event).toBe('error'));
    expect(bad.gizmoLayer()).toBeUndefined();
  });

  it('waits for scenes.ready before deciding; a failed boot GET is an error event', async () => {
    let settle!: () => void;
    const { scenes, events, ready } = boot('a', [], new Promise<void>((r) => { settle = r; }));
    await new Promise((r) => setTimeout(r, 0));
    expect(events()).toEqual([]);
    scenes.replace(DOCS);
    settle();
    await ready();
    expect(scenes.visible()).toEqual(['a']);

    const failed = boot('a', [], Promise.reject(new Error('could not read the scene documents: down')));
    await vi.waitFor(() => expect(failed.events().at(-1)).toEqual({ event: 'error', payload: { message: 'could not read the scene documents: down' } }));
    expect(failed.gizmoLayer()).toBeUndefined();
  });

  /** A stroke's bounds carry its width (and a `-0`): within a pixel of the rect is the rect. */
  const near = (b: { x: number; y: number; width: number; height: number }, want: number[]) => {
    for (const [i, v] of [b.x, b.y, b.width, b.height].entries()) expect(Math.abs(v - want[i])).toBeLessThanOrEqual(1);
  };

  // Design 960×576 on the same 480×288 screen with a 48px band at the
  // bottom: the fit is into 480×240 (scale 240/576 = 5/12, the design 400
  // wide, letterboxed 40px each side), so the safe rect runs from design
  // x −96 to 1056 and y 0 to 576, and the band below it is 48 screen px.
  it('draws the design box and the safe rect from the fit, with the bar band hatched below it; the frames follow a resize', async () => {
    const { app, scenes, ready, frame } = boot('a', DOCS, undefined, { top: 0, right: 0, bottom: 48, left: 0 });
    await ready();
    expect(scenes.fit()?.viewport).toEqual({ left: -96, top: 0, right: 1056, bottom: 576 });
    const frames = scenes.container.getChildByLabel('frames')!;
    expect(scenes.container.getChildIndex(frames)).toBe(1); // over the grid, under the scene
    near(frames.getChildByLabel('design-frame')!.getBounds(), [40, 0, 400, 240]);
    near(frames.getChildByLabel('safe-rect')!.getBounds(), [0, 0, 480, 240]);
    near(frames.getChildByLabel('safe-band')!.getBounds(), [0, 240, 480, 48]);
    // The band goes with the insets: a resize without them leaves no band and the safe rect on the design box.
    scenes.resize(480, 288);
    frame();
    expect(frames.getChildByLabel('safe-band')!.getBounds().height).toBe(0);
    near(frames.getChildByLabel('safe-rect')!.getBounds(), [0, 0, 480, 288]);
    void app;
  });

  it("a pinned node's drag emits the offset from its pin point, not the absolute position", async () => {
    // `pinned` sits 100 design px in from the bottom-right corner: absolute (860, 476), screen (430, 238).
    const docs: SceneDoc[] = [{ id: 'a', nodes: [{ id: 'pinned', type: 'box', props: { pin: 'bottom-right', x: -100, y: -100 } }] }, DOCS[1]];
    const { edit, scenes, events, ready, gizmoLayer } = boot('a', docs);
    await ready();
    expect(scenes.view({ scene: 'a', node: 'pinned' })!.position).toMatchObject({ x: 860, y: 476 });
    edit().pickAndSelect(440, 248);
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: 'pinned' } });
    const layer = gizmoLayer()!;
    const body = layer.children[1];
    body.emit('pointerdown', ev(440, 248));
    layer.emit('globalpointermove', ev(460, 238)); // +20, −10 screen = +40, −20 design
    layer.emit('pointerup', ev(460, 238));
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'pinned', props: { x: -60, y: -120 }, variant: null } });
    expect(scenes.docs().get('a')!.nodes[0].props).toEqual({ pin: 'bottom-right', x: -60, y: -120 });
    expect(scenes.view({ scene: 'a', node: 'pinned' })!.position).toMatchObject({ x: 900, y: 456 });
  });

  it("a pinned node's grid snap lands the OFFSET on the grid, not the absolute position", async () => {
    // A 24px band at the top: the fit is 480×264 (scale 264/576 = 11/24), the
    // design 440 wide letterboxed 20px each side, so the safe rect's left edge
    // is design x −43.63… — OFF the 16-grid. `pinned` hangs off bottom-left at
    // offset (0, −96): absolute (−43.63…, 480), screen (0, 244).
    const docs: SceneDoc[] = [{ id: 'a', nodes: [{ id: 'pinned', type: 'box', props: { pin: 'bottom-left', x: 0, y: -96 } }] }, DOCS[1]];
    const { edit, scenes, events, ready, gizmoLayer, call } = boot('a', docs, undefined, { top: 24, right: 0, bottom: 0, left: 0 });
    await ready();
    const left = scenes.fit()!.viewport.left;
    expect(left).toBeCloseTo(-480 / 11, 6);
    expect(scenes.view({ scene: 'a', node: 'pinned' })!.position.x).toBeCloseTo(left, 6);
    await call('grid', { on: true, step: 16 });
    edit().pickAndSelect(9, 251);
    expect(events().at(-1)).toEqual({ event: 'selected', payload: { node: 'pinned' } });
    const layer = gizmoLayer()!;
    const body = layer.children[1];
    const px = 11 / 24; // screen px per design px
    body.emit('pointerdown', ev(9, 251));
    layer.emit('globalpointermove', ev(9 + 21 * px, 251)); // +21 design in x: offset 21 → grid 16
    layer.emit('pointerup', ev(9 + 21 * px, 251));
    // Snapping the ABSOLUTE would have put it at design −16: an offset of 27.63…, written 28.
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'pinned', props: { x: 16, y: -96 }, variant: null } });
    expect(scenes.view({ scene: 'a', node: 'pinned' })!.position.x).toBeCloseTo(left + 16, 6);
  });

  it('an edit is written whole-px, so the IDE echo (rounded by the same table) acknowledges it and a later edit survives', async () => {
    const { edit, scenes, events, ready, frame, key, call, gizmoLayer } = boot();
    await ready();
    edit().pickAndSelect(65, 65); // hi, at design (120,120)
    const layer = gizmoLayer()!;
    const body = layer.children[1];
    // +20.2 screen px is +40.4 design: a fractional drag, written 160 — not 160.4.
    body.emit('pointerdown', ev(70, 70));
    layer.emit('globalpointermove', ev(90.2, 70));
    layer.emit('pointerup', ev(90.2, 70));
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 160, y: 120 }, variant: null } });
    expect(scenes.view({ scene: 'a', node: 'hi' })!.position.x).toBe(160);
    // A nudge follows before the IDE answers the drag.
    key('ArrowRight');
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 161, y: 120 }, variant: null } });
    // The IDE's echo of the DRAG: it reflects the pending edit exactly, so it
    // acknowledges that one alone and the nudge is laid over it again. Had the
    // canvas kept 160.4, nothing would have matched and the nudge would be lost.
    await call('replace', { docs: withHi({ x: 160, y: 120 }) });
    frame();
    expect(scenes.view({ scene: 'a', node: 'hi' })!.position.x).toBe(161);
    expect(scenes.docs().get('a')!.nodes[1].props).toEqual({ x: 161, y: 120 });
  });

  it('under a portrait fit an edit carries variant: portrait and the optimistic patch writes portrait.nodes, leaving nodes[] alone', async () => {
    const { app, edit, scenes, events, ready, frame, key, call } = boot();
    await ready();
    edit().pickAndSelect(65, 65); // hi
    // The screen turns: the safe rect is taller than wide, the design rotates (576×960).
    app.screen.width = 288; app.screen.height = 480;
    scenes.resize(288, 480);
    frame();
    expect(edit().orientation()).toBe('portrait');
    expect(edit().fit()).toBe(scenes.fit());
    // The flip is told once — the IDE follows the page, not its own preset.
    expect(events().at(-1)).toEqual({ event: 'orientation', payload: { orientation: 'portrait' } });
    scenes.resize(300, 480); // another portrait fit: no flip, nothing told
    frame();
    expect(events().at(-1)?.event).toBe('orientation');
    expect(events().filter((e) => e.event === 'orientation')).toHaveLength(1);
    key('ArrowRight');
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 121, y: 120 }, variant: 'portrait' } });
    const a = scenes.docs().get('a')!;
    expect(a.portrait).toEqual({ nodes: { hi: { x: 121, y: 120 } } });
    expect(a.nodes[1].props).toEqual({ x: 120, y: 120 });
    expect(scenes.view({ scene: 'a', node: 'hi' })!.position.x).toBe(121);
    // The IDE's echo carries the block: acknowledged on that layer, nothing snaps back.
    key('ArrowRight');
    await call('replace', { docs: [{ ...DOCS[0], portrait: { nodes: { hi: { x: 121, y: 120 } } } }, DOCS[1]] });
    frame();
    expect(scenes.view({ scene: 'a', node: 'hi' })!.position.x).toBe(122);
    expect(scenes.docs().get('a')!.portrait).toEqual({ nodes: { hi: { x: 122, y: 120 } } });
    // Back to landscape: the override is dropped from the view and edits go to the node again.
    app.screen.width = 480; app.screen.height = 288;
    scenes.resize(480, 288);
    frame();
    expect(events().at(-1)).toEqual({ event: 'orientation', payload: { orientation: 'landscape' } });
    expect(scenes.view({ scene: 'a', node: 'hi' })!.position.x).toBe(120);
    key('ArrowRight');
    expect(events().at(-1)).toEqual({ event: 'edit', payload: { node: 'hi', props: { x: 121, y: 120 }, variant: null } });
  });

  it('disposing the fiber tears everything down', async () => {
    const { ctx, app, scenes, ready, fiber, key, events } = boot();
    await ready();
    await fiber.dispose();
    expect(app.stage.children.find((c) => c.label === 'gizmo')).toBeUndefined();
    expect(scenes.container.getChildByLabel('grid')).toBeNull();
    expect(app.ticker.remove).toHaveBeenCalled();
    expect((window as unknown as { __e8edit?: unknown }).__e8edit).toBeUndefined();
    const n = events().length;
    key('Escape');
    expect(events()).toHaveLength(n);
    void ctx;
  });
});
