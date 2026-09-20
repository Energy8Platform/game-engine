import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { Sound } from '@pixi/sound';
import type { RunCtx } from '@energy8engine/flow';
import { createSound, type SoundInstance, type SoundLike, type SoundProps } from '../src/sound';
import { createAudioState, type Clock } from '../src/audio-state';

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

/** Full `SoundProps`, defaults `action=play, loop=false, volume=1, wait=false, category=sfx, fade=0` — override what a test cares about. */
function props(over: Partial<SoundProps> = {}): SoundProps {
  return { action: 'play', loop: false, volume: 1, wait: false, category: 'sfx', fade: 0, ...over };
}

/**
 * A manual `Clock`: `now()` reads a counter this test drives with
 * `advance(ms)`, which also fires every registered `tick` callback once —
 * standing in for one animation frame `ms` long, deterministically.
 */
function fakeClock(): { clock: Clock; advance(ms: number): void } {
  let time = 0;
  const fns = new Set<() => void>();
  return {
    clock: {
      now: () => time,
      tick(fn) {
        fns.add(fn);
        return () => fns.delete(fn);
      },
    },
    advance(ms: number) {
      time += ms;
      for (const fn of [...fns]) fn();
    },
  };
}

/** A `SoundLike` whose `play` records its options (incl. onto the instance's own `volume`) and hands back a way to fire `complete`. */
function fakeSound() {
  let complete: (() => void) | undefined;
  const stopListeners = new Set<() => void>();
  const instance: SoundInstance = {
    volume: 0,
    stop: vi.fn(() => stopListeners.forEach((fn) => fn())),
    on: vi.fn((event: 'end' | 'stop', fn: () => void) => {
      if (event === 'stop') stopListeners.add(fn);
    }),
  };
  const sound: SoundLike & { fireComplete(): void } = {
    play: vi.fn((o: { loop: boolean; volume: number; complete?: () => void }) => {
      instance.volume = o.volume;
      complete = o.complete;
      return instance;
    }),
    stop: vi.fn(() => instance.stop()),
    destroy: vi.fn(),
    fireComplete: () => complete?.(),
  };
  return { sound, instance };
}

