import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import * as runtime from '../src/runtime';

const fetchOk = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

function boot(fetchFn = fetchOk({ scenes: [{ id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] }], diagnostics: [], nodeTypes: [] })) {
  const ctx = new Context();
  const app = { stage: new Container(), ticker: null };
  ctx.provide('renderer', { app });
  const fiber = ctx.plugin(runtime, { design: { width: 100, height: 50 }, fetchFn });
  return { ctx, app, fiber };
}

describe('scenes row', () => {
  it('provides nodeTypes, transitions, assetLoader, scenes; fetches /api/scenes and mounts', async () => {
    const { ctx, app, fiber } = boot();
    await fiber;
    expect(ctx.get('nodeTypes')!.list().map((t) => t.type).sort()).toEqual(['container', 'image', 'scene', 'shape', 'text']);
    expect(ctx.get('transitions')!.ids()).toEqual(['cut', 'fade']);
    await vi.waitFor(() => expect(ctx.get('scenes')!.docs().has('a')).toBe(true));
    expect(app.stage.children).toContain(ctx.get('scenes')!.container);
  });

  it('a failed GET is one error diagnostic through ctx.diagnostics, and the row still applies', async () => {
    const report = vi.fn();
    const { ctx, fiber } = boot(vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    ctx.provide('diagnostics', { report });
    await fiber;
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'scenes', where: '/api/scenes' })));
    expect(ctx.get('scenes')).toBeDefined();
  });

  it('a `replace` that lands before the gated /api/scenes fetch resolves wins over it', async () => {
    let resolveFetch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const gatedFetch = vi.fn(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;
    const { ctx, fiber } = boot(gatedFetch);
    await fiber;

    ctx.get('scenes')!.replace([{ id: 'x', nodes: [] }]);
    expect(ctx.get('scenes')!.docs().has('x')).toBe(true);

    resolveFetch({
      ok: true,
      json: async () => ({ scenes: [{ id: 'a', nodes: [] }], diagnostics: [], nodeTypes: [] }),
    });
    // Flush the fetch/json microtasks the runtime's own async IIFE awaits.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.get('scenes')!.docs().has('x')).toBe(true);
    expect(ctx.get('scenes')!.docs().has('a')).toBe(false);
  });

  it('disposing the fiber detaches the design root without destroying foreign views', async () => {
    const { ctx, app, fiber } = boot();
    await fiber;
    const foreign = new Container();
    ctx.get('nodeTypes')!.register({ type: 'foreign', schema: (await import('schemastery')).default.object({}), mount: () => foreign, unmount: (v) => v.parent?.removeChild(v) });
    ctx.get('scenes')!.replace([{ id: 'a', nodes: [{ id: 'f', type: 'foreign', props: {} }] }]);
    await fiber.dispose();
    expect(app.stage.children).toEqual([]);
    expect(foreign.destroyed).toBe(false);
  });

  it('fits the design into the renderer at boot and again on every resize', async () => {
    // The GAME page has nobody else to call `resize` (the editor page's
    // `scene-edit` does its own): the row fits itself.
    const ctx = new Context();
    const listeners = new Set<(w: number, h: number) => void>();
    const screen = { width: 640, height: 360 };
    const app = {
      stage: new Container(),
      ticker: null,
      screen,
      renderer: {
        on: (_e: string, fn: (w: number, h: number) => void) => void listeners.add(fn),
        off: (_e: string, fn: (w: number, h: number) => void) => void listeners.delete(fn),
      },
    };
    ctx.provide('renderer', { app });
    const fiber = ctx.plugin(runtime, {
      design: { width: 480, height: 270 },
      fetchFn: fetchOk({ scenes: [], diagnostics: [], nodeTypes: [] }),
    });
    await fiber;
    const root = ctx.get('scenes')!.container;
    expect(root.scale.x).toBeCloseTo(4 / 3, 10);
    listeners.forEach((fn) => fn(320, 180));
    // One microtask later: the shell's own resize listener (registered
    // after this row's) has re-laid its bar by then.
    expect(root.scale.x).toBeCloseTo(4 / 3, 10);
    await Promise.resolve();
    expect(root.scale.x).toBeCloseTo(2 / 3, 10);
    await fiber.dispose();
    expect(listeners.size).toBe(0);
  });

  /** A renderer with a screen and a resize emitter, as the fit tests need. */
  const withScreen = (width: number, height: number) => {
    const ctx = new Context();
    const listeners = new Set<(w: number, h: number) => void>();
    const app = {
      stage: new Container(),
      ticker: null,
      screen: { width, height },
      renderer: {
        on: (_e: string, fn: (w: number, h: number) => void) => void listeners.add(fn),
        off: (_e: string, fn: (w: number, h: number) => void) => void listeners.delete(fn),
      },
    };
    ctx.provide('renderer', { app });
    return { ctx, app, listeners };
  };
  const design = { width: 480, height: 288 };
  const empty = () => fetchOk({ scenes: [], diagnostics: [], nodeTypes: [] });

  it('fits into the viewport minus the shell\'s safe area, re-read on every resize', async () => {
    const { ctx, listeners } = withScreen(480, 288);
    const safeArea = { top: 0, right: 0, bottom: 100, left: 0 };
    ctx.provide('shell', { safeArea });
    const fiber = ctx.plugin(runtime, { design, fetchFn: empty() });
    await fiber;
    const root = ctx.get('scenes')!.container;
    expect(root.scale.x).toBeCloseTo(188 / 288, 10);
    // The bar's height is measured: a layout change moves it, and the next resize reads the new value.
    safeArea.bottom = 50;
    listeners.forEach((fn) => fn(480, 288));
    await Promise.resolve();
    expect(root.scale.x).toBeCloseTo(238 / 288, 10);
    await fiber.dispose();
  });

  it('a resize whose microtask lands after the dispose is a no-op', async () => {
    const { ctx, listeners } = withScreen(480, 288);
    const fiber = ctx.plugin(runtime, { design, fetchFn: empty() });
    await fiber;
    const resize = vi.spyOn(ctx.get('scenes')!, 'resize');
    // The listener as the renderer held it: an event already dispatched
    // when the dispose lands still runs its deferred half.
    const [onResize] = [...listeners];
    await fiber.dispose();
    onResize!(320, 180);
    await Promise.resolve();
    expect(resize).not.toHaveBeenCalled();
  });

  it('a `safeArea` service wins over the shell\'s', async () => {
    const { ctx } = withScreen(480, 288);
    ctx.provide('shell', { safeArea: { top: 0, right: 0, bottom: 100, left: 0 } });
    ctx.provide('safeArea', { top: 0, right: 0, bottom: 20, left: 0 });
    const fiber = ctx.plugin(runtime, { design, fetchFn: empty() });
    await fiber;
    expect(ctx.get('scenes')!.container.scale.x).toBeCloseTo(268 / 288, 10);
    await fiber.dispose();
  });

  it('the fit re-runs when `shell` is provided AFTER the scenes row', async () => {
    const { ctx } = withScreen(480, 288);
    const fiber = ctx.plugin(runtime, { design, fetchFn: empty() });
    await fiber;
    const scenes = ctx.get('scenes')!;
    expect(scenes.container.scale.x).toBeCloseTo(1, 10);
    const resize = vi.spyOn(scenes, 'resize');
    const safeArea = { top: 0, right: 0, bottom: 100, left: 0 };
    ctx.provide('shell', { safeArea });
    await new Promise((r) => setTimeout(r, 0));
    expect(resize).toHaveBeenCalledWith(480, 288, safeArea);
    expect(scenes.container.scale.x).toBeCloseTo(188 / 288, 10);
    await fiber.dispose();
  });

  it('the `shell` effect goes with the row: a shell provided after the dispose re-fits nothing', async () => {
    const { ctx } = withScreen(480, 288);
    const fiber = ctx.plugin(runtime, { design, fetchFn: empty() });
    await fiber;
    const resize = vi.spyOn(ctx.get('scenes')!, 'resize');
    await fiber.dispose();
    ctx.provide('shell', { safeArea: { top: 0, right: 0, bottom: 100, left: 0 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(resize).not.toHaveBeenCalled();
  });

  it('a portrait viewport fits the rotated design by default, `portrait` when configured; orientation() says which', async () => {
    const { ctx, listeners } = withScreen(288, 480);
    const fiber = ctx.plugin(runtime, { design, fetchFn: empty() });
    await fiber;
    const scenes = ctx.get('scenes')!;
    // 480×288 rotated is 288×480: the viewport exactly, scale 1.
    expect(scenes.container.scale.x).toBeCloseTo(1, 10);
    expect(scenes.orientation()).toBe('portrait');
    listeners.forEach((fn) => fn(480, 288));
    await Promise.resolve();
    expect(scenes.orientation()).toBe('landscape');
    expect(scenes.container.scale.x).toBeCloseTo(1, 10);
    await fiber.dispose();

    const own = withScreen(288, 480);
    const fiber2 = own.ctx.plugin(runtime, {
      design,
      portrait: { width: 144, height: 240 },
      fetchFn: empty(),
    });
    await fiber2;
    expect(own.ctx.get('scenes')!.container.scale.x).toBeCloseTo(2, 10);
    expect(own.ctx.get('scenes')!.orientation()).toBe('portrait');
    await fiber2.dispose();
  });

  it('ready resolves after the GET has replaced', async () => {
    const { ctx, fiber } = boot();
    await fiber;
    await ctx.get('scenes')!.ready;
    expect(ctx.get('scenes')!.docs().has('a')).toBe(true);
  });

  it('ready rejects on a failed GET when nothing replaced', async () => {
    const { ctx, fiber } = boot(vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    await fiber;
    await expect(ctx.get('scenes')!.ready).rejects.toThrow('down');
  });

  it('ready resolves when a frame replaced first, even if the GET then fails', async () => {
    let rejectFetch!: (e: Error) => void;
    const gatedFetch = vi.fn(() => new Promise((_, reject) => { rejectFetch = reject; })) as unknown as typeof fetch;
    const { ctx, fiber } = boot(gatedFetch);
    await fiber;
    ctx.get('scenes')!.replace([{ id: 'x', nodes: [] }]);
    rejectFetch(new Error('down'));
    await expect(ctx.get('scenes')!.ready).resolves.toBeUndefined();
    expect(ctx.get('scenes')!.docs().has('x')).toBe(true);
  });
});

describe('ui.tap', () => {
  /** The stage a real `Application` hands the row: a `Container` IS an emitter, so the test fires `pointerdown` by hand. */
  const withStage = (screen: { width: number; height: number }) => {
    const ctx = new Context();
    const stage = new Container();
    const app = { stage, ticker: null, screen };
    ctx.provide('renderer', { app });
    return { ctx, stage, app };
  };

  const plug = (ctx: Context, design: { width: number; height: number }) =>
    ctx.plugin(runtime, { design, fetchFn: fetchOk({ scenes: [], diagnostics: [], nodeTypes: [] }) });

  it('a stage pointerdown emits ui.tap on the flow bus, in DESIGN units', async () => {
    const { ctx, stage, app } = withStage({ width: 200, height: 100 });
    const emit = vi.fn();
    // The flow bus, exactly as `@energy8engine/flow`'s row provides it.
    ctx.provide('events', { emit, on: () => () => {} });
    const fiber = plug(ctx, { width: 100, height: 50 });
    await fiber;
    expect(stage.eventMode).toBe('static');
    expect(stage.hitArea).toBe(app.screen);
    // The design is fitted 2× into the viewport: a tap at (100, 50) on
    // screen is (50, 25) in the design the author laid the scene out in.
    stage.emit('pointerdown', { global: { x: 100, y: 50 } } as never);
    expect(emit).toHaveBeenCalledWith('ui.tap', { x: 50, y: 25 });
    await fiber.dispose();
    emit.mockClear();
    stage.emit('pointerdown', { global: { x: 100, y: 50 } } as never);
    expect(emit).not.toHaveBeenCalled();
  });

  it('no flow row: the tap is a lenient no-op, never a throw', async () => {
    const { ctx, stage } = withStage({ width: 200, height: 100 });
    const fiber = plug(ctx, { width: 100, height: 50 });
    await fiber;
    expect(() => stage.emit('pointerdown', { global: { x: 1, y: 2 } } as never)).not.toThrow();
    await fiber.dispose();
  });

  it('the editor page (a `sceneEdit` service) swallows the tap — a click there selects a node', async () => {
    const { ctx, stage } = withStage({ width: 200, height: 100 });
    const emit = vi.fn();
    ctx.provide('events', { emit, on: () => () => {} });
    // What `@energy8engine/scene-edit` provides at apply; read at CLICK
    // time, so it counts whether that row composed before this one or after.
    ctx.provide('sceneEdit', true);
    const fiber = plug(ctx, { width: 100, height: 50 });
    await fiber;
    stage.emit('pointerdown', { global: { x: 100, y: 50 } } as never);
    expect(emit).not.toHaveBeenCalled();
    await fiber.dispose();
  });

  it('a headless app whose stage is no emitter still composes', async () => {
    const ctx = new Context();
    ctx.provide('renderer', { app: { stage: Object.assign(new Container(), { on: undefined, off: undefined }) } });
    const fiber = plug(ctx, { width: 100, height: 50 });
    await expect(fiber).resolves.toBeDefined();
    await fiber.dispose();
  });
});
