/**
 * Shared per-row audio state: each category's current volume (the "mix
 * bus" `audio` nodes duck — `sfx`/`music`), the set of currently-playing
 * instances per category (so a category change can ramp every one of them
 * live), and the `clock` every ramp is driven by. `runtime.ts` creates ONE
 * `AudioState` per row and hands the SAME object to `createSound` and
 * `createAudio`, so a `sound` node's plays and an `audio` node's category
 * change see each other.
 *
 * `clock` is injectable (`requestAnimationFrame` + `performance.now` by
 * default) so tests can step ramps by hand instead of waiting on real
 * frames — see `tests/sound.test.ts`/`tests/audio.test.ts`'s `fakeClock()`.
 */

export interface Clock {
  now(): number;
  /** Calls `fn` every frame until the returned canceller is called. */
  tick(fn: () => void): () => void;
}

/** The little a ramp needs from a playing instance: a settable volume, and (optionally) a way to hear it end. */
export interface LiveInstance {
  volume: number;
  on?(event: 'end' | 'stop', fn: () => void): void;
}

const rafClock: Clock = {
  now: () => performance.now(),
  tick(fn) {
    let raf = requestAnimationFrame(function loop() {
      fn();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  },
};

interface Live {
  category: string;
  /** This instance's own per-play volume (pre-category-multiply) — what a category ramp re-multiplies by the new category volume. */
  base: number;
  instance: LiveInstance;
}

interface RampEntry {
  stop: () => void;
  onDone?: () => void;
}

export interface AudioStateDeps {
  clock?: Clock;
}

export interface AudioState {
  clock: Clock;
  /** A category's current volume; 1 for one nothing has ever set. */
  categoryVolume(category: string): number;
  /**
   * Registers a live instance under a category, so a later `setCategory`
   * ramps it too. Auto-removed on the instance's own `end`/`stop` (real
   * `@pixi/sound` fires both — 'end' on natural completion, 'stop' on a
   * manual one); the returned remover lets the caller untrack it early.
   */
  track(category: string, base: number, instance: LiveInstance): () => void;
  /**
   * Ramps `instance.volume` from `from` to `to` over `ms`, calling
   * `onDone` once it lands (at once, synchronously, when `ms <= 0`). A
   * second ramp started on the SAME instance before the first finishes
   * cancels it first — one clock loop fighting another over the same
   * `.volume` would leave it at whichever ticked last.
   */
  ramp(instance: LiveInstance, from: number, to: number, ms: number, onDone?: () => void): () => void;
  /** Sets a category's volume, ramping every live instance in it to `base × volume` over `fade` ms; a later play reads the new value via `categoryVolume`. */
  setCategory(category: string, volume: number, fade: number): void;
  /** Cancels every in-flight ramp (row teardown) without firing their `onDone`. */
  dispose(): void;
}

export function createAudioState(deps: AudioStateDeps = {}): AudioState {
  const clock = deps.clock ?? rafClock;
  const categories: Record<string, number> = {};
  const live = new Set<Live>();
  // One entry per instance CURRENTLY being ramped — starting a new ramp on
  // an instance already in here cancels the old one first (see `ramp`'s doc).
  const ramps = new Map<LiveInstance, RampEntry>();

  function cancelRamp(instance: LiveInstance, ran: boolean): void {
    const entry = ramps.get(instance);
    if (!entry) return;
    ramps.delete(instance);
    entry.stop();
    if (ran) entry.onDone?.();
  }

  function ramp(
    instance: LiveInstance,
    from: number,
    to: number,
    ms: number,
    onDone?: () => void,
  ): () => void {
    cancelRamp(instance, false);
    if (ms <= 0) {
      instance.volume = to;
      onDone?.();
      return () => {};
    }
    instance.volume = from;
    const start = clock.now();
    const stop = clock.tick(() => {
      const t = Math.min(1, (clock.now() - start) / ms);
      instance.volume = from + (to - from) * t;
      if (t >= 1) cancelRamp(instance, true);
    });
    ramps.set(instance, { stop, onDone });
    return () => cancelRamp(instance, false);
  }

  return {
    clock,
    categoryVolume: (category) => categories[category] ?? 1,
    track(category, base, instance) {
      const entry: Live = { category, base, instance };
      live.add(entry);
      const remove = () => live.delete(entry);
      instance.on?.('end', remove);
      instance.on?.('stop', remove);
      return remove;
    },
    ramp,
    setCategory(category, volume, fade) {
      categories[category] = volume;
      for (const entry of live) {
        if (entry.category !== category) continue;
        ramp(entry.instance, entry.instance.volume, entry.base * volume, fade);
      }
    },
    dispose() {
      for (const instance of [...ramps.keys()]) cancelRamp(instance, false);
    },
  };
}
