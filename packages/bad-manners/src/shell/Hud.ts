import { Container, FillGradient, Graphics, type Text } from 'pixi.js';
import type { SafeArea } from '@energy8platform/shell';
import { bonusBuyLocked, menuLocked, uiScale, type BmCtx } from './context';
import { BuyButton, Field, IconButton, SpinButton } from './components';
import { SIZE } from './theme';

const MARGIN = 40;
/** The bar sits on the bottom edge: only the bubble tails' clearance below it. */
const BOTTOM = 8;
const M_MARGIN = 24;
const GAP = 12;
/** Desktop SPIN / BUY discs (the kit's 128, +25%). */
const DISC = 160;
/** The burger's tail clearance over the disc / readout under it. */
const MENU_GAP = 2;
const M_DISC = 200;
const M_BUY = 150;
const PILL = { w: 64, h: 48 };
/** §5.1's darkening under the HUD. */
const SHADE_H = 260;
const SHADE = new FillGradient({
  type: 'linear',
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
  colorStops: [
    { offset: 0, color: 'rgba(0,0,0,0)' },
    { offset: 1, color: 'rgba(0,0,0,0.55)' },
  ],
  textureSpace: 'local',
});

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The game-screen HUD. Desktop: two bottom columns — left: the menu over the round BUY over BALANCE;
 *  right: autoplay + turbo over SPIN over BET — and WIN centred on the bottom line between them.
 *  Portrait: BALANCE | BET on the bottom row; BUY (menu above it) · SPIN · autoplay/turbo over it; WIN
 *  above SPIN. Rebuilt on every state change. */
export class Hud extends Container {
  balanceValue?: Text;
  winValue?: Text;
  private ctx: BmCtx;
  private shade = new Graphics();
  private stage = new Container();
  private safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  menuBtn!: IconButton;
  spin?: SpinButton;
  buy?: BuyButton;
  autoBtn?: IconButton;
  turboBtn?: IconButton;
  balance?: Field;
  win!: Field;
  bet!: Field;
  totalWin?: Field;

  constructor(ctx: BmCtx) {
    super();
    this.ctx = ctx;
    this.addChild(this.shade, this.stage);
    this.build();
  }

  safeArea(): SafeArea {
    return this.safe;
  }

