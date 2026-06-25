import { Container, Graphics, Text } from 'pixi.js';
import type { ShellHost } from '../context';
import type { IconName } from '../icons';
import { stepBet, nextTurbo } from '../state';
import { effectiveAccent, contrastText } from '../colors';
import { makeText } from '../text';
import { FlexBox } from '../primitives/flex';
import { Spacer } from '../primitives/controls';
import {
  IconButton,
  Readout,
  SpinDisc,
  BuyBonusBadge,
  divider,
} from '../primitives/widgets';

const PLAQUE_H = 56;

// Bar height constants — used by applyFit() and the public `height` getter.
const WIDE_PAD_BOTTOM = 4;     // applyFit: padBottom = 4
const WIDE_SPIN_DISC_H = 86;   // tallest wide element: SpinDisc (86px) bottom-anchors the row
/** Pixel height the wide bar reserves at the bottom of the screen (at scale=1). */
export const WIDE_BAR_H = WIDE_PAD_BOTTOM + WIDE_SPIN_DISC_H; // 90

const MOBILE_PAD_BOTTOM = 8;   // applyFitMobile: bottom offset = 8
// Three rows: top(46) + gap(14) + controls(62) + gap(14) + betRow(46) = 182
const MOBILE_INNER_H = 46 + 14 + 62 + 14 + 46;
/** Pixel height the mobile bar reserves at the bottom of the screen (at scale=1). */
export const MOBILE_BAR_H = MOBILE_PAD_BOTTOM + MOBILE_INNER_H; // 190

// turbo glyph by level — matches BottomBar.turboIcon (0/1 → turbo1, 2 → turbo2, 3 → turbo3).
function turboIcon(level: number): IconName {
  return (['turbo1', 'turbo1', 'turbo2', 'turbo3'] as const)[Math.max(0, Math.min(3, level))];
}

/** A rounded plaque (dark or glass) — `.ge-pl`. */
function plaque(
  host: ShellHost,
  variant: 'dark' | 'glass',
  opts: {
    corners?: [number, number, number, number];
    width?: number;
    height?: number;
    padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
    gap?: number;
    justify?: 'start' | 'center' | 'end' | 'space-between';
  } = {},
): FlexBox {
  return new FlexBox({
    direction: 'row',
    align: 'center',
    justify: opts.justify ?? 'start',
    gap: opts.gap ?? 18,
    padding: opts.padding ?? { left: 20, right: 20 },
    height: opts.height ?? PLAQUE_H,
    width: opts.width,
    background: {
      fill: variant === 'dark' ? host.tokens.plaqueDark : host.tokens.plaqueGlass,
      radius: 16,
      corners: opts.corners,
    },
  });
}

/** Vertical money readout inside a plaque (white value, plaque-label caption, no shadow). */
function plaqueReadout(host: ShellHost, label: string, value: string): Readout {
  return new Readout({
    label: host.t(label),
    value,
    muted: host.tokens.plaqueLabel,
    fg: '#ffffff',
    shadow: false,
  });
}

/** The bottom control bar. Rebuilt on every `render()` (like the DOM shell). Exposes the
 *  balance / win value Texts for count-up and runs the wide/mobile fit-scale reflow. */
export class BottomBar extends Container {
  balanceValue?: Text;
  winValue?: Text;
  private host: ShellHost;
  private inner = new Container();
  // wide structural refs for fit-scale
  private leftZone?: Container;
  private rightZone?: Container;
  private winPill?: WinPill;
  private leftW = 0;
  private rightW = 0;

  constructor(host: ShellHost) {
    super();
    this.host = host;
    this.addChild(this.inner);
    if (host.layout === 'mobile') this.buildMobile();
    else this.buildWide();
  }

