import { describe, expect, it } from 'vitest';
import { createAudioState, type Clock, type LiveInstance } from '../src/audio-state';

/**
 * Manual `Clock`: `now()` reads a counter this test drives with
 * `advance(ms)`, which also fires every registered `tick` callback once —
 * standing in for one animation frame `ms` long, deterministically.
 * `size()` exposes how many `tick` subscribers are currently live, so a
 * test can prove a cancelled ramp actually released its frame callback and
 * isn't just coincidentally quiet.
 */
function fakeClock(): { clock: Clock; advance(ms: number): void; size(): number } {
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
    size: () => fns.size,
  };
}

describe('createAudioState', () => {
  describe('track()’s remove cancels a ramp still targeting the same instance', () => {
    // A dead/pooled instance must stop being written to — pixi pools
    // instances on `'end'`/`'stop'` (`Sound._pool`), so a ramp left running
    // past that point can land on a DIFFERENT, later, unrelated sound the
    // pool hands the same object back to.

    it('a hard stop (untrack, no fade) mid-ramp cancels it: volume stops changing, the clock tick is released', () => {
      const { clock, advance, size } = fakeClock();
      const state = createAudioState({ clock });
      const stopListeners = new Set<() => void>();
      const instance: LiveInstance = {
        volume: 0,
        on: (event, fn) => {
          if (event === 'stop') stopListeners.add(fn);
        },
      };
      const untrack = state.track('sfx', 1, instance);
      state.ramp(instance, 0, 1, 1000);
      expect(size()).toBe(1);
      advance(500);
      expect(instance.volume).toBeCloseTo(0.5); // the ramp is live
      // `sound.ts`'s `action: 'stop'` with `fade: 0` calls `entry.untrack()`
      // (this same closure) unconditionally, THEN the real stop.
      untrack();
      expect(size()).toBe(0); // the ramp's frame callback is gone
      advance(500); // would have finished the ramp to 1 were it still live
      expect(instance.volume).toBeCloseTo(0.5); // unchanged — no longer ramping
    });

    it("the instance ending naturally mid-ramp (its own 'end') cancels the ramp the same way", () => {
      const { clock, advance, size } = fakeClock();
      const state = createAudioState({ clock });
      const endListeners = new Set<() => void>();
      const instance: LiveInstance = {
        volume: 0,
        on: (event, fn) => {
          if (event === 'end') endListeners.add(fn);
        },
      };
      state.track('sfx', 1, instance);
      state.ramp(instance, 0, 1, 1000);
      advance(500);
      expect(instance.volume).toBeCloseTo(0.5); // the ramp is live
      expect(size()).toBe(1);
      // The instance's own natural completion — real `@pixi/sound` fires
      // this itself; nothing here calls `untrack()` directly.
      endListeners.forEach((fn) => fn());
      expect(size()).toBe(0); // the ramp's frame callback is gone
      advance(500);
      expect(instance.volume).toBeCloseTo(0.5); // unchanged — no longer ramping
    });

    it('is idempotent: removing an already-untracked instance, or one with no ramp running, is a quiet no-op', () => {
      const { clock, size } = fakeClock();
      const state = createAudioState({ clock });
      const instance: LiveInstance = { volume: 1 };
      const untrack = state.track('sfx', 1, instance); // never ramped
      expect(() => untrack()).not.toThrow();
      expect(() => untrack()).not.toThrow(); // a second removal of the same entry
      expect(size()).toBe(0);
    });
  });
});
