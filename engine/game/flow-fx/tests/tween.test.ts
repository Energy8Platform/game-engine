import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { Tween } from '@energy8platform/game-engine/animation';
import type { RunCtx } from '@energy8engine/flow';
import { createTween } from '../src/tween';

function runCtx(provide: Record<string, unknown> = {}) {
  const ctx = new Context();
  for (const [name, value] of Object.entries(provide)) ctx.provide(name, value);
  const controller = new AbortController();
  const rc: RunCtx = {
    vars: {},
    ctx,
    signal: controller.signal,
    fetchFn: vi.fn() as unknown as typeof fetch,
    report: vi.fn(),
    busy: () => false,
    idle: async () => {},
  };
  return { rc, controller };
}

describe('createTween', () => {
  it('one out, `target`/`ms` required, `easing` one of the real Easing keys, `wait` defaults true', () => {
    const kind = createTween();
    expect(kind.outs).toEqual(['next']);
    const parsed = kind.schema({ target: 'a/b', ms: 200 } as never) as {
      wait: boolean;
      easing: string;
    };
    expect(parsed.wait).toBe(true);
    expect(parsed.easing).toBe('linear');
    expect(() => kind.schema({ ms: 200 } as never)).toThrow();
    expect(() => kind.schema({ target: 'a/b' } as never)).toThrow();
  });

  it('a target not on stage reports and leaves by next, without touching `to`', async () => {
    const to = vi.fn();
    const kind = createTween({ to, kill: vi.fn() });
    const scenes = { view: vi.fn(() => undefined) };
    const { rc } = runCtx({ scenes });
    const result = await kind.run!(
      { target: 'base_game/logo', ms: 100, easing: 'linear', wait: true },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('node base_game/logo is not on stage');
    expect(to).not.toHaveBeenCalled();
    // The scene is everything before the FIRST slash; the node is the rest, rejoined.
    expect(scenes.view).toHaveBeenCalledWith({ scene: 'base_game', node: 'logo' });
  });

  it('maps x/y/alpha/rotation as-is, scale to scale.x + scale.y, and drops whatever is undefined', async () => {
    const view = { label: 'logo' };
    const to = vi.fn(() => Promise.resolve());
    const kind = createTween({ to, kill: vi.fn() });
    const scenes = { view: vi.fn(() => view) };
    const { rc } = runCtx({ scenes });
    await kind.run!(
      { target: 'base_game/logo', ms: 300, easing: 'easeOutQuad', wait: true, x: 10, scale: 2 },
      rc,
    );
    expect(to).toHaveBeenCalledWith(
      view,
      { x: 10, 'scale.x': 2, 'scale.y': 2 },
      300,
      expect.any(Function),
    );
  });

  it('nothing to animate reports and leaves by next without calling `to`', async () => {
    const to = vi.fn();
    const kind = createTween({ to, kill: vi.fn() });
    const scenes = { view: vi.fn(() => ({})) };
    const { rc } = runCtx({ scenes });
    const result = await kind.run!({ target: 'a/b', ms: 100, easing: 'linear', wait: true }, rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('tween has nothing to animate');
    expect(to).not.toHaveBeenCalled();
  });

  it('wait: false returns at once, without awaiting the tween', async () => {
    const to = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const kind = createTween({ to, kill: vi.fn() });
    const scenes = { view: vi.fn(() => ({})) };
    const { rc } = runCtx({ scenes });
    const result = await kind.run!(
      { target: 'a/b', ms: 100, easing: 'linear', wait: false, x: 1 },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
  });

  it('an abort mid-wait kills the tween on the view and rethrows the abort reason', async () => {
    const to = vi.fn(() => new Promise<void>(() => {})); // never resolves on its own
    const kill = vi.fn();
    const view = { label: 'logo' };
    const kind = createTween({ to, kill });
    const scenes = { view: vi.fn(() => view) };
    const { rc, controller } = runCtx({ scenes });
    const pending = kind.run!({ target: 'a/b', ms: 100, easing: 'linear', wait: true, x: 1 }, rc);
    const reason = new Error('stopped');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(kill).toHaveBeenCalledWith(view);
  });

  it('with no deps, defaults to the legacy Tween.to / Tween.killTweensOf', async () => {
    const toSpy = vi.spyOn(Tween, 'to').mockReturnValue(Promise.resolve());
    const killSpy = vi.spyOn(Tween, 'killTweensOf').mockImplementation(() => {});
    try {
      const kind = createTween();
      const view = { label: 'logo' };
      const scenes = { view: vi.fn(() => view) };
      const { rc } = runCtx({ scenes });
      const result = await kind.run!(
        { target: 'a/b', ms: 50, easing: 'linear', wait: true, x: 1 },
        rc,
      );
      expect(result).toEqual({ out: 'next' });
      expect(toSpy).toHaveBeenCalledWith(view, { x: 1 }, 50, expect.any(Function));
      expect(killSpy).not.toHaveBeenCalled();
    } finally {
      toSpy.mockRestore();
      killSpy.mockRestore();
    }
  });
});