  // ── wide / landscape ────────────────────────────────────────────────────────
  private buildWide(): void {
    const { state, config, tokens } = this.host;
    const isBase = state.mode === 'base';
    const isFS = state.mode === 'freeSpins';
    const showFsBlocks = isFS || (state.mode === 'replay' && state.freeSpins.total > 0);

    // LEFT cluster: [menu] (buy) [balance] [FS] [Total win]. A replay is read-only — there's no
    // real balance, so it's hidden (keyed on the sticky `replay` flag, not `mode`).
    const OVERLAP = 16; // .ge-shell-buybonus margin:0 -16px
    const buy = isBase ? this.buildBuyBadge() : null;
    this.buyBadge = buy;
    const showBalance = !state.replay;
    const menu = new IconButton('menu', {
      color: '#ffffff',
      hover: tokens.accent,
      onTap: () => this.host.openMenu(),
    });
    const menuPlaque = plaque(this.host, 'dark', {
      // connects to the balance when shown; rounds on both sides when the balance is hidden
      corners: showBalance ? [16, 0, 0, 16] : [16, 16, 16, 16],
      padding: { left: 20, right: 20 },
    }).add(menu);

    const items: { node: FlexBox; gap: number }[] = [];
    if (showBalance) {
      const balance = plaqueReadout(this.host, 'Balance', this.host.fmt(state.balance));
      this.balanceValue = balance.valueText;
      const balPlaque = plaque(this.host, 'glass', {
        corners: [0, 16, 16, 0],
        padding: { left: 24, right: 20 },
        width: 240,
      }).add(balance);
      // the buy badge overlaps the menu↔balance seam, so the balance shifts right by buyW − 2·overlap
      items.push({ node: balPlaque, gap: buy ? buyBadgeSize(this.host) - 2 * OVERLAP : 0 });
    }

    if (showFsBlocks) {
      const fs = state.freeSpins;
      const fsText = fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`;
      const fsPlaque = plaque(this.host, 'glass', { padding: { left: 16, right: 16 } }).add(
        plaqueReadout(this.host, 'Free spins', fsText),
      );
      const twPlaque = plaque(this.host, 'glass').add(
        plaqueReadout(this.host, 'Total win', this.host.fmtWin(fs.totalWin)),
      );
      items.push({ node: fsPlaque, gap: 8 }, { node: twPlaque, gap: 8 }); // .ge-pl-fs/totalwin margin-left:8
    }

    const left = new Container();
    this.layoutLeftCluster(left, menuPlaque, buy, items);
    this.leftZone = left;

    // RIGHT cluster: [bet | divider | auto SPIN turbo]
    const right = isBase || isFS || state.mode === 'replay' ? this.buildRight(isBase) : new Container();
    this.rightZone = right;

    // MIDDLE win pill
    this.winPill = state.win > 0 ? this.buildWinPill() : undefined;
    if (this.winPill) this.winValue = this.winPill.value;

    this.inner.addChild(left, right);
    if (this.winPill) this.inner.addChild(this.winPill);

    this.applyBusy();
  }

  /** Lay out [menu](buy)[items…] in flow; each item carries its own left gap. The buy badge (when
   *  present) overlaps the menu↔first-item seam and renders on top. */
  private layoutLeftCluster(
    host: Container,
    menuPlaque: FlexBox,
    buy: BuyBonusBadge | null,
    items: { node: FlexBox; gap: number }[],
  ): void {
    const OVERLAP = 16; // .ge-shell-buybonus margin:0 -16px
    // measure the plaques (FlexBox.outerWidth is only valid after layout()).
    menuPlaque.layout();
    for (const it of items) it.node.layout();
    menuPlaque.position.set(0, 0);
    let x = menuPlaque.outerWidth;
    const nodes: Container[] = [menuPlaque];
    for (const it of items) {
      x += it.gap;
      it.node.position.set(x, 0);
      x += it.node.outerWidth;
      nodes.push(it.node);
    }
    host.addChild(...nodes);
    if (buy) {
      buy.position.set(menuPlaque.outerWidth - OVERLAP, (PLAQUE_H - buyBadgeSize(this.host)) / 2);
      host.addChild(buy); // last → renders on top (z-index:3)
    }
    this.leftW = x;
  }

  private buildBuyBadge(): BuyBonusBadge | null {
    const { state, config } = this.host;
    if (config.features.buyBonus === false && !config.onBonusBuy) return null;
    const feature = state.activeFeature;
    if (feature) {
      const accent = effectiveAccent(feature);
      return new BuyBonusBadge({
        bg: accent,
        fg: contrastText(accent),
        label: this.host.t('DISABLE'),
        tokens: this.host.tokens,
        ticker: this.host.ticker,
        onTap: () => this.host.deactivateFeature(),
      });
    }
    return new BuyBonusBadge({
      bg: this.host.tokens.accent,
      fg: '#ffffff',
      label: twoLine(this.host.t('BUY BONUS')),
      tokens: this.host.tokens,
      ticker: this.host.ticker,
      onTap: () => this.host.openBuyBonus(),
    });
  }

  private buildRight(isBase: boolean): Container {
    const { state, config, tokens } = this.host;
    const feature = state.activeFeature;
    const betShown = feature ? state.bet * feature.priceMultiplier : state.bet;
    const betReadout = new Readout({
      label: this.host.t('Bet'),
      value: this.host.fmt(betShown),
      muted: feature ? effectiveAccent(feature) : tokens.plaqueLabel,
      fg: feature ? effectiveAccent(feature) : '#ffffff',
      shadow: false,
    });
    if (isBase) {
      betReadout.eventMode = 'static';
      betReadout.cursor = 'pointer';
      betReadout.on('pointertap', () => {
        if (!this.betLocked()) this.host.openBetPicker();
      });
    }

    const betChildren: Container[] = [betReadout];
    if (isBase) {
      // stacked +/− — the DOM step is two 24px-glyph icon buttons (.ge-iconbtn font-size:24, h:24)
      const step = new FlexBox({ direction: 'column', gap: 0, align: 'center' });
      this.betUp = new IconButton('plus', { size: 26, glyph: 24, color: '#ffffff', hover: tokens.accent, onTap: () => this.onBet(1) });
      this.betDown = new IconButton('minus', { size: 26, glyph: 24, color: '#ffffff', hover: tokens.accent, onTap: () => this.onBet(-1) });
      step.add(this.betUp);
      step.add(this.betDown);
      betChildren.push(step);
    }
    const betPlaque = plaque(this.host, 'dark', {
      corners: [16, 0, 0, 16],
      width: 210,
      justify: 'space-between',
      padding: { left: 20, right: 8 },
    });
    for (const c of betChildren) betPlaque.add(c);
    this.betReadout = betReadout;

    const div = divider(tokens, 30);

    // spinwrap: auto · SPIN · turbo. auto/SPIN are base-mode only (DOM gates them on isBase);
    // turbo shows in every mode.
    const spinWrap = plaque(this.host, 'dark', {
      corners: [0, 16, 16, 0],
      gap: 10,
      padding: { left: 14, right: 8 },
    });
    if (isBase && config.features.autoplay) {
      this.autoBtn = new IconButton('autoplay', {
        color: '#ffffff',
        hover: tokens.accent,
        activeColor: tokens.accent,
        active: state.autoplay.active,
        onTap: () => this.onAutoplay(),
      });
      if (state.autoplay.active) this.autoBtn.setGlow(true);
      spinWrap.add(this.autoBtn);
    }
    if (isBase) {
      this.spin = new SpinDisc({
        tokens,
        ticker: this.host.ticker,
        onSpin: () => this.host.emit('spin'),
        onStop: () => this.stopAutoplay(),
      });
      if (state.autoplay.active) this.spin.setAutoplay(true, state.autoplay.remaining);
      if (state.busy) this.spin.setBusy(true);
      spinWrap.add(this.spin);
    }
    if (config.features.turbo > 0) {
      this.turboBtn = new IconButton(turboIcon(state.turbo), {
        color: '#ffffff',
        hover: tokens.accent,
        activeColor: '#ffffff',
        active: state.turbo > 0,
        onTap: () => this.onTurbo(),
      });
      this.turboBtn.alpha = state.turbo > 0 ? 1 : 0.5; // resting turbo reads dimmed
      spinWrap.add(this.turboBtn);
    }

    const right = new Container();
    betPlaque.layout();
    spinWrap.layout();
    betPlaque.position.set(0, 0);
    div.position.set(betPlaque.outerWidth, (PLAQUE_H - 30) / 2);
    spinWrap.position.set(betPlaque.outerWidth + 1, 0);
    right.addChild(betPlaque, div, spinWrap);
    this.rightW = betPlaque.outerWidth + 1 + spinWrap.outerWidth;
    return right;
  }

  private buildWinPill(): WinPill {
    return new WinPill(this.host, this.host.t('Win'), this.host.fmtWin(this.host.state.win));
  }

  // ── interactive handlers ────────────────────────────────────────────────────
  private betReadout?: Readout;
  private betUp?: IconButton;
  private betDown?: IconButton;
  private buyBadge?: BuyBonusBadge | null;
  private spin?: SpinDisc;
  private autoBtn?: IconButton;
  private turboBtn?: IconButton;

  private onBet(dir: 1 | -1): void {
    const { state } = this.host;
    if (state.busy) return;
    const next = stepBet(state, dir);
    if (next !== state.bet) {
      state.bet = next;
      this.host.emit('betChange', next);
      this.host.render();
    }
  }
  private onTurbo(): void {
    const { state, config } = this.host;
    const next = nextTurbo(state.turbo, config.features.turbo);
    state.turbo = next;
    this.host.emit('turboChange', next);
    this.host.render();
  }
  private onAutoplay(): void {
    if (this.host.state.autoplay.active) this.stopAutoplay();
    else this.host.openAutoplayPicker();
  }
  private stopAutoplay(): void {
    this.host.state.autoplay = { active: false, remaining: 0 };
    this.host.emit('autoplayStop');
    this.host.render();
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
    // disabled for the whole autoplay run (not just per-spin busy) so it doesn't flicker/pulse
    if (this.buyBadge) this.buyBadge.disabled = state.busy || auto || !state.buyBonusEnabled;
    if (this.betReadout && lockBet) {
      this.betReadout.eventMode = 'none';
      this.betReadout.cursor = 'default';
    }
    // buy badge handled in build (feature/disabled state). Disable while busy/autoplay.
  }

  // ── mobile / portrait ───────────────────────────────────────────────────────
  private buildMobile(): void {
    const { state, config, tokens } = this.host;
    const isBase = state.mode === 'base';
    const isFS = state.mode === 'freeSpins';
    const showFsBlocks = isFS || (state.mode === 'replay' && state.freeSpins.total > 0);
    const W = this.host.screenW - 24; // padding 0 12

    // top: balance · win (glass). A replay is read-only → no balance (keyed on the sticky flag).
    const top = plaque(this.host, 'glass', {
      width: W,
      height: 46,
      justify: 'space-between',
      padding: { left: 16, right: 16 },
      gap: 0, // .ge-m-top is space-between only (no gap) — keep the natural width honest for the fit
    });
    if (!state.replay) {
      const bal = plaqueReadout(this.host, 'Balance', this.host.fmt(state.balance));
      this.balanceValue = bal.valueText;
      top.add(bal); // balance always hugs the left
    }
    top.add(new Spacer(), { grow: 1 }); // fills the gap so balance stays left and win stays right
    if (state.win > 0) {
      const win = new WinPillInline(this.host, this.host.t('Win'), this.host.fmtWin(state.win));
      this.winValue = win.value;
      top.add(win); // win always hugs the right
    }

    // controls: menu · auto · spin · fs · totalwin · turbo · buy (dark, white).
    // No gap — the DOM .ge-m-controls is space-between only; a min-gap would inflate the natural
    // width and trigger a false fit-scale (excess right padding on narrow phones).
    const controls = plaque(this.host, 'dark', {
      width: W,
      height: 62,
      justify: 'space-between',
      padding: { left: 18, right: 18 },
      gap: 0, // space-between only — plaque()'s default gap (18) inflated the natural width by 4×18,
      //         falsely tripping the fit-scale on narrow phones (over-shrunk → big side padding).
    });
    const menuBtn = new IconButton('menu', { color: '#fff', hover: tokens.accent, onTap: () => this.host.openMenu() });
    if (config.features.autoplay) {
      this.autoBtn = new IconButton('autoplay', {
        color: '#fff',
        hover: tokens.accent,
        activeColor: tokens.accent,
        active: state.autoplay.active,
        onTap: () => this.onAutoplay(),
      });
      if (state.autoplay.active) this.autoBtn.setGlow(true);
    }
    if (isBase) {
      // DOM mobile center = isBase ? spin : null — the disc (incl. the autoplay STOP) shows only in
      // base, same as the wide path; freeSpins/replay never render it.
      this.spin = new SpinDisc({
        size: 84,
        glyph: 66,
        tokens,
        ticker: this.host.ticker,
        onSpin: () => this.host.emit('spin'),
        onStop: () => this.stopAutoplay(),
      });
      if (state.autoplay.active) this.spin.setAutoplay(true, state.autoplay.remaining);
      if (state.busy) this.spin.setBusy(true);
    }
    if (config.features.turbo > 0) {
      this.turboBtn = new IconButton(turboIcon(state.turbo), {
        color: '#fff',
        hover: tokens.accent,
        activeColor: '#fff',
        active: state.turbo > 0,
        onTap: () => this.onTurbo(),
      });
      this.turboBtn.alpha = state.turbo > 0 ? 1 : 0.5;
    }
    const buy = isBase ? this.buildBuyBadgeMobile() : null;
    this.buyBadge = buy;

    if (isBase && this.spin) {
      // Keep the SPIN disc centred in the bar regardless of which optional side buttons exist:
      // split into equal-width left/right zones (menu·auto | spin | turbo·buy). With both zones the
      // same width and equal L/R bar padding, space-between lands the disc at the exact centre —
      // so dropping the auto or turbo button no longer shifts it left/right.
      const SIDE_GAP = 12;
      const leftZone = new FlexBox({ direction: 'row', align: 'center', gap: SIDE_GAP, justify: 'start' });
      leftZone.add(menuBtn);
      if (this.autoBtn) leftZone.add(this.autoBtn);
      const rightZone = new FlexBox({ direction: 'row', align: 'center', gap: SIDE_GAP, justify: 'end' });
      if (this.turboBtn) rightZone.add(this.turboBtn);
      if (buy) rightZone.add(buy);
      const zoneW = Math.max(leftZone.measureSize().w, rightZone.measureSize().w);
      leftZone.setLayoutSize(zoneW, undefined);
      rightZone.setLayoutSize(zoneW, undefined);
      controls.add(leftZone);
      controls.add(this.spin);
      controls.add(rightZone);
    } else {
      // FS / replay: no spin disc — flow the items (menu · auto? · free-spins · total win · turbo?).
      controls.add(menuBtn);
      if (this.autoBtn) controls.add(this.autoBtn);
      if (showFsBlocks) {
        const fs = state.freeSpins;
        const fsText = fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`;
        controls.add(mobileReadout(this.host, 'Free spins', fsText));
        controls.add(mobileReadout(this.host, 'Total win', this.host.fmtWin(fs.totalWin)));
      }
      if (this.turboBtn) controls.add(this.turboBtn);
    }

