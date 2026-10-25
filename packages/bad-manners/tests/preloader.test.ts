import { describe, it, expect, afterEach } from 'vitest';
import { createCSSPreloader, removeCSSPreloader, setCSSPreloaderProgress } from '@energy8platform/platform-core/loading';
import { badMannersPreloader } from '../src/preloader';
import { LAYERS, MIN_MS } from '../src/preloader/intro';

describe('badMannersPreloader', () => {
  let container: HTMLElement;
  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('mounts every intro layer, skips the powered-by splash, and drives the underline from the load', () => {
    container = document.body.appendChild(document.createElement('div'));
    createCSSPreloader(container, { preloaderVariant: badMannersPreloader });
    for (const id of Object.keys(LAYERS)) expect(container.querySelector(`[data-bm-layer="${id}"]`)).not.toBeNull();
    expect(container.querySelector('.ge-splash')).toBeNull();
    expect(container.querySelector('[data-bm-layer="face"] svg')).not.toBeNull();
    // no WAAPI in jsdom: the final lockup, underline at 70% until the load passes it, never backwards
    const bar = container.querySelector<HTMLElement>('[data-bm-layer="progress"]')!;
    expect(bar.style.width).toBe(`${LAYERS.progress.w * 0.7}px`);
    setCSSPreloaderProgress(0.9);
    expect(bar.style.width).toBe(`${LAYERS.progress.w * 0.9}px`);
    setCSSPreloaderProgress(0.5);
    expect(bar.style.width).toBe(`${LAYERS.progress.w * 0.9}px`);
  });

  it('holds the brand gate for the intro', () => {
    container = document.body.appendChild(document.createElement('div'));
    expect(badMannersPreloader.introMs).toBeGreaterThanOrEqual(1000);
    expect(badMannersPreloader.introMs).toBeLessThanOrEqual(MIN_MS);
  });
});
