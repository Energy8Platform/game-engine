// @vitest-environment jsdom

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  LOADER_BAR_MAX_WIDTH,
  createCSSPreloader,
  removeCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
} from '../src/loading';
import { VARIANTS } from '../src/loading/variants';
import type { PreloaderVariantName } from '../src/loading/variants';

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