    // bet: − value + (dark)
    const betRow = plaque(this.host, 'dark', {
      width: W,
      height: 46,
      justify: 'space-between',
      padding: { left: 18, right: 18 },
      gap: 8,
    });
    if (isBase) {
      this.betDown = new IconButton('minus', { color: '#fff', hover: tokens.accent, onTap: () => this.onBet(-1) });
      betRow.add(this.betDown);
    }
    const feature = state.activeFeature;
    const betShown = feature ? state.bet * feature.priceMultiplier : state.bet;
    const betR = new Readout({
      label: this.host.t('Bet'),
      value: this.host.fmt(betShown),
      muted: feature ? effectiveAccent(feature) : '#fff',
      fg: feature ? effectiveAccent(feature) : '#fff',
      // centred between the +/− steppers in base; a plain stake readout (FS/replay) hugs the left
      align: isBase ? 'center' : 'left',
      shadow: false,
    });
    this.betReadout = betR;
    if (isBase) {
      betR.eventMode = 'static';
      betR.cursor = 'pointer';
      betR.on('pointertap', () => {
        if (!this.betLocked()) this.host.openBetPicker();
      });
    }
    betRow.add(betR);
    if (isBase) {
      this.betUp = new IconButton('plus', { color: '#fff', hover: tokens.accent, onTap: () => this.onBet(1) });
      betRow.add(this.betUp);
    }

