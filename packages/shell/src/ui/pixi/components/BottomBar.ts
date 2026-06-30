import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import type { PixiComponentContext } from '../context';
import { effectiveAccent, contrastText } from '@/core/colors';
import { FlexBox } from '../primitives/flex';
import { roundedPath } from '../primitives/flex';
import {
  IconButton,
  Readout,
  SpinDisc,
  BuyBonusBadge,
  FsHero,
  divider,
  attachHover,
  attachPress,
} from '../primitives/widgets';
import { IconView, makeRingedIcon } from '../pixi-icon';

// ── design constants (mirror the DOM `.ge-bar-panel` / mobile rules) ──────────
const BAR_H = 68;            // continuous dark panel height
const SPIN = 84;            // hero disc — pops above/below the bar
const SPIN_POP = (SPIN - BAR_H) / 2; // 8 — how far the disc sticks out top/bottom
const MAX_BAR_W = 850;      // .ge-shell-bottom max-width
const OUTER_PAD = 14;       // .ge-shell-bottom padding
const PANEL_PAD = 14;       // .ge-bar-panel padding
const ZONE_GAP = 12;        // .ge-zone gap
const ROW_GAP = 10;         // BUY BONUS ↔ panel gap
const MID_GAP = 24;         // minimum gap between the left info group and the right controls
const BAR_REF_W = 840;      // zoom reference width
const BAR_MIN_SCALE = 0.5;
const WIDE_PAD_BOTTOM = 8;
export const WIDE_BAR_H = WIDE_PAD_BOTTOM + SPIN; // ≈92

const BUY_W = 62;           // buy-bonus disc on desktop
const DISC = 38;            // white-disc icon button box (auto/turbo)
const FS_BOX = 90;          // fixed bet-value box width

// mobile
const M_CTRL_H = 62, M_INFO_H = 40, M_GAP = 10, M_PAD_BOTTOM = 8, M_SIDE = 10;
const M_BUY = 50;
export const MOBILE_BAR_H = M_PAD_BOTTOM + SPIN + M_GAP + M_INFO_H; // spin pops above the controls

/** Three-state turbo button: single `turbo1` bolt on a white disc, with fill+ring treatment
 *  matching the DOM redesign. Level is conveyed by fill colour + ring colour (not glyph swap):
 *  - off (0): bolt fill #fff + BLACK ring, container alpha .5
 *  - L1:      bolt fill #fff + ACCENT ring, alpha 1
 *  - L≥2:     bolt fill ACCENT + ACCENT ring, alpha 1
 *  Hover at any level: bolt fill+ring → accent, disc border → accent (standard bar-button hover). */
class TurboButton extends Container {
  private box: number;
  private view: IconView;
  private discG: Graphics;
  private discBorder: number;
  private level: number;
  private accent: string;

  constructor(opts: { size: number; glyph: number; discFill: string; discBorder?: number; accent: string; level: number; onTap: () => void }) {
    super();
    this.box = opts.size;
    this.accent = opts.accent;
    this.level = opts.level;
    this.discBorder = opts.discBorder ?? 2;
    this.discG = new Graphics();
    this.addChild(this.discG);
    const { fill, ring } = this._colors(false);
    this.view = makeRingedIcon('turbo1', opts.glyph, fill, ring);
    this.view.position.set((this.box - opts.glyph) / 2, (this.box - opts.glyph) / 2);
    this.addChild(this.view);
    // off is no longer dimmed — it reads as off via the black ring (DOM dropped the opacity:.5 rule)
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = new Rectangle(0, 0, this.box, this.box);
    this._paint(false);
    attachHover(this, () => this._paint(true), () => this._paint(false));
    attachPress(this, 0.92, () => opts.onTap());
  }

  private _colors(hovering: boolean): { fill: string; ring: string } {
    if (hovering) return { fill: this.accent, ring: this.accent };
    if (this.level === 0) return { fill: '#ffffff', ring: '#000000' };
    if (this.level === 1) return { fill: '#ffffff', ring: this.accent };
    return { fill: this.accent, ring: this.accent };
  }

  private _paint(hovering: boolean): void {
    const { fill, ring } = this._colors(hovering);
    this.view.setColors(fill, ring);
    const r = this.box / 2 - this.discBorder / 2;
    this.discG.clear();
    this.discG.circle(this.box / 2, this.box / 2, r).fill('#ffffff');
    // border lights accent on hover OR when engaged (level>0) — mirrors DOM .ge-iconbtn.ge-active
    const ringActive = hovering || this.level > 0;
    this.discG.stroke({ color: ringActive ? this.accent : '#000000', width: this.discBorder });
  }

