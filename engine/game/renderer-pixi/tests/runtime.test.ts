import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';

/**
 * The runtime half's own concern, which `renderer.test.ts` does not touch:
 * where the canvas ends up. A live DOM element cannot travel in a row's
 * YAML config, so it arrives as a caller-provided `mount` SERVICE — and a
 * game composed without one must still come up, attached nowhere, rather
 * than waiting forever for a mount that is never coming.
 *
 * `pixi.js` is mocked for the same reason `renderer.test.ts` mocks it
 * (`Application.init()` needs a real DOM), and this package's suite runs
 * under `node`, so the "mount" here is the narrowest object this file
 * actually calls into — `appendChild` — not a jsdom element. What is
 * being proven is the wiring, and the wiring only ever calls that.
 */
const { init, destroy, canvas, resize } = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  destroy: vi.fn(),
  canvas: { remove: vi.fn() },
  resize: vi.fn(),
}));

vi.mock('pixi.js', () => {
  class FakeApplication {
    init = init;
    destroy = destroy;
    canvas = canvas;
    resize = resize;
  }
  return { Application: FakeApplication };
});

import * as runtime from '../src/runtime';

function fakeMount() {
  return { appendChild: vi.fn(), clientWidth: 0, clientHeight: 0 } as unknown as HTMLElement;
}

/**
 * Stands in for the browser's `ResizeObserver` — this suite runs under
 * `node`, which has none. Records `observe`/`disconnect` and exposes
 * `fire()` so a test can trigger a box-change by hand instead of driving a
 * real layout.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  fire() {
    this.callback();
  }
}

describe('renderer-pixi runtime half', () => {
  // The pixi fake is hoisted once for the whole file, so its spies carry
  // calls across tests unless cleared — `canvas.remove` in particular is
  // asserted NOT to have been called yet.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches its canvas to the mount the caller provided', async () => {
    const ctx = new Context();
    const mount = fakeMount();
    ctx.provide('mount', mount);

    await ctx.plugin(runtime, { width: 100, height: 50 });

    expect(init).toHaveBeenLastCalledWith({ width: 100, height: 50 });
    expect(mount.appendChild).toHaveBeenCalledWith(canvas);
    expect(ctx.renderer).toBeDefined();

    await ctx.fiber.dispose();
  });

  it('comes up with no mount at all — attached nowhere, not waiting for one', async () => {
    const ctx = new Context();

    await ctx.plugin(runtime, {});

    expect(ctx.renderer).toBeDefined();
    await ctx.fiber.dispose();
  });

  it('takes its canvas back out of the mount when the plugin is disposed', async () => {
    const ctx = new Context();
    ctx.provide('mount', fakeMount());

    await ctx.plugin(runtime, {});
    expect(canvas.remove).not.toHaveBeenCalled();

    await ctx.fiber.dispose();
    expect(canvas.remove).toHaveBeenCalled();
  });

  describe('following the mount (§3 of the design spec)', () => {
    beforeEach(() => {
      FakeResizeObserver.instances.length = 0;
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    });

    afterEach(() => {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    });

    it('no size configured: resizeTo is the mount, autoDensity on, and it observes the box', async () => {
      const ctx = new Context();
      const mount = fakeMount();
      ctx.provide('mount', mount);

      await ctx.plugin(runtime, {});

      expect(init).toHaveBeenLastCalledWith({ resizeTo: mount, autoDensity: true, resolution: 1 });
      expect(FakeResizeObserver.instances).toHaveLength(1);
      expect(FakeResizeObserver.instances[0].observe).toHaveBeenCalledWith(mount);

      await ctx.fiber.dispose();
    });

    it('a mount box change fires app.resize()', async () => {
      const ctx = new Context();
      ctx.provide('mount', fakeMount());

      await ctx.plugin(runtime, {});
      expect(resize).not.toHaveBeenCalled();
      FakeResizeObserver.instances[0]!.fire();
      expect(resize).toHaveBeenCalledTimes(1);

      await ctx.fiber.dispose();
    });

    it('disposing the plugin disconnects the observer before destroying the app', async () => {
      const ctx = new Context();
      ctx.provide('mount', fakeMount());

      await ctx.plugin(runtime, {});
      const observer = FakeResizeObserver.instances[0]!;
      expect(observer.disconnect).not.toHaveBeenCalled();

      await ctx.fiber.dispose();

      expect(observer.disconnect).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(observer.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
        destroy.mock.invocationCallOrder[0]!,
      );
    });

    it('both sizes given: a fixed canvas, no observer', async () => {
      const ctx = new Context();
      ctx.provide('mount', fakeMount());

      await ctx.plugin(runtime, { width: 320, height: 240 });

      expect(init).toHaveBeenLastCalledWith({ width: 320, height: 240 });
      expect(FakeResizeObserver.instances).toHaveLength(0);

      await ctx.fiber.dispose();
    });

    it('one size given: reports a warning and follows the mount anyway', async () => {
      const ctx = new Context();
      const mount = fakeMount();
      ctx.provide('mount', mount);
      const report = vi.fn();
      ctx.provide('diagnostics', { report });

      await ctx.plugin(runtime, { width: 320 });

      expect(report).toHaveBeenCalledWith({
        severity: 'warning',
        plugin: 'renderer-pixi',
        where: 'config',
        message: 'width and height come together — following the mount instead',
        fix: 'set both, or neither',
      });
      // The lone value was stripped — the canvas follows the mount, not 320px wide.
      expect(init).toHaveBeenLastCalledWith({ resizeTo: mount, autoDensity: true, resolution: 1 });

      await ctx.fiber.dispose();
    });

    it('one size given but no diagnostics service composed: still follows the mount, no throw', async () => {
      const ctx = new Context();
      const mount = fakeMount();
      ctx.provide('mount', mount);

      await expect(ctx.plugin(runtime, { height: 240 })).resolves.not.toThrow();
      expect(init).toHaveBeenLastCalledWith({ resizeTo: mount, autoDensity: true, resolution: 1 });

      await ctx.fiber.dispose();
    });
  });

  describe('no ResizeObserver in this environment', () => {
    beforeEach(() => {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    });

    it('still initialises and follows the mount — no throw', async () => {
      const ctx = new Context();
      const mount = fakeMount();
      ctx.provide('mount', mount);

      await expect(ctx.plugin(runtime, {})).resolves.not.toThrow();
      expect(init).toHaveBeenLastCalledWith({ resizeTo: mount, autoDensity: true, resolution: 1 });
      expect(ctx.renderer).toBeDefined();

      await ctx.fiber.dispose();
    });
  });
});
