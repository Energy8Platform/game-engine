import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import { createPixiSShell, removePixiSShell, type PixiShellConfig } from '@/ui/pixi-s';

const stubTicker = { add() {}, remove() {} };

function fakeApp(w: number, h: number): Application {
  return {
    screen: { width: w, height: h },
    ticker: stubTicker,
    renderer: { on() {}, off() {} },
    stage: new Container(),
  } as unknown as Application;
}

function config(app: Application): PixiShellConfig {
  return {
    app,
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.5, 1, 2],
    defaultBet: 1,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    gameInfo: { sections: [] },
    features: { turbo: 2, autoplay: {}, buyBonus: [] },
  } as PixiShellConfig;
}

// The fade-out tween never ticks on the stub ticker, so don't await — `active` clears synchronously.
afterEach(() => {
  void removePixiSShell();
});

describe('createPixiSShell', () => {
  it('desktop: the columns reserve the sides, not a bottom strip', () => {
    const shell = createPixiSShell(config(fakeApp(1280, 720)));
    expect(shell.safeArea.left).toBeGreaterThan(100);
    expect(shell.safeArea.right).toBeGreaterThan(100);
    expect(shell.safeArea.bottom).toBe(0);
    expect(shell.barHeight).toBe(0);
  });

  it('portrait: one bottom block; barHeight is its height', () => {
    const shell = createPixiSShell(config(fakeApp(390, 844)));
    expect(shell.safeArea.left).toBe(0);
    expect(shell.safeArea.right).toBe(0);
    expect(shell.safeArea.bottom).toBeGreaterThan(150);
    expect(shell.barHeight).toBe(shell.safeArea.bottom);
  });

  it('one active shell at a time', () => {
    const a = createPixiSShell(config(fakeApp(1280, 720)));
    expect(createPixiSShell(config(fakeApp(1280, 720)))).toBe(a);
  });
});
