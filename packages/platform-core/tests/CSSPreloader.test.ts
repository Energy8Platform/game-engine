// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createCSSPreloader,
  removeCSSPreloader,
  setCSSPreloaderProgress,
} from '../src/loading';

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

  it('is a silent no-op when called before createCSSPreloader', () => {
    expect(() => setCSSPreloaderProgress(0.5)).not.toThrow();
  });
});
