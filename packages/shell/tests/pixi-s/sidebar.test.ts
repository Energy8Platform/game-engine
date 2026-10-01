import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import type { Container, Graphics } from 'pixi.js';
import type { SGlyph } from '@/ui/pixi-s/icons';
import { SideBar, OUTER, SAFE_GAP, M_SIDE, WIDE_BOTTOM } from '@/ui/pixi-s/SideBar';
import type { SButton, SBet, SSpin, SFsCounter, SReadout } from '@/ui/pixi-s/widgets';
import { sIcon } from '@/ui/pixi-s/icons';
import { S } from '@/ui/pixi-s/theme';
import { SKEW } from '@/ui/pixi-s/slab';
import type { PixiComponentContext } from '@/ui/pixi/context';
import { makeContext, defaultConfig } from '../pixi/_host';

interface Parts {
  leftCol: Container;
  rightCol: Container;
  center: Container;
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
  for (const col of [parts(bar).leftCol, parts(bar).rightCol, parts(bar).center]) {
    const k = box(col);
    expect(k.x).toBeGreaterThanOrEqual(0);
    expect(k.y).toBeGreaterThanOrEqual(0);
    expect(k.r).toBeLessThanOrEqual(w);
    expect(k.b).toBeLessThanOrEqual(h);
  }
}

const ANTE = { id: 'ante', type: 'feature' as const, title: 'Warrior Ante', description: '', priceMultiplier: 1.25 };

