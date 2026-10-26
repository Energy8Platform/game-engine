import { Container, Graphics, Text } from 'pixi.js';
import type { PixiComponentContext } from '../../pixi/context';
import type { Rect } from '../../../core/popover';
import type { HbBar } from '../PixiHbRenderer';
import type { SafeArea } from '../../../core/renderer';
import { FlexBox } from '../../pixi/primitives/flex';
import { IconButton, Readout, SpinDisc, BonusButton, FsHero } from '../primitives/widgets';
import type { SpinAutoplayMode } from '../primitives/widgets';
import { bonusBuyLocked, menuLocked } from '../../../core/state';
import { HB } from '../theme';
import { plaque } from '../primitives/plaque';

// ── design constants ─────────────────────────────────────────────────────────
/** Which of the disc's three faces the autoplay state calls for — see `SpinAutoplayMode`. */
export function autoplayDiscMode(state: { autoplay: { active: boolean; remaining: number } }): SpinAutoplayMode {
  if (state.autoplay.active) return 'running';
  return state.autoplay.remaining > 0 ? 'paused' : 'off';
}

const BAR_H = 68; // the plaque panel
const SPIN = 92; // hero disc — pops above/below the panel (= 2·SQ + STACK_GAP)
const SPIN_POP = (SPIN - BAR_H) / 2;
const STACK_GAP = 4; // auto over turbo: 2·SQ + STACK_GAP = SPIN, so the stack matches the disc
const MAX_BAR_W = 900;
const OUTER_PAD = 14;
const PANEL_PAD = 14;
const ZONE_GAP = 14;
const ROW_GAP = 12; // bonus ↔ panel ↔ hero cluster gaps
const MID_GAP = 24;
const BAR_REF_W = 900;
const BAR_MIN_SCALE = 0.35; // Stake popout S (400×225) needs ~0.37 for the widest bar
const WIDE_PAD_BOTTOM = 8;
export const WIDE_BAR_H = WIDE_PAD_BOTTOM + SPIN; // ≈92

const BUY_W = 64; // bonus plaque on desktop
const SQ = 44; // square plaque buttons (auto/turbo) — stacked beside SPIN, two fit in its height
const STEP = 28; // bet ± plaques
const FS_BOX = 96; // fixed bet-value box width

// mobile
const M_CTRL_H = 62,
  M_INFO_H = 46,
  M_GAP = 10,
  M_PAD_BOTTOM = 8,
  M_SIDE = 10;
const M_BUY = 50;
const M_SQ = 40;
export const MOBILE_BAR_H = M_PAD_BOTTOM + SPIN + M_GAP + M_INFO_H;

/** Turbo: the level paints the bolts in — L1 the first bolt, L2 both. */
function makeTurboButton(level: number, onTap: () => void, size = SQ, glyph = 40): IconButton {
  return new IconButton('turbo', { size, glyph, bolts: Math.min(2, Math.max(0, level)), onTap });
}

/** A readout in the bar (stroked Switzer value, muted heading-font label). */
function readout(
  host: PixiComponentContext,
  label: string,
  value: string,
  opts: { valueSize?: number; align?: 'left' | 'center' | 'right'; fixedWidth?: number; maxWidth?: number } = {},
): Readout {
  return new Readout({
    label: host.t(label),
    value,
    align: opts.align,
    valueSize: opts.valueSize,
    fixedWidth: opts.fixedWidth,
    maxWidth: opts.maxWidth,
  });
}

/** The bottom control bar. Rebuilt on every `render()`. Exposes balance/win value Texts for
 *  count-up and runs the wide/mobile fit-scale. */
export class BottomBar extends Container implements HbBar {
  balanceValue?: Text;
  winValue?: Text;
  private host: PixiComponentContext;
  private inner = new Container();

  // wide structural refs
  private buy?: BonusButton;
  private panelBg = new Graphics();
  private leftZone?: FlexBox;
  private betZone?: FlexBox;
  private heroZone?: FlexBox;
  // interactive refs (shared wide/mobile)
  private betReadout?: Readout;
  private betUp?: IconButton;
  private betDown?: IconButton;
  private spin?: SpinDisc;
  private autoBtn?: IconButton;
  private turboBtn?: IconButton;
  private menuBtn?: IconButton;
  /** The menu's PLATE in LOCAL coordinates relative to `inner` (see menuPlate()). */
  private plateRect: Rect | null = null;

  constructor(host: PixiComponentContext) {
    super();
    this.host = host;
    this.addChild(this.inner);
    if (host.layout === 'mobile') this.buildMobile();
    else this.buildWide();
  }

