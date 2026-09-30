import { Container, type Text } from 'pixi.js';
import type { PixiComponentContext } from '../pixi/context';
import type { HbBar } from '../pixi-hb/PixiHbRenderer';
import { autoplayDiscMode } from '../pixi-hb/components/BottomBar';
import { makeIcon } from '../pixi-hb/pixi-icon';
import type { Rect } from '@/core/popover';
import type { SafeArea } from '@/core/renderer';
import { bonusBuyLocked } from '@/core/state';
import { SKEW } from './slab';
import { sIcon } from './icons';
import { S } from './theme';
import { SButton, SReadout, SBet, SSpin, SFsCounter, type Sized } from './widgets';

// ── design constants ─────────────────────────────────────────────────────────
interface Sizes {
  menu: [number, number];
  menuGlyph: number;
  readout: [number, number];
  labelSize: number;
  valueSize: number;
  bet: [number, number];
  betLabel: number;
  betValue: number;
  /** The mask glyph on BUY — BUY itself is SPIN's size. */
  buyGlyph: number;
  spin: [number, number];
  spinGlyph: number;
  tab: [number, number];
  tabGlyph: number;
  tabGap: number;
  /** How far the tabs tuck under SPIN's left edge. */
  tabOverlap: number;
  /** Vertical gap between stacked slabs. */
  gap: number;
}

const WIDE: Sizes = {
  menu: [64, 40], menuGlyph: 20,
  readout: [268, 56], labelSize: 15, valueSize: 23,
  bet: [232, 38], betLabel: 14, betValue: 19,
  buyGlyph: 120,
  spin: [248, 126], spinGlyph: 84,
  tab: [56, 34], tabGlyph: 20, tabGap: 4, tabOverlap: 20,
  gap: 4,
};

/** Left (172) + M_COL_GAP (12) + right (186) = M_REF_W (370) = a 390 phone minus the side padding. */
const MOBILE: Sizes = {
  menu: [52, 38], menuGlyph: 20,
  readout: [172, 44], labelSize: 11, valueSize: 17,
  bet: [186, 40], betLabel: 11, betValue: 17,
  buyGlyph: 76,
  spin: [150, 90], spinGlyph: 56,
  tab: [50, 30], tabGlyph: 16, tabGap: 4, tabOverlap: 20,
  gap: 8,
};

/** Wide fit: designed for 1280×720, scaled by the smaller ratio, never above 1. The floor keeps
 *  Stake popout S (400×225) readable, as in HB. */
export const WIDE_REF_W = 1280;
export const WIDE_REF_H = 720;
export const WIDE_MIN_SCALE = 0.35;
/** Screen padding around the wide columns. */
export const OUTER = 16;
/** Extra room between a column and the scene's safe rect. */
export const SAFE_GAP = 12;
/** Mobile block: design width, side / bottom padding, and the gap between its two columns. */
export const M_REF_W = 370;
export const M_SIDE = 10;
export const M_BOTTOM = 8;
export const M_COL_GAP = 12;

/** The S control bar: two side columns plus WIN between them, laid out in rows.
 *  - Button row: BUY (left, SPIN-sized; TOTAL WIN in its slot during free spins) and SPIN or the FS
 *    counter (right) with the autoplay / turbo tabs tucked under SPIN's left edge. The burger sits
 *    above BUY.
 *  - Row right under the buttons: BALANCE (left) and BET (right).
 *  - WIN: wide — on the bottom line, centred in the gap between the columns; mobile — its own bottom
 *    row, centred under both.
 *  Wide: the columns sit in the bottom corners and the scene gets side insets plus the WIN row.
 *  Mobile: everything in one bottom block. Rebuilt on every render(). */
export class SideBar extends Container implements HbBar {
  balanceValue?: Text;
  winValue?: Text;
  private host: PixiComponentContext;
  private mobile: boolean;
  private z: Sizes;
  // wide: the columns and `center` (WIN) sit on the bar, each scaled; mobile: all three sit in
  // `block`, scaled together. Both columns share one row frame: y = 0 is the burger row's top.
  private leftCol = new Container();
  private rightCol = new Container();
  private center = new Container();
  private block = new Container();
  private leftW = 0;
  private rightW = 0;
  /** Row frame: button row top, the row under it, and the total height down to that row's bottom. */
  private rowB = 0;
  private rowC = 0;
  private rowsH = 0;
  private plate: Rect | null = null;
  private safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  private menuBtn!: SButton;
  private totalWin?: SReadout;
  private win!: SReadout;
  private balance?: SReadout;
  private buy?: SButton;
  private bet!: SBet;
  private spin?: SSpin;
  private fs?: SFsCounter;
  private autoTab?: SButton;
  private turboTab?: SButton;

