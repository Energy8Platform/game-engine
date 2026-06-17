import { Container, Graphics, Text } from 'pixi.js';
import type { ShellHost } from '../context';
import type { IconName } from '../icons';
import { stepBet, nextTurbo } from '../state';
import { effectiveAccent, contrastText } from '../colors';
import { makeText } from '../text';
import { FlexBox } from '../primitives/flex';
import {
  IconButton,
  Readout,
  SpinDisc,
  BuyBonusBadge,
  divider,
} from '../primitives/widgets';

const PLAQUE_H = 56;

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

    // LEFT cluster: [menu] (buy) [balance] [FS] [Total win]
    const menu = new IconButton('menu', {
      color: '#ffffff',
      hover: tokens.accent,
      onTap: () => this.host.openSettings(),
    });
    const menuPlaque = plaque(this.host, 'dark', {
      corners: [16, 0, 0, 16],
      padding: { left: 20, right: 20 },
    }).add(menu);

    const balance = plaqueReadout(this.host, 'Balance', this.host.fmt(state.balance));
    this.balanceValue = balance.valueText;
    const balPlaque = plaque(this.host, 'glass', {
      corners: [0, 16, 16, 0],
      padding: { left: 24, right: 20 },
      width: 240,
    }).add(balance);

    const leftItems: Container[] = [menuPlaque, balPlaque];

    if (showFsBlocks) {
      const fs = state.freeSpins;
      const fsText = fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`;
      const fsPlaque = plaque(this.host, 'glass', { padding: { left: 16, right: 16 } }).add(
        plaqueReadout(this.host, 'Free spins', fsText),
      );
      const twPlaque = plaque(this.host, 'glass').add(
        plaqueReadout(this.host, 'Total win', this.host.fmtWin(fs.totalWin)),
      );
      leftItems.push(fsPlaque, twPlaque);
    }

    // BUY BONUS badge overlaps the menu↔balance seam (z above both).
    const buy = isBase ? this.buildBuyBadge() : null;

    const left = new Container();
    this.layoutLeftCluster(left, menuPlaque, buy, balPlaque, leftItems.slice(2));
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

  /** Lay out [menu](buy)[balance][fs…] with the buy badge overlapping the menu/balance seam. */
  private layoutLeftCluster(
    host: Container,
    menuPlaque: FlexBox,
    buy: BuyBonusBadge | null,
    balPlaque: FlexBox,
    rest: Container[],
  ): void {
    const OVERLAP = 16; // .ge-shell-buybonus margin:0 -16px
    let x = 0;
    menuPlaque.position.set(x, 0);
    x += menuPlaque.outerWidth;
    let balX = x;
    if (buy) balX = x - OVERLAP + buyBadgeSize(this.host) - OVERLAP;
    balPlaque.position.set(balX, 0);
    x = balX + balPlaque.outerWidth;
    for (const r of rest) {
      x += 8; // .ge-pl-fs / .ge-pl-totalwin margin-left:8
      (r as FlexBox).position.set(x, 0);
      x += (r as FlexBox).outerWidth;
    }
    host.addChild(menuPlaque, balPlaque, ...rest);
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
      // tighter chevrons stacked (the DOM step is two 24px-tall icon buttons)
      const step = new FlexBox({ direction: 'column', gap: 0, align: 'center' });
      this.betUp = new IconButton('plus', { size: 30, glyph: 20, color: '#ffffff', hover: tokens.accent, onTap: () => this.onBet(1) });
      this.betDown = new IconButton('minus', { size: 30, glyph: 20, color: '#ffffff', hover: tokens.accent, onTap: () => this.onBet(-1) });
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

    // top: balance · win (glass)
    const top = plaque(this.host, 'glass', {
      width: W,
      height: 46,
      justify: 'space-between',
      padding: { left: 16, right: 16 },
    });
    const bal = plaqueReadout(this.host, 'Balance', this.host.fmt(state.balance));
    this.balanceValue = bal.valueText;
    top.add(bal);
    if (state.win > 0) {
      const win = new WinPillInline(this.host, this.host.t('Win'), this.host.fmtWin(state.win));
      this.winValue = win.value;
      top.add(win);
    }

    // controls: menu · auto · spin · fs · totalwin · turbo · buy (dark, white)
    const controls = plaque(this.host, 'dark', {
      width: W,
      height: 62,
      justify: 'space-between',
      padding: { left: 18, right: 18 },
      gap: 10,
    });
    const ctlItems: Container[] = [];
    ctlItems.push(
      new IconButton('menu', { color: '#fff', hover: tokens.accent, onTap: () => this.host.openSettings() }),
    );
    if (config.features.autoplay) {
      this.autoBtn = new IconButton('autoplay', {
        color: '#fff',
        hover: tokens.accent,
        activeColor: tokens.accent,
        active: state.autoplay.active,
        onTap: () => this.onAutoplay(),
      });
      if (state.autoplay.active) this.autoBtn.setGlow(true);
      ctlItems.push(this.autoBtn);
    }
    if (isBase || state.autoplay.active) {
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
      ctlItems.push(this.spin);
    }
    if (showFsBlocks) {
      const fs = state.freeSpins;
      const fsText = fs.current == null ? `${fs.total}` : `${fs.current} / ${fs.total}`;
      ctlItems.push(mobileReadout(this.host, 'Free spins', fsText));
      ctlItems.push(mobileReadout(this.host, 'Total win', this.host.fmtWin(fs.totalWin)));
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
      ctlItems.push(this.turboBtn);
    }
    if (isBase) {
      const buy = this.buildBuyBadgeMobile();
      if (buy) ctlItems.push(buy);
    }
    for (const c of ctlItems) controls.add(c);

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
      align: 'center',
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
  applyFit(): void {
    if (this.host.layout === 'mobile') {
      this.applyFitMobile();
      return;
    }
    const W = this.host.screenW;
    const H = this.host.screenH;
    const padX = 18;
    const padBottom = 14;
    const centerY = H - padBottom - 86 / 2; // tallest element (SPIN disc) bottom-anchored
    this.inner.scale.set(1);
    this.inner.position.set(0, 0);

    // place zones at edges, vertically centred on the plaque row (56) which sits on centerY
    const plaqueTop = centerY - PLAQUE_H / 2;
    if (this.leftZone) this.leftZone.position.set(padX, plaqueTop);
    if (this.rightZone) this.rightZone.position.set(W - padX - this.rightW, plaqueTop);

    const leftRight = padX + this.leftW + this.rightW + padX;
    const winW = this.winPill ? this.winPill.outerWidth : 0;
    const inlineNeed = leftRight + (winW ? winW + 28 : 0);

    if (this.winPill) {
      if (inlineNeed <= W) {
        // inline, centred between the zones
        this.winPill.setLifted(false);
        this.winPill.position.set((W - this.winPill.outerWidth) / 2, centerY - PLAQUE_H / 2);
      } else {
        // lift above the bar
        this.winPill.setLifted(true);
        this.winPill.position.set((W - this.winPill.outerWidth) / 2, plaqueTop - this.winPill.outerHeight - 8);
      }
    }

    // still too wide → scale the whole bar down, anchored bottom-centre
    if (leftRight > W) {
      const s = W / leftRight;
      this.inner.scale.set(s);
      this.inner.position.set((W - leftRight * s) / 2 - 0, H - (H - 0) * 0); // keep left origin; shift handled below
      // re-anchor: scale around bottom-centre
      this.inner.position.set((W * (1 - s)) / 2, (H - padBottom) * (1 - s));
    }
  }

  private applyFitMobile(): void {
    const W = this.host.screenW;
    const H = this.host.screenH;
    let need = 0;
    for (const r of this.inner.children) need = Math.max(need, (r as Container).getLocalBounds().width);
    const avail = W - 24;
    const s = need > avail + 1 && avail > 0 ? Math.max(0.7, avail / need) : 1;
    // total stack height
    const stackH = this.inner.getLocalBounds().height;
    this.inner.scale.set(s);
    this.inner.position.set((W - W * s) / 2 + 12 * s, H - stackH * s - 8);
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
    this.labelText.position.set(padX, (h - this.labelText.height) / 2);
    this.value.position.set(padX + this.labelText.width + gap, (h - this.value.height) / 2);
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
      align: 'center',
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
