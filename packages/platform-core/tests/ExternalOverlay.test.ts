// @vitest-environment jsdom

/**
 * A game-supplied loading overlay (Artube's branded loader) covers the gap BEFORE the engine's own
 * loading screen exists, and is dismissed the moment that screen has painted. It is not a
 * replacement for the CSS preloader — an earlier design made it one, and this suite pins the
 * distinction, because the failure it prevents is invisible in code review: any leakage back into
 * `CSSPreloader.ts` silently changes what non-Artube games look like while they load.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  adoptExternalOverlay,
  advanceExternalOverlay,
  externalOverlayHold,
  releaseExternalOverlay,
  hasExternalOverlay,
  createCSSPreloader,
  removeCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
} from '../src/loading';
import type { ExternalLoadingOverlay } from '../src/types';

const PRELOADER_ID = '__ge-css-preloader__';

interface Spy extends ExternalLoadingOverlay {
  calls: string[];
}

function spyOverlay(throwOn: Partial<Record<keyof ExternalLoadingOverlay, boolean>> = {}): Spy {
  const calls: string[] = [];
  return {
    calls,
    showLoader() {
      calls.push('show');
      if (throwOn.showLoader) throw new Error('boom: show');
    },
    updateProgress(value: number) {
      calls.push(`progress:${value}`);
      if (throwOn.updateProgress) throw new Error('boom: progress');
    },
    hideLoader() {
      calls.push('hide');
      if (throwOn.hideLoader) throw new Error('boom: hide');
    },
  };
}

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  // Both modules hold singleton state — return them to a clean slate whatever the test did.
  releaseExternalOverlay();
  await removeCSSPreloader(container);
  vi.restoreAllMocks();
});

describe('adopting a game-supplied overlay', () => {
  it('shows it and takes ownership, without mounting any DOM of ours', () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);

    expect(hasExternalOverlay()).toBe(true);
    expect(overlay.calls).toEqual(['show']);
    // Their overlay is already on screen (Artube's comes from index.html). Ours must not appear
    // yet — the hand-over is what mounts it, one frame before theirs goes away.
    expect(document.getElementById(PRELOADER_ID)).toBeNull();
    expect(container.children.length).toBe(0);
  });

  it('is idempotent — a second adoption does not show it twice', () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);
    adoptExternalOverlay(overlay);
    expect(overlay.calls).toEqual(['show']);
  });

  it('ignores progress before adoption and after release', () => {
    advanceExternalOverlay(0.5); // nothing adopted — must not throw
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);
    releaseExternalOverlay();
    advanceExternalOverlay(0.9);
    expect(overlay.calls).toEqual(['show', 'hide']);
  });
});

describe('progress goes out as it arrives', () => {
  it('reports every milestone, monotonic and clamped, as a 0–100 percentage', () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);

    // The first non-zero value is what starts Artube's partner→branded crossfade. Sending it at
    // once is the whole reason their branded phase is ever seen; the floor below is what gives the
    // animation room to finish. (An earlier design delayed this by 800ms instead — see the
    // minimum-display suite for why that is now redundant.)
    advanceExternalOverlay(0.35);
    advanceExternalOverlay(0.7);
    advanceExternalOverlay(0.7); // repeated milestone: nothing to say
    advanceExternalOverlay(0.5); // a later step reporting less must not walk the bar backwards
    advanceExternalOverlay(2); // clamped
    advanceExternalOverlay(Number.NaN); // ignored, not turned into 0

    expect(overlay.calls).toEqual(['show', 'progress:35', 'progress:70', 'progress:100']);
  });
});

/**
 * The overlay's minimum time on screen — the fix for a partner's branding flashing past.
 *
 * Measured live before this existed: adopted at ~15ms, dismissed at ~844ms. Under a second, and
 * their two-phase screen never reached its second phase at all. `externalOverlayHold()` is what the
 * hand-over awaits before it mounts anything of ours, so their screen keeps the window whole.
 *
 * It also absorbs the problem the old 800ms reveal delay existed for. Artube's crossfade to the
 * branded phase runs 500ms and is triggered by the first progress above zero; live, it once started
 * at 375ms and was cut 39ms later, leaving a half-formed gradient and a bar that never filled. With
 * a floor of 1500ms a crossfade that starts at a boot milestone always has room — and if one
 * somehow starts late, the floor stretches to cover it rather than cutting it.
 */
