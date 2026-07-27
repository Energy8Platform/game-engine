// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createCSSPreloader,
  removeCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
} from '../src/loading';
import { BRAND_FLOOR_MS, SPLASH_DURATION_MS } from '../src/loading/splash';

/** Fast-forward past the powered-by splash + brand floor that gates every start. */
const BRAND_GATE_MS = SPLASH_DURATION_MS + BRAND_FLOOR_MS;

/**
 * Run `fn` on fake timers, always restoring real ones — `afterEach` tears the
 * preloader down through a real 600ms timeout and would hang otherwise.
 */
async function withFakeTimers(fn: () => Promise<void>): Promise<void> {
  vi.useFakeTimers();
  try {
    await fn();
  } finally {
    vi.useRealTimers();
  }
}

// This describe block MUST come first in the file so that module-scoped `state`
// is genuinely null — no prior test has called createCSSPreloader yet.
describe('setCSSPreloaderProgress — no-op pre-create', () => {
  it('is a silent no-op when called before createCSSPreloader', () => {
    expect(() => setCSSPreloaderProgress(0.5)).not.toThrow();
  });
});

describe('waitCSSPreloaderTap (no-op pre-create)', () => {
  it('throws when called before createCSSPreloader', () => {
    expect(() => waitCSSPreloaderTap()).toThrow(
      /CSS preloader not initialized/,
    );
  });
});

describe('CSSPreloader smoke', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('mounts the preloader overlay into the container', () => {
    createCSSPreloader(container);
    expect(document.getElementById('__ge-css-preloader__')).toBeTruthy();
  });

  it('exposes a rect with id ge-pl-loader-rect and a text with id ge-pl-loader-text', () => {
    createCSSPreloader(container);
    const rect = container.querySelector('#ge-pl-loader-rect');
    const text = container.querySelector('#ge-pl-loader-text');
    expect(rect).not.toBeNull();
    expect(text).not.toBeNull();
    expect(rect!.tagName.toLowerCase()).toBe('rect');
    expect(text!.tagName.toLowerCase()).toBe('text');
  });
});

describe('setCSSPreloaderProgress', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('updates the rect width to progress * LOADER_BAR_MAX_WIDTH (174)', () => {
    createCSSPreloader(container);
    setCSSPreloaderProgress(0.5);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe(String(0.5 * 174));
  });

  it('adds .driven class to the rect on first progress update', () => {
    createCSSPreloader(container);
    setCSSPreloaderProgress(0.1);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.classList.contains('driven')).toBe(true);
  });

  it('updates percentage text when showPercentage: true', () => {
    createCSSPreloader(container, { showPercentage: true });
    setCSSPreloaderProgress(0.42);
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('42%');
  });

  it('does NOT update text when showPercentage is unset (default false)', () => {
    createCSSPreloader(container);
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    const before = text.textContent;
    setCSSPreloaderProgress(0.42);
    expect(text.textContent).toBe(before);
  });

  it('clamps progress to [0, 1]', () => {
    createCSSPreloader(container);
    setCSSPreloaderProgress(1.5);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe('174');

    setCSSPreloaderProgress(-0.5);
    expect(rect.getAttribute('width')).toBe('0');
  });

  it('treats NaN as 0', () => {
    createCSSPreloader(container);
    setCSSPreloaderProgress(0.5);
    setCSSPreloaderProgress(Number.NaN);
    const rect = container.querySelector('#ge-pl-loader-rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe('0');
  });
});

describe('waitCSSPreloaderTap (skip path)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('resolves once the brand gate elapses when config.tapToStart === false', async () => {
    await withFakeTimers(async () => {
      createCSSPreloader(container, { tapToStart: false });
      const tap = waitCSSPreloaderTap();
      await vi.advanceTimersByTimeAsync(BRAND_GATE_MS);
      await expect(tap).resolves.toBeUndefined();
    });
  });

  it('does NOT resolve while the powered-by splash is still playing', async () => {
    await withFakeTimers(async () => {
      createCSSPreloader(container, { tapToStart: false });
      let settled = false;
      void waitCSSPreloaderTap().then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(SPLASH_DURATION_MS - 1);
      expect(settled).toBe(false);
    });
  });

  it('keeps driving progress behind the gate (bar is not frozen)', async () => {
    await withFakeTimers(async () => {
      createCSSPreloader(container, { tapToStart: false, showPercentage: true });
      void waitCSSPreloaderTap();
      setCSSPreloaderProgress(0.6);
      const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
      expect(text.textContent).toBe('60%');
    });
  });
});

