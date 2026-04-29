// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCSSPreloader, removeCSSPreloader } from '../src/loading';

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
