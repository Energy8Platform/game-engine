// @vitest-environment jsdom

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  LOADER_BAR_MAX_WIDTH,
  createCSSPreloader,
  removeCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
} from '../src/loading';
import { VARIANTS } from '../src/loading/variants';
import type { PreloaderVariantName } from '../src/loading/variants';
import { HELLBUDDHA_INTRO_MS, LOADER_BAR_MAX_WIDTH as HB_BAR_MAX_WIDTH } from '../src/loading/variants/hellbuddha';
import { BRAND_FLOOR_MS, SPLASH_DURATION_MS } from '../src/loading/splash';
import { ENERGY8_INTRO_MS } from '../src/loading/variants/energy8';

describe('preloader variant registry', () => {
  it('exposes the energy8 variant as a registered key', () => {
    expect(Object.keys(VARIANTS)).toContain('energy8');
  });

  it('every registered variant implements the PreloaderVariant shape', () => {
    for (const variant of Object.values(VARIANTS)) {
      expect(typeof variant.buildContentHTML).toBe('function');
      expect(typeof variant.css).toBe('string');
      expect(typeof variant.mount).toBe('function');
    }
  });
});

describe('createCSSPreloader — variant selection', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('renders energy8 when preloaderVariant is "energy8" explicitly', () => {
    createCSSPreloader(container, { preloaderVariant: 'energy8' });
    expect(container.querySelector('#ge-pl-loader-rect')).not.toBeNull();
    expect(container.querySelector('#ge-pl-loader-text')).not.toBeNull();
  });

  it('defaults to energy8 when preloaderVariant is omitted', () => {
    createCSSPreloader(container);
    setCSSPreloaderProgress(0.5);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe(String(0.5 * LOADER_BAR_MAX_WIDTH));
  });

  it('falls back to energy8 for an unknown variant name', () => {
    createCSSPreloader(container, {
      preloaderVariant: 'does-not-exist' as PreloaderVariantName,
    });
    expect(container.querySelector('#ge-pl-loader-rect')).not.toBeNull();
  });
});

