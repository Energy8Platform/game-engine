import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import type { RunCtx } from '@energy8engine/flow';
import { createAudio, type AudioProps } from '../src/audio';
import { createAudioState, type Clock } from '../src/audio-state';

function runCtx(vars: Record<string, unknown> = {}) {
  const ctx = new Context();
  const controller = new AbortController();
  const rc: RunCtx = {
    vars,
    ctx,
    signal: controller.signal,
    fetchFn: vi.fn() as unknown as typeof fetch,
    report: vi.fn(),
    busy: () => false,
    idle: async () => {},
  };
  return { rc, controller };
}

function props(over: Partial<AudioProps> = {}): AudioProps {
  return { category: 'sfx', volume: '1', fade: 0, ...over };
}

/** Manual clock — `advance(ms)` fires every registered `tick` callback once, standing in for one frame `ms` long. */
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

describe('createAudio', () => {
  it('one out; defaults category=sfx, volume="1", fade=0', () => {
    const kind = createAudio(createAudioState());
    expect(kind.outs).toEqual(['next']);
    const parsed = kind.schema({} as never) as AudioProps;
    expect(parsed).toEqual({ category: 'sfx', volume: '1', fade: 0 });
  });

  it('sets the category volume at once with fade: 0', async () => {
    const state = createAudioState();
    const kind = createAudio(state);
    const { rc } = runCtx();
    const result = await kind.run!(props({ category: 'music', volume: '0.5' }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(state.categoryVolume('music')).toBe(0.5);
  });

  it('ramps every live instance of the category to instanceVolume × newCategoryVolume, over the clock', async () => {
    const { clock, advance } = fakeClock();
    const state = createAudioState({ clock });
    const instance = { volume: 0.6 }; // a `sound` node's own volume was 0.6, played while category was at its default 1
    state.track('music', 0.6, instance);
    const kind = createAudio(state);
    const { rc } = runCtx();
    const result = await kind.run!(props({ category: 'music', volume: '0.5', fade: 1000 }), rc);
    expect(result).toEqual({ out: 'next' });
    advance(500);
    expect(instance.volume).toBeCloseTo(0.45); // halfway from 0.6 to 0.6 * 0.5 = 0.3
    advance(500);
    expect(instance.volume).toBeCloseTo(0.3);
  });

  it('an instance of a DIFFERENT category is left alone', async () => {
    const state = createAudioState();
    const sfxInstance = { volume: 0.7 };
    state.track('sfx', 0.7, sfxInstance);
    const kind = createAudio(state);
    const { rc } = runCtx();
    await kind.run!(props({ category: 'music', volume: '0.1' }), rc);
    expect(sfxInstance.volume).toBe(0.7);
  });

  it('a later play reads the category volume this node set', async () => {
    const state = createAudioState();
    const kind = createAudio(state);
    const { rc } = runCtx();
    await kind.run!(props({ category: 'music', volume: '0.25' }), rc);
    // What `sound.ts`'s `run` reads before every play — see `sound.test.ts`'s
    // "play multiplies by the category volume" for the play side of this.
    expect(state.categoryVolume('music')).toBe(0.25);
  });

  it('`$path` volume reads a var, clamped 0..1', async () => {
    const state = createAudioState();
    const kind = createAudio(state);
    const { rc } = runCtx({ duckLevel: 1.5 });
    await kind.run!(props({ category: 'music', volume: '$duckLevel' }), rc);
    expect(state.categoryVolume('music')).toBe(1); // clamped
  });

  it('a negative `$path` volume clamps to 0', async () => {
    const state = createAudioState();
    const kind = createAudio(state);
    const { rc } = runCtx({ duckLevel: -0.3 });
    await kind.run!(props({ category: 'sfx', volume: '$duckLevel' }), rc);
    expect(state.categoryVolume('sfx')).toBe(0);
  });

  it('a non-numeric volume reports and leaves by next without touching the category', async () => {
    const state = createAudioState();
    const kind = createAudio(state);
    const { rc } = runCtx();
    const result = await kind.run!(props({ category: 'music', volume: 'loud' }), rc);
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith('volume "loud" is not a number');
    expect(state.categoryVolume('music')).toBe(1); // untouched, still the default
  });

  it('an unknown category reports and leaves by next without touching state', async () => {
    const state = createAudioState();
    const kind = createAudio(state);
    const { rc } = runCtx();
    const result = await kind.run!(
      { category: 'voice' as AudioProps['category'], volume: '0.5', fade: 0 },
      rc,
    );
    expect(result).toEqual({ out: 'next' });
    expect(rc.report).toHaveBeenCalledWith("unknown category 'voice'");
    expect(state.categoryVolume('voice')).toBe(1); // never set
  });
});