describe('waitCSSPreloaderTap (active path)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('swaps text to default "TAP TO START" while waiting', () => {
    createCSSPreloader(container);
    void waitCSSPreloaderTap();
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('TAP TO START');
    expect(text.classList.contains('ge-svg-pulse')).toBe(true);
  });

  it('honors a custom tapToStartText', () => {
    createCSSPreloader(container, { tapToStartText: 'PLAY' });
    void waitCSSPreloaderTap();
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('PLAY');
  });

  it('sets cursor: pointer on the overlay while waiting', () => {
    createCSSPreloader(container);
    void waitCSSPreloaderTap();
    const overlay = document.getElementById('__ge-css-preloader__') as HTMLDivElement;
    expect(overlay.style.cursor).toBe('pointer');
  });

  it('resolves when a pointerdown is dispatched on the overlay', async () => {
    await withFakeTimers(async () => {
      createCSSPreloader(container);
      const tap = waitCSSPreloaderTap();

      const overlay = document.getElementById('__ge-css-preloader__') as HTMLDivElement;
      overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      await vi.advanceTimersByTimeAsync(BRAND_GATE_MS);
      await expect(tap).resolves.toBeUndefined();
    });
  });

  it('an early tap still waits out the brand gate', async () => {
    await withFakeTimers(async () => {
      createCSSPreloader(container);
      let settled = false;
      void waitCSSPreloaderTap().then(() => {
        settled = true;
      });

      const overlay = document.getElementById('__ge-css-preloader__') as HTMLDivElement;
      overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      await vi.advanceTimersByTimeAsync(BRAND_GATE_MS - 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    });
  });

  it('returns the same Promise on subsequent calls (memoized)', () => {
    createCSSPreloader(container);
    const a = waitCSSPreloaderTap();
    const b = waitCSSPreloaderTap();
    expect(a).toBe(b);
  });

  it('ignores setCSSPreloaderProgress while waiting (text stays as tap label)', () => {
    createCSSPreloader(container, { showPercentage: true });
    setCSSPreloaderProgress(0.3);
    void waitCSSPreloaderTap();
    setCSSPreloaderProgress(0.9);
    const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('TAP TO START');
  });

  it('ignores setCSSPreloaderProgress after tap resolved (text stays as tap label)', async () => {
    await withFakeTimers(async () => {
      createCSSPreloader(container, { showPercentage: true });
      const tap = waitCSSPreloaderTap();
      const overlay = document.getElementById('__ge-css-preloader__') as HTMLDivElement;
      overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(BRAND_GATE_MS);
      await tap;

      setCSSPreloaderProgress(0.9);
      const text = container.querySelector('#ge-pl-loader-text') as SVGTextElement;
      expect(text.textContent).toBe('TAP TO START');
    });
  });
});

describe('removeCSSPreloader', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('returns a Promise that resolves after the overlay is removed', async () => {
    createCSSPreloader(container);
    const result = removeCSSPreloader(container);
    expect(result).toBeInstanceOf(Promise);

    // jsdom does not fire transitionend automatically — use the
    // safety-timeout path. The Promise must still resolve.
    await result;

    expect(document.getElementById('__ge-css-preloader__')).toBeNull();
  });

  it('is idempotent — second call resolves without throwing', async () => {
    createCSSPreloader(container);
    await removeCSSPreloader(container);
    await expect(removeCSSPreloader(container)).resolves.toBeUndefined();
  });

  it('resolves a pending waitCSSPreloaderTap before fading', async () => {
    createCSSPreloader(container);
    const tap = waitCSSPreloaderTap();
    const removed = removeCSSPreloader(container);

    // The tap Promise resolves first (synchronously inside removeCSSPreloader),
    // then the fade-out completes and removed resolves.
    await expect(tap).resolves.toBeUndefined();
    await expect(removed).resolves.toBeUndefined();
    expect(document.getElementById('__ge-css-preloader__')).toBeNull();
  });

  it('setCSSPreloaderProgress after remove is a silent no-op', async () => {
    createCSSPreloader(container);
    await removeCSSPreloader(container);
    expect(() => setCSSPreloaderProgress(0.5)).not.toThrow();
  });
});

describe('CSSPreloader container position handling', () => {
  let styleEl: HTMLStyleElement;

  afterEach(() => {
    styleEl?.remove();
  });

  it('makes a STATIC container relative so the absolute overlay has a positioned ancestor', async () => {
    const container = document.createElement('div'); // no positioning → computed `static`
    document.body.appendChild(container);
    createCSSPreloader(container);
    expect(container.style.position).toBe('relative');
    await removeCSSPreloader(container);
    container.remove();
  });

  it('does NOT override a container positioned via a stylesheet rule (regression: #game { position: fixed })', async () => {
    // The game host sets `#game { position: fixed; inset: 0 }` from a stylesheet, so the inline
    // style is empty. The preloader must NOT write inline `position: relative` — that would beat
    // the fixed rule and collapse #game to content height, so the height:100% overlay can't fill
    // the screen. It must read the COMPUTED position (fixed) and leave the container alone.
    styleEl = document.createElement('style');
    styleEl.textContent = '#game-host { position: fixed; inset: 0; }';
    document.head.appendChild(styleEl);
    const container = document.createElement('div');
    container.id = 'game-host';
    document.body.appendChild(container);

    expect(getComputedStyle(container).position).toBe('fixed'); // precondition
    createCSSPreloader(container);
    expect(container.style.position).toBe(''); // inline untouched → stylesheet `fixed` still wins

    await removeCSSPreloader(container);
    expect(container.style.position).toBe(''); // still untouched after removal
    container.remove();
  });

  it('restores the prior inline position on removal', async () => {
    const container = document.createElement('div');
    container.style.position = 'static'; // explicit inline, computed `static` → overridden
    document.body.appendChild(container);
    createCSSPreloader(container);
    expect(container.style.position).toBe('relative');
    await removeCSSPreloader(container);
    expect(container.style.position).toBe('static'); // prior inline restored
    container.remove();
  });
});