    // stack the three rows centered
    top.layout();
    controls.layout();
    betRow.layout();
    const rows = [top, controls, betRow];
    let y = 0;
    for (const r of rows) {
      r.position.set(0, y);
      y += (r as FlexBox).outerHeight + 14; // gap 14
    }
    this.inner.addChild(top, controls, betRow);
    this.applyBusy();
  }

  private buildBuyBadgeMobile(): BuyBonusBadge | null {
    const { state, config, tokens } = this.host;
    if (config.features.buyBonus === false && !config.onBonusBuy) return null;
    const feature = state.activeFeature;
    if (feature) {
      const accent = effectiveAccent(feature);
      return new BuyBonusBadge({
        size: 50,
        fontSize: 9,
        border: 2,
        bg: accent,
        fg: contrastText(accent),
        label: this.host.t('DISABLE'),
        tokens,
        ticker: this.host.ticker,
        onTap: () => this.host.deactivateFeature(),
      });
    }
    return new BuyBonusBadge({
      size: 50,
      fontSize: 9,
      border: 2,
      bg: tokens.accent,
      fg: '#fff',
      label: twoLine(this.host.t('BUY BONUS')),
      tokens,
      ticker: this.host.ticker,
      onTap: () => this.host.openBuyBonus(),
    });
  }

  // ── positioning / fit-scale (called by the shell after construction) ─────────

  /** Pixel height this bar reserves at the bottom of the screen.
   *  Reflects the current wide/mobile layout at scale=1 (the shell never clips the bar taller
   *  than this). Correct immediately after construction; does not change until `applyFit()` is
   *  called with a different layout. */
  get height(): number {
    return this.host.layout === 'mobile' ? MOBILE_BAR_H : WIDE_BAR_H;
  }

  applyFit(): void {
    if (this.host.layout === 'mobile') {
      this.applyFitMobile();
      return;
    }
    const W = this.host.screenW;
    const H = this.host.screenH;
    const padX = 18;
    const padBottom = WIDE_PAD_BOTTOM; // sits the bar lower toward the frame edge (was 14)
    const GAP = 14; // .ge-shell-bottom { gap:14px } between zones
    const centerY = H - padBottom - WIDE_SPIN_DISC_H / 2; // tallest element (SPIN disc) bottom-anchored
    const winCenterY = centerY - PLAQUE_H / 2;
    const plaqueTop = centerY - PLAQUE_H / 2;
    this.inner.scale.set(1);
    this.inner.position.set(0, 0);

    const winW = this.winPill ? this.winPill.outerWidth : 0;
    // The WIN pill stays inline between the zones only while the whole row (incl. the pill) fits;
    // otherwise it lifts onto its own line above the bar (matching the DOM fit behaviour).
    const naturalInline = padX + this.leftW + GAP + (winW ? winW + GAP : 0) + this.rightW + padX;
    const winInline = !!this.winPill && naturalInline <= W;
    // Row natural width with the pill counted only when it sits inline.
    const rowNatural = padX + this.leftW + GAP + (winInline ? winW + GAP : 0) + this.rightW + padX;
    const overflow = rowNatural > W;

    if (this.leftZone) this.leftZone.position.set(padX, plaqueTop);

    if (overflow) {
      // pack zones in flow (left · win? · right), then scale the row to fit, bottom-centre anchored
      let x = padX + this.leftW + GAP;
      if (winInline && this.winPill) {
        this.winPill.setLifted(false);
        this.winPill.position.set(x, winCenterY);
        x += winW + GAP;
      }
      if (this.rightZone) this.rightZone.position.set(x, plaqueTop);
      if (this.winPill && !winInline) {
        this.winPill.setLifted(true);
        this.winPill.position.set((rowNatural - this.winPill.outerWidth) / 2, plaqueTop - this.winPill.outerHeight - 8);
      }
      const s = W / rowNatural;
      this.inner.scale.set(s);
      this.inner.position.set((W - rowNatural * s) / 2, (H - padBottom) * (1 - s));
    } else {
      // fits → space-between: left flush-left, right flush-right, win centred (inline or lifted)
      if (this.rightZone) this.rightZone.position.set(W - padX - this.rightW, plaqueTop);
      if (this.winPill) {
        this.winPill.setLifted(!winInline);
        if (winInline) {
          // centre the pill in the GAP between the clusters (like flex space-between), not the whole
          // frame — a frame-centred pill overlaps the Total win plaque on the left in FS mode.
          const gapMid = (padX + this.leftW + (W - padX - this.rightW)) / 2;
          this.winPill.position.set(gapMid - winW / 2, winCenterY);
        } else {
          this.winPill.position.set((W - winW) / 2, plaqueTop - this.winPill.outerHeight - 8);
        }
      }
    }
  }

  private applyFitMobile(): void {
    const W = this.host.screenW;
    const H = this.host.screenH;
    // Measure each row's NATURAL content width (the fixed-width plaque clamps it, so getLocalBounds
    // would always read W-24 and hide overflow). Big balance/win numbers overflow → scale the stack.
    let need = 0;
    for (const r of this.inner.children) {
      const nat = r instanceof FlexBox ? r.naturalWidth : (r as Container).getLocalBounds().width;
      need = Math.max(need, nat);
    }
    const avail = W - 24;
    const s = need > avail + 1 && avail > 0 ? Math.max(0.4, avail / need) : 1;
    const b = this.inner.getLocalBounds();
    this.inner.scale.set(s);
    // Centre the scaled stack so left/right padding match. It was anchored at x=12, so once the
    // stack scaled down on narrow phones (mobile-s) it left a big gap on the right edge.
    this.inner.position.set((W - b.width * s) / 2 - b.x * s, H - b.height * s - MOBILE_PAD_BOTTOM);
  }
}