describe('the overlay keeps the screen for a minimum time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Resolve-or-not, without hanging the test on a promise that is supposed to still be pending. */
  function settle(p: Promise<void>): { done: () => boolean } {
    let done = false;
    void p.then(() => {
      done = true;
    });
    return { done: () => done };
  }

  it('fills the bar before waiting — the boot is done, only the wait is left', async () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);
    advanceExternalOverlay(0.85); // the last boot milestone

    void externalOverlayHold();
    // Otherwise their bar is frozen at 85% for the whole hold and then the screen is taken away
    // with it still short. The fill runs INTO the window the hold guarantees.
    expect(overlay.calls).toEqual(['show', 'progress:85', 'progress:100']);
  });

  it('holds a fast hand-over back to the default 1500ms', async () => {
    adoptExternalOverlay(spyOverlay());

    vi.advanceTimersByTime(400); // a 400ms boot — the whole gap, live
    const hold = settle(externalOverlayHold());
    await vi.advanceTimersByTimeAsync(1000);
    expect(hold.done()).toBe(false); // 1400ms in
    await vi.advanceTimersByTimeAsync(100);
    expect(hold.done()).toBe(true); // 1500ms
  });

  it('takes the game’s own number when it has one', async () => {
    adoptExternalOverlay(spyOverlay(), 3000);
    const hold = settle(externalOverlayHold());
    await vi.advanceTimersByTimeAsync(1600);
    expect(hold.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1400);
    expect(hold.done()).toBe(true);
  });

  it('costs a slow boot nothing — the hand-over is already past the floor', async () => {
    adoptExternalOverlay(spyOverlay());
    vi.advanceTimersByTime(4000);
    const hold = settle(externalOverlayHold());
    await Promise.resolve();
    expect(hold.done()).toBe(true);
  });

  it('is not reached at all with no overlay adopted', async () => {
    const hold = settle(externalOverlayHold());
    await Promise.resolve();
    expect(hold.done()).toBe(true);
  });

  it('stretches so a crossfade that started late can still finish', async () => {
    adoptExternalOverlay(spyOverlay());
    // A boot slow enough that its first milestone lands near the floor: 1300 + 500 > 1500, so
    // dismissing at 1500 would cut the crossfade — exactly the artefact that was rejected.
    vi.advanceTimersByTime(1300);
    advanceExternalOverlay(0.35);

    const hold = settle(externalOverlayHold());
    await vi.advanceTimersByTimeAsync(200); // 1500ms: the plain minimum is up
    expect(hold.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(300); // 1800ms: 500ms after the crossfade started
    expect(hold.done()).toBe(true);
  });

  it('does not stretch for a crossfade with room to spare', async () => {
    adoptExternalOverlay(spyOverlay());
    vi.advanceTimersByTime(300);
    advanceExternalOverlay(0.35); // done by 800ms, well inside the floor
    const hold = settle(externalOverlayHold());
    await vi.advanceTimersByTimeAsync(1200);
    expect(hold.done()).toBe(true);
  });

  it('a release settles a pending hold at once — a failed boot waits for nothing', async () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);
    const hold = settle(externalOverlayHold());

    // The boot-error path (GameApplication.start's catch, createSlotGame's fatal). Courtesy time
    // for a partner's brand must never come between a player and an error they need to see.
    releaseExternalOverlay();
    await Promise.resolve();
    expect(hold.done()).toBe(true);
    expect(overlay.calls).toEqual(['show', 'hide']);

    // And nothing may fire late onto an overlay that is already gone.
    await vi.advanceTimersByTimeAsync(5000);
    expect(overlay.calls).toEqual(['show', 'hide']);
  });

  it('a fresh adoption gets a fresh floor', async () => {
    adoptExternalOverlay(spyOverlay());
    await vi.advanceTimersByTimeAsync(2000);
    releaseExternalOverlay();

    adoptExternalOverlay(spyOverlay());
    const hold = settle(externalOverlayHold());
    await vi.advanceTimersByTimeAsync(1400);
    // The previous overlay's time on screen is not this one's.
    expect(hold.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(hold.done()).toBe(true);
  });
});

