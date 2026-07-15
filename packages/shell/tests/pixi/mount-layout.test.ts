import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import { PixiRenderer } from '@/ui/pixi/PixiRenderer';
import { ShellController } from '@/core/ShellController';

/**
 * Regression: the pixi shell must SEED its layout from the current screen size at mount — it can't
 * wait for a 'resize' event, because the renderer was already sized to the container during boot
 * (ViewportManager.refresh) BEFORE the shell subscribed, so on a stationary device that event never
 * arrives. Without the seed a portrait mobile showed the DESKTOP bar (layout stuck at its 'wide'
 * default). The HTML renderer got this for free via ResizeObserver-fires-on-observe.
 */

const stubTicker = { add() {}, remove() {} };

/** Minimal Application stub exposing only what PixiRenderer.mount + notifyResize touch. */
function fakeApp(w: number, h: number): Application {
  return {
    screen: { width: w, height: h },
    ticker: stubTicker,
    renderer: { on() {}, off() {} },
    stage: new Container(),
  } as unknown as Application;
}

function mountShell(w: number, h: number): ShellController {
  const renderer = new PixiRenderer({ app: fakeApp(w, h), parent: new Container() });
  return new ShellController({
    renderer,
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.2, 0.5, 1, 2, 5],
    defaultBet: 1,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    gameInfo: { sections: [] },
    features: { turbo: 3, autoplay: {}, buyBonus: [] },
  });
}

describe('pixi shell seeds layout at mount (no resize event needed)', () => {
  it('portrait screen → mobile layout, not the wide default', () => {
    const c = mountShell(400, 800);
    expect(c.layout).toBe('mobile');
  });

  it('landscape screen → wide layout', () => {
    const c = mountShell(1200, 675);
    expect(c.layout).toBe('wide');
  });
});