// ── win pill (wide) — `.ge-winpill` ────────────────────────────────────────────
class WinPill extends Container {
  readonly value: Text;
  private bg = new Graphics();
  private labelText: Text;
  private host: ShellHost;
  private lifted = false;
  outerWidth = 0;
  outerHeight = PLAQUE_H;

  constructor(host: ShellHost, label: string, value: string) {
    super();
    this.host = host;
    this.labelText = makeText(label, {
      size: 10,
      weight: '700',
      color: 'rgba(255,255,255,.7)',
      letterSpacing: 1.2,
      upper: true,
    });
    this.value = makeText(value, { size: 16, weight: '800', color: '#ffffff' });
    this.addChild(this.bg, this.labelText, this.value);
    this.draw();
  }

  setLifted(v: boolean): void {
    if (v === this.lifted) return;
    this.lifted = v;
    this.draw();
  }

  private draw(): void {
    const padX = this.lifted ? 16 : 24;
    const h = this.lifted ? this.labelText.height + 12 : PLAQUE_H;
    const gap = 8;
    const contentW = this.labelText.width + gap + this.value.width;
    const w = contentW + padX * 2;
    this.bg.clear();
    this.bg.roundRect(0, 0, w, h, this.lifted ? 999 : 16);
    this.bg.fill(this.host.tokens.plaqueGlass);
    // Centre the value's CAP height (the digits) in the pill — NOT its full ink box, whose height
    // trim extends down to the comma's descender, which would lift the digits up and leave uneven
    // top/bottom padding (worse the shorter the pill). The small WIN label then centres on the caps.
    const valCapH = 16 * 0.72; // value font (16px) cap height, excluding the comma descender
    const valTop = (h - valCapH) / 2;
    this.value.position.set(padX + this.labelText.width + gap, valTop);
    this.labelText.position.set(padX, valTop + (valCapH - this.labelText.height) / 2);
    this.outerWidth = w;
    this.outerHeight = h;
  }
}

// ── win readout inline (mobile top row) — same as WinPill but transparent (sits in glass plaque) ──
class WinPillInline extends Container {
  readonly value: Text;
  constructor(host: ShellHost, label: string, value: string) {
    super();
    const r = new Readout({
      label,
      value,
      muted: host.tokens.plaqueLabel,
      fg: '#ffffff',
      align: 'right', // win always hugs the right edge of the mobile top row
      shadow: false,
    });
    this.value = r.valueText;
    this.addChild(r);
  }
}

function mobileReadout(host: ShellHost, label: string, value: string): Readout {
  return new Readout({ label: host.t(label), value, muted: '#ffffff', fg: '#ffffff', align: 'center', shadow: false });
}

/** Render a two-word label across two lines (the BUY BONUS badge). */
function twoLine(label: string): string {
  return label.split(/\s+/).join('\n');
}

function buyBadgeSize(_host: ShellHost): number {
  return 80;
}
