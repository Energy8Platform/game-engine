// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
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
  // Always return the module to a clean state — its overlay/preloader state is module-scoped.
  await removeCSSPreloader(container);
  vi.restoreAllMocks();
});

describe('an external loading overlay REPLACES the CSS preloader', () => {
  it('mounts no preloader DOM of its own and shows the overlay instead', () => {
    const overlay = spyOverlay();
    createCSSPreloader(container, { externalOverlay: overlay });

    // The whole point: exactly one overlay on screen. Ours must not appear under or over theirs.
    expect(document.getElementById(PRELOADER_ID)).toBeNull();
    expect(container.children.length).toBe(0);
    expect(overlay.calls).toEqual(['show']);
  });

  it('is idempotent — a second create does not show the overlay twice', () => {
    const overlay = spyOverlay();
    createCSSPreloader(container, { externalOverlay: overlay });
    // GameApplication calls createCSSPreloader twice on this path (once before the container is
    // resolved, once at the normal boot step). The second call must be a no-op.
    createCSSPreloader(container, { externalOverlay: overlay });
    expect(overlay.calls).toEqual(['show']);
  });

  it('routes the same progress the built-in bar would show, as a 0–100 percentage', () => {
    const overlay = spyOverlay();
    createCSSPreloader(container, { externalOverlay: overlay });

    setCSSPreloaderProgress(0);
    setCSSPreloaderProgress(0.42);
    setCSSPreloaderProgress(1);
    // Out-of-range and NaN are clamped exactly as the built-in path clamps them.
    setCSSPreloaderProgress(1.5);
    setCSSPreloaderProgress(-1);
    setCSSPreloaderProgress(Number.NaN);

    expect(overlay.calls).toEqual([
      'show',
      'progress:0',
      'progress:42',
      'progress:100',
      'progress:100',
      'progress:0',
      'progress:0',
    ]);
  });

  it('does not gate on a tap — an overlay we do not own has nothing to tap', async () => {
    const overlay = spyOverlay();
    // tapToStart defaults to TRUE for the built-in preloader; on this path it must not hang a boot.
    createCSSPreloader(container, { externalOverlay: overlay, tapToStart: true });
    await expect(waitCSSPreloaderTap()).resolves.toBeUndefined();
  });

  it('hides on removal, once, and ignores progress afterwards', async () => {
    const overlay = spyOverlay();
    createCSSPreloader(container, { externalOverlay: overlay });
    setCSSPreloaderProgress(0.5);

    await removeCSSPreloader(container);
    // LoadingScene.onDestroy removes it defensively a second time; the boot-error path can too.
    await removeCSSPreloader(container);
    setCSSPreloaderProgress(0.9);

    expect(overlay.calls).toEqual(['show', 'progress:50', 'hide']);
  });

  it('leaves the built-in preloader untouched when no overlay is supplied', () => {
    createCSSPreloader(container, {});
    expect(document.getElementById(PRELOADER_ID)).not.toBeNull();
  });
});

describe('a throwing overlay cannot break the boot or strand itself on screen', () => {
  it('swallows a throw from showLoader and still hides on teardown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overlay = spyOverlay({ showLoader: true });

    expect(() => createCSSPreloader(container, { externalOverlay: overlay })).not.toThrow();
    expect(warn).toHaveBeenCalled();

    // The failure must not have de-registered the overlay: teardown (the boot-error path in
    // GameApplication) still has to reach hideLoader, or the loader sits there forever.
    await removeCSSPreloader(container);
    expect(overlay.calls).toEqual(['show', 'hide']);
  });

  it('swallows a throw from updateProgress — progress is cosmetic, loading is not', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overlay = spyOverlay({ updateProgress: true });
    createCSSPreloader(container, { externalOverlay: overlay });
    expect(() => setCSSPreloaderProgress(0.3)).not.toThrow();
  });

  it('swallows a throw from hideLoader so teardown always completes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overlay = spyOverlay({ hideLoader: true });
    createCSSPreloader(container, { externalOverlay: overlay });
    await expect(removeCSSPreloader(container)).resolves.toBeUndefined();
  });
});
