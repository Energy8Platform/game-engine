import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import type { Container, Graphics } from 'pixi.js';
import type { IconView } from '@/ui/pixi-hb/pixi-icon';
import { SideBar, OUTER, SAFE_GAP } from '@/ui/pixi-s/SideBar';
import type { SButton, SBet, SSpin, SFsCounter, SReadout } from '@/ui/pixi-s/widgets';
import { sIcon } from '@/ui/pixi-s/icons';
import { S } from '@/ui/pixi-s/theme';
import type { PixiComponentContext } from '@/ui/pixi/context';
import { makeContext, defaultConfig } from '../pixi/_host';

interface Parts {
  leftCol: Container;
  rightCol: Container;
  block: Container;
  menuBtn: SButton;
  totalWin?: SReadout;
  win: SReadout;
  balance?: SReadout;
  buy?: SButton;
  bet: SBet;
  spin?: SSpin;
  fs?: SFsCounter;
  autoTab?: SButton;
  turboTab?: SButton;
}
const parts = (b: SideBar) => b as unknown as Parts;

type Box = { x: number; y: number; r: number; b: number };
const box = (n: Container): Box => {
  const k = n.getBounds();
  return { x: k.x, y: k.y, r: k.x + k.width, b: k.y + k.height };
};

const FULL = { features: { turbo: 2, autoplay: {}, buyBonus: [] } };

function host(w: number, h: number, cfg: Record<string, unknown> = FULL, over: Record<string, unknown> = {}): PixiComponentContext {
  return makeContext({ config: defaultConfig(cfg), layout: h > w ? 'mobile' : 'wide', screenW: w, screenH: h, ...over });
}

function build(ctx: PixiComponentContext): SideBar {
  const bar = new SideBar(ctx);
  bar.applyFit();
  return bar;
}

function expectOnScreen(bar: SideBar, w: number, h: number): void {
  for (const col of [parts(bar).leftCol, parts(bar).rightCol]) {
    const k = box(col);
    expect(k.x).toBeGreaterThanOrEqual(0);
    expect(k.y).toBeGreaterThanOrEqual(0);
    expect(k.r).toBeLessThanOrEqual(w);
    expect(k.b).toBeLessThanOrEqual(h);
  }
}

const ANTE = { id: 'ante', type: 'feature' as const, title: 'Warrior Ante', description: '', priceMultiplier: 1.25 };