  /** Update turbo level and repaint (called when the shell re-renders the bar). */
  setLevel(level: number, accent: string): void {
    this.level = level;
    this.accent = accent;
    this._paint(false);
  }

  measureSize(): { w: number; h: number } { return { w: this.box, h: this.box }; }
  setLayoutSize(): void { /* fixed */ }
}

/** A readout in the bar (white Oswald value, plaque-label caption, no shadow). */
function readout(host: PixiComponentContext, label: string, value: string, opts: { valueSize?: number; align?: 'left' | 'center' | 'right'; fixedWidth?: number; color?: string; muted?: string } = {}): Readout {
  return new Readout({
    label: host.t(label),
    value,
    muted: opts.muted ?? host.tokens.plaqueLabel,
    fg: opts.color ?? '#ffffff',
    align: opts.align,
    valueSize: opts.valueSize,
    fixedWidth: opts.fixedWidth,
    shadow: false,
  });
}

/** The bottom control bar. Rebuilt on every `render()`. Exposes balance/win value Texts for
 *  count-up and runs the wide/mobile fit-scale (mirrors the DOM shell). */
export class BottomBar extends Container {
  balanceValue?: Text;
  winValue?: Text;
  private host: PixiComponentContext;
  private inner = new Container();

  // wide structural refs
  private buy?: BuyBonusBadge;
  private panelBg = new Graphics();
  private leftZone?: FlexBox;
  private rightZone?: FlexBox;
  // interactive refs (shared wide/mobile)
  private betReadout?: Readout;
  private betUp?: IconButton;
  private betDown?: IconButton;
  private spin?: SpinDisc;
  private autoBtn?: IconButton;
  private turboBtn?: TurboButton;

  constructor(host: PixiComponentContext) {
    super();
    this.host = host;
    this.addChild(this.inner);
    if (host.layout === 'mobile') this.buildMobile();
    else this.buildWide();
  }

  // ── wide / landscape ──────────────────────────────────────────────────────
  private buildWide(): void {
    const { state, tokens } = this.host;
    const isBase = state.mode === 'base';
    const isFS = state.mode === 'freeSpins';
    const showFsBlocks = isFS || (state.mode === 'replay' && state.freeSpins.total > 0);

    // BUY BONUS — floats outside-left of the panel (base only)
    this.buy = isBase ? this.buildBuy(BUY_W, 13, 3) ?? undefined : undefined;

    // LEFT info group: menu · balance · (Total win) · (Win)
    const left = new FlexBox({ direction: 'row', align: 'center', gap: ZONE_GAP });
    left.add(new IconButton('menu', { size: 36, glyph: 30, color: '#ffffff', hover: tokens.accent, onTap: () => this.host.actions.openMenu() }));
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

    // RIGHT controls group: bet (+ step) · |divider| · auto · SPIN/FS · turbo
    this.rightZone = this.buildRightWide(isBase, showFsBlocks);

    this.inner.addChild(this.panelBg, left, this.rightZone);
    if (this.buy) this.inner.addChild(this.buy);
    this.applyBusy();
  }

