import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import { PixiHbRenderer, type HbBar } from '@/ui/pixi-hb/PixiHbRenderer';
import { ShellController } from '@/core/ShellController';

const stubTicker = { add() {}, remove() {} };

/** Minimal Application stub exposing only what the renderer's mount + resize touch. */
function fakeApp(w: number, h: number): Application {
  return {
    screen: { width: w, height: h },
    ticker: stubTicker,
    renderer: { on() {}, off() {} },
    stage: new Container(),
  } as unknown as Application;
}

function fakeBar(): HbBar {
  const bar = new Container() as HbBar;
  Object.assign(bar, {
    applyFit() {},
    menuAnchor: () => null,
    menuPlate: () => null,
    fitScale: () => 1,
    safeArea: () => ({ top: 0, right: 120, bottom: 0, left: 80 }),
  });
  return bar;
}

function mount(renderer: PixiHbRenderer): ShellController {
  return new ShellController({
    renderer,
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2],
    defaultBet: 1,
    currentBet: null,
    balance: 100,
    win: 0,
    mode: 'base',
    gameInfo: { sections: [] },
    features: { turbo: 0, autoplay: false, buyBonus: false },
  });
}

describe('PixiHbRenderer — pluggable bar', () => {
  it('builds the injected bar and reports its safe area; barHeight is its bottom inset', () => {
    let built = 0;
    const r = new PixiHbRenderer({
      app: fakeApp(1200, 675),
      parent: new Container(),
      bar: () => {
        built++;
        return fakeBar();
      },
    });
    mount(r);
    expect(built).toBeGreaterThan(0);
    expect(r.safeArea).toEqual({ top: 0, right: 120, bottom: 0, left: 80 });
    expect(r.barHeight).toBe(0);
  });

  it('defaults to the HB bottom bar: bottom-only inset equal to barHeight', () => {
    const r = new PixiHbRenderer({ app: fakeApp(1200, 675), parent: new Container() });
    mount(r);
    expect(r.safeArea.left).toBe(0);
    expect(r.safeArea.right).toBe(0);
    expect(r.barHeight).toBeGreaterThan(0);
    expect(r.safeArea.bottom).toBe(r.barHeight);
  });
});
