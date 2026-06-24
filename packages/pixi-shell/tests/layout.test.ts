import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { Container, Text, Ticker } from 'pixi.js';
import type { ShellHost } from '../src/context';
import { resolveTheme } from '../src/theme';
import { createInitialState } from '../src/state';
import { IconButton, Readout, SpinDisc, BuyBonusBadge } from '../src/primitives/widgets';
import { BottomBar } from '../src/components/BottomBar';
import { openSettings } from '../src/components/Settings';
import { openGameInfo } from '../src/components/GameInfo';
import { openBuyBonus } from '../src/components/BuyBonus';
import { openBetPicker, openAutoplayPicker } from '../src/components/pickers';
import { buildReplayModal } from '../src/components/ReplayModal';

const tokens = resolveTheme({});
const stubTicker = { add() {}, remove() {} } as unknown as Ticker;

function baseConfig(over: Record<string, unknown> = {}): any {
  return {
    app: {} as never,
    theme: {},
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.2, 0.5, 1, 2, 5],
    defaultBet: 1,
    currentBet: null,
    balance: 1234.5,
    win: 12.3,
    mode: 'base',
    gameInfo: {
      sections: [
        { type: 'modes', modes: [{ title: 'Base game', price: '1× bet', rtp: 96.5, maxWin: '5000×', description: 'Match left to right.' }] },
        { type: 'controls' },
        { type: 'paytable', rows: [{ symbol: { text: 'Wild' }, wins: [{ count: '5', multiplier: 250 }] }] },
        { type: 'wins', kind: 'classic', grid: { cols: 5, rows: 3 }, lines: [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0]] },
        { type: 'wins', kind: 'cluster', grid: { cols: 6, rows: 5 }, minCount: 5, description: 'Cluster pays.' },
        { type: 'wins', kind: 'ways', grid: { cols: 5, rows: 4 }, description: '1024 ways.' },
        { type: 'wins', kind: 'shapes', grid: { cols: 5, rows: 3 }, shapes: [{ name: 'V', cells: [[0, 0], [2, 2], [4, 0]], description: 'V shape.' }] },
        { type: 'custom', title: 'Rules', html: '<p>All wins ×bet.</p>' },
      ],
    },
    features: {
      turbo: 3,
      autoplay: {},
      buyBonus: [
        { id: 'ante', type: 'feature', title: 'Ante Bet', description: '+25% triggers', priceMultiplier: 1.25, volatility: 2 },
        { id: 'fs', type: 'bonus', title: 'Free Spins', description: '10 free spins', priceMultiplier: 100, volatility: 5 },
      ],
    },
    ...over,
  };
}

