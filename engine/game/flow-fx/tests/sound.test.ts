import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { Sound } from '@pixi/sound';
import type { RunCtx } from '@energy8engine/flow';
import { createSound, type SoundLike } from '../src/sound';

function runCtx() {
  const ctx = new Context();
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

/** A `SoundLike` whose `play` records its options and hands back a way to fire `complete`. */
function fakeSound() {
  let complete: (() => void) | undefined;
  const instance = { stop: vi.fn() };
  const sound: SoundLike & { fireComplete(): void } = {
    play: vi.fn((o: { loop: boolean; volume: number; complete?: () => void }) => {
      complete = o.complete;
      return instance;
    }),
    stop: vi.fn(),
    destroy: vi.fn(),
    fireComplete: () => complete?.(),
  };
  return { sound, instance };
}

describe('createSound', () => {
  it('one out; defaults action=play, loop=false, volume=1, wait=false', () => {
    const kind = createSound();
    expect(kind.outs).toEqual(['next']);
    const parsed = kind.schema({} as never) as {
      action: string;
      loop: boolean;
      volume: number;
      wait: boolean;
    };
    expect(parsed).toEqual({ action: 'play', loop: false, volume: 1, wait: false });
  });

  it('no src reports and leaves by next without calling `from`', async () => {
    const from = vi.fn();
    const kind = createSound({ from });
    const { rc } = runCtx();
    const result = await kind.run!({ action: 'play', loop: false, volume: 1, wait: false }, rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('sound has no src');
    expect(from).not.toHaveBeenCalled();
  });

  it('play with wait: false fires and returns at once, without waiting for complete', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound({ from });
    const { rc } = runCtx();
    const result = await kind.run!(
      { src: 'assets/spin.wav', action: 'play', loop: true, volume: 0.5, wait: false },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
    expect(from).toHaveBeenCalledWith('/assets/spin.wav');
    expect(sound.play).toHaveBeenCalledWith({ loop: true, volume: 0.5 });
  });

  it('play with wait: true awaits `complete`', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound({ from });
    const { rc } = runCtx();
    const pending = kind.run!(
      { src: 'assets/spin.wav', action: 'play', loop: false, volume: 1, wait: true },
      rc,
    );
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // still waiting on `complete`
    sound.fireComplete();
    expect(await pending).toEqual({ out: 'next' });
  });

  it('caches by src: a second play of the same src does not call `from` again', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound({ from });
    const { rc } = runCtx();
    await kind.run!({ src: 'a.wav', action: 'play', loop: false, volume: 1, wait: false }, rc);
    await kind.run!({ src: 'a.wav', action: 'play', loop: false, volume: 1, wait: false }, rc);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('action: stop stops the cached sound for that src and does not play', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound({ from });
    const { rc } = runCtx();
    await kind.run!({ src: 'a.wav', action: 'play', loop: false, volume: 1, wait: false }, rc);
    const result = await kind.run!(
      { src: 'a.wav', action: 'stop', loop: false, volume: 1, wait: false },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
    expect(sound.stop).toHaveBeenCalledTimes(1);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('stop on a src never played is a quiet no-op', async () => {
    const kind = createSound({ from: vi.fn() });
    const { rc } = runCtx();
    const result = await kind.run!(
      { src: 'never.wav', action: 'stop', loop: false, volume: 1, wait: false },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
  });

  it('a throwing `from` is caught and reported, not thrown', async () => {
    const from = vi.fn(() => {
      throw new Error('404');
    });
    const kind = createSound({ from });
    const { rc } = runCtx();
    const result = await kind.run!(
      { src: 'a.wav', action: 'play', loop: false, volume: 1, wait: false },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('sound a.wav: 404');
  });

  it('abort while waiting stops the instance and RETHROWS the abort reason — same contract as `tween`, so the interpreter suppresses it (a `report` would bypass that and paint a diagnostic on a node that was only ever stopped on purpose)', async () => {
    const instance = { stop: vi.fn() };
    const sound: SoundLike = {
      play: vi.fn(() => Promise.resolve(instance)),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    const from = vi.fn(() => sound);
    const kind = createSound({ from });
    const { rc, controller } = runCtx();
    const pending = kind.run!(
      { src: 'a.wav', action: 'play', loop: false, volume: 1, wait: true },
      rc,
    );
    const reason = new Error('stopped');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(rc.report).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(instance.stop).toHaveBeenCalled());
  });

  it('wait: false play that rejects (a 404, a decode failure) is still reported, after `next` already answered', async () => {
    const sound: SoundLike = {
      play: vi.fn(() => Promise.reject(new Error('404'))),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    const from = vi.fn(() => sound);
    const kind = createSound({ from });
    const { rc } = runCtx();
    const result = await kind.run!(
      { src: 'a.wav', action: 'play', loop: false, volume: 1, wait: false },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
    await vi.waitFor(() => expect(rc.report).toHaveBeenCalledWith('sound a.wav: 404'));
  });

  it('wait: true play that rejects (a 404, a decode failure) is caught and reported — the node does not hang to the timeout', async () => {
    const sound: SoundLike = {
      play: vi.fn(() => Promise.reject(new Error('404'))),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    const from = vi.fn(() => sound);
    const kind = createSound({ from });
    const { rc } = runCtx();
    const result = await kind.run!(
      { src: 'a.wav', action: 'play', loop: false, volume: 1, wait: true },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('sound a.wav: 404');
  });

  it('wait: true with loop: true never completes — reported as a warning, falls back to fire-and-forget', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound({ from });
    const { rc } = runCtx();
    const result = await kind.run!(
      { src: 'a.wav', action: 'play', loop: true, volume: 1, wait: true },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith(
      'a looping sound never completes; wait ignored',
      'warning',
    );
    // The fire-and-forget shape: no `complete` callback (there is no `await` waiting for it).
    expect(sound.play).toHaveBeenCalledWith({ loop: true, volume: 1 });
  });

  it('the default `from` calls `Sound.from` without `preload` — preload plus an immediate play() would load and play twice', async () => {
    const fake = { play: vi.fn(), stop: vi.fn(), destroy: vi.fn() };
    const spy = vi.spyOn(Sound, 'from').mockReturnValue(fake as never);
    try {
      const kind = createSound();
      const { rc } = runCtx();
      await kind.run!({ src: 'x.wav', action: 'play', loop: false, volume: 1, wait: false }, rc);
      expect(spy).toHaveBeenCalledWith({ url: '/x.wav' });
    } finally {
      spy.mockRestore();
    }
  });

  it('dispose() destroys every cached sound and clears the cache', async () => {
    const { sound: a } = fakeSound();
    const { sound: b } = fakeSound();
    const from = vi.fn((url: string) => (url === '/a.wav' ? a : b));
    const kind = createSound({ from });
    const { rc } = runCtx();
    await kind.run!({ src: 'a.wav', action: 'play', loop: false, volume: 1, wait: false }, rc);
    await kind.run!({ src: 'b.wav', action: 'play', loop: false, volume: 1, wait: false }, rc);
    kind.dispose();
    expect(a.destroy).toHaveBeenCalledTimes(1);
    expect(b.destroy).toHaveBeenCalledTimes(1);
  });
});