describe('releasing it', () => {
  it('hides it once and reports who did it', () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);

    expect(releaseExternalOverlay()).toBe(true);
    // Called defensively from several places (LoadingScene's hand-over, the boot-error catch,
    // createSlotGame's fatal). Only the first may reach hideLoader.
    expect(releaseExternalOverlay()).toBe(false);
    expect(hasExternalOverlay()).toBe(false);
    expect(overlay.calls).toEqual(['show', 'hide']);
  });

  it('returns false when nothing was ever adopted — the pre-boot fatal path', () => {
    expect(releaseExternalOverlay()).toBe(false);
  });

  it('re-adoption after release starts a fresh progress run', () => {
    const first = spyOverlay();
    adoptExternalOverlay(first);
    advanceExternalOverlay(0.8);
    releaseExternalOverlay();

    const second = spyOverlay();
    adoptExternalOverlay(second);
    advanceExternalOverlay(0.1); // would be "backwards" against the previous run's 0.8
    expect(second.calls).toEqual(['show', 'progress:10']);
  });
});

describe('the built-in CSS preloader is untouched by any of this', () => {
  it('mounts, drives and gates exactly as it does with no overlay in sight', async () => {
    adoptExternalOverlay(spyOverlay());

    // This is the hand-over: the preloader mounts while their overlay is still adopted.
    createCSSPreloader(container, { tapToStart: false });
    expect(document.getElementById(PRELOADER_ID)).not.toBeNull();

    setCSSPreloaderProgress(0.5);
    // The tap gate still applies — the engine's loading screen is the one on screen now, and it
    // behaves the same on every platform. (tapToStart:false here so the brand floor is the only
    // gate and the test does not wait on a pointer event.)
    await expect(waitCSSPreloaderTap()).resolves.toBeUndefined();
  });

  it('sends the preloader progress to the preloader, never to the overlay', () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);
    createCSSPreloader(container, {});
    setCSSPreloaderProgress(0.5);
    // Asset-load progress belongs to OUR bar. The overlay's numbers are boot milestones only.
    expect(overlay.calls).toEqual(['show']);
  });

  it('removing the preloader does not dismiss the overlay (different lifetimes)', async () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);
    createCSSPreloader(container, {});
    await removeCSSPreloader(container);
    expect(overlay.calls).toEqual(['show']);
    expect(hasExternalOverlay()).toBe(true);
  });
});

describe('a throwing overlay cannot break the boot or strand itself on screen', () => {
  it('swallows a throw from showLoader and still hides on teardown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overlay = spyOverlay({ showLoader: true });

    expect(() => adoptExternalOverlay(overlay)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    // The failure must not have de-registered it: teardown still has to reach hideLoader, or the
    // loader sits on screen forever.
    expect(releaseExternalOverlay()).toBe(true);
    expect(overlay.calls).toEqual(['show', 'hide']);
  });

  it('swallows a throw from updateProgress — progress is cosmetic, loading is not', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adoptExternalOverlay(spyOverlay({ updateProgress: true }));
    expect(() => advanceExternalOverlay(0.3)).not.toThrow();
  });

  it('swallows a throw from hideLoader so teardown always completes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adoptExternalOverlay(spyOverlay({ hideLoader: true }));
    expect(() => releaseExternalOverlay()).not.toThrow();
    expect(hasExternalOverlay()).toBe(false);
  });
});