  /** Screen-space rect of the burger — the menu popover's POINTER. */
  menuAnchor(): Rect | null {
    if (!this.menuBtn || this.menuBtn.destroyed) return null;
    const p = this.menuBtn.getGlobalPosition();
    const s = this.inner.scale.x;
    const size = this.menuBtn.measureSize();
    return { x: p.x, y: p.y, w: size.w * s, h: size.h * s };
  }

  /** Screen-space rect of the menu's PLATE — the panel (wide) or the controls row (mobile). Resolved
   *  lazily on every call because the renderer rebuilds this bar on most state changes. */
  menuPlate(): Rect | null {
    if (this.destroyed) return null;
    if (!this.plateRect) return null;
    const s = this.inner.scale.x;
    const origin = this.inner.getGlobalPosition();
    return {
      x: origin.x + this.plateRect.x * s,
      y: origin.y + this.plateRect.y * s,
      w: this.plateRect.w * s,
      h: this.plateRect.h * s,
    };
  }

  /** The scale factor the bar currently applies to itself (`inner.scale`). */
  fitScale(): number {
    if (this.destroyed) return 1;
    return this.inner.scale.x;
  }

  /** Only the bottom strip is reserved; the rest of the screen is full-bleed. */
  safeArea(): SafeArea {
    return { top: 0, right: 0, bottom: this.height, left: 0 };
  }

  // ── shared pieces ─────────────────────────────────────────────────────────
  /** The bet readout (+ strip) and its stepper. With a feature active the label is an orange chip
   *  naming the mode and the stepper is replaced by a bare cross — the bet is locked by the feature. */
  private buildBetGroup(isBase: boolean, valueSize: number, fixedWidth: number, step: number, stacked: boolean): FlexBox {
    const { state } = this.host;
    const feature = state.activeFeature;
    const betShown = feature ? state.bet * feature.priceMultiplier : state.bet;
    const i = state.availableBets.indexOf(state.bet);
    const bet = new Readout({
      label: feature ? feature.title : this.host.t('Bet'),
      chip: !!feature,
      value: this.host.fmt(betShown),
      valueSize,
      fixedWidth,
      align: stacked ? 'left' : 'center',
      strip: { count: state.availableBets.length, index: i },
    });
    this.betReadout = bet;
    if (isBase && !feature) {
      bet.eventMode = 'static';
      bet.cursor = 'pointer';
      bet.on('pointertap', () => {
        if (!this.betLocked()) this.host.actions.openBetPicker();
      });
    }
    const group = new FlexBox({ direction: 'row', align: 'center', gap: 8 });
    if (!isBase) {
      group.add(bet);
      return group;
    }
    this.betUp = new IconButton('plus', { size: step, glyph: Math.round(step * 0.64), onTap: () => this.onBet(1) });
    this.betDown = new IconButton('minus', { size: step, glyph: Math.round(step * 0.64), onTap: () => this.onBet(-1) });
    if (stacked) {
      const col = new FlexBox({ direction: 'column', align: 'center', gap: 3 });
      col.add(this.betUp);
      col.add(this.betDown);
      group.add(bet);
      group.add(col);
    } else {
      group.add(this.betDown);
      group.add(bet);
      group.add(this.betUp);
    }
    return group;
  }

  private buildSpin(): SpinDisc {
    const { state } = this.host;
    const spin = new SpinDisc({
      size: SPIN,
      glyph: Math.round(SPIN * 0.86),
      ticker: this.host.ticker,
      onSpin: () => this.host.actions.spin(),
      onStop: () => this.stopAutoplay(),
      onResume: () => this.resumeAutoplay(),
    });
    spin.setAutoplay(autoplayDiscMode(state), state.autoplay.remaining);
    if (state.busy) spin.setBusy(true);
    return spin;
  }