describe('S side bar — wide', () => {
  it('two bottom-anchored columns at the screen edges; menu, win, balance top to bottom', () => {
    const p = parts(build(host(1280, 720)));
    expect(p.leftCol.x).toBe(OUTER);
    const r = box(p.rightCol);
    expect(r.r).toBeGreaterThan(1280 - OUTER - 1);
    expect(r.r).toBeLessThanOrEqual(1280 - OUTER + 3); // + the slab shadow
    for (const b of [box(p.balance!).b, r.b]) {
      expect(b).toBeGreaterThan(720 - OUTER - 1);
      expect(b).toBeLessThanOrEqual(720 - OUTER + 3);
    }
    expect(box(p.menuBtn).y).toBeLessThan(box(p.win).y);
    expect(box(p.win).y).toBeLessThan(box(p.balance!).y);
  });

  it('BUY sits above BET; the tabs tuck under SPIN from its left', () => {
    const bar = build(host(1280, 720));
    const { buy, bet, spin, autoTab, turboTab, rightCol } = parts(bar);
    expect(box(buy!).b).toBeLessThanOrEqual(box(bet).y + 3);
    expect(Math.abs(box(buy!).r - box(bet).r)).toBeLessThan(1);
    const s = box(spin!);
    const a = box(autoTab!);
    const t = box(turboTab!);
    expect(a.x).toBeLessThan(s.x);
    expect(a.r).toBeGreaterThan(s.x);
    expect(a.y).toBeGreaterThan(s.y);
    expect(t.y).toBeGreaterThan(a.y);
    expect(t.b).toBeLessThan(s.b);
    expect(rightCol.getChildIndex(autoTab!)).toBeLessThan(rightCol.getChildIndex(spin!)); // SPIN draws over
  });

  it('reserves the sides: the safe insets reach just past each column', () => {
    const bar = build(host(1280, 720));
    const l = box(parts(bar).leftCol);
    const r = box(parts(bar).rightCol);
    const sa = bar.safeArea();
    expect(sa.top).toBe(0);
    expect(sa.bottom).toBe(0);
    expect(sa.left).toBeGreaterThanOrEqual(l.r - 3);
    expect(sa.left).toBeLessThanOrEqual(l.r + SAFE_GAP);
    expect(1280 - sa.right).toBeLessThanOrEqual(r.x);
    expect(1280 - sa.right).toBeGreaterThanOrEqual(r.x - SAFE_GAP);
    // nothing in the right column pokes past its reserved edge — the tabs included
    expect(1280 - sa.right + SAFE_GAP).toBeLessThanOrEqual(box(parts(bar).autoTab!).x + 0.5);
  });

  it('menu popover: points at the burger, placed against the left column', () => {
    const bar = build(host(1280, 720));
    const plate = bar.menuPlate()!;
    const anchor = bar.menuAnchor()!;
    expect(plate.x).toBe(OUTER);
    expect(anchor.x).toBeGreaterThanOrEqual(plate.x);
    expect(anchor.y).toBeGreaterThanOrEqual(plate.y - 0.5);
    expect(anchor.y + anchor.h).toBeLessThanOrEqual(plate.y + plate.h + 3);
    expect(bar.fitScale()).toBe(1);
  });

  it('fits Stake popout S (400×225), a laptop (1024×576) and a landscape phone (844×390)', () => {
    for (const [w, h] of [[400, 225], [1024, 576], [844, 390]]) expectOnScreen(build(host(w, h)), w, h);
    expect(build(host(400, 225)).fitScale()).toBe(0.35);
  });

  it('a huge balance and a long feature title never make the columns overlap', () => {
    const ctx = host(1024, 576);
    ctx.state.balance = 10_000_000_000;
    ctx.state.activeFeature = ANTE;
    const sa = build(ctx).safeArea();
    expect(sa.left).toBeLessThan(1024 - sa.right);
  });
});

describe('S side bar — mobile', () => {
  it('BUY is SPIN-sized, bottom-left, level with SPIN', () => {
    const { buy, spin } = parts(build(host(390, 844)));
    expect(buy!.measureSize()).toEqual(spin!.measureSize());
    const b = box(buy!);
    const s = box(spin!);
    expect(b.r).toBeLessThan(s.x);
    expect(Math.abs(b.b - s.b)).toBeLessThan(1);
  });

  it('the block reserves the bottom: safeArea.bottom reaches its top edge', () => {
    const bar = build(host(390, 844));
    const k = box(parts(bar).block);
    const sa = bar.safeArea();
    expect(sa.left).toBe(0);
    expect(sa.right).toBe(0);
    expect(Math.abs(sa.bottom - (844 - k.y))).toBeLessThan(1);
    expect(k.b).toBeLessThanOrEqual(844);
    expect(k.x).toBeGreaterThanOrEqual(0);
    expect(k.r).toBeLessThanOrEqual(390);
  });

  it('a narrow phone with a huge balance: the block scales down to fit', () => {
    const ctx = host(320, 568);
    ctx.state.balance = 10_000_000_000;
    const bar = build(ctx);
    const k = box(parts(bar).block);
    expect(k.x).toBeGreaterThanOrEqual(0);
    expect(k.r).toBeLessThanOrEqual(320);
    expect(bar.fitScale()).toBeLessThan((320 - 20) / 370);
  });

  it('no buy-bonus configured: no BUY, and the columns still share the bottom line', () => {
    const p = parts(build(host(390, 844, { features: { turbo: 2, autoplay: {}, buyBonus: false } })));
    expect(p.buy).toBeUndefined();
    expect(Math.abs(box(p.balance!).b - box(p.spin!).b)).toBeLessThan(1);
  });
});