  private buildRightWide(isBase: boolean, showFsBlocks: boolean): FlexBox {
    const { state, config, tokens } = this.host;
    const feature = state.activeFeature;
    const betShown = feature ? state.bet * feature.priceMultiplier : state.bet;
    const bet = new Readout({
      label: this.host.t('Bet'),
      value: this.host.fmt(betShown),
      muted: feature ? effectiveAccent(feature) : tokens.plaqueLabel,
      fg: feature ? effectiveAccent(feature) : '#ffffff',
      fixedWidth: FS_BOX,
      align: 'left',
      shadow: false,
    });
    this.betReadout = bet;
    if (isBase) {
      bet.eventMode = 'static';
      bet.cursor = 'pointer';
      bet.on('pointertap', () => { if (!this.betLocked()) this.host.actions.openBetPicker(); });
    }

    const betGroup = new FlexBox({ direction: 'row', align: 'center', gap: 8 });
    betGroup.add(bet);
    if (isBase) {
      // plain (borderless) +/- icons, bolder — stacked
      const step = new FlexBox({ direction: 'column', align: 'center', gap: 2 });
      this.betUp = new IconButton('plus', { size: 24, glyph: 22, color: '#ffffff', hover: tokens.accent, onTap: () => this.onBet(1) });
      this.betDown = new IconButton('minus', { size: 24, glyph: 22, color: '#ffffff', hover: tokens.accent, onTap: () => this.onBet(-1) });
      step.add(this.betUp);
      step.add(this.betDown);
      betGroup.add(step);
    }

    const spinWrap = new FlexBox({ direction: 'row', align: 'center', gap: 8 });
    if (isBase && config.features.autoplay) {
      this.autoBtn = new IconButton('autoplay', {
        size: DISC, glyph: 25, disc: tokens.btn, color: tokens.btnInk, hover: tokens.accent, activeColor: tokens.accent,
        active: state.autoplay.active, onTap: () => this.onAutoplay(),
      });
      if (state.autoplay.active) this.autoBtn.setGlow(true);
      spinWrap.add(this.autoBtn);
    }
    if (isBase) {
      this.spin = new SpinDisc({ size: SPIN, glyph: 65, tokens, ticker: this.host.ticker, onSpin: () => this.host.actions.spin(), onStop: () => this.stopAutoplay() });
      if (state.autoplay.active) this.spin.setAutoplay(true, state.autoplay.remaining);
      if (state.busy) this.spin.setBusy(true);
      spinWrap.add(this.spin);
    } else if (showFsBlocks) {
      const fs = state.freeSpins;
      const fsText = fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`;
      spinWrap.add(new FsHero({ label: this.host.t('Free spins'), value: fsText, tokens, height: SPIN }));
    }
    if (config.features.turbo > 0) {
      this.turboBtn = new TurboButton({
        size: DISC, glyph: 19, discFill: tokens.btn, discBorder: 2, accent: tokens.accent,
        level: state.turbo, onTap: () => this.onTurbo(),
      });
      spinWrap.add(this.turboBtn);
    }

    const right = new FlexBox({ direction: 'row', align: 'center', gap: ZONE_GAP });
    right.add(betGroup);
    right.add(divider(this.host.tokens, 22));
    right.add(spinWrap);
    right.layout();
    return right;
  }

  private buildBuy(size: number, fontSize: number, border: number): BuyBonusBadge | null {
    const { state, config, tokens } = this.host;
    if (config.features.buyBonus === false && !config.onBonusBuy) return null;
    const feature = state.activeFeature;
    if (feature) {
      const accent = effectiveAccent(feature);
      return new BuyBonusBadge({ size, fontSize, border, bg: accent, fg: contrastText(accent), label: this.host.t('DISABLE'), tokens, ticker: this.host.ticker, onTap: () => this.host.actions.deactivateFeature() });
    }
    return new BuyBonusBadge({ size, border, bg: tokens.accent, icon: 'ticket', iconSize: size * 0.55, iconColor: tokens.btnInk, label: '', tokens, ticker: this.host.ticker, onTap: () => this.host.actions.openBuyBonus() });
  }

  // ── mobile / portrait ─────────────────────────────────────────────────────
  private buildMobile(): void {
    const { state, config, tokens } = this.host;
    const isBase = state.mode === 'base';
    const isFS = state.mode === 'freeSpins';
    const showFsBlocks = isFS || (state.mode === 'replay' && state.freeSpins.total > 0);
    const W = this.host.screenW - 2 * M_SIDE;

    // hero (centre): SPIN in base, FS counter in free spins
    let hero: Container | undefined;
    if (isBase) {
      this.spin = new SpinDisc({ size: SPIN, glyph: 65, tokens, ticker: this.host.ticker, onSpin: () => this.host.actions.spin(), onStop: () => this.stopAutoplay() });
      if (state.autoplay.active) this.spin.setAutoplay(true, state.autoplay.remaining);
      if (state.busy) this.spin.setBusy(true);
      hero = this.spin;
    } else if (showFsBlocks) {
      const fs = state.freeSpins;
      const fsText = fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`;
      hero = new FsHero({ label: this.host.t('Free spins'), value: fsText, tokens, height: SPIN });
    }

    const menu = new IconButton('menu', { size: 40, glyph: 26, color: '#ffffff', hover: tokens.accent, onTap: () => this.host.actions.openMenu() });
    if (config.features.autoplay) {
      this.autoBtn = new IconButton('autoplay', { size: 40, glyph: 26, color: '#ffffff', hover: tokens.accent, activeColor: tokens.accent, active: state.autoplay.active, onTap: () => this.onAutoplay() });
      if (state.autoplay.active) this.autoBtn.setGlow(true);
    }
    if (config.features.turbo > 0) {
      this.turboBtn = new TurboButton({
        size: 40, glyph: 22, discFill: tokens.btn, discBorder: 2, accent: tokens.accent,
        level: state.turbo, onTap: () => this.onTurbo(),
      });
    }
    const buy = isBase ? this.buildBuy(M_BUY, 9, 2) ?? undefined : undefined;

    // level 1 — controls bar (dark)
    const controls = new FlexBox({ direction: 'row', align: 'center', justify: 'space-between', gap: 0, width: W, height: M_CTRL_H, padding: { left: 18, right: 18 }, background: { fill: tokens.bar, radius: 16 } });
    if (isBase && hero) {
      const SIDE = 12;
      const lz = new FlexBox({ direction: 'row', align: 'center', gap: SIDE, justify: 'start' });
      lz.add(menu); if (this.autoBtn) lz.add(this.autoBtn);
      const rz = new FlexBox({ direction: 'row', align: 'center', gap: SIDE, justify: 'end' });
      if (this.turboBtn) rz.add(this.turboBtn); if (buy) rz.add(buy);
      const zw = Math.max(lz.measureSize().w, rz.measureSize().w);
      lz.setLayoutSize(zw, undefined); rz.setLayoutSize(zw, undefined);
      controls.add(lz); controls.add(hero); controls.add(rz);
    } else {
      controls.add(menu);
      if (this.autoBtn) controls.add(this.autoBtn);
      if (hero) controls.add(hero);
      if (showFsBlocks) controls.add(readout(this.host, 'Total win', this.host.fmtWin(state.freeSpins.totalWin), { color: '#ffffff', muted: '#ffffff', align: 'center' }));
      if (this.turboBtn) controls.add(this.turboBtn);
    }
    controls.layout();

    // level 2 — small info pill (balance · − bet + · win)
    const betGroup = new FlexBox({ direction: 'row', align: 'center', gap: 6 });
    const feature = state.activeFeature;
    const betShown = feature ? state.bet * feature.priceMultiplier : state.bet;
    if (isBase) {
      this.betDown = new IconButton('minus', { size: 26, glyph: 18, color: '#ffffff', hover: tokens.accent, onTap: () => this.onBet(-1) });
      betGroup.add(this.betDown);
    }
    const bet = new Readout({ label: this.host.t('Bet'), value: this.host.fmt(betShown), muted: feature ? effectiveAccent(feature) : tokens.plaqueLabel, fg: feature ? effectiveAccent(feature) : '#ffffff', valueSize: 11, align: 'center', fixedWidth: 76, shadow: false });
    this.betReadout = bet;
    if (isBase) { bet.eventMode = 'static'; bet.cursor = 'pointer'; bet.on('pointertap', () => { if (!this.betLocked()) this.host.actions.openBetPicker(); }); }
    betGroup.add(bet);
    if (isBase) { this.betUp = new IconButton('plus', { size: 26, glyph: 18, color: '#ffffff', hover: tokens.accent, onTap: () => this.onBet(1) }); betGroup.add(this.betUp); }
    betGroup.layout();

    const innerW = W - 28; // pad 14 each side
    const slot = Math.max(40, (innerW - betGroup.outerWidth - 20) / 2);
    const info = new FlexBox({ direction: 'row', align: 'center', justify: 'space-between', width: W, height: M_INFO_H, padding: { left: 14, right: 14 }, gap: 10, background: { fill: tokens.plaqueGlass, radius: 12 } });
    const bal = readout(this.host, 'Balance', this.host.fmt(state.balance), { valueSize: 11, align: 'left', fixedWidth: slot });
    this.balanceValue = bal.valueText;
    info.add(bal);
    info.add(betGroup);
    // WIN always present (no jiggle on win↔0)
    const win = readout(this.host, 'Win', this.host.fmtWin(state.win), { valueSize: 11, align: 'right', fixedWidth: slot });
    this.winValue = win.valueText;
    info.add(win);
    info.layout();

    // stack (positioned in applyFitMobile)
    this.inner.addChild(controls, info);
    this.mobileControls = controls;
    this.mobileInfo = info;
    this.mobileHeroPop = isBase || showFsBlocks ? SPIN_POP_MOBILE() : 0;
    this.applyBusy();
  }
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
    if (this.host.state.autoplay.active) this.stopAutoplay();
    else this.host.actions.openAutoplayPicker();
  }
  private stopAutoplay(): void {
    this.host.actions.stopAutoplay();
  }
  private betLocked(): boolean {
    return this.host.state.busy || this.host.state.autoplay.active;
  }

  private applyBusy(): void {
    const { state } = this.host;
    const auto = state.autoplay.active;
    const lockBet = state.busy || auto;
    const i = state.availableBets.indexOf(state.bet);
    if (this.betUp) this.betUp.disabled = lockBet || i >= state.availableBets.length - 1;
    if (this.betDown) this.betDown.disabled = lockBet || i <= 0;
    if (this.spin) this.spin.disabled = state.busy && !auto;
    if (this.autoBtn) this.autoBtn.disabled = state.busy && !auto;
    if (this.buy) this.buy.disabled = state.busy || auto || !state.buyBonusEnabled;
    if (this.betReadout && lockBet) { this.betReadout.eventMode = 'none'; this.betReadout.cursor = 'default'; }
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
    if (this.host.layout === 'mobile') { this.applyFitMobile(); return; }
    const { screenW: W, screenH: H, tokens } = this.host;
    const left = this.leftZone!, right = this.rightZone!;
    const buyW = this.buy ? BUY_W + ROW_GAP : 0;

    // content area = buy + panel; panel holds left (hard-left) and right (hard-right) with ≥MID_GAP.
    const neededContent = buyW + PANEL_PAD * 2 + left.outerWidth + MID_GAP + right.outerWidth;
    const designContent = Math.max(MAX_BAR_W - 2 * OUTER_PAD, neededContent);
    const barW = designContent + 2 * OUTER_PAD;
    const s = Math.max(BAR_MIN_SCALE, Math.min(1, W / BAR_REF_W, (W - 2 * OUTER_PAD) / barW));

    // local layout (origin at bar-left = 0)
    const panelCenterY = SPIN_POP + BAR_H / 2;
    const panelX = OUTER_PAD + buyW;
    const panelRight = barW - OUTER_PAD;
    // panel background
    this.panelBg.clear();
    roundedPath(this.panelBg, panelX, SPIN_POP, panelRight - panelX, BAR_H, [12, 12, 12, 12]);
    this.panelBg.fill(tokens.bar);

    if (this.buy) this.buy.position.set(OUTER_PAD, panelCenterY - BUY_W / 2);
    left.position.set(panelX + PANEL_PAD, panelCenterY - left.outerHeight / 2);
    right.position.set(panelRight - PANEL_PAD - right.outerWidth, panelCenterY - right.outerHeight / 2);

    this.inner.scale.set(s);
    this.inner.position.set((W - barW * s) / 2, (H - WIDE_PAD_BOTTOM) - SPIN * s);
    this.measureFootprint();
  }

  private applyFitMobile(): void {
    const { screenW: W, screenH: H } = this.host;
    const controls = this.mobileControls!, info = this.mobileInfo!;
    const pop = this.mobileHeroPop; // how far the hero sticks above the controls bar
    // vertical stack: [controls (hero pops `pop` above)] gap [info]
    const topPad = pop;
    controls.position.set(0, topPad);
    info.position.set(0, topPad + M_CTRL_H + M_GAP);
    const localBottom = topPad + M_CTRL_H + M_GAP + M_INFO_H;

    // When a row's content overflows the bar width, widen BOTH rows to the common content width
    // (mirrors the DOM `.ge-fit .ge-shell-bottom { width:max-content }`) so space-between spreads to a
    // non-negative gap instead of packing the children on top of each other (turbo over the SPIN disc).
    // Equal widths keep the two rows centred on each other; the whole stack then scales down to fit.
    const avail = W - 2 * M_SIDE;
    const need = Math.max(controls.naturalWidth, info.naturalWidth);
    const rowW = Math.max(avail, need);
    controls.setLayoutSize(rowW, undefined);
    info.setLayoutSize(rowW, undefined);
    const s = rowW > 0 ? Math.max(0.4, Math.min(1, avail / rowW)) : 1;

    this.inner.scale.set(s);
    this.inner.position.set((W - rowW * s) / 2, H - localBottom * s - M_PAD_BOTTOM);
    this.measureFootprint();
  }
}

function SPIN_POP_MOBILE(): number {
  return (SPIN - M_CTRL_H) / 2; // 11
}
