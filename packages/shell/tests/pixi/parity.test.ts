import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, afterEach } from 'vitest';
import type { Application, Ticker } from 'pixi.js';
import { Container } from 'pixi.js';
import { createPixiShell, removePixiShell, type PixiShellConfig } from '@/ui/pixi/index';

// ── Minimal Application stub ──────────────────────────────────────────────────
// createPixiShell needs a Pixi Application; the renderer accesses .ticker, .screen,
// .stage, .renderer, and .canvas. We provide enough of a stub so mount() succeeds
// without real WebGL.
function makeStubApp(): Application {
  const ticker = { add() {}, remove() {} } as unknown as Ticker;
  const stage = new Container();
  // Minimal Pixi renderer stub: emit/on/off for resize events, render() no-op.
  const pixiRenderer = {
    on() {},
    off() {},
    render() {},
    width: 1200,
    height: 675,
  };
  const app = {
    ticker,
    stage,
    renderer: pixiRenderer,
    canvas: undefined,
    screen: { width: 1200, height: 675 },
  } as unknown as Application;
  return app;
}

function makeConfig(over: Partial<PixiShellConfig> = {}): PixiShellConfig {
  return {
    app: makeStubApp(),
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.5, 1, 2, 5],
    defaultBet: 1,
    currentBet: null,
    balance: 100,
    win: 0,
    mode: 'base',
    gameInfo: {},
    features: { turbo: 0, autoplay: false, buyBonus: false },
    ...over,
  } as PixiShellConfig;
}

afterEach(() => {
  removePixiShell();
});

describe('createPixiShell — PixiGameShell API-parity facade', () => {
  it('returns the same instance on repeated calls (singleton)', () => {
    const a = createPixiShell(makeConfig());
    const b = createPixiShell(makeConfig()); // second call — different config object
    expect(a).toBe(b);
  });

  it('exposes setVisible as a function', () => {
    const shell = createPixiShell(makeConfig());
    expect(typeof shell.setVisible).toBe('function');
  });

  it('setVisible(false) does not throw', () => {
    const shell = createPixiShell(makeConfig());
    expect(() => shell.setVisible(false)).not.toThrow();
  });

  it('setVisible(true) does not throw', () => {
    const shell = createPixiShell(makeConfig());
    shell.setVisible(false);
    expect(() => shell.setVisible(true)).not.toThrow();
  });

  it('exposes safeArea as an object with numeric top/right/bottom/left', () => {
    const shell = createPixiShell(makeConfig());
    const sa = shell.safeArea;
    expect(sa).toBeTypeOf('object');
    expect(typeof sa.top).toBe('number');
    expect(typeof sa.right).toBe('number');
    expect(typeof sa.bottom).toBe('number');
    expect(typeof sa.left).toBe('number');
  });

  it('safeArea.top / right / left are 0 (only bottom bar is reserved)', () => {
    const shell = createPixiShell(makeConfig());
    const sa = shell.safeArea;
    expect(sa.top).toBe(0);
    expect(sa.right).toBe(0);
    expect(sa.left).toBe(0);
  });

  it('exposes barHeight as a number', () => {
    const shell = createPixiShell(makeConfig());
    expect(typeof shell.barHeight).toBe('number');
  });

  it('safeArea.bottom === barHeight', () => {
    const shell = createPixiShell(makeConfig());
    expect(shell.safeArea.bottom).toBe(shell.barHeight);
  });

  it('is still a ShellController (has .on)', () => {
    const shell = createPixiShell(makeConfig());
    expect(typeof shell.on).toBe('function');
  });

  it('is still a ShellController (has .openReplay)', () => {
    const shell = createPixiShell(makeConfig());
    expect(typeof shell.openReplay).toBe('function');
  });

  it('removePixiShell causes the next createPixiShell to return a fresh instance', () => {
    const first = createPixiShell(makeConfig());
    removePixiShell();
    const second = createPixiShell(makeConfig());
    expect(first).not.toBe(second);
  });
});
