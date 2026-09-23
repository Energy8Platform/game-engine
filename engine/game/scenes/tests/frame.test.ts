/**
 * `scenes.onFrame` — a per-tick hook for code that has no node to attach
 * to (paper-duel's tier overlay follows falling cells). The service
 * builder is `require.test.ts`'s pattern: no node types registered,
 * `onFrame` has nothing to do with the mount tree.
 */
import { describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import { createNodeTypes } from '../src/node-types';
import { type AssetLoader } from '../src/builtin';
import { createScenes } from '../src/scenes';
import type { TickerLike } from '../src/transitions';

/** A ticker the test drives by hand — `mount.test.ts` has the same shape. */
function fakeTicker(): TickerLike & { tick(ms: number): void; hooked: number } {
  const fns = new Set<(t: { deltaMS: number }) => void>();
  return {
    add: (fn) => fns.add(fn),
    remove: (fn) => fns.delete(fn),
    tick: (ms) => [...fns].forEach((fn) => fn({ deltaMS: ms })),
    get hooked() {
      return fns.size;
    },
  };
}

const loader: AssetLoader = {
  load: vi.fn(async () => {}),
  unload: vi.fn(async () => {}),
  get: () => Texture.EMPTY,
};

function boot(ticker?: TickerLike | null) {
  const ctx = new Context();
  const report = vi.fn<(d: Diagnostic) => void>();
  const scenes = createScenes({
    root: new Container(),
    design: { width: 100, height: 50 },
    nodeTypes: createNodeTypes(),
    loader,
    ctx,
    report,
    ticker,
  });
  return { scenes, report };
}

describe('onFrame', () => {
  it("fires per tick with the ticker's deltaMS", () => {
    const ticker = fakeTicker();
    const { scenes } = boot(ticker);
    const fn = vi.fn();
    scenes.onFrame(fn);
    ticker.tick(16);
    ticker.tick(20);
    expect(fn.mock.calls).toEqual([[16], [20]]);
  });

  it('the disposer unhooks', () => {
    const ticker = fakeTicker();
    const { scenes } = boot(ticker);
    const fn = vi.fn();
    const off = scenes.onFrame(fn);
    off();
    ticker.tick(16);
    expect(fn).not.toHaveBeenCalled();
  });

  it('two registrations both fire, behind one ticker hook', () => {
    const ticker = fakeTicker();
    const { scenes } = boot(ticker);
    expect(ticker.hooked).toBe(0);
    const a = vi.fn();
    const b = vi.fn();
    scenes.onFrame(a);
    expect(ticker.hooked).toBe(1);
    scenes.onFrame(b);
    expect(ticker.hooked).toBe(1);
    ticker.tick(10);
    expect(a).toHaveBeenCalledWith(10);
    expect(b).toHaveBeenCalledWith(10);
  });

  it('the ticker hook drops once the last registration disposes; a composition that never calls onFrame never hooks', () => {
    const ticker = fakeTicker();
    const { scenes } = boot(ticker);
    const offA = scenes.onFrame(vi.fn());
    const offB = scenes.onFrame(vi.fn());
    offA();
    expect(ticker.hooked).toBe(1);
    offB();
    expect(ticker.hooked).toBe(0);
  });

  it('a registration after the last one went re-hooks the ticker', () => {
    const ticker = fakeTicker();
    const { scenes } = boot(ticker);
    scenes.onFrame(vi.fn())();
    expect(ticker.hooked).toBe(0);
    const fn = vi.fn();
    scenes.onFrame(fn);
    expect(ticker.hooked).toBe(1);
    ticker.tick(16);
    expect(fn).toHaveBeenCalledWith(16);
  });

  it('a disposer called twice is a no-op — it cannot unhook a sibling registration', () => {
    const ticker = fakeTicker();
    const { scenes } = boot(ticker);
    const off = scenes.onFrame(vi.fn());
    const other = vi.fn();
    scenes.onFrame(other);
    off();
    off();
    expect(ticker.hooked).toBe(1);
    ticker.tick(16);
    expect(other).toHaveBeenCalledWith(16);
  });

  it('a throwing fn is unhooked and reported once (scenes, onFrame); its siblings keep firing', () => {
    const ticker = fakeTicker();
    const { scenes, report } = boot(ticker);
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    scenes.onFrame(bad);
    scenes.onFrame(good);
    ticker.tick(16);
    expect(good).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', plugin: 'scenes', where: 'onFrame' }),
    );
    ticker.tick(16);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('with no ticker the registration is accepted, never fires, and the disposer is a no-op', () => {
    const { scenes } = boot(null);
    const fn = vi.fn();
    const off = scenes.onFrame(fn);
    expect(() => off()).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('destroy drops a live ticker hook', () => {
    const ticker = fakeTicker();
    const { scenes } = boot(ticker);
    scenes.onFrame(vi.fn());
    expect(ticker.hooked).toBe(1);
    scenes.destroy();
    expect(ticker.hooked).toBe(0);
  });
});