const near = (a: number, b: number, tol = 1) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('S side bar — wide', () => {
  it('rows: menu over BUY | SPIN, BALANCE | BET right under them, WIN on the bottom line between the columns', () => {
    const p = parts(build(host(1280, 720)));
    expect(p.leftCol.x).toBe(OUTER);
    const l = box(p.leftCol);
    const r = box(p.rightCol);
    expect(r.r).toBeGreaterThan(1280 - OUTER - 1);
    expect(r.r).toBeLessThanOrEqual(1280 - OUTER + 3); // + the slab shadow
    const [buy, spin, bal, bet, win] = [box(p.buy!), box(p.spin!), box(p.balance!), box(p.bet), box(p.win)];
    expect(box(p.menuBtn).b).toBeLessThanOrEqual(buy.y + 3);
    near(buy.y, spin.y);
    near(bal.y, bet.y);
    expect(bal.y).toBeGreaterThanOrEqual(buy.b - 3);
    expect(bet.y).toBeGreaterThanOrEqual(spin.b - 3);
    // WIN: on the bottom line (with BALANCE), centred in the gap between the two columns
    near(win.b, bal.b);
    expect(win.b).toBeGreaterThan(720 - WIDE_BOTTOM - 1);
    expect(win.b).toBeLessThanOrEqual(720 - WIDE_BOTTOM + 3);
    expect(win.x).toBeGreaterThan(l.r);
    expect(win.r).toBeLessThan(r.x);
    near((win.x + win.r) / 2, (l.r + r.x) / 2, 4);
  });

  it('SPIN, BUY and both tabs are 30% shorter than the first cut (the user, 2026-09-30)', () => {
    const wide = parts(build(host(1280, 720)));
    expect(wide.spin!.measureSize()).toEqual({ w: 174, h: 126 });
    expect(wide.buy!.measureSize()).toEqual({ w: 174, h: 126 });
    expect(wide.autoTab!.measureSize()).toEqual({ w: 34, h: 34 });
    expect(wide.turboTab!.measureSize()).toEqual({ w: 34, h: 34 });
    const phone = parts(build(host(390, 844)));
    expect(phone.spin!.measureSize()).toEqual({ w: 105, h: 90 });
    expect(phone.buy!.measureSize()).toEqual({ w: 105, h: 90 });
    expect(phone.autoTab!.measureSize()).toEqual({ w: 29, h: 30 });
    expect(phone.turboTab!.measureSize()).toEqual({ w: 29, h: 30 });
  });

  it('BUY is SPIN-sized in the left column, level with SPIN (as on mobile)', () => {
    const { buy, spin, leftCol, rightCol } = parts(build(host(1280, 720)));
    expect(buy!.measureSize()).toEqual(spin!.measureSize());
    expect(buy!.parent).toBe(leftCol);
    expect(rightCol.children).not.toContain(buy);
    near(box(buy!).y, box(spin!).y);
  });

  it('the tabs stand apart from SPIN: a tabGap-wide seam parallel to its slanted left edge', () => {
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      const { spin, autoTab, turboTab } = parts(build(host(w, h)));
      const [tl, , , bl] = SKEW.spin;
      const sh = spin!.measureSize().h;
      // SPIN's left edge in its local units, from its top-left to its bottom-left corner
      const edgeX = (y: number) => tl[0] + ((bl[0] - tl[0]) * (y - tl[1])) / (sh + bl[1] - tl[1]);
      for (const tab of [autoTab!, turboTab!]) {
        const { w: tw, h: th } = tab.measureSize();
        const d = tw - tab.slab.points[4]; // how far the tab's bottom-right corner sits in
        for (const [x, y] of [[tw, 0], [tw - d, th]]) {
          const p = spin!.toLocal(tab.toGlobal({ x, y }));
          near(edgeX(p.y) - p.x, 4, 0.5);
        }
      }
      expect(box(turboTab!).y).toBeGreaterThan(box(autoTab!).y);
      expect(box(turboTab!).b).toBeLessThan(box(spin!).b);
    }
  });

  it('BET: the label is yellow, as in the reference — the feature title too', () => {
    expect(parts(build(host(1280, 720))).bet.labelText.style.fill).toBe(S.yellow);
    const ctx = host(1280, 720);
    ctx.state.activeFeature = ANTE;
    expect(parts(build(ctx)).bet.labelText.style.fill).toBe(S.yellow);
  });

  it('the tabs are one size and start flush with SPIN\'s top edge', () => {
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      const p = parts(build(host(w, h)));
      expect(p.autoTab!.measureSize()).toEqual(p.turboTab!.measureSize());
      near(box(p.autoTab!).y, box(p.spin!).y, 0.5);
      expect(box(p.turboTab!).b).toBeLessThan(box(p.spin!).b);
    }
  });

  it('the tabs light up yellow on hover, with an ink glyph', () => {
    const p = parts(build(host(1280, 720)));
    for (const tab of [p.autoTab!, p.turboTab!]) {
      expect(tab.slab.face).toBe(S.plate);
      tab.emit('pointerover', {});
      expect(tab.slab.face).toBe(S.yellow);
      expect(tab.glyph.visible).toBe(false);
      tab.emit('pointerout', {});
      expect(tab.slab.face).toBe(S.plate);
      expect(tab.glyph.visible).toBe(true);
    }
  });

  it('reserves the sides and the WIN row: the safe insets reach just past each column and above WIN', () => {
    const bar = build(host(1280, 720));
    const l = box(parts(bar).leftCol);
    const r = box(parts(bar).rightCol);
    const win = box(parts(bar).win);
    const sa = bar.safeArea();
    expect(sa.top).toBe(0);
    expect(sa.bottom).toBeGreaterThanOrEqual(720 - win.y);
    expect(sa.bottom).toBeLessThanOrEqual(720 - win.y + SAFE_GAP + 0.5);
    expect(sa.left).toBeGreaterThanOrEqual(l.r - 3);
    expect(sa.left).toBeLessThanOrEqual(l.r + SAFE_GAP);
    expect(1280 - sa.right).toBeLessThanOrEqual(r.x);
    expect(1280 - sa.right).toBeGreaterThanOrEqual(r.x - SAFE_GAP);
    // nothing in the right column pokes past its reserved edge — the tabs included
    const { autoTab, turboTab } = parts(bar);
    expect(1280 - sa.right + SAFE_GAP).toBeLessThanOrEqual(Math.min(box(autoTab!).x, box(turboTab!).x) + 0.5);
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
    for (const [w, h] of [[400, 225], [1024, 576], [844, 390]]) {
      const bar = build(host(w, h));
      expectOnScreen(bar, w, h);
      const p = parts(bar);
      expect(box(p.win).x).toBeGreaterThan(box(p.leftCol).r); // WIN never runs into a column
      expect(box(p.win).r).toBeLessThan(box(p.rightCol).x);
    }
    expect(build(host(400, 225)).fitScale()).toBe(0.35);
  });

  it('the insets do not change with content: FS rows, long labels and huge wins never widen a column', () => {
    const RU: Record<string, string> = { 'Total win': 'ОБЩИЙ ВЫИГРЫШ', Balance: 'БАЛАНС', Win: 'ВЫИГРЫШ' };
    const t = (s: string) => RU[s] ?? s;
    const base = build(host(1280, 720, FULL, { t })).safeArea();
    const ctx = host(1280, 720, FULL, { t });
    ctx.state.mode = 'freeSpins';
    ctx.state.freeSpins = { current: 3, total: 10, totalWin: 1_000_000 };
    ctx.state.win = 1_000_000;
    ctx.state.balance = 10_000_000_000;
    const bar = build(ctx);
    expect(bar.safeArea()).toEqual(base);
    const p = parts(bar);
    for (const r of [p.totalWin!, p.win, p.balance!]) {
      expect(r.labelText.x).toBeGreaterThan(0);
      expect(r.valueText.x + r.valueText.width).toBeLessThanOrEqual(r.slab.w);
    }
    const feat = host(1280, 720, FULL, { t });
    feat.state.activeFeature = { ...ANTE, title: 'Legendary Warrior Ante' };
    expect(build(feat).safeArea()).toEqual(base);
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
  it('rows: BUY | SPIN level, BALANCE | BET right under them, WIN centred on the bottom row', () => {
    const p = parts(build(host(390, 844)));
    const [buy, spin, bal, bet, win, k] = [box(p.buy!), box(p.spin!), box(p.balance!), box(p.bet), box(p.win), box(p.block)];
    expect(p.buy!.measureSize()).toEqual(p.spin!.measureSize());
    expect(buy.r).toBeLessThan(spin.x);
    near(buy.y, spin.y);
    near(bal.y, bet.y);
    expect(bal.y).toBeGreaterThanOrEqual(buy.b - 3);
    expect(win.y).toBeGreaterThanOrEqual(Math.max(bal.b, bet.b) - 3);
    near(win.b, k.b);
    near((win.x + win.r) / 2, (k.x + k.r) / 2, 4);
  });

  it('a phone wider than the design pins the columns to the side padding (the user: "по краям большие паддинги, должно быть прижато")', () => {
    for (const [w, h] of [[452, 812], [430, 932], [390, 844]]) {
      const p = parts(build(host(w, h)));
      const left = Math.min(box(p.leftCol).x, box(p.balance!).x, box(p.buy!).x);
      const right = Math.max(box(p.bet).r, box(p.spin!).r);
      near(left, M_SIDE, 3); // the slab shadows / leans may sit a few px inside
      near(right, w - M_SIDE, 4);
      expect(p.block.scale.x).toBe(1); // spread, not scaled up
      const win = box(p.win);
      near((win.x + win.r) / 2, w / 2, 4);
    }
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

  it('plates keep their design size whatever the text; the block only scales with the screen', () => {
    const ctx = host(320, 568);
    ctx.state.balance = 10_000_000_000;
    ctx.state.win = 1_000_000_000;
    ctx.state.activeFeature = { ...ANTE, title: 'Legendary Warrior Ante' };
    const bar = build(ctx);
    const p = parts(bar);
    expect(p.balance!.measureSize()).toEqual({ w: 172, h: 44 });
    expect(p.win.measureSize()).toEqual({ w: 172, h: 44 });
    expect(p.bet.measureSize()).toEqual({ w: 186, h: 40 });
    const k = box(p.block);
    expect(k.x).toBeGreaterThanOrEqual(0);
    expect(k.r).toBeLessThanOrEqual(320);
    expect(bar.fitScale()).toBeCloseTo((320 - 20) / 370, 5);
  });

  it('no buy-bonus configured: no BUY, and BALANCE | BET still sit under the button row', () => {
    const p = parts(build(host(390, 844, { features: { turbo: 2, autoplay: {}, buyBonus: false } })));
    expect(p.buy).toBeUndefined();
    near(box(p.balance!).y, box(p.bet).y);
    expect(box(p.balance!).y).toBeGreaterThanOrEqual(box(p.spin!).b - 3);
  });
});

describe('S side bar — modes and controls', () => {
  it('free spins: the counter replaces SPIN, TOTAL WIN takes BUY\'s slot, no BUY, no stepper', () => {
    const ctx = host(1280, 720);
    ctx.state.mode = 'freeSpins';
    ctx.state.freeSpins = { current: 3, total: 10, totalWin: 12 };
    const p = parts(build(ctx));
    expect(p.spin).toBeUndefined();
    expect(p.fs!.valueText.text).toBe('3 / 10');
    expect(p.totalWin!.valueText.text).toBe('€12.00');
    expect(box(p.totalWin!).y).toBeGreaterThanOrEqual(box(p.fs!).y - 0.5);
    expect(box(p.totalWin!).b).toBeLessThanOrEqual(box(p.fs!).b + 3);
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

  it('an active feature: red BUY with a cross, the multiplied bet — and the stepper still steps (the user: "когда активна feature я в баре не могу менять ставку")', () => {
    const steps: number[] = [];
    const ctx = host(1280, 720, FULL, { actions: { stepBet: (d: 1 | -1) => steps.push(d) } });
    ctx.state.activeFeature = ANTE;
    ctx.state.bet = ctx.state.availableBets[1];
    const p = parts(build(ctx));
    expect(p.buy!.face).toBe('red');
    expect((p.buy!.glyph as SGlyph).iconName).toBe('close');
    expect(p.bet.up!.disabled).toBe(false);
    expect(p.bet.down!.disabled).toBe(false);
    expect(p.bet.labelText.text).toBe('WARRIOR ANTE');
    p.bet.up!.emit('pointertap', {});
    p.bet.down!.emit('pointertap', {});
    expect(steps).toEqual([1, -1]);
  });

  it('an active feature shows the feature price: the bet times its multiplier', () => {
    const ctx = host(1280, 720);
    ctx.state.activeFeature = ANTE;
    expect(parts(build(ctx)).bet.valueText.text).toBe('€1.25');
  });

  it('a replay of free spins: TOTAL WIN sits on the bottom row, in BALANCE\'s empty slot, not raised above it', () => {
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      const ctx = host(w, h);
      ctx.state.mode = 'replay';
      ctx.state.replay = true;
      ctx.state.freeSpins = { current: 3, total: 10, totalWin: 12 };
      const p = parts(build(ctx));
      expect(p.balance).toBeUndefined();
      // exactly where BALANCE sits during live free spins
      const live = host(w, h);
      live.state.mode = 'freeSpins';
      live.state.freeSpins = { current: 3, total: 10, totalWin: 12 };
      const bal = box(parts(build(live)).balance!);
      const tw = box(p.totalWin!);
      near(tw.x, bal.x, 1);
      near(tw.y, bal.y, 1);
    }
    // live free spins keep it in BUY's slot, over BALANCE
    const live = host(1280, 720);
    live.state.mode = 'freeSpins';
    live.state.freeSpins = { current: 3, total: 10, totalWin: 12 };
    const q = parts(build(live));
    expect(box(q.totalWin!).b).toBeLessThan(box(q.balance!).y + 1);
  });

  it('the bar sits close to the bottom edge: 8px on desktop, less on a popout (scaled, at least 4)', () => {
    for (const [w, h, max] of [[1280, 720, 8], [480, 270, 4], [400, 225, 4]]) {
      const p = parts(build(host(w, h)));
      const bottom = Math.max(box(p.balance!).b, box(p.bet).b, box(p.win).b);
      const gap = h - bottom;
      expect(gap, `${w}×${h}`).toBeLessThanOrEqual(max + 0.5);
      expect(gap, `${w}×${h}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('autoplay running: a yellow tab with STOP and SPIN stops the run; halted: SPIN resumes with the count', () => {
    const run = host(1280, 720);
    run.state.autoplay = { active: true, remaining: 5 };
    const a = parts(build(run));
    expect(a.autoTab!.face).toBe('yellow');
    expect((a.autoTab!.glyph as SGlyph).iconName).toBe('stop');
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
      const g = t.glyph as SGlyph;
      expect(g.iconName).toBe('turbo');
      expect(g.gfx.context).toBe(sIcon('turbo', 1, color).gfx.context);
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

  it('setMenuOpen swaps the burger glyph for ✕ and back', () => {
    const bar = build(host(1280, 720));
    const b = bar as unknown as { menuBtn: SButton; menuClose: Container };
    expect(b.menuBtn.glyph.visible).toBe(true);
    expect(b.menuClose.visible).toBe(false);
    bar.setMenuOpen(true);
    expect(b.menuBtn.glyph.visible).toBe(false);
    expect(b.menuClose.visible).toBe(true);
    expect((b.menuClose as SGlyph).iconName).toBe('close');
    bar.setMenuOpen(false);
    expect(b.menuBtn.glyph.visible).toBe(true);
    expect(b.menuClose.visible).toBe(false);
  });
});
