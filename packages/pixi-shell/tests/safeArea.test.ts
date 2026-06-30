import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import type { Ticker } from 'pixi.js';
import type { ShellHost } from '../src/context';
import { resolveTheme } from '../src/theme';
import { createInitialState } from '../src/state';
import { BottomBar, WIDE_BAR_H, MOBILE_BAR_H } from '../src/components/BottomBar';

const tokens = resolveTheme({});
const stubTicker = { add() {}, remove() {} } as unknown as Ticker;

function makeHost(over: Partial<ShellHost> = {}): ShellHost {
  const config: any = {
    app: {} as never,
    theme: {},
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.5, 1, 2, 5],
    defaultBet: 1,
    currentBet: null,
    balance: 100,
    win: 0,
    mode: 'base',
    features: { turbo: 0, autoplay: false, buyBonus: false },
  };
  const state = createInitialState(config);
  const noop = () => {};
  return {
    tokens,
    ticker: stubTicker,
    canvas: undefined,
    config,
    state,
    layout: 'wide',
    screenW: 1200,
    screenH: 675,
    t: (s) => s,
    fmt: (n) => `€${n.toFixed(2)}`,
    fmtWin: (n) => `€${n.toFixed(2)}`,
    emit: noop as never,
    render: noop,
    pushLayer: (node) => ({ root: node, close: noop }),
    closeLayer: noop,
    fitModals: noop,
    openMenu: noop,
    openSettings: noop,
    openInfo: noop,
    openBuyBonus: noop,
    openBetPicker: noop,
    openAutoplayPicker: noop,
    openReplay: noop,
    openModal: noop,
    activateFeature: noop,
    deactivateFeature: noop,
    ...over,
  };
}

describe('BottomBar.height — safeArea source of truth', () => {
  it('returns WIDE_BAR_H (92) in wide layout', () => {
    const host = makeHost({ layout: 'wide', screenW: 1200, screenH: 675 });
    const bar = new BottomBar(host);
    expect(bar.height).toBe(WIDE_BAR_H);
    expect(bar.height).toBe(92);
  });

  it('returns MOBILE_BAR_H (142) in mobile layout', () => {
    const host = makeHost({ layout: 'mobile', screenW: 375, screenH: 667 });
    const bar = new BottomBar(host);
    expect(bar.height).toBe(MOBILE_BAR_H);
    expect(bar.height).toBe(142);
  });

  it('height tracks the layout set on host', () => {
    const host = makeHost({ layout: 'wide', screenW: 1200, screenH: 675 });
    const wideBar = new BottomBar(host);
    expect(wideBar.height).toBe(WIDE_BAR_H);

    // Switching layout produces a different height
    host.layout = 'mobile';
    // BottomBar reads host.layout at call time — same instance reflects the new layout
    expect(wideBar.height).toBe(MOBILE_BAR_H);
  });

  it('safeArea.bottom === barHeight for wide', () => {
    const host = makeHost({ layout: 'wide', screenW: 1200, screenH: 675 });
    const bar = new BottomBar(host);
    // Simulate what PixiGameShell.safeArea does:
    const barHeight = bar.height;
    const safeArea = { top: 0, right: 0, bottom: barHeight, left: 0 };
    expect(safeArea.bottom).toBe(bar.height);
    expect(safeArea.top).toBe(0);
    expect(safeArea.left).toBe(0);
    expect(safeArea.right).toBe(0);
  });

  it('safeArea.bottom === barHeight for mobile', () => {
    const host = makeHost({ layout: 'mobile', screenW: 375, screenH: 667 });
    const bar = new BottomBar(host);
    const barHeight = bar.height;
    const safeArea = { top: 0, right: 0, bottom: barHeight, left: 0 };
    expect(safeArea.bottom).toBe(bar.height);
  });

  // The bar fit-scales with the SCREEN in every mode, so on a popout it's SHORTER than the nominal
  // reserve — and `height` reports that real (smaller) footprint, never overlapping the reels and not
  // wasting space. (Regression for the earlier bug where replay stayed full-size on Popout S.)
  it('reports the scaled-down footprint on a short popout (replay, Popout S)', () => {
    const host = makeHost({ layout: 'wide', screenW: 400, screenH: 225 });
    host.state.mode = 'replay';
    host.state.replay = true;
    host.state.win = 12.3; // a win → the WIN pill renders too
    const bar = new BottomBar(host);
    bar.applyFit();
    const occupied = host.screenH - bar.getBounds().y;
    expect(occupied, 'bar fit-scales down on a short popout').toBeLessThan(WIDE_BAR_H);
    expect(bar.height, 'reserve == the bar\'s actual footprint').toBeCloseTo(occupied, 0);
  });

  it('base and replay get the SAME bar scale on a popout (no resize on mode switch)', () => {
    const mk = (mode: 'base' | 'replay') => {
      const host = makeHost({ layout: 'wide', screenW: 400, screenH: 225 });
      host.state.mode = mode;
      if (mode === 'replay') host.state.replay = true;
      const bar = new BottomBar(host);
      bar.applyFit();
      return (bar as unknown as { inner: { scale: { x: number } } }).inner.scale.x;
    };
    expect(mk('base'), 'base/replay share one screen-size scale').toBeCloseTo(mk('replay'), 3);
  });
});
