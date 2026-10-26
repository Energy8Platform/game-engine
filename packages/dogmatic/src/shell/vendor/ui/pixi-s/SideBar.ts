import { Container, Graphics, type Text } from 'pixi.js';
import type { PixiComponentContext } from '../pixi/context';
import type { HbBar } from '../pixi-hb/PixiHbRenderer';
import { autoplayDiscMode } from '../pixi-hb/components/BottomBar';
import type { Rect } from '../../core/popover';
import type { SafeArea } from '../../core/renderer';
import { bonusBuyLocked, menuLocked } from '../../core/state';
import { FLAT, Slab, SKEW, slabPoints, type Corners } from './slab';
import { sIcon, sBonusIcon, type SGlyph } from './icons';
import { S } from './theme';
import { SButton, SReadout, SBet, SSpin, SFsCounter, type Sized } from './widgets';
import { dogmaticGlyph } from '../pixi-hb/dogmatic-brand';
import { buttonMetrics, buttonPoints, getButtonDesign, type ButtonMetrics } from './button-design';

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
  /** Gap between the stacked tabs, and the seam between a tab and SPIN's slanted left edge. */
  tabGap: number;
  /** Vertical gap between stacked slabs. */
  gap: number;
}

const WIDE: Sizes = {
  menu: [158, 32], menuGlyph: 20,
  readout: [248, 50], labelSize: 12, valueSize: 22,
  bet: [232, 50], betLabel: 12, betValue: 21,
  buyGlyph: 94,
  spin: [158, 118], spinGlyph: 80,
  tab: [48, 59], tabGlyph: 22, tabGap: 6,
  gap: 6,
};

/** Left (172) + M_COL_GAP (12) + right (186) = M_REF_W (370) = a 390 phone minus the side padding. */
const MOBILE: Sizes = {
  menu: [52, 38], menuGlyph: 20,
  readout: [172, 44], labelSize: 11, valueSize: 17,
  bet: [186, 40], betLabel: 11, betValue: 17,
  buyGlyph: 66,
  spin: [105, 90], spinGlyph: 56,
  tab: [29, 30], tabGlyph: 16, tabGap: 4,
  gap: 8,
};

/** Wide fit: designed for 1280×720, scaled by the smaller ratio, never above 1. The floor keeps
 *  Stake popout S (400×225) readable, as in HB. */
export const WIDE_REF_W = 1280;
export const WIDE_REF_H = 720;
export const WIDE_MIN_SCALE = 0.35;
/** Screen padding around the wide columns (left / right). */
export const OUTER = 16;
/** Wide bottom padding at full scale; it scales with the bar (never under 4), so a small popout's
 *  bar sits on the bottom edge (the user: "прижать bar сильнее к низу, особенно в popout"). */
export const WIDE_BOTTOM = 8;
/** Extra room between a column and the scene's safe rect. */
export const SAFE_GAP = 12;
/** Mobile block: design width, side / bottom padding, and the gap between its two columns. */
export const M_REF_W = 370;
export const M_SIDE = 10;
export const M_BOTTOM = 8;
export const M_COL_GAP = 12;

// Native HellBuddha mobile geometry, kept separate from the DOGMATIC desktop plates.
const MOBILE_SKEW = {
  menu: [[7, 0], [0, 0], [-7, 0], [0, 0]],
  readout: [[11, 6], [0, 0], [-11, -6], [0, 0]],
  bet: [[7, 0], [0, 1], [-7, 0], [0, -3]],
  spin: [[21, 0], [0, 5], [-21, 0], [0, -10]],
} as const satisfies Record<string, Corners>;

