import { describe, expect, it, vi } from 'vitest';

/**
 * `pixi.js`'s real `Application.init()` needs a DOM (measured: it rejects
 * with `ReferenceError: document is not defined` in plain Node — see the
 * module doc in src/index.ts). So this suite mocks `Application` itself
 * and checks the one thing `createPixiRenderer` adds on top of it: that it
 * calls `.init()` with exactly the options it was given, and returns
 * `{ app, destroy() }` wired to that same instance.
 */
const { init, destroy, instances } = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  destroy: vi.fn(),
  instances: [] as unknown[],
}));

vi.mock('pixi.js', () => {
  class FakeApplication {
    init = init;
    destroy = destroy;
    constructor() {
      instances.push(this);
    }
  }
  return { Application: FakeApplication };
});

import { createPixiRenderer } from '../src/index';

describe('createPixiRenderer', () => {
  it('forwards its options to Application.init unchanged', async () => {
    await createPixiRenderer({ width: 800, height: 600, background: 0x0a0a0a });
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith({ width: 800, height: 600, background: 0x0a0a0a });
  });

  it('defaults to an empty options object when none is given', async () => {
    await createPixiRenderer();
    expect(init).toHaveBeenLastCalledWith({});
  });

  it('returns the same Application instance it constructed, as `app`', async () => {
    const renderer = await createPixiRenderer();
    expect(renderer.app).toBe(instances[instances.length - 1]);
  });

  it('destroy() calls Application.destroy(true, { children: true })', async () => {
    const renderer = await createPixiRenderer();
    renderer.destroy();
    expect(destroy).toHaveBeenCalledWith(true, { children: true });
  });
});
