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
});
