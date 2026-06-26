// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createCSSPreloader,
  removeCSSPreloader,
} from '@energy8platform/platform-core/loading';
import { LoadingScene } from '../src/loading/LoadingScene';

/**
 * Option B: LoadingScene no longer renders its own overlay. The CSS preloader
 * created at boot stays alive, and LoadingScene drives it (progress + tap +
 * removal). These tests stand in for the boot by creating the preloader first.
 */
function makeContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  return container;
}

describe('LoadingScene drives the shared CSS preloader (no clone overlay)', () => {
  let container: HTMLElement;

  afterEach(async () => {
    await removeCSSPreloader(container);
    document.getElementById('__ge-loading-overlay__')?.remove();
    container?.remove();
  });

  it('updateLoaderBar drives the existing preloader, not a second overlay', () => {
    container = makeContainer();
    createCSSPreloader(container, {
      preloaderVariant: 'voidmoon',
      showPercentage: true,
    });

    const scene = new LoadingScene();
    Object.assign(scene as unknown as Record<string, unknown>, {
      _config: {},
      _engine: { app: { canvas: container.querySelector('canvas') } },
    });

    (scene as any).updateLoaderBar(0.5);

    const rects = container.querySelectorAll('#ge-vm-loader-rect');
    expect(rects.length).toBe(1); // only the shared preloader — no clone
    // Drove the shared preloader to a non-zero fill (exact px is a
    // platform-core detail — don't couple the test to its bar width).
    expect(Number(rects[0].getAttribute('width'))).toBeGreaterThan(0);

    const text = container.querySelector('#ge-vm-loader-text') as SVGTextElement;
    expect(text.textContent).toBe('50%');
  });

  it('does NOT create its own __ge-loading-overlay__', async () => {
    container = makeContainer();
    createCSSPreloader(container, { preloaderVariant: 'voidmoon', tapToStart: false });

    let gotoArgs: { scene: string; data: any } | null = null;
    const engine = {
      config: { loading: { tapToStart: false, minDisplayTime: 0 }, manifest: { bundles: [] } },
      assets: {
        init: async () => {},
        getBundleNames: () => [] as string[],
        isBundleLoaded: () => false,
        loadBundle: async () => {},
        loadBundles: async () => {},
      },
      audio: { init: async () => {} },
      app: { canvas: container.querySelector('canvas') },
      scenes: { goto: async (scene: string, data: any) => { gotoArgs = { scene, data }; } },
    };

    const scene = new LoadingScene();
    await scene.onEnter({ engine, targetScene: 'game', targetData: { lvl: 2 } });

    // Transitioned to the target scene, forwarding engine + data
    expect(gotoArgs!.scene).toBe('game');
    expect(gotoArgs!.data.engine).toBe(engine);
    expect(gotoArgs!.data.lvl).toBe(2);

    // No clone overlay was ever created, and the shared preloader is gone
    expect(container.querySelector('#__ge-loading-overlay__')).toBeNull();
    expect(container.querySelector('#ge-vm-loader-rect')).toBeNull();
  });
});