  constructor(host: PixiComponentContext) {
    super();
    this.host = host;
    this.mobile = host.layout === 'mobile';
    this.z = this.mobile ? MOBILE : WIDE;
    const z = this.z;
    this.rowB = z.menu[1] + z.gap;
    this.rowC = this.rowB + z.spin[1] + z.gap;
    this.rowsH = this.rowC + Math.max(z.readout[1], z.bet[1]);
    this.buildLeft();
    this.buildRight();
    this.win = this.readout('Win', this.host.fmtWin(this.host.state.win));
    this.winValue = this.win.valueText;
    this.center.addChild(this.win);
    const parts = [this.leftCol, this.rightCol, this.center];
    if (this.mobile) {
      this.block.addChild(...parts);
      this.addChild(this.block);
    } else {
      this.addChild(...parts);
    }
    this.applyBusy();
  }

  // ── HbBar ─────────────────────────────────────────────────────────────────
  menuAnchor(): Rect | null {
    if (this.destroyed || this.menuBtn.destroyed) return null;
    const b = this.menuBtn.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  /** Wide: the left column; mobile: the whole block — the popover opens above it. */
  menuPlate(): Rect | null {
    return this.destroyed ? null : this.plate;
  }

  fitScale(): number {
    if (this.destroyed) return 1;
    return (this.mobile ? this.block : this.leftCol).scale.x;
  }

  safeArea(): SafeArea {
    return this.safe;
  }

  applyFit(): void {
    const { screenW: W, screenH: H } = this.host;
    const winW = this.win.measureSize().w;
    const winH = this.win.measureSize().h;
    if (this.mobile) {
      const blockW = Math.max(M_REF_W, this.leftW + M_COL_GAP + this.rightW, winW);
      const blockH = this.rowsH + this.z.gap + winH;
      this.leftCol.position.set(0, 0);
      this.rightCol.position.set(blockW - this.rightW, 0);
      this.center.position.set((blockW - winW) / 2, this.rowsH + this.z.gap);
      const s = Math.min(1, (W - 2 * M_SIDE) / blockW);
      const top = H - M_BOTTOM - blockH * s;
      this.block.scale.set(s);
      this.block.position.set((W - blockW * s) / 2, top);
      this.safe = { top: 0, right: 0, bottom: H - top, left: 0 };
      this.plate = { x: this.block.x, y: top, w: blockW * s, h: blockH * s };
      return;
    }
    const s = Math.max(WIDE_MIN_SCALE, Math.min(1, W / WIDE_REF_W, H / WIDE_REF_H));
    const top = H - OUTER - this.rowsH * s;
    const leftEdge = OUTER + this.leftW * s; // the left column's right edge
    const rx = W - OUTER - this.rightW * s; // the right column's left edge (tabs included)
    // WIN sits on the bottom line, centred in the gap between the columns
    const winY = top + (this.rowsH - winH) * s;
    for (const c of [this.leftCol, this.rightCol, this.center]) c.scale.set(s);
    this.leftCol.position.set(OUTER, top);
    this.rightCol.position.set(rx, top);
    this.center.position.set((leftEdge + rx - winW * s) / 2, winY);
    this.safe = { top: 0, right: W - rx + SAFE_GAP, bottom: H - winY + SAFE_GAP, left: leftEdge + SAFE_GAP };
    this.plate = { x: OUTER, y: top, w: this.leftW * s, h: this.rowsH * s };
  }

  // ── columns ───────────────────────────────────────────────────────────────
  /** The burger; the button row: BUY (base), or TOTAL WIN in free spins; BALANCE under it. */
  private buildLeft(): void {
    const { state } = this.host;
    const z = this.z;
    this.menuBtn = new SButton({
      w: z.menu[0],
      h: z.menu[1],
      face: 'plate',
      corners: SKEW.menu,
      glyph: makeIcon('menu', z.menuGlyph, { ink: S.fg, fill: S.fg }),
      glyphSize: z.menuGlyph,
      onTap: () => this.host.actions.openMenu(),
    });
    const items: Sized[] = [this.menuBtn];
    if (this.isBase()) {
      this.buy = this.buildBuy();
      if (this.buy) this.buy.position.set(0, this.rowB);
    } else if (this.showFs()) {
      // BUY's slot is free outside base: TOTAL WIN goes there, so no row grows and no inset moves
      this.totalWin = this.readout('Total win', this.host.fmtWin(state.freeSpins.totalWin));
      this.totalWin.position.set(0, this.rowB + (z.spin[1] - z.readout[1]) / 2);
    }
    if (this.buy) items.push(this.buy);
    if (this.totalWin) items.push(this.totalWin);
    if (!state.replay) {
      this.balance = this.readout('Balance', this.host.fmt(state.balance));
      this.balanceValue = this.balance.valueText;
      this.balance.position.set(0, this.rowC);
      items.push(this.balance);
    }
    this.leftCol.addChild(...items);
    this.leftW = Math.max(...items.map((i) => i.measureSize().w));
  }

  /** The button row: SPIN or the FS counter, the tabs under its left edge from its top down; BET
   *  under it. Right-aligned. Without a hero (replay) there are no tabs. */
  private buildRight(): void {
    const { config } = this.host;
    const z = this.z;
    this.bet = this.buildBet();
    let hero: Sized | undefined;
    if (this.isBase()) hero = this.spin = this.buildSpin();
    else if (this.showFs()) hero = this.fs = this.buildFs();
    const items: Sized[] = hero ? [hero, this.bet] : [this.bet];
    let colW = Math.max(...items.map((i) => i.measureSize().w));
    if (hero) hero.position.set(colW - hero.measureSize().w, this.rowB);
    this.bet.position.set(colW - this.bet.measureSize().w, this.rowC);
    this.rightCol.addChild(...items);

    const tabs: SButton[] = [];
    if (hero && this.isBase() && config.features.autoplay) tabs.push((this.autoTab = this.buildAutoTab()));
    if (hero && config.features.turbo > 0) tabs.push((this.turboTab = this.buildTurboTab()));
    if (hero && tabs.length) {
      const [tw, th] = z.tab;
      const x = hero.x - tw + z.tabOverlap;
      let y = hero.y; // flush with the hero's top edge
      for (const t of tabs) {
        t.position.set(x, y);
        this.rightCol.addChildAt(t, 0); // under the hero
        y += th + z.tabGap;
      }
      if (x < 0) {
        // the tabs poke out past the widest slab: shift everything so the column starts at 0
        for (const c of this.rightCol.children) c.x -= x;
        colW -= x;
      }
    }
    this.rightW = colW;
  }

  // ── pieces ────────────────────────────────────────────────────────────────
  private readout(label: string, value: string): SReadout {
    const z = this.z;
    return new SReadout({ label: this.host.t(label), value, w: z.readout[0], h: z.readout[1], labelSize: z.labelSize, valueSize: z.valueSize });
  }

  /** The mask slab, SPIN's size and shape, level with SPIN in the button row; with a feature active
   *  it turns red with a white cross (tap = deactivate). */
  private buildBuy(): SButton | undefined {
    const { state, config } = this.host;
    if (config.features.buyBonus === false && !config.onBonusBuy) return undefined;
    const z = this.z;
    const feature = state.activeFeature;
    const cross = Math.round(z.buyGlyph * 0.5);
    return new SButton({
      w: z.spin[0],
      h: z.spin[1],
      face: feature ? 'red' : 'yellow',
      corners: SKEW.spin,
      glyph: feature ? makeIcon('close', cross, { ink: S.fg, fill: S.fg }) : sIcon('mask', z.buyGlyph, S.ink),
      glyphSize: feature ? cross : z.buyGlyph,
      onTap: () => (feature ? this.host.actions.deactivateFeature() : this.host.actions.openBuyBonus()),
    });
  }

  /** − BET +. With a feature active the label names it and the value is the feature price. */
  private buildBet(): SBet {
    const { state } = this.host;
    const z = this.z;
    const feature = state.activeFeature;
    const isBase = this.isBase();
    return new SBet({
      label: feature ? feature.title : this.host.t('Bet'),
      value: this.host.fmt(feature ? state.bet * feature.priceMultiplier : state.bet),
      w: z.bet[0],
      h: z.bet[1],
      labelSize: z.betLabel,
      valueSize: z.betValue,
      stepper: isBase,
      onStep: (dir) => {
        if (!this.host.state.busy) this.host.actions.stepBet(dir);
      },
      onValue: isBase && !feature
        ? () => {
            if (!this.betLocked()) this.host.actions.openBetPicker();
          }
        : undefined,
    });
  }

  private buildSpin(): SSpin {
    const { state } = this.host;
    const z = this.z;
    const spin = new SSpin({
      w: z.spin[0],
      h: z.spin[1],
      glyph: z.spinGlyph,
      ticker: this.host.ticker,
      autoplay: autoplayDiscMode(state),
      remaining: state.autoplay.remaining,
      onSpin: () => this.host.actions.spin(),
      onStop: () => this.host.actions.stopAutoplay(),
      onResume: () => this.host.actions.startAutoplay(this.host.state.autoplay.remaining),
    });
    if (state.busy) spin.setBusy(true);
    return spin;
  }

  private buildFs(): SFsCounter {
    const { state } = this.host;
    const z = this.z;
    const fs = state.freeSpins;
    const value = state.bonus?.value ?? (fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`);
    return new SFsCounter({
      w: z.spin[0],
      h: z.spin[1],
      label: this.host.t(state.bonus?.label ?? 'Free spins'),
      value,
      labelSize: z.labelSize,
      valueSize: Math.round(z.valueSize * 1.3),
    });
  }

  /** ▶ — a running run shows a yellow face with STOP (tap stops it); idle opens the picker. Idle
   *  hover: the yellow face with an ink ▶. */
  private buildAutoTab(): SButton {
    const z = this.z;
    const g = z.tabGlyph;
    const running = this.host.state.autoplay.active;
    return new SButton({
      w: z.tab[0],
      h: z.tab[1],
      face: running ? 'yellow' : 'plate',
      corners: SKEW.tab,
      glyph: running ? makeIcon('stop', g, { ink: S.ink, fill: S.ink }) : sIcon('play', g, S.fg),
      glyphSize: g,
      insetRight: z.tabOverlap,
      hoverFace: running ? undefined : 'yellow',
      hoverGlyph: running ? undefined : sIcon('play', g, S.ink),
      onTap: () => {
        const { active, remaining } = this.host.state.autoplay;
        if (active || remaining > 0) this.host.actions.stopAutoplay();
        else this.host.actions.openAutoplayPicker();
      },
    });
  }

  /** ⚡ — L0 white bolt, L1 yellow bolt, L2 yellow face with an ink bolt. Hover on a black tab: the
   *  yellow face with an ink bolt (= the L2 look). */
  private buildTurboTab(): SButton {
    const z = this.z;
    const g = z.tabGlyph;
    const level = this.host.state.turbo;
    const color = level >= 2 ? S.ink : level === 1 ? S.yellow : S.fg;
    return new SButton({
      w: z.tab[0],
      h: z.tab[1],
      face: level >= 2 ? 'yellow' : 'plate',
      corners: SKEW.tab,
      glyph: sIcon('bolt', g, color),
      glyphSize: g,
      insetRight: z.tabOverlap,
      hoverFace: level >= 2 ? undefined : 'yellow',
      hoverGlyph: level >= 2 ? undefined : sIcon('bolt', g, S.ink),
      onTap: () => this.host.actions.cycleTurbo(),
    });
  }

  // ── state ─────────────────────────────────────────────────────────────────
  private isBase(): boolean {
    return this.host.state.mode === 'base';
  }

  /** Free spins / bonus, or a replay of a free-spins round. */
  private showFs(): boolean {
    const s = this.host.state;
    return s.mode === 'freeSpins' || s.mode === 'bonus' || (s.mode === 'replay' && s.freeSpins.total > 0);
  }

  private betLocked(): boolean {
    return this.host.state.busy || this.host.state.autoplay.active;
  }

  /** Same locks as HB's BottomBar.applyBusy. */
  private applyBusy(): void {
    const { state } = this.host;
    const auto = state.autoplay.active;
    const lockBet = state.busy || auto || !!state.activeFeature;
    const i = state.availableBets.indexOf(state.bet);
    if (this.bet.up) this.bet.up.disabled = lockBet || i >= state.availableBets.length - 1;
    if (this.bet.down) this.bet.down.disabled = lockBet || i <= 0;
    if (this.spin) this.spin.disabled = state.busy && !auto;
    if (this.autoTab) this.autoTab.disabled = state.busy && !auto;
    if (this.buy) this.buy.disabled = bonusBuyLocked(state);
    if (lockBet) {
      this.bet.valueHit.eventMode = 'none';
      this.bet.valueHit.cursor = 'default';
    }
  }
}
