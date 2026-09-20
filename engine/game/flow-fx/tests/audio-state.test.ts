import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * A `requestAnimationFrame` modelled on the real one's SHAPE — a queue
 * drained one generation at a time, where a callback that schedules another
 * frame runs on the NEXT drain and a `cancelAnimationFrame` aimed at the
 * frame currently executing finds nothing left to cancel (it was dequeued
 * before it ran). That last detail is the whole point: it is what made the
 * old `rafClock` leak, and no subscription-shaped fake can express it.
 *
 * Installed over the globals so the REAL `rafClock` (the default clock of a
 * `createAudioState()` built with no deps) is what runs — `performance.now`
 * too, so ramp time is this test's to advance.
 */
function rafHarness(): { frame(ms?: number): void; ticks(): number; pending(): number } {
  let time = 0;
  let id = 0;
  let queue = new Map<number, () => void>();
  let ticks = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    queue.set((id += 1), fn);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => queue.delete(handle));
  vi.stubGlobal('performance', { now: () => time });
  return {
    frame(ms = 16) {
      time += ms;
      const due = [...queue.values()];
      queue = new Map();
      for (const fn of due) {
        ticks += 1;
        fn();
      }
    },
    ticks: () => ticks,
    pending: () => queue.size,
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
  describe('the rAF clock stops when the ramp it drives ends', () => {
    // A ramp that LANDS cancels itself from inside its own tick. The frame
    // executing right then can no longer be cancelled, so a loop that
    // rescheduled unconditionally re-armed itself one last time — forever,
    // and out of reach of `dispose()`. One leaked chain per completed fade.
    afterEach(() => vi.unstubAllGlobals());

    it('a completed ramp schedules no further frames — and none after dispose() either', () => {
      const { frame, ticks, pending } = rafHarness();
      const state = createAudioState(); // no deps: the real `rafClock`
      const instance: LiveInstance = { volume: 0 };
      let done = 0;
      state.ramp(instance, 0, 1, 100, () => (done += 1));
      for (let i = 0; i < 10 && done === 0; i += 1) frame(20);
      expect(done).toBe(1);
      expect(instance.volume).toBe(1);

      const landed = ticks();
      expect(pending()).toBe(0); // nothing re-armed on the frame that finished it
      frame();
      frame();
      frame();
      expect(ticks()).toBe(landed); // the loop is gone, not merely quiet
      state.dispose();
      frame();
      expect(ticks()).toBe(landed);
    });

    it('dispose() mid-ramp stops the loop too', () => {
      const { frame, ticks, pending } = rafHarness();
      const state = createAudioState();
      const instance: LiveInstance = { volume: 0 };
      state.ramp(instance, 0, 1, 1000);
      frame(100);
      expect(instance.volume).toBeCloseTo(0.1);
      state.dispose();
      expect(pending()).toBe(0);
      const stopped = ticks();
      frame(100);
      expect(ticks()).toBe(stopped);
      expect(instance.volume).toBeCloseTo(0.1); // no longer written to
    });
  });

  it('dispose() forgets tracked instances: a later setCategory reaches nothing', () => {
    const { clock, advance, size } = fakeClock();
    const state = createAudioState({ clock });
    const instance: LiveInstance = { volume: 1 };
    state.track('music', 1, instance);
    state.dispose();
    state.setCategory('music', 0.25, 100);
    expect(size()).toBe(0); // no ramp started — the set is empty
    advance(100);
    expect(instance.volume).toBe(1);
  });
});