function makeHost(over: Partial<ShellHost> & { config?: any } = {}): ShellHost {
  const config = over.config ?? baseConfig();
  const state = createInitialState(config);
  const noop = () => {};
  const host: ShellHost = {
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
  return host;
}

/** A node's bounds must be finite and within the screen box (allowing a small epsilon). */
function expectWithinScreen(node: Container, w: number, h: number, label: string): void {
  const b = node.getLocalBounds();
  expect(Number.isFinite(b.x), `${label} x finite`).toBe(true);
  expect(Number.isFinite(b.width), `${label} w finite`).toBe(true);
  expect(b.width, `${label} width <= screen`).toBeLessThanOrEqual(w + 1.5);
  expect(b.height, `${label} height <= screen`).toBeLessThanOrEqual(h + 1.5);
}

describe('text shim', () => {
  it('measures Pixi Text (width + height > 0)', () => {
    const t = new Text({ text: 'Balance', style: { fontFamily: 'Inter', fontSize: 13 } });
    expect(t.width).toBeGreaterThan(0);
    expect(t.height).toBeGreaterThan(0);
  });
});

describe('widget centering — icons & text stay put', () => {
  it('IconButton centres its glyph in the box', () => {
    const btn = new IconButton('menu', { color: '#fff', hover: '#f00', size: 40, glyph: 24 });
    expect(btn.measureSize()).toEqual({ w: 40, h: 40 });
    // the IconView child sits at (box-glyph)/2 = 8
    const icon = btn.children.find((c) => c !== undefined)!;
    expect(icon.position.x).toBeCloseTo(8, 3);
    expect(icon.position.y).toBeCloseTo(8, 3);
  });

  it('SpinDisc centres the spin glyph and reports its size', () => {
    const disc = new SpinDisc({ size: 86, glyph: 68, tokens, ticker: stubTicker, onSpin() {}, onStop() {} });
    expect(disc.measureSize()).toEqual({ w: 86, h: 86 });
    const glyph = disc.children[1]; // [disc bg, glyph]
    expect(glyph.position.x).toBeCloseTo((86 - 68) / 2, 3);
    expect(glyph.position.y).toBeCloseTo((86 - 68) / 2, 3);
  });

  it('Readout stacks value under label, both at x≥0', () => {
    const r = new Readout({ label: 'Balance', value: '€1.234,50', muted: '#999', fg: '#fff' });
    const sz = r.measureSize();
    expect(sz.w).toBeGreaterThan(0);
    expect(sz.h).toBeGreaterThan(0);
    expect(r.valueText.position.y).toBeGreaterThan(r.children[0].position.y); // value below label
    expect(r.valueText.position.x).toBeGreaterThanOrEqual(0);
  });

  it('BuyBonusBadge centres its label inside the disc', () => {
    const badge = new BuyBonusBadge({ size: 80, fontSize: 13, bg: '#8b5cf6', label: 'BUY\nBONUS', tokens, ticker: stubTicker, onTap() {} });
    expect(badge.measureSize()).toEqual({ w: 80, h: 80 });
    const b = badge.getLocalBounds();
    // glow ring may extend slightly; the label/disc stay within ~the badge box
    expect(b.width).toBeLessThanOrEqual(80 + 12);
    expect(b.height).toBeLessThanOrEqual(80 + 12);
  });
});

describe('BottomBar — fits the screen across presets', () => {
  const presets: Array<[string, number, number, 'wide' | 'mobile']> = [
    ['desktop', 1200, 675, 'wide'],
    ['laptop', 1024, 576, 'wide'],
    ['popout-l', 800, 450, 'wide'],
    ['narrow-landscape', 560, 360, 'wide'], // forces fit-scale
    ['mobile-m', 375, 667, 'mobile'],
    ['mobile-s', 320, 568, 'mobile'],
  ];
  for (const [name, w, h, layout] of presets) {
    it(`${name} (${w}×${h}) keeps the bar within the viewport`, () => {
      const host = makeHost({ screenW: w, screenH: h, layout });
      const bar = new BottomBar(host);
      bar.applyFit();
      expectWithinScreen(bar, w, h, `bar/${name}`);
    });
  }

  it('fit-scale engages when the landscape bar overflows', () => {
    const wide = makeHost({ screenW: 1200, screenH: 675 });
    const wbar = new BottomBar(wide);
    wbar.applyFit();
    const wideScale = (wbar as unknown as { inner: Container }).inner.scale.x;

    const narrow = makeHost({ screenW: 520, screenH: 340 }); // too narrow for the full row
    const nbar = new BottomBar(narrow);
    nbar.applyFit();
    const narrowScale = (nbar as unknown as { inner: Container }).inner.scale.x;

    expect(wideScale).toBeCloseTo(1, 3); // roomy desktop → no shrink
    expect(narrowScale).toBeLessThan(1); // overflow → scaled down to fit
    expect(narrowScale).toBeGreaterThan(0.2); // but not collapsed
  });

  it('free-spins / replay zones never overlap (left cluster vs right cluster)', () => {
    // Regression: the FS left cluster (balance + FS counter + total win) collided with the right
    // cluster because the right zone was pinned to the screen edge instead of packed in flow.
    for (const [mode, w] of [['freeSpins', 800], ['freeSpins', 560], ['replay', 800]] as const) {
      const host = makeHost({ screenW: w, screenH: 450 });
      host.state.mode = mode;
      if (mode === 'replay') host.state.replay = true;
      host.state.freeSpins = { current: 3, total: 10, totalWin: 42 };
      const bar = new BottomBar(host);
      bar.applyFit();
      const zones = bar as unknown as { leftZone?: Container; rightZone?: Container };
      if (zones.leftZone && zones.rightZone) {
        const l = zones.leftZone.getBounds();
        const r = zones.rightZone.getBounds();
        // left cluster's right edge must not cross the right cluster's left edge
        expect(l.x + l.width, `${mode}@${w}: left/right overlap`).toBeLessThanOrEqual(r.x + 1);
      }
    }
  });

  it('replay hides the balance readout', () => {
    const host = makeHost({ screenW: 1200, screenH: 675 });
    host.state.replay = true;
    const bar = new BottomBar(host);
    bar.applyFit();
    expect((bar as unknown as { balanceValue?: unknown }).balanceValue).toBeUndefined();
  });

  it('mobile stack scales to fit a narrow phone', () => {
    const host = makeHost({ screenW: 320, screenH: 568, layout: 'mobile' });
    const bar = new BottomBar(host);
    bar.applyFit();
    const scale = (bar as unknown as { inner: Container }).inner.scale.x;
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(1);
    expectWithinScreen(bar, 320, 568, 'bar/mobile-fit');
  });

  it('free-spins mode builds and fits (FS + total-win plaques)', () => {
    const host = makeHost({ screenW: 1200, screenH: 675 });
    host.state.mode = 'freeSpins';
    host.state.freeSpins = { current: 3, total: 10, totalWin: 42 };
    const bar = new BottomBar(host);
    bar.applyFit();
    expectWithinScreen(bar, 1200, 675, 'bar/freeSpins');
  });

  it('active feature (Ante) tints bet + flips BUY BONUS without overflow', () => {
    const host = makeHost({ screenW: 1024, screenH: 576 });
    host.state.activeFeature = host.config.features.buyBonus[0];
    const bar = new BottomBar(host);
    bar.applyFit();
    expectWithinScreen(bar, 1024, 576, 'bar/feature');
  });
});

describe('overlays & modals — content stays within the screen', () => {
  const sizes: Array<[string, number, number]> = [
    ['desktop', 1200, 675],
    ['popout-l', 800, 450],
    ['mobile-m', 375, 667],
  ];
  for (const [name, w, h] of sizes) {
    it(`Settings overlay fits ${name}`, () => {
      const host = makeHost({ screenW: w, screenH: h });
      const ov = openSettings(host);
      ov.resize?.(w, h);
      expectWithinScreen(ov, w, h, `settings/${name}`);
    });
    it(`Game info overlay fits ${name}`, () => {
      const host = makeHost({ screenW: w, screenH: h });
      const ov = openGameInfo(host);
      ov.resize?.(w, h);
      expectWithinScreen(ov, w, h, `gameinfo/${name}`);
    });
    it(`Buy-bonus overlay fits ${name}`, () => {
      const host = makeHost({ screenW: w, screenH: h, layout: w < 500 ? 'mobile' : 'wide' });
      const ov = openBuyBonus(host)!;
      ov.resize?.(w, h);
      expectWithinScreen(ov, w, h, `buybonus/${name}`);
    });
    it(`Bet & autoplay pickers fit ${name}`, () => {
      const host = makeHost({ screenW: w, screenH: h });
      const bet = openBetPicker(host);
      bet.resize?.(w, h);
      expectWithinScreen(bet, w, h, `betpicker/${name}`);
      const auto = openAutoplayPicker(host);
      auto.resize?.(w, h);
      expectWithinScreen(auto, w, h, `autopicker/${name}`);
    });
    it(`Replay modal fits ${name}`, () => {
      const host = makeHost({ screenW: w, screenH: h });
      const modal = buildReplayModal(host, { bonusId: 'fs', bet: 1, payoutMultiplier: 87.5, onReplay() {} });
      modal.resize?.(w, h);
      expectWithinScreen(modal, w, h, `replay/${name}`);
    });
  }
});
