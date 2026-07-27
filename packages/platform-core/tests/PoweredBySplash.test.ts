// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LOADER_BAR_MAX_WIDTH,
  createCSSPreloader,
  removeCSSPreloader,
  setCSSPreloaderProgress,
} from '../src/loading';
import { SPLASH_CLASS, SPLASH_DURATION_MS } from '../src/loading/splash';

const OVERLAY_ID = '__ge-css-preloader__';

function splash(container: HTMLElement): Element | null {
  return container.querySelector(`.${SPLASH_CLASS}`);
}

describe('powered-by splash', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await removeCSSPreloader(container);
    container.remove();
  });

  it('mounts over the preloader on the very first frame', () => {
    createCSSPreloader(container);
    expect(splash(container)).not.toBeNull();
  });

  it('carries the Energy8 attribution artwork', () => {
    createCSSPreloader(container);
    const title = splash(container)!.querySelector('title');
    expect(title?.textContent).toBe('Powered by Energy8 Engine');
  });

  it('is the last child of the overlay so it paints above the variant', () => {
    createCSSPreloader(container);
    const overlay = document.getElementById(OVERLAY_ID)!;
    expect(overlay.lastElementChild).toBe(splash(container));
  });

  it('plays for every variant, not just one', () => {
    createCSSPreloader(container, { preloaderVariant: 'slottech' });
    expect(splash(container)).not.toBeNull();
    expect(container.querySelector('#ge-st-loader-rect')).not.toBeNull();
  });

  it('plays over custom preloader HTML too (it is not opt-out)', () => {
    createCSSPreloader(container, { cssPreloaderHTML: '<p id="mine">hi</p>' });
    expect(container.querySelector('#mine')).not.toBeNull();
    expect(splash(container)).not.toBeNull();
  });

  it('detaches itself once its timeline has played out', async () => {
    vi.useFakeTimers();
    createCSSPreloader(container);
    expect(splash(container)).not.toBeNull();

    await vi.advanceTimersByTimeAsync(SPLASH_DURATION_MS);
    expect(splash(container)).toBeNull();
    // The overlay it lived in must survive — only the layer goes.
    expect(document.getElementById(OVERLAY_ID)).not.toBeNull();
  });

  it('leaves the variant mounted underneath, so progress is never lost', () => {
    createCSSPreloader(container);
    // Still inside the splash window — the bar must already be drivable.
    setCSSPreloaderProgress(0.5);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe(String(0.5 * LOADER_BAR_MAX_WIDTH));
  });

  it('is torn down with the overlay when removed mid-splash', async () => {
    createCSSPreloader(container);
    await removeCSSPreloader(container);
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
    expect(splash(container)).toBeNull();
  });

  it('does not strand a detach timer past teardown', async () => {
    vi.useFakeTimers();
    createCSSPreloader(container);
    const removed = removeCSSPreloader(container);

    // Well past both the overlay's fade fallback and the splash's own detach
    // point: a timer that outlived teardown would fire somewhere in here.
    await vi.advanceTimersByTimeAsync(SPLASH_DURATION_MS * 2);

    await expect(removed).resolves.toBeUndefined();
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
  });
});
