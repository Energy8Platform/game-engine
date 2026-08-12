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

  it('reports boot progress as a 0–100 percentage, clamped and monotonic', () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);

    advanceExternalOverlay(0.35);
    advanceExternalOverlay(0.7);
    advanceExternalOverlay(0.7); // repeated milestone: nothing to say
    advanceExternalOverlay(0.5); // a later step reporting less must not walk the bar backwards
    advanceExternalOverlay(2); // clamped
    advanceExternalOverlay(Number.NaN); // ignored, not turned into 0

    expect(overlay.calls).toEqual(['show', 'progress:35', 'progress:70', 'progress:100']);
  });

  /**
   * The trap this whole design has to clear: Artube's loader crossfades from its dark partner
   * phase to the green Artube-branded one on the FIRST progress above zero. A boot that reported
   * nothing would hand over while still on the partner phase, and the player would never see the
   * branding that is the reason for using their loader at all.
   */
  it('sends a non-zero first progress, so a two-phase loader reaches its branded phase', () => {
    const overlay = spyOverlay();
    adoptExternalOverlay(overlay);
    advanceExternalOverlay(0.35);

    const first = overlay.calls.find((c) => c.startsWith('progress:'));
    expect(first).toBeDefined();
    expect(Number(first!.slice('progress:'.length))).toBeGreaterThan(0);
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