describe('createSound', () => {
  it('one out; defaults action=play, loop=false, volume=1, wait=false, category=sfx, fade=0', () => {
    const kind = createSound(createAudioState());
    expect(kind.outs).toEqual(['next']);
    const parsed = kind.schema({} as never) as SoundProps;
    expect(parsed).toEqual({
      action: 'play',
      loop: false,
      volume: 1,
      wait: false,
      category: 'sfx',
      fade: 0,
    });
  });

  it('no src reports and leaves by next without calling `from`', async () => {
    const from = vi.fn();
    const kind = createSound(createAudioState(), { from });
    const { rc } = runCtx();
    const result = await kind.run!(props(), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('sound has no src');
    expect(from).not.toHaveBeenCalled();
  });

  it('play with wait: false fires and returns at once, without waiting for complete', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound(createAudioState(), { from });
    const { rc } = runCtx();
    const result = await kind.run!(props({ src: 'assets/spin.wav', loop: true, volume: 0.5 }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(from).toHaveBeenCalledWith('/assets/spin.wav');
    expect(sound.play).toHaveBeenCalledWith({ loop: true, volume: 0.5 });
  });

  it('play with wait: true awaits `complete`', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound(createAudioState(), { from });
    const { rc } = runCtx();
    const pending = kind.run!(props({ src: 'assets/spin.wav', wait: true }), rc);
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
    const kind = createSound(createAudioState(), { from });
    const { rc } = runCtx();
    await kind.run!(props({ src: 'a.wav' }), rc);
    await kind.run!(props({ src: 'a.wav' }), rc);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('action: stop stops the cached sound for that src and does not play', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound(createAudioState(), { from });
    const { rc } = runCtx();
    await kind.run!(props({ src: 'a.wav' }), rc);
    const result = await kind.run!(props({ src: 'a.wav', action: 'stop' }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(sound.stop).toHaveBeenCalledTimes(1);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('stop on a src never played is a quiet no-op', async () => {
    const kind = createSound(createAudioState(), { from: vi.fn() });
    const { rc } = runCtx();
    const result = await kind.run!(props({ src: 'never.wav', action: 'stop' }), rc);
    expect(result).toEqual({ out: 'next' });
  });

  it('a throwing `from` is caught and reported, not thrown', async () => {
    const from = vi.fn(() => {
      throw new Error('404');
    });
    const kind = createSound(createAudioState(), { from });
    const { rc } = runCtx();
    const result = await kind.run!(props({ src: 'a.wav' }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('sound a.wav: 404');
  });

  it('abort while waiting stops the instance and RETHROWS the abort reason — same contract as `tween`, so the interpreter suppresses it (a `report` would bypass that and paint a diagnostic on a node that was only ever stopped on purpose)', async () => {
    const instance: SoundInstance = { volume: 1, stop: vi.fn() };
    const sound: SoundLike = {
      play: vi.fn(() => Promise.resolve(instance)),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    const from = vi.fn(() => sound);
    const kind = createSound(createAudioState(), { from });
    const { rc, controller } = runCtx();
    const pending = kind.run!(props({ src: 'a.wav', wait: true }), rc);
    const reason = new Error('stopped');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(rc.report).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(instance.stop).toHaveBeenCalled());
  });

  it('wait: true on an already-aborted signal rejects with its reason at once — nothing plays, nothing is reported', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound(createAudioState(), { from });
    const { rc, controller } = runCtx();
    const reason = new Error('stopped');
    controller.abort(reason);
    await expect(kind.run!(props({ src: 'a.wav', wait: true }), rc)).rejects.toBe(reason);
    expect(sound.play).not.toHaveBeenCalled();
    expect(rc.report).not.toHaveBeenCalled();
  });

  it('wait: false play that rejects (a 404, a decode failure) is still reported, after `next` already answered', async () => {
    const sound: SoundLike = {
      play: vi.fn(() => Promise.reject(new Error('404'))),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    const from = vi.fn(() => sound);
    const kind = createSound(createAudioState(), { from });
    const { rc } = runCtx();
    const result = await kind.run!(props({ src: 'a.wav' }), rc);
    expect(result).toEqual({ out: 'next' });
    await vi.waitFor(() => expect(rc.report).toHaveBeenCalledWith('sound a.wav: 404'));
  });

  it("wait: true play that rejects (a 404, a decode failure) is caught and reported — the node does not hang to the timeout, and removes its abort listener (no leak on `signal`, the interpreter's shared epoch signal)", async () => {
    const sound: SoundLike = {
      play: vi.fn(() => Promise.reject(new Error('404'))),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    const from = vi.fn(() => sound);
    const kind = createSound(createAudioState(), { from });
    const { rc, controller } = runCtx();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const result = await kind.run!(props({ src: 'a.wav', wait: true }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('sound a.wav: 404');
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('wait: true with loop: true never completes — reported as a warning, falls back to fire-and-forget', async () => {
    const { sound } = fakeSound();
    const from = vi.fn(() => sound);
    const kind = createSound(createAudioState(), { from });
    const { rc } = runCtx();
    const result = await kind.run!(props({ src: 'a.wav', loop: true, wait: true }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith(
      'a looping sound never completes; wait ignored',
      'warning',
    );
    // The fire-and-forget shape: no `complete` callback (there is no `await` waiting for it).
    expect(sound.play).toHaveBeenCalledWith({ loop: true, volume: 1 });
  });

  it('the default `from` calls `Sound.from` without `preload` — preload plus an immediate play() would load and play twice', async () => {
    const fake = { play: vi.fn(() => ({ volume: 0, stop: vi.fn() })), stop: vi.fn(), destroy: vi.fn() };
    const spy = vi.spyOn(Sound, 'from').mockReturnValue(fake as never);
    try {
      const kind = createSound(createAudioState());
      const { rc } = runCtx();
      await kind.run!(props({ src: 'x.wav' }), rc);
      expect(spy).toHaveBeenCalledWith({ url: '/x.wav' });
    } finally {
      spy.mockRestore();
    }
  });

  it('dispose() destroys every cached sound and clears the cache', async () => {
    const { sound: a } = fakeSound();
    const { sound: b } = fakeSound();
    const from = vi.fn((url: string) => (url === '/a.wav' ? a : b));
    const kind = createSound(createAudioState(), { from });
    const { rc } = runCtx();
    await kind.run!(props({ src: 'a.wav' }), rc);
    await kind.run!(props({ src: 'b.wav' }), rc);
    kind.dispose();
    expect(a.destroy).toHaveBeenCalledTimes(1);
    expect(b.destroy).toHaveBeenCalledTimes(1);
  });

  describe('category and fade', () => {
    it('play multiplies by the category volume even with no fade', async () => {
      const { sound } = fakeSound();
      const from = vi.fn(() => sound);
      const state = createAudioState();
      state.setCategory('music', 0.5, 0);
      const kind = createSound(state, { from });
      const { rc } = runCtx();
      await kind.run!(props({ src: 'a.wav', volume: 0.8, category: 'music' }), rc);
      expect(sound.play).toHaveBeenCalledWith({ loop: false, volume: 0.4 });
    });

    it('fade up over an injected clock reaches `volume × category`', async () => {
      const { clock, advance } = fakeClock();
      const state = createAudioState({ clock });
      state.setCategory('music', 0.5, 0);
      const { sound, instance } = fakeSound();
      const from = vi.fn(() => sound);
      const kind = createSound(state, { from });
      const { rc } = runCtx();
      await kind.run!(props({ src: 'a.wav', volume: 0.8, category: 'music', fade: 1000 }), rc);
      // Starts silent — the fade owns the volume from here, not the play() call.
      expect(sound.play).toHaveBeenCalledWith({ loop: false, volume: 0 });
      await Promise.resolve();
      await Promise.resolve();
      advance(500);
      expect(instance.volume).toBeCloseTo(0.2); // halfway to 0.8 * 0.5
      advance(500);
      expect(instance.volume).toBeCloseTo(0.4);
    });

    it('fade-out stop ramps the instance to 0 over the clock, then calls the real stop', async () => {
      const { clock, advance } = fakeClock();
      const state = createAudioState({ clock });
      const { sound, instance } = fakeSound();
      const from = vi.fn(() => sound);
      const kind = createSound(state, { from });
      const { rc } = runCtx();
      await kind.run!(props({ src: 'a.wav', volume: 1 }), rc);
      await Promise.resolve();
      await Promise.resolve();
      expect(instance.volume).toBe(1);
      const result = await kind.run!(props({ src: 'a.wav', action: 'stop', fade: 1000 }), rc);
      expect(result).toEqual({ out: 'next' }); // answers at once; the ramp runs in the background
      expect(sound.stop).not.toHaveBeenCalled();
      advance(500);
      expect(instance.volume).toBeCloseTo(0.5);
      expect(sound.stop).not.toHaveBeenCalled();
      advance(500);
      expect(instance.volume).toBe(0);
      expect(sound.stop).toHaveBeenCalledTimes(1);
    });

    it('`wait` with a faded stop resolves when silent', async () => {
      const { clock, advance } = fakeClock();
      const state = createAudioState({ clock });
      const { sound } = fakeSound();
      const from = vi.fn(() => sound);
      const kind = createSound(state, { from });
      const { rc } = runCtx();
      const pending = kind.run!(props({ src: 'a.wav', wait: true }), rc);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      const stopResult = await kind.run!(props({ src: 'a.wav', action: 'stop', fade: 1000 }), rc);
      expect(stopResult).toEqual({ out: 'next' });
      expect(settled).toBe(false); // still fading — not silent yet
      advance(1000);
      expect(await pending).toEqual({ out: 'next' }); // resolved once silent
      expect(sound.stop).toHaveBeenCalledTimes(1);
    });
  });
});