describe('energy8 variant', () => {
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

  it('groups the wordmark for the intro: the e, the letters between, then the 8 on top', () => {
    createCSSPreloader(container, { preloaderVariant: 'energy8' });
    const word = container.querySelector('.ge-e8-word')!;
    expect(word.querySelector('.ge-e8-e')).not.toBeNull();
    expect(word.querySelectorAll('.ge-e8-mid > path').length).toBe(5);
    expect(word.lastElementChild!.classList.contains('ge-e8-8')).toBe(true);
    expect(container.querySelector('#ge-pl-loader-rect')!.closest('.ge-e8-loader')).not.toBeNull();
  });

  it('paints a black screen regardless of the game background config', () => {
    createCSSPreloader(container, {
      preloaderVariant: 'energy8',
      backgroundColor: 0x123456,
      backgroundGradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 100%)',
    });
    const css = container.querySelector('style')!.textContent!;
    expect(css).toContain('background: #000;');
    expect(css).not.toContain('linear-gradient');
  });

  it('holds the brand gate until the splash and the logo intro have played, plus the brand floor', async () => {
    vi.useFakeTimers();
    createCSSPreloader(container, { preloaderVariant: 'energy8', tapToStart: false });
    let settled = false;
    void waitCSSPreloaderTap().then(() => {
      settled = true;
    });

    expect(ENERGY8_INTRO_MS).toBeGreaterThan(SPLASH_DURATION_MS);
    await vi.advanceTimersByTimeAsync(ENERGY8_INTRO_MS + BRAND_FLOOR_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});

describe('slottech variant', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('is a registered variant', () => {
    expect(Object.keys(VARIANTS)).toContain('slottech');
  });

  it('renders its own loader rect + text (not the energy8 ids)', () => {
    createCSSPreloader(container, { preloaderVariant: 'slottech' });
    expect(container.querySelector('#ge-st-loader-rect')).not.toBeNull();
    expect(container.querySelector('#ge-st-loader-text')).not.toBeNull();
    // energy8's ids must NOT be present
    expect(container.querySelector('#ge-pl-loader-rect')).toBeNull();
  });

  it('drives the loader rect width on progress (max width 841.89)', () => {
    createCSSPreloader(container, { preloaderVariant: 'slottech' });
    setCSSPreloaderProgress(0.5);
    const rect = container.querySelector('#ge-st-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe(String(0.5 * 841.89));
    expect(rect.classList.contains('driven')).toBe(true);
  });

  it('shows percentage text when showPercentage: true', () => {
    createCSSPreloader(container, {
      preloaderVariant: 'slottech',
      showPercentage: true,
    });
    setCSSPreloaderProgress(0.37);
    const text = container.querySelector('#ge-st-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('37%');
  });

  it('swaps to the tap label while waiting for tap', () => {
    createCSSPreloader(container, { preloaderVariant: 'slottech' });
    void waitCSSPreloaderTap();
    const text = container.querySelector('#ge-st-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('TAP TO START');
  });
});

describe('voidmoon variant', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('is a registered variant', () => {
    expect(Object.keys(VARIANTS)).toContain('voidmoon');
  });

  it('renders its own loader rect + text (not the energy8 ids)', () => {
    createCSSPreloader(container, { preloaderVariant: 'voidmoon' });
    expect(container.querySelector('#ge-vm-loader-rect')).not.toBeNull();
    expect(container.querySelector('#ge-vm-loader-text')).not.toBeNull();
    // energy8's ids must NOT be present
    expect(container.querySelector('#ge-pl-loader-rect')).toBeNull();
  });

  it('drives the loader rect width on progress (max width 519)', () => {
    createCSSPreloader(container, { preloaderVariant: 'voidmoon' });
    setCSSPreloaderProgress(0.5);
    const rect = container.querySelector('#ge-vm-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe(String(0.5 * 519));
    expect(rect.classList.contains('driven')).toBe(true);
  });

  it('shows percentage text when showPercentage: true', () => {
    createCSSPreloader(container, {
      preloaderVariant: 'voidmoon',
      showPercentage: true,
    });
    setCSSPreloaderProgress(0.37);
    const text = container.querySelector('#ge-vm-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('37%');
  });

  it('swaps to the tap label while waiting for tap', () => {
    createCSSPreloader(container, { preloaderVariant: 'voidmoon' });
    void waitCSSPreloaderTap();
    const text = container.querySelector('#ge-vm-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('TAP TO START');
  });
});

describe('hellbuddha variant', () => {
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

  it('is a registered variant', () => {
    expect(Object.keys(VARIANTS)).toContain('hellbuddha');
  });

  it('renders the animated lockup plus its own loader rect + text', () => {
    createCSSPreloader(container, { preloaderVariant: 'hellbuddha' });
    // The artwork: the buddha (dark silhouette + white detail) and all ten letters of the wordmark.
    expect(container.querySelector('.ge-hb .body .f')).not.toBeNull();
    expect(container.querySelectorAll('.ge-hb .body .dark').length).toBe(2);
    expect(container.querySelectorAll('.ge-hb .body .f > *').length).toBe(22);
    expect(container.querySelectorAll('.ge-hb .ltr').length).toBe(10);
    expect(container.querySelector('#ge-hb-loader-rect')).not.toBeNull();
    expect(container.querySelector('#ge-pl-loader-rect')).toBeNull();
    // The status text lives at the bottom of the screen, outside the lockup.
    const text = container.querySelector('#ge-hb-loader-text')!;
    expect(text.closest('svg')).toBeNull();
    expect(text.closest('.ge-hb-status')).not.toBeNull();
  });

  it('paints a black screen regardless of the game background config', () => {
    createCSSPreloader(container, {
      preloaderVariant: 'hellbuddha',
      backgroundGradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 100%)',
    });
    const css = container.querySelector('style')!.textContent!;
    expect(css).toContain('background: #000;');
    expect(css).not.toContain('linear-gradient');
  });

  it('keeps the bar outside the artwork group so the 8s one-shot rule cannot freeze it', () => {
    createCSSPreloader(container, { preloaderVariant: 'hellbuddha' });
    const rect = container.querySelector('#ge-hb-loader-rect')!;
    expect(rect.closest('.ge-hb')).toBeNull();
    expect(rect.closest('.ge-hb-loader')).not.toBeNull();
  });

  it('drives the loader rect width on progress, up to the bar\'s full width', () => {
    createCSSPreloader(container, { preloaderVariant: 'hellbuddha' });
    setCSSPreloaderProgress(0.5);
    const rect = container.querySelector('#ge-hb-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe(String(0.5 * HB_BAR_MAX_WIDTH));
    expect(rect.classList.contains('driven')).toBe(true);
  });

  it('shows percentage text when showPercentage: true', () => {
    createCSSPreloader(container, {
      preloaderVariant: 'hellbuddha',
      showPercentage: true,
    });
    setCSSPreloaderProgress(0.37);
    const text = container.querySelector('#ge-hb-loader-text') as HTMLElement;
    expect(text.textContent).toBe('37%');
  });

  it('swaps to the tap label while waiting for tap', () => {
    createCSSPreloader(container, { preloaderVariant: 'hellbuddha' });
    void waitCSSPreloaderTap();
    const text = container.querySelector('#ge-hb-loader-text') as HTMLElement;
    expect(text.textContent).toBe('TAP TO START');
  });

  it('holds the brand gate until its 8s intro has played, plus the brand floor', async () => {
    vi.useFakeTimers();
    createCSSPreloader(container, { preloaderVariant: 'hellbuddha', tapToStart: false });
    let settled = false;
    void waitCSSPreloaderTap().then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(HELLBUDDHA_INTRO_MS + BRAND_FLOOR_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});
