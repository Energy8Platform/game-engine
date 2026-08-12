// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GameApplication } from '../src/core/GameApplication';
import type { ExternalLoadingOverlay } from '../src/types';

/**
 * A game may hand the engine its own loading overlay (`loading.externalOverlay`) — Artube's
 * `LoaderViewController` is the reason the seam exists. Two properties matter at THIS level (the
 * routing itself is platform-core's, tested there):
 *
 *  1. the overlay is adopted before anything in `start()` can throw, and
 *  2. a boot failure hides it — the same guarantee the CSS preloader already had in the catch.
 *
 * Property 2 is sharper here than for the built-in preloader: an external overlay is ALREADY on
 * screen when the engine starts (Artube's is injected into index.html), so failing to hide it
 * leaves a dead loading screen up forever rather than merely never showing one.
 */
function spyOverlay(): ExternalLoadingOverlay & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    showLoader: () => void calls.push('show'),
    updateProgress: (v: number) => void calls.push(`progress:${v}`),
    hideLoader: () => void calls.push('hide'),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GameApplication + a game-supplied loading overlay', () => {
  it('adopts and hides it even when the boot fails before the container resolves', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const overlay = spyOverlay();
    // A container selector that matches nothing: `resolveContainer()` throws at the very first
    // step, before PixiJS is touched. If the overlay were only adopted after that, nothing could
    // take it down.
    const game = new GameApplication({
      container: '#does-not-exist',
      loading: { externalOverlay: overlay },
    });

    await expect(game.start('game')).rejects.toThrow(/not found/);
    expect(overlay.calls).toEqual(['show', 'hide']);
  });

  it('mounts no CSS preloader of its own on that path', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const game = new GameApplication({
      container: '#does-not-exist',
      loading: { externalOverlay: spyOverlay() },
    });

    await expect(game.start('game')).rejects.toThrow();
    expect(document.getElementById('__ge-css-preloader__')).toBeNull();
  });
});