/** DOGMATIC side bar. Desktop keeps the approved large controls and outer modes rail.
 *  Mobile uses the original HellBuddha dimensions and row frame: small separate menu,
 *  left-side Auto/Turbo tabs, inline BALANCE/BET, then a centered WIN row. */
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
  private menuClose!: SGlyph;
  private totalWin?: SReadout;
  private win!: SReadout;
  private balance?: SReadout;
  private buy?: SButton;
  private bet!: SBet;
  private spin?: SSpin;
  private fs?: SFsCounter;
  private autoTab?: SButton;
  private turboTab?: SButton;
  private modeRail?: Container;
  private buttons: ButtonMetrics;

  constructor(host: PixiComponentContext) {
    super();
    this.host = host;
    this.mobile = host.layout === 'mobile';
    this.z = this.mobile ? MOBILE : WIDE;
    this.buttons = buttonMetrics(this.z.spin, this.mobile);
    const z = this.z;
    this.rowB = this.mobile ? z.menu[1] + z.gap : z.menu[1] - 1;
    this.rowC = this.rowB + z.spin[1] + z.gap;
    this.rowsH = this.rowC + Math.max(z.readout[1], z.bet[1]);
    this.buildLeft();
    this.buildRight();
    this.win = this.readout('Win', host.fmtWin(host.state.win));
    const phoneScale = Math.min(1, (host.screenW - 2 * M_SIDE) / M_REF_W);
    if (this.mobile && this.win.valueText.scale.x * z.valueSize * phoneScale < 12) {
      this.win.destroy({ children: true });
      this.win = new SReadout({ label: host.t('Win'), value: host.fmtWin(host.state.win),
        w: M_REF_W, h: z.readout[1], labelSize: z.labelSize, valueSize: z.valueSize,
        points: slabPoints(M_REF_W, z.readout[1], MOBILE_SKEW.readout, false) });
    }
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

  /** The menu is open: the burger shows ✕ (a tap closes it — the controller toggles). */
  setMenuOpen(open: boolean): void {
    if (this.destroyed) return;
    this.menuBtn.glyph.visible = !open;
    this.menuClose.visible = open;
  }

  applyFit(): void {
    const { screenW: W, screenH: H } = this.host;
    const winW = this.win.measureSize().w;
    const winH = this.win.measureSize().h;
    if (this.mobile) {
      // A narrower screen scales the design down; a wider one spreads it — the columns stay pinned
      // to the side padding, never scaled up (the user: "по краям большие паддинги, должно быть прижато").
      const designW = Math.max(M_REF_W, this.leftW + M_COL_GAP + this.rightW, winW);
      const s = Math.min(1, (W - 2 * M_SIDE) / designW);
      const blockW = (W - 2 * M_SIDE) / s;
      const blockH = this.rowsH + this.z.gap + winH;
      this.leftCol.position.set(0, 0);
      this.rightCol.position.set(blockW - this.rightW, 0);
      this.center.position.set((blockW - winW) / 2, this.rowsH + this.z.gap);
      const top = H - M_BOTTOM - blockH * s;
      this.block.scale.set(s);
      this.block.position.set(M_SIDE, top);
      this.safe = { top: 0, right: 0, bottom: H - top, left: 0 };
      this.plate = { x: this.block.x, y: top, w: blockW * s, h: blockH * s };
      return;
    }
    const s = Math.max(WIDE_MIN_SCALE, Math.min(1, W / WIDE_REF_W, H / WIDE_REF_H));
    const top = H - Math.max(4, WIDE_BOTTOM * s) - this.rowsH * s;
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
      w: this.buttons.menu[0],
      h: this.buttons.menu[1],
      face: 'plate',
      corners: SKEW.menu,
      glyph: sIcon('menu', z.menuGlyph, S.fg),
      glyphSize: z.menuGlyph,
      points: this.buttonShape(...this.buttons.menu, 'menu'),
      onTap: () => this.host.actions.openMenu(),
    });
    // the ✕ the burger shows while the menu is open (setMenuOpen), in the same glyph box
    this.menuClose = sIcon('close', z.menuGlyph, S.fg);
    this.menuClose.position.copyFrom(this.menuBtn.glyph.position);
    this.menuClose.visible = false;
    this.menuBtn.addChild(this.menuClose);
    const items: Sized[] = [this.menuBtn];
    if (this.isBase()) {
      this.buy = this.buildBuy();
      if (this.buy) {
        this.buy.position.set(0, this.rowB + z.spin[1] - this.buy.measureSize().h);
        if (!this.mobile) this.menuBtn.y = this.buy.y - this.buttons.menu[1] + 1;
      }
    } else if (this.showFs()) {
      // BUY's slot is free outside base: TOTAL WIN goes there, so no row grows and no inset moves. A
      // replay has no BALANCE, so TOTAL WIN takes BALANCE's slot on the bottom row instead of
      // floating over an empty one.
      this.totalWin = this.readout('Total win', this.host.fmtWin(state.freeSpins.totalWin));
      if (state.replay) this.totalWin.position.set(0, this.rowC);
      else this.totalWin.position.set(0, this.rowB + (z.spin[1] - z.readout[1]) / 2);
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

  /** The button row: SPIN or the FS counter with a full-height modes rail; BET
   *  under it. Right-aligned. Without a hero (replay) there are no tabs. */
  private buildRight(): void {
    const { config } = this.host;
    const z = this.z;
    this.bet = this.buildBet();
    let hero: Sized | undefined;
    if (this.isBase()) hero = this.spin = this.buildSpin();
    else if (this.showFs()) hero = this.fs = this.buildFs();
    const items: Sized[] = hero ? [hero, this.bet] : [this.bet];
    const hasAuto = !!hero && this.isBase() && !!config.features.autoplay;
    const hasTurbo = !!hero && config.features.turbo > 0;
    const railW = hasAuto || hasTurbo ? this.buttons.railWidth + this.buttons.gap : 0;
    const colW = Math.max(...items.map((i) => i.measureSize().w), (hero?.measureSize().w ?? 0) + railW);
    if (hero) hero.position.set(colW - hero.measureSize().w - railW, this.rowB + z.spin[1] - hero.measureSize().h);
    this.bet.position.set(colW - this.bet.measureSize().w, this.rowC);
    this.rightCol.addChild(...items);

    if (this.mobile) {
      // Source layout: SPIN at the outside edge; the tabs follow its left lean.
      if (hero) hero.x = colW - hero.measureSize().w;
      const tabs: SButton[] = [];
      if (hasAuto) tabs.push(this.autoTab = this.buildAutoTab());
      if (hasTurbo) tabs.push(this.turboTab = this.buildTurboTab());
      tabs.forEach((tab, i) => {
        tab.position.set(hero!.x + this.mobileSpinEdge(i * (z.tab[1] + z.tabGap), hero!.measureSize().h)
          - z.tabGap - this.buttons.railWidth, hero!.y + i * (z.tab[1] + z.tabGap));
        this.rightCol.addChild(tab);
      });
      this.rightW = colW;
      return;
    }

    if (hero && railW) {
      const rail = this.modeRail = new Container();
      const height = hero.measureSize().h;
      const count = Number(hasAuto) + Number(hasTurbo);
      const part = height / count;
      const rw = this.buttons.railWidth;
      const points = buttonPoints(rw, height, 'rail') ?? slabPoints(rw, height);
      rail.addChild(new Slab(rw, height, { face: S.plate, corners: FLAT, points }));
      if (hasAuto) { this.autoTab = this.buildAutoTab(part); rail.addChild(this.autoTab); }
      if (hasTurbo) {
        this.turboTab = this.buildTurboTab(part);
        this.turboTab.y = hasAuto ? part : 0;
        rail.addChild(this.turboTab);
      }
      if (count === 2) rail.addChild(new Graphics().rect(8, part - .5, rw - 16, 1).fill('#3a3a40'));
      rail.addChild(new Graphics().poly(points).stroke({ color: '#34343a', width: 1, alignment: 1 }));
      const clip = new Graphics().poly(points).fill('#ffffff');
      rail.addChild(clip); rail.mask = clip;
      rail.position.set(hero.x + hero.measureSize().w + this.buttons.gap, hero.y);
      this.rightCol.addChild(rail);
    }
    this.rightW = colW;
  }

  // ── pieces ────────────────────────────────────────────────────────────────
  private mobileSpinEdge(y: number, h: number): number {
    const [tl, , , bl] = MOBILE_SKEW.spin;
    return tl[0] + (bl[0] - tl[0]) * (y - tl[1]) / (h + bl[1] - tl[1]);
  }

  private mobileTabCorners(height: number): Corners {
    const lean = this.mobileSpinEdge(0, this.z.spin[1]) - this.mobileSpinEdge(height, this.z.spin[1]);
    return [[lean, 0], [0, 0], [-lean, 0], [0, 0]];
  }

  private buttonShape(w: number, h: number, role: 'spin' | 'bonus' | 'menu'): number[] | undefined {
    if (this.mobile && getButtonDesign() === 'current')
      return slabPoints(w, h, role === 'menu' ? MOBILE_SKEW.menu : MOBILE_SKEW.spin, false);
    return buttonPoints(w, h, role);
  }

  private readout(label: string, value: string): SReadout {
    const z = this.z;
    return new SReadout({ label: this.host.t(label), value, w: z.readout[0], h: z.readout[1], labelSize: z.labelSize, valueSize: z.valueSize,
      points: this.mobile ? slabPoints(...z.readout, MOBILE_SKEW.readout, false) : undefined });
  }

  /** The mask slab, SPIN's size and shape, level with SPIN in the button row; with a feature active
   *  it turns red with a white cross (tap = deactivate). */
  private buildBuy(): SButton | undefined {
    const { state, config } = this.host;
    if (config.features.buyBonus === false && !config.onBonusBuy) return undefined;
    const z = this.z;
    const feature = state.activeFeature;
    const size = this.buttons.bonusGlyph;
    const cross = Math.round(size * 0.5);
    const collar = !feature ? dogmaticGlyph(size) : null;
    return new SButton({
      w: this.buttons.bonus[0],
      h: this.buttons.bonus[1],
      face: feature ? 'red' : collar ? 'plate' : 'yellow',
      corners: SKEW.spin,
      glyph: feature ? sIcon('close', cross, S.fg) : collar ?? sBonusIcon(config.bonusIcon, size, S.ink),
      glyphSize: feature ? cross : size,
      points: this.buttonShape(...this.buttons.bonus, 'bonus'),
      outline: feature ? S.red : S.yellow,
      outlineWidth: 2,
      solidBacking: true,
      caption: feature ? this.host.t('Disable') : 'BONUS',
      captionSize: this.mobile ? 10 : getButtonDesign()==='current' ? 11 : 12,
      captionLayout: !this.mobile && getButtonDesign()!=='current' ? 'side' : 'below',
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
      points: this.mobile ? slabPoints(...z.bet, MOBILE_SKEW.bet, false) : undefined,
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
      w: this.buttons.spin[0],
      h: this.buttons.spin[1],
      glyph: this.buttons.spinGlyph,
      points: this.buttonShape(...this.buttons.spin, 'spin'),
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
  private buildAutoTab(height = this.z.tab[1]): SButton {
    const z = this.z;
    const g = z.tabGlyph;
    const running = this.host.state.autoplay.active;
    return new SButton({
      w: this.buttons.railWidth,
      h: height,
      face: running ? 'yellow' : 'plate',
      corners: FLAT,
      embedded: !this.mobile,
      points: this.mobile ? slabPoints(this.buttons.railWidth, height,
        this.mobileTabCorners(height), false) : undefined,
      glyph: running ? sIcon('stop', g, S.ink) : sIcon('play', g, S.fg),
      glyphSize: g,
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
  private buildTurboTab(height = this.z.tab[1]): SButton {
    const z = this.z;
    const g = z.tabGlyph;
    const level = this.host.state.turbo;
    const color = level >= 2 ? S.ink : level === 1 ? S.yellow : S.fg;
    return new SButton({
      w: this.buttons.railWidth,
      h: height,
      face: level >= 2 ? 'yellow' : 'plate',
      corners: FLAT,
      embedded: !this.mobile,
      points: this.mobile ? slabPoints(this.buttons.railWidth, height,
        this.mobileTabCorners(height), false) : undefined,
      glyph: sIcon('turbo', g, color),
      glyphSize: g,
      hoverFace: level >= 2 ? undefined : 'yellow',
      hoverGlyph: level >= 2 ? undefined : sIcon('turbo', g, S.ink),
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

  /** HB's BottomBar.applyBusy locks, except an active feature keeps the bet steppable — its price
   *  follows the bet (the user: "когда активна feature я в баре не могу менять ставку"). */
  private applyBusy(): void {
    const { state } = this.host;
    const auto = state.autoplay.active;
    const lockBet = state.busy || auto;
    const i = state.availableBets.indexOf(state.bet);
    if (this.bet.up) this.bet.up.disabled = lockBet || i >= state.availableBets.length - 1;
    if (this.bet.down) this.bet.down.disabled = lockBet || i <= 0;
    // The SPIN slab stays live through a round: tapped then, it speeds the round up (the shell
    // turns that spin into a skip). Except as a halted run's RESUME slab — that would start
    // autoplay mid-round.
    if (this.spin) this.spin.disabled = state.busy && !auto && state.autoplay.remaining > 0;
    if (this.autoTab) this.autoTab.disabled = state.busy && !auto;
    if (this.buy) this.buy.disabled = bonusBuyLocked(state);
    this.menuBtn.disabled = menuLocked(state);
    if (lockBet) {
      this.bet.valueHit.eventMode = 'none';
      this.bet.valueHit.cursor = 'default';
    }
  }
}