  /** The burger's screen rect — the menu stacks above it. */
  menuAnchor(): Rect | null {
    if (this.destroyed || this.menuBtn.destroyed) return null;
    const b = this.menuBtn.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  /** While the menu is open the burger shows ✕ (a tap closes it). */
  setMenuOpen(open: boolean): void {
    if (!this.destroyed && !this.menuBtn.destroyed) this.menuBtn.setIcon(open ? 'close' : 'menu');
  }

  // ── build ──────────────────────────────────────────────────────────────────
  private build(): void {
    const { state, config } = this.ctx;
    const t = (s: string) => this.ctx.t(s);
    const tk = this.ctx.ticker;
    const base = state.mode === 'base';
    const fs = state.mode === 'freeSpins' || state.mode === 'bonus' || (state.mode === 'replay' && state.freeSpins.total > 0);
    const portrait = this.ctx.layout === 'mobile';
    const disc = portrait ? M_DISC : DISC;

    this.menuBtn = new IconButton(tk, { icon: 'menu', shape: 'bubble-l', onTap: () => this.ctx.actions.openMenu() });
    this.menuBtn.disabled = menuLocked(state);

    if (!state.replay) {
      this.balance = new Field(tk, { label: t('Balance'), value: this.ctx.fmt(state.balance), tail: 'l', key: 'balance' });
      this.balanceValue = this.balance.valueText;
    }
    this.win = new Field(tk, { label: t('Win'), value: this.ctx.fmtWin(state.win), tail: 'l', minW: 260, key: 'win' });
    this.winValue = this.win.valueText;

    const feature = state.activeFeature;
    const lockBet = state.busy || state.autoplay.active;
    const i = state.availableBets.indexOf(state.bet);
    this.bet = new Field(tk, {
      label: feature ? feature.title : t('Bet'),
      value: this.ctx.fmt(feature ? state.bet * feature.priceMultiplier : state.bet),
      tail: 'r',
      key: 'bet',
      stepper: base
        ? {
            onStep: (d) => this.ctx.actions.stepBet(d),
            downDisabled: lockBet || i <= 0,
            upDisabled: lockBet || i >= state.availableBets.length - 1,
          }
        : undefined,
      onValue: base && !feature && !lockBet ? () => this.ctx.actions.openBetPicker() : undefined,
    });

    if (base) {
      const auto = state.autoplay;
      this.spin = new SpinButton(tk, {
        size: disc,
        mode: auto.active || auto.remaining > 0 ? 'autoplay' : 'spin',
        remaining: auto.remaining,
        turbo: state.turbo > 0,
        onTap: () => (auto.active ? this.ctx.actions.stopAutoplay() : this.ctx.actions.spin()),
      });
      // live through a round (a tap then speeds it up), except as a halted run's resume
      this.spin.disabled = state.busy && !auto.active && auto.remaining > 0;
      this.spin.setBusy(state.busy);
      if (config.features.autoplay) {
        const running = auto.active;
        this.autoBtn = new IconButton(tk, {
          icon: running ? 'stop' : 'autoplay',
          shape: 'pill',
          width: PILL.w,
          height: PILL.h,
          on: running,
          onTap: () => {
            const a = this.ctx.state.autoplay;
            if (a.active || a.remaining > 0) this.ctx.actions.stopAutoplay();
            else this.ctx.actions.openAutoplayPicker();
          },
        });
        this.autoBtn.disabled = state.busy && !running;
      }
      // the round BUY: the face as in the logo (accent tongue); with a feature on, an accent ✕ disc
      if (!state.replay && (config.features.buyBonus !== false || config.onBonusBuy)) {
        this.buy = new BuyButton(tk, {
          size: portrait ? M_BUY : disc,
          active: !!feature,
          onTap: () => (this.ctx.state.activeFeature ? this.ctx.actions.deactivateFeature() : this.ctx.actions.openBuyBonus()),
        });
        this.buy.disabled = bonusBuyLocked(state) && !feature;
      }
    } else if (fs) {
      const f = state.freeSpins;
      const value = state.bonus?.value ?? (f.current == null ? `${f.total}` : `${f.current}/${f.total}`);
      this.spin = new SpinButton(tk, { size: disc, counter: { label: t(state.bonus?.label ?? 'Free spins'), value }, onTap: () => {} });
      this.totalWin = new Field(tk, { label: t('Total win'), value: this.ctx.fmtWin(f.totalWin), tail: 'l', key: 'totalWin' });
    }
    // turbo: off · L1 (lime outline, lime bolt) · L2+ (lime plate, ink bolt)
    if (this.spin && config.features.turbo > 0) {
      const lvl = state.turbo;
      this.turboBtn = new IconButton(tk, {
        icon: 'turbo',
        shape: 'pill',
        width: PILL.w,
        height: PILL.h,
        on: lvl === 1,
        lime: lvl >= 2,
        onTap: () => this.ctx.actions.cycleTurbo(),
      });
    }
  }

  // ── layout ─────────────────────────────────────────────────────────────────
  applyFit(): void {
    const W = this.ctx.screenW;
    const H = this.ctx.screenH;
    this.stage.removeChildren();
    if (this.ctx.layout === 'mobile') this.fitPortrait(W, H);
    else this.fitWide(W, H);
    const shadeTop = H - SHADE_H * this.stage.scale.y;
    this.shade.clear().rect(0, shadeTop, W, H - shadeTop).fill(SHADE);
  }

  /** Autoplay + turbo side by side. */
  private pills(): Container | null {
    const list = [this.autoBtn, this.turboBtn].filter(Boolean) as IconButton[];
    if (!list.length) return null;
    const row = Object.assign(new Container(), { bw: list.length * PILL.w + (list.length - 1) * GAP, bh: PILL.h });
    list.forEach((p, i) => {
      p.x = i * (PILL.w + GAP);
      row.addChild(p);
    });
    return row;
  }

  private fitWide(W: number, H: number): void {
    // columns, bottom-up: [field] under [disc] under [top]; the field's tail clears the bottom edge
    const pills = this.pills();
    const leftTop = this.menuBtn;
    const leftDisc: Container | undefined = this.buy ?? this.totalWin;
    const rightW = Math.max(DISC, this.bet.fw, pills ? w(pills) : 0);
    const leftW = Math.max(this.buy ? DISC : 0, this.totalWin?.fw ?? 0, this.balance?.fw ?? 0, w(leftTop));
    const winW = this.win.fw;
    const need = 2 * MARGIN + leftW + rightW + winW + 4 * GAP;
    const s = Math.min(uiScale(W, H), W / need);
    const Wd = W / s;
    const Hd = H / s;
    this.stage.scale.set(s);

    const fieldY = Hd - BOTTOM - SIZE.field.h; // the bottom row (tails reach the edge)
    const discBottom = fieldY - GAP;
    const discY = discBottom - DISC;

    // right column, centred on one line
    const rx = Wd - MARGIN - rightW;
    const rc = rx + rightW / 2;
    this.bet.position.set(rc - this.bet.fw / 2, fieldY);
    this.stage.addChild(this.bet);
    if (this.spin) {
      this.spin.position.set(rc - DISC / 2, discY);
      this.stage.addChild(this.spin);
      if (pills) {
        pills.position.set(rc - w(pills) / 2, discY - GAP - PILL.h);
        this.stage.addChild(pills);
      }
    }

    // left column: menu over BUY over BALANCE, left-aligned
    const lx = MARGIN;
    if (this.balance) {
      this.balance.position.set(lx, fieldY);
      this.stage.addChild(this.balance);
    }
    // stacked from the bottom: BUY level with SPIN; free spins / replay drop TOTAL WIN and the menu down
    let leftTopY = this.balance ? fieldY : Hd - BOTTOM;
    if (this.buy) {
      this.buy.position.set(lx, discY);
      leftTopY = discY;
    } else if (this.totalWin) {
      this.totalWin.position.set(lx, (this.balance ? fieldY - GAP : Hd - BOTTOM) - this.totalWin.fh);
      leftTopY = this.totalWin.y;
    }
    if (leftDisc) this.stage.addChild(leftDisc);
    leftTop.position.set(lx, leftTopY - MENU_GAP - leftTop.bh);
    this.stage.addChild(leftTop);

    // WIN: on the bottom line, centred between the columns
    const gapL = lx + leftW + GAP;
    const gapR = rx - GAP;
    this.win.position.set(Math.max(gapL, Math.min(gapR - winW, (gapL + gapR - winW) / 2)), fieldY);
    this.stage.addChild(this.win);
    this.safe = {
      top: 0,
      left: Math.ceil((lx + leftW + GAP) * s),
      right: Math.ceil((Wd - rx + GAP) * s),
      bottom: Math.ceil((Hd - fieldY + GAP) * s),
    };
  }

  private fitPortrait(W: number, H: number): void {
    const row1: Field[] = [...(this.balance ? [this.balance] : []), this.bet];
    const need = 2 * M_MARGIN + row1.reduce((a, n) => a + n.fw, 0) + GAP;
    const s = Math.min(uiScale(W, H), W / need);
    const Wd = W / s;
    const Hd = H / s;
    this.stage.scale.set(s);
    const fieldY = Hd - BOTTOM - SIZE.field.h;
    // row 1: BALANCE left, BET right
    if (this.balance) this.balance.position.set(M_MARGIN, fieldY);
    this.bet.position.set(Wd - M_MARGIN - this.bet.fw, fieldY);
    this.stage.addChild(...row1);
    // row 2: BUY (menu above it) left · SPIN centred · autoplay over turbo right
    const discY = fieldY - GAP - M_DISC;
    const cy = discY + M_DISC / 2;
    let top = fieldY;
    if (this.spin) {
      this.spin.position.set((Wd - M_DISC) / 2, discY);
      this.stage.addChild(this.spin);
      top = discY;
    }
    const pills = [this.autoBtn, this.turboBtn].filter(Boolean) as IconButton[];
    pills.forEach((p, i) => {
      p.position.set(Wd - M_MARGIN - PILL.w, cy - (pills.length * PILL.h + (pills.length - 1) * GAP) / 2 + i * (PILL.h + GAP));
      this.stage.addChild(p);
    });
    let leftTop = cy;
    if (this.buy) {
      this.buy.position.set(M_MARGIN, cy - M_BUY / 2);
      this.stage.addChild(this.buy);
      leftTop = this.buy.y;
    } else if (this.totalWin) {
      this.totalWin.position.set(M_MARGIN, (this.balance ? fieldY - GAP : Hd - BOTTOM) - this.totalWin.fh);
      this.stage.addChild(this.totalWin);
      leftTop = this.totalWin.y;
    } else if (!this.balance) {
      leftTop = Hd - BOTTOM;
    }
    this.menuBtn.position.set(M_MARGIN, leftTop - MENU_GAP - this.menuBtn.bh);
    this.stage.addChild(this.menuBtn);
    // WIN above SPIN, centred
    const winY = top - GAP - this.win.fh;
    this.win.position.set((Wd - this.win.fw) / 2, winY);
    this.stage.addChild(this.win);
    const hudTop = Math.min(winY, this.menuBtn.y) - GAP;
    this.safe = { top: 0, right: 0, bottom: Math.ceil(H - hudTop * s), left: 0 };
  }
}

/** Design width of a laid-out piece that carries its own box. */
function w(n: Container): number {
  return (n as unknown as { bw: number }).bw;
}
