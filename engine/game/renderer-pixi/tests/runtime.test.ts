import { beforeEach, describe, expect, it, vi } from 'vitest';
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
const { init, destroy, canvas } = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  destroy: vi.fn(),
  canvas: { remove: vi.fn() },
}));

vi.mock('pixi.js', () => {
  class FakeApplication {
    init = init;
    destroy = destroy;
    canvas = canvas;
  }
  return { Application: FakeApplication };
});

import * as runtime from '../src/runtime';

function fakeMount() {
  return { appendChild: vi.fn() } as unknown as HTMLElement;
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
});