  private buildFsHero(): FsHero {
    const { state } = this.host;
    const fs = state.freeSpins;
    const fsText = state.bonus?.value ?? (fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`);
    return new FsHero({ label: this.host.t(state.bonus?.label ?? 'Free spins'), value: fsText, height: SPIN });
  }

  private buildAuto(size: number, glyph: number): IconButton {
    const { state } = this.host;
    const b = new IconButton('autoplay', { size, glyph, active: state.autoplay.active, onTap: () => this.onAutoplay() });
    return b;
  }

  /** The bonus plaque; with a feature active it turns red and shows a cross (tap = deactivate). */
  private buildBuy(size: number): BonusButton | undefined {
    const { state, config } = this.host;
    if (config.features.buyBonus === false && !config.onBonusBuy) return undefined;
    const feature = state.activeFeature;
    return new BonusButton({
      size,
      face: feature ? 'red' : 'orange',
      icon: feature ? 'close' : 'volatility',
      bonusIcon: config.bonusIcon,
      onTap: () => (feature ? this.host.actions.deactivateFeature() : this.host.actions.openBuyBonus()),
    });
  }

  // ── wide / landscape ──────────────────────────────────────────────────────
  private buildWide(): void {
    const { state, config } = this.host;
    const isBase = state.mode === 'base';
    const isFS = state.mode === 'freeSpins' || state.mode === 'bonus';
    const showFsBlocks = isFS || (state.mode === 'replay' && state.freeSpins.total > 0);

    // BONUS — outside-left of the panel (base only)
    this.buy = isBase ? this.buildBuy(BUY_W) : undefined;

    // LEFT info group: menu · balance · (Total win) · (Win)
    const left = new FlexBox({ direction: 'row', align: 'center', gap: ZONE_GAP });
    this.menuBtn = new IconButton('menu', { size: 40, glyph: 24, onTap: () => this.host.actions.openMenu() });
    left.add(this.menuBtn);
    if (!state.replay) {
      const bal = readout(this.host, 'Balance', this.host.fmt(state.balance));
      this.balanceValue = bal.valueText;
      left.add(bal);
    }
    if (showFsBlocks) left.add(readout(this.host, 'Total win', this.host.fmtWin(state.freeSpins.totalWin)));
    if (state.win > 0) {
      const win = readout(this.host, 'Win', this.host.fmtWin(state.win));
      this.winValue = win.valueText;
      left.add(win);
    }
    left.layout();
    this.leftZone = left;

    // BET group — the panel's right end
    const bet = this.buildBetGroup(isBase, 13, FS_BOX, STEP, true);
    bet.layout();
    this.betZone = bet;

    // HERO cluster — outside-right of the panel: SPIN (or the FS counter) · [auto over turbo]
    const hero = new FlexBox({ direction: 'row', align: 'center', gap: ROW_GAP });
    if (isBase) {
      this.spin = this.buildSpin();
      hero.add(this.spin);
    } else if (showFsBlocks) {
      hero.add(this.buildFsHero());
    }
    const stack = new FlexBox({ direction: 'column', align: 'center', gap: STACK_GAP });
    if (isBase && config.features.autoplay) {
      this.autoBtn = this.buildAuto(SQ, 42);
      stack.add(this.autoBtn);
    }
    if (config.features.turbo > 0) {
      this.turboBtn = makeTurboButton(state.turbo, () => this.onTurbo());
      stack.add(this.turboBtn);
    }
    if (this.autoBtn || this.turboBtn) hero.add(stack);
    hero.layout();
    this.heroZone = hero;

    this.inner.addChild(this.panelBg, left, bet, hero);
    if (this.buy) this.inner.addChild(this.buy);
    this.applyBusy();
  }

  // ── mobile / portrait ─────────────────────────────────────────────────────
  private buildMobile(): void {
    const { state, config } = this.host;
    const isBase = state.mode === 'base';
    const isFS = state.mode === 'freeSpins' || state.mode === 'bonus';
    const showFsBlocks = isFS || (state.mode === 'replay' && state.freeSpins.total > 0);
    const W = this.host.screenW - 2 * M_SIDE;

    let hero: Container | undefined;
    if (isBase) {
      this.spin = this.buildSpin();
      hero = this.spin;
    } else if (showFsBlocks) {
      hero = this.buildFsHero();
    }

    const menu = new IconButton('menu', { size: M_SQ, glyph: 24, onTap: () => this.host.actions.openMenu() });
    this.menuBtn = menu;
    if (isBase && config.features.autoplay) this.autoBtn = this.buildAuto(M_SQ, 36);
    if (config.features.turbo > 0) this.turboBtn = makeTurboButton(state.turbo, () => this.onTurbo(), M_SQ, 36);
    this.buy = isBase ? this.buildBuy(M_BUY) : undefined;

    // level 1 — controls row
    const controls = new FlexBox({
      direction: 'row',
      align: 'center',
      justify: 'space-between',
      gap: 0,
      width: W,
      height: M_CTRL_H,
      padding: { left: 14, right: 14 },
    });
    if (isBase && hero) {
      const SIDE = 10;
      const lz = new FlexBox({ direction: 'row', align: 'center', gap: SIDE, justify: 'start' });
      lz.add(menu);
      if (this.autoBtn) lz.add(this.autoBtn);
      const rz = new FlexBox({ direction: 'row', align: 'center', gap: SIDE, justify: 'end' });
      if (this.turboBtn) rz.add(this.turboBtn);
      if (this.buy) rz.add(this.buy);
      const zw = Math.max(lz.measureSize().w, rz.measureSize().w);
      lz.setLayoutSize(zw, undefined);
      rz.setLayoutSize(zw, undefined);
      controls.add(lz);
      controls.add(hero);
      controls.add(rz);
    } else {
      controls.add(menu);
      if (this.autoBtn) controls.add(this.autoBtn);
      if (hero) controls.add(hero);
      if (showFsBlocks) {
        const PAD = 14, GAPS = 24;
        const heroSized = hero as unknown as { measureSize?: () => { w: number; h: number } };
        const heroW = hero ? (heroSized.measureSize?.().w ?? hero.getLocalBounds().width) : 0;
        const fixed = M_SQ + (this.autoBtn ? M_SQ : 0) + heroW + (this.turboBtn ? M_SQ : 0);
        const twSlot = Math.max(60, W - 2 * PAD - fixed - GAPS);
        controls.add(readout(this.host, 'Total win', this.host.fmtWin(state.freeSpins.totalWin), { align: 'center', maxWidth: twSlot }));
      }
      if (this.turboBtn) controls.add(this.turboBtn);
    }
    controls.layout();

    // level 2 — info row (balance · − bet + · win)
    const betGroup = this.buildBetGroup(isBase, 11, 76, 26, false);
    betGroup.layout();
    const innerW = W - 28;
    const slot = Math.max(40, (innerW - betGroup.outerWidth - 20) / 2);
    const info = new FlexBox({
      direction: 'row',
      align: 'center',
      justify: 'space-between',
      width: W,
      height: M_INFO_H,
      padding: { left: 14, right: 14 },
      gap: 10,
    });
    if (!state.replay) {
      const bal = readout(this.host, 'Balance', this.host.fmt(state.balance), { valueSize: 11, align: 'left', fixedWidth: slot });
      this.balanceValue = bal.valueText;
      info.add(bal);
    }
    info.add(betGroup);
    const win = readout(this.host, 'Win', this.host.fmtWin(state.win), { valueSize: 11, align: 'right', fixedWidth: slot });
    this.winValue = win.valueText;
    info.add(win);
    info.layout();

    this.inner.addChild(this.mobileBg, this.mobileInfoBg, controls, info);
    this.mobileControls = controls;
    this.mobileInfo = info;
    this.mobileHeroPop = isBase || showFsBlocks ? (SPIN - M_CTRL_H) / 2 : 0;
    this.applyBusy();
  }
  private mobileBg = new Graphics();
  private mobileInfoBg = new Graphics();
  private mobileControls?: FlexBox;
  private mobileInfo?: FlexBox;
  private mobileHeroPop = 0;

  // ── interactive handlers ──────────────────────────────────────────────────
  private onBet(dir: 1 | -1): void {
    if (this.host.state.busy) return;
    this.host.actions.stepBet(dir);
  }
  private onTurbo(): void {
    this.host.actions.cycleTurbo();
  }
  private onAutoplay(): void {
    const { active, remaining } = this.host.state.autoplay;
    if (active || remaining > 0) this.stopAutoplay();
    else this.host.actions.openAutoplayPicker();
  }
  private stopAutoplay(): void {
    this.host.actions.stopAutoplay();
  }
  private resumeAutoplay(): void {
    this.host.actions.startAutoplay(this.host.state.autoplay.remaining);
  }
  private betLocked(): boolean {
    return this.host.state.busy || this.host.state.autoplay.active;
  }

  private applyBusy(): void {
    const { state } = this.host;
    const auto = state.autoplay.active;
    const lockBet = state.busy || auto || !!state.activeFeature;
    const i = state.availableBets.indexOf(state.bet);
    if (this.betUp) this.betUp.disabled = lockBet || i >= state.availableBets.length - 1;
    if (this.betDown) this.betDown.disabled = lockBet || i <= 0;
    // The disc stays live through a round: tapped then, it speeds the round up (the shell turns
    // that spin into a skip). Except as a halted run's RESUME disc — that would start autoplay
    // mid-round.
    if (this.spin) this.spin.disabled = state.busy && !auto && state.autoplay.remaining > 0;
    if (this.autoBtn) this.autoBtn.disabled = state.busy && !auto;
    if (this.buy) this.buy.disabled = bonusBuyLocked(state);
    if (this.menuBtn) this.menuBtn.disabled = menuLocked(state);
    if (this.betReadout && lockBet) {
      this.betReadout.eventMode = 'none';
      this.betReadout.cursor = 'default';
    }
  }

  // ── height / fit ──────────────────────────────────────────────────────────
  get height(): number {
    const nominal = this.host.layout === 'mobile' ? MOBILE_BAR_H : WIDE_BAR_H;
    return this._measured > 0 ? this._measured : nominal;
  }
  private _measured = 0;
  private measureFootprint(): void {
    const occupied = this.host.screenH - this.getBounds().y;
    this._measured = Number.isFinite(occupied) && occupied > 0 ? occupied : 0;
  }

  applyFit(): void {
    if (this.host.layout === 'mobile') {
      this.applyFitMobile();
      return;
    }
    const { screenW: W, screenH: H } = this.host;
    const left = this.leftZone!,
      bet = this.betZone!,
      hero = this.heroZone!;
    const buyW = this.buy ? BUY_W + ROW_GAP : 0;
    const heroW = hero.outerWidth > 0 ? hero.outerWidth + ROW_GAP : 0;

    // content = bonus + panel + hero cluster; the panel holds left (hard-left) and bet (hard-right).
    const panelNeed = PANEL_PAD * 2 + left.outerWidth + MID_GAP + bet.outerWidth;
    const neededContent = buyW + panelNeed + heroW;
    const designContent = Math.max(MAX_BAR_W - 2 * OUTER_PAD, neededContent);
    const barW = designContent + 2 * OUTER_PAD;
    const s = Math.max(BAR_MIN_SCALE, Math.min(1, W / BAR_REF_W, (W - 2 * OUTER_PAD) / barW));

    const panelCenterY = SPIN_POP + BAR_H / 2;
    const panelX = OUTER_PAD + buyW;
    const panelRight = barW - OUTER_PAD - heroW;
    plaque(this.panelBg, panelRight - panelX, BAR_H, { fill: HB.bar });
    this.panelBg.position.set(panelX, SPIN_POP);
    this.plateRect = { x: panelX, y: SPIN_POP, w: panelRight - panelX, h: BAR_H };

    if (this.buy) this.buy.position.set(OUTER_PAD, panelCenterY - BUY_W / 2);
    left.position.set(panelX + PANEL_PAD, panelCenterY - left.outerHeight / 2);
    bet.position.set(panelRight - PANEL_PAD - bet.outerWidth, panelCenterY - bet.outerHeight / 2);
    hero.position.set(panelRight + ROW_GAP, panelCenterY - hero.outerHeight / 2);

    this.inner.scale.set(s);
    this.inner.position.set((W - barW * s) / 2, H - (WIDE_PAD_BOTTOM + SPIN) * s);
    this.measureFootprint();
  }

  private applyFitMobile(): void {
    const { screenW: W, screenH: H } = this.host;
    const controls = this.mobileControls!,
      info = this.mobileInfo!;
    const pop = this.mobileHeroPop;
    const topPad = pop;
    controls.position.set(0, topPad);
    info.position.set(0, topPad + M_CTRL_H + M_GAP);
    const localBottom = topPad + M_CTRL_H + M_GAP + M_INFO_H;

    const avail = W - 2 * M_SIDE;
    const need = Math.max(controls.naturalWidth, info.naturalWidth);
    const rowW = Math.max(avail, need);
    controls.setLayoutSize(rowW, M_CTRL_H);
    info.setLayoutSize(rowW, M_INFO_H);
    // both rows share one plaque each (drawn here, not as FlexBox backgrounds, so the border is inset)
    plaque(this.mobileBg, rowW, M_CTRL_H, { fill: HB.bar });
    this.mobileBg.position.set(0, topPad);
    plaque(this.mobileInfoBg, rowW, M_INFO_H, { fill: HB.bar });
    this.mobileInfoBg.position.set(0, topPad + M_CTRL_H + M_GAP);
    this.plateRect = { x: 0, y: topPad - pop, w: controls.outerWidth, h: controls.outerHeight + pop };
    const s = rowW > 0 ? Math.max(0.4, Math.min(1, avail / rowW)) : 1;

    this.inner.scale.set(s);
    this.inner.position.set((W - rowW * s) / 2, H - localBottom * s - M_PAD_BOTTOM);
    this.measureFootprint();
  }
}