describe('S side bar — modes and controls', () => {
  it('free spins: the counter replaces SPIN, TOTAL WIN joins the left column, no BUY, no stepper', () => {
    const ctx = host(1280, 720);
    ctx.state.mode = 'freeSpins';
    ctx.state.freeSpins = { current: 3, total: 10, totalWin: 12 };
    const p = parts(build(ctx));
    expect(p.spin).toBeUndefined();
    expect(p.fs!.valueText.text).toBe('3 / 10');
    expect(p.totalWin!.valueText.text).toBe('€12.00');
    expect(p.buy).toBeUndefined();
    expect(p.bet.up).toBeUndefined();
  });

  it('replay without free spins: no balance, no hero, no tabs — and still on screen', () => {
    const ctx = host(1280, 720);
    ctx.state.mode = 'replay';
    ctx.state.replay = true;
    const bar = build(ctx);
    const p = parts(bar);
    expect(p.balance).toBeUndefined();
    expect(bar.balanceValue).toBeUndefined();
    expect(p.spin).toBeUndefined();
    expect(p.fs).toBeUndefined();
    expect(p.turboTab).toBeUndefined();
    expectOnScreen(bar, 1280, 720);
  });

  it('an active feature: red BUY with a cross, a locked stepper, the multiplied bet', () => {
    const ctx = host(1280, 720);
    ctx.state.activeFeature = ANTE;
    const p = parts(build(ctx));
    expect(p.buy!.face).toBe('red');
    expect((p.buy!.glyph as IconView).iconName).toBe('close');
    expect(p.bet.up!.disabled).toBe(true);
    expect(p.bet.down!.disabled).toBe(true);
    expect(p.bet.valueText.text).toBe('€1.25');
    expect(p.bet.labelText.text).toBe('WARRIOR ANTE');
  });

  it('autoplay running: a yellow tab with STOP and SPIN stops the run; halted: SPIN resumes with the count', () => {
    const run = host(1280, 720);
    run.state.autoplay = { active: true, remaining: 5 };
    const a = parts(build(run));
    expect(a.autoTab!.face).toBe('yellow');
    expect((a.autoTab!.glyph as IconView).iconName).toBe('stop');
    expect(a.spin!.mode).toBe('stop');
    expect(a.spin!.count).toBe('5');
    const halt = host(1280, 720);
    halt.state.autoplay = { active: false, remaining: 4 };
    const h = parts(build(halt));
    expect(h.spin!.mode).toBe('resume');
    expect(h.spin!.count).toBe('4');
  });

  it('the turbo level picks the tab face and the bolt colour', () => {
    const expectTab = (level: number, face: string, color: string) => {
      const ctx = host(1280, 720);
      ctx.state.turbo = level;
      const t = parts(build(ctx)).turboTab!;
      expect(t.face).toBe(face);
      expect((t.glyph as Graphics).context).toBe(sIcon('bolt', 1, color).context);
    };
    expectTab(0, 'plate', S.fg);
    expectTab(1, 'plate', S.yellow);
    expectTab(2, 'yellow', S.ink);
  });

  it('busy: SPIN and autoplay disabled, the bet locked', () => {
    const ctx = host(1280, 720);
    ctx.state.busy = true;
    const p = parts(build(ctx));
    expect(p.spin!.disabled).toBe(true);
    expect(p.autoTab!.disabled).toBe(true);
    expect(p.bet.up!.disabled).toBe(true);
    expect(p.bet.valueHit.eventMode).toBe('none');
  });

  it('taps route to the controller actions', () => {
    const calls: string[] = [];
    const ctx = host(1280, 720, FULL, {
      actions: {
        spin: () => calls.push('spin'),
        openMenu: () => calls.push('menu'),
        openBuyBonus: () => calls.push('buy'),
        cycleTurbo: () => calls.push('turbo'),
        openAutoplayPicker: () => calls.push('auto'),
        stepBet: (d: number) => calls.push(`bet${d}`),
        openBetPicker: () => calls.push('picker'),
      },
    });
    const p = parts(build(ctx));
    for (const n of [p.spin!, p.menuBtn, p.buy!, p.turboTab!, p.autoTab!, p.bet.up!, p.bet.valueHit]) n.emit('pointertap', {});
    expect(calls).toEqual(['spin', 'menu', 'buy', 'turbo', 'auto', 'bet1', 'picker']);
  });
});
