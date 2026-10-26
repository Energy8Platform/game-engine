import { describe, it, expect, afterEach } from 'vitest';
import { createCSSPreloader, removeCSSPreloader, setCSSPreloaderProgress } from '@energy8platform/platform-core/loading';
import { dogmaticPreloader } from '../src/preloader';

describe('dogmaticPreloader', () => {
  let container: HTMLElement;
  afterEach(async () => {
    await removeCSSPreloader(container);
    container.remove();
  });

  it('mounts the collar / wordmark / loading layers, skips the powered-by splash, and follows the load', () => {
    container = document.body.appendChild(document.createElement('div'));
    createCSSPreloader(container, { preloaderVariant: dogmaticPreloader });
    for (const sel of ['.dl-body', '.dl-tag', '.dl-wordmark', '.dl-track', '.dl-percent']) expect(container.querySelector(sel), sel).not.toBeNull();
    expect(container.querySelector('.ge-splash')).toBeNull();
    expect(container.querySelector('img')).toBeNull(); // no URL is ever fetched
    const fill = container.querySelector<HTMLElement>('.dl-fill')!;
    const label = container.querySelector<HTMLElement>('.dl-percent')!;
    setCSSPreloaderProgress(0.42);
    expect(fill.style.width).toBe('42%');
    expect(label.textContent).toBe('42%');
    setCSSPreloaderProgress(0.1);
    expect(fill.style.width).toBe('42%');
  });
});
