import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import type { BonusOption } from '@/core/types';
import { groupBonusSlots } from '@/core/bonusGroups';
import { betDir } from '@/core/keyboard';
import { makeText } from '../text';
import { makeIcon } from '../pixi-icon';
import { clamp, navButton } from '../primitives/overlay';
import { plaque } from '../primitives/plaque';
import { CardModal } from '../primitives/card';
import { ScrollBox } from '../primitives/scroll';
import { IconButton, Readout, TextButton } from '../primitives/widgets';
import { HB, BORDER } from '../theme';

/** Buy-bonus: no frame — over the frosted game a ✕ in the top-right corner, a vertical,
 *  always-scrolling list of mode CARDS (two per row on a wide screen, one otherwise) and a balance /
 *  bet band pinned to the bottom. Each card: hero on its left third behind a divider, then the title
 *  (with ‹ › when the slot is a `groupedBy` group), volatility, description and a bottom-pinned CTA.
 *  Returns null when there are no bonus options. */
export function openBuyBonus(host: PixiComponentContext): ShellLayer | null {
  const bonuses = host.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;
  return new BuyBonusPage(host, bonuses);
}

const BET_BAND_H = 64;
const HERO_FRACTION = 0.33;
const CARD_GAP = 12;
/** Two cards per row from this content width up. */
const TWO_UP_MIN_W = 640;

export class BuyBonusPage extends Container implements ShellLayer {
  readonly tag = 'buybonus';
  private host: PixiComponentContext;
  private veil = new Graphics();
  private closeBtn?: Container;
  /** Card slots — a `groupedBy` group is one slot with several members. */
  readonly slots: BonusOption[][];
  /** Which member each group slot shows; kept across rebuilds (bet steps, resizes). */
  private groupIndex = new Map<number, number>();
  private scroll?: ScrollBox;
  private band = new Container();
  private confirm?: CardModal;
  private confirmBonus?: BonusOption;
  /** CTA per slot, in slot order — for tests. */
  ctas: TextButton[] = [];

  constructor(host: PixiComponentContext, bonuses: BonusOption[]) {
    super();
    this.host = host;
    this.slots = groupBonusSlots(bonuses);
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.addChild(this.veil, this.band);
    this.resize(host.screenW, host.screenH);
  }

  /** The option a slot currently shows. */
  current(slot: number): BonusOption {
    const members = this.slots[slot];
    return members[(this.groupIndex.get(slot) ?? 0) % members.length];
  }

  /** Flip a group slot to another member (wraps). */
  step(slot: number, dir: 1 | -1): void {
    const n = this.slots[slot].length;
    if (n < 2) return;
    this.groupIndex.set(slot, ((((this.groupIndex.get(slot) ?? 0) + dir) % n) + n) % n);
    this.rebuild();
  }

  private w = 0;
  private h = 0;

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.veil.clear().rect(0, 0, w, h).fill(HB.backdrop);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    this.removeConfirm();
    this.rebuild();
  }

  fit(): void {
    /* re-laid out on resize */
  }

  private isAffordable(bonus: BonusOption): boolean {
    const s = this.host.state;
    if (s.busy || !s.buyBonusEnabled) return false;
    return bonus.priceMultiplier * s.bet <= s.balance;
  }

  private isActive(bonus: BonusOption): boolean {
    return this.host.state.activeFeature?.id === bonus.id;
  }

  // ── page ────────────────────────────────────────────────────────────────────
  private rebuild(): void {
    const em = clamp(11, this.h / 36, 15);
    const pad = clamp(12, em * 1.2, 20);
    const nav = clamp(36, this.h * 0.08, 48);
    // ✕ in the top-right corner; the cards start below it
    this.closeBtn?.destroy({ children: true });
    this.closeBtn = navButton(this.host, 'close', () => this.host.closeLayer(), nav);
    this.closeBtn.position.set(this.w - pad - nav, pad);
    this.addChild(this.closeBtn);
    const top = pad + nav + pad * 0.5;
    const betH = Math.min(BET_BAND_H, this.h * 0.16);
    const listH = this.h - top - betH - pad;
    const r = new Rectangle(0, top, this.w, listH);

    // the card list scrolls
    if (this.scroll) {
      this.removeChild(this.scroll);
      this.scroll.destroy({ children: true });
    }
    const scroll = new ScrollBox(this.host.canvas, this.host.ticker);
    this.scroll = scroll;
    this.addChildAt(scroll, 1);
    scroll.position.set(r.x, r.y);
    scroll.setViewport(r.width, listH);
    const contentW = Math.min(1100, r.width - pad * 2 - ScrollBox.GUTTER);
    const left = (r.width - ScrollBox.GUTTER - contentW) / 2;
    const cols = contentW >= TWO_UP_MIN_W ? 2 : 1;
    const cardW = (contentW - CARD_GAP * (cols - 1)) / cols;
    const cardH = clamp(150, listH * (cols === 2 ? 0.6 : 0.55), 240);
    this.ctas = [];
    this.slots.forEach((_, i) => {
      const card = this.buildCard(i, cardW, cardH, em);
      card.position.set(left + (i % cols) * (cardW + CARD_GAP), Math.floor(i / cols) * (cardH + CARD_GAP));
      scroll.content.addChild(card);
    });
    // bottom padding so the last row clears the band
    const tail = new Graphics().rect(0, 0, 1, 1).fill({ color: 0, alpha: 0 });
    tail.position.set(0, Math.ceil(this.slots.length / cols) * (cardH + CARD_GAP));
    scroll.content.addChild(tail);
    scroll.refresh();

    // bet band — a bar-like plaque pinned to the bottom edge
    this.band.removeChildren().forEach((c) => c.destroy({ children: true }));
    const bandW = Math.min(this.w - pad * 2, 900);
    const bg = plaque(new Graphics(), bandW, betH, { fill: HB.bar });
    const band = this.buildBetBand(bandW, betH, em);
    band.addChildAt(bg, 0);
    band.position.set((this.w - bandW) / 2, this.h - betH - pad * 0.5);
    this.band.addChild(band);
  }

  private buildCard(slot: number, w: number, h: number, em: number): Container {
    const bonus = this.current(slot);
    const members = this.slots[slot];
    const price = bonus.priceMultiplier * this.host.state.bet;
    const affordable = this.isAffordable(bonus);
    const active = this.isActive(bonus);
    const card = new Container();
    card.label = `bb-card-${slot}`;
    card.addChild(plaque(new Graphics(), w, h, { fill: HB.panel }));

    const heroW = Math.round(w * HERO_FRACTION);
    card.addChild(new Graphics().rect(heroW, 0, BORDER, h).fill(HB.line));
    card.addChild(this.buildHero(bonus, heroW, h, em, price, affordable));

    const pad = clamp(8, em * 0.9, 14);
    const colX = heroW + BORDER + pad;
    const colW = w - colX - pad;
    let y = pad;

    // title row (‹ › when the slot is a group)
    const nav = members.length > 1;
    const arrow = clamp(24, em * 2, 30);
    const title = makeText(bonus.title, {
      size: em * 1.3,
      weight: '700',
      heading: true,
      color: HB.fg,
      upper: true,
      align: 'center',
      letterSpacing: em * 0.05,
    });
    const titleRoom = colW - (nav ? (arrow + 6) * 2 : 0);
    if (title.width > titleRoom) title.scale.set(titleRoom / title.width);
    const rowH = Math.max(title.height, nav ? arrow : 0);
    title.anchor.set(0.5, 0.5);
    title.position.set(colX + colW / 2, y + rowH / 2);
    card.addChild(title);
    if (nav) {
      const prev = new IconButton('back', { size: arrow, glyph: Math.round(arrow * 0.5), onTap: () => this.step(slot, -1) });
      const next = new IconButton('chevronRight', { size: arrow, glyph: Math.round(arrow * 0.5), onTap: () => this.step(slot, 1) });
      prev.label = `bb-prev-${slot}`;
      next.label = `bb-next-${slot}`;
      prev.position.set(colX, y + (rowH - arrow) / 2);
      next.position.set(colX + colW - arrow, y + (rowH - arrow) / 2);
      card.addChild(prev, next);
    }
    y += rowH + pad * 0.5;

    if (bonus.volatility) {
      const vol = volatilityRow(bonus.volatility, em * 1.4);
      vol.position.set(colX + (colW - vol.width) / 2, y);
      card.addChild(vol);
      y += em * 1.4 + pad * 0.5;
    }

    // bottom-pinned CTA (price on its label)
    const ctaH = clamp(30, em * 2.6, 40);
    const ctaY = h - pad - ctaH;
    const ctaLabel = bonus.type === 'feature' ? (active ? 'Deactivate' : 'Activate') : 'Buy';
    const cta = new TextButton(`${this.host.t(ctaLabel)} · ${this.host.fmt(price)}`, {
      w: colW,
      h: ctaH,
      face: bonus.type === 'feature' ? 'red' : 'orange',
      size: em * 0.95,
      onTap: () => this.select(bonus),
    });
    cta.label = `bb-cta-${slot}`;
    cta.disabled = !affordable && !active;
    cta.position.set(colX, ctaY);
    card.addChild(cta);
    this.ctas.push(cta);

    // description fills what's left (clipped to the card)
    const descH = ctaY - pad * 0.5 - y;
    if (descH >= em * 1.3) {
      const desc = makeText(bonus.description, { size: em * 0.95, color: HB.fg, wrapWidth: colW, lineHeight: em * 1.35, align: 'left' });
      const clip = new Graphics().rect(0, 0, colW, descH).fill(0xffffff);
      const wrap = new Container();
      wrap.position.set(colX, y);
      wrap.addChild(desc, clip);
      desc.mask = clip;
      card.addChild(wrap);
    }
    return card;
  }

  private buildHero(bonus: BonusOption, w: number, h: number, em: number, price: number, affordable: boolean): Container {
    const hero = new Container();
    hero.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0 }));
    const pad = em * 0.8;
    const boxW = w - pad * 2;
    const boxH = h - pad * 2;
    if (bonus.custom) {
      const node = bonus.custom({
        bonus,
        bet: this.host.state.bet,
        price,
        priceText: this.host.fmt(price),
        disabled: !affordable,
        accent: HB.orange,
        select: () => this.select(bonus),
      }) as Container;
      const b = node.getLocalBounds();
      const s = b.width > 0 && b.height > 0 ? Math.min(1, boxW / b.width, boxH / b.height) : 1;
      node.scale.set(s);
      node.position.set(pad + (boxW - b.width * s) / 2 - b.x * s, pad + (boxH - b.height * s) / 2 - b.y * s);
      hero.addChild(persistent(node));
    } else if (bonus.thumbnail) {
      const slot = new Container();
      slot.position.set(pad, pad);
      hero.addChild(slot);
      Assets.load(bonus.thumbnail)
        .then((tex: Texture) => {
          if (slot.destroyed) return;
          const sp = new Sprite(tex);
          const s = Math.min(boxW / tex.width, boxH / tex.height);
          sp.scale.set(s);
          sp.position.set((boxW - tex.width * s) / 2, (boxH - tex.height * s) / 2);
          slot.addChild(sp);
        })
        .catch(() => {});
    } else {
      const size = Math.min(boxW, boxH) * 0.85;
      const bird = makeIcon('bonus', size, { fill: bonus.type === 'feature' ? HB.red : HB.orange });
      bird.position.set(pad + (boxW - size) / 2, pad + (boxH - size) / 2);
      hero.addChild(bird);
    }
    return hero;
  }

  private buildBetBand(w: number, h: number, em: number): Container {
    const band = new Container();
    const { state } = this.host;
    const pad = clamp(10, em * 1.2, 20);
    const i = state.availableBets.indexOf(state.bet);
    const feature = state.activeFeature;
    const betShown = feature ? state.bet * feature.priceMultiplier : state.bet;
    const bet = new Readout({
      label: feature ? feature.title : this.host.t('Bet'),
      chip: !!feature,
      value: this.host.fmt(betShown),
      valueSize: em * 1.05,
      fixedWidth: Math.max(72, em * 6),
      strip: { count: state.availableBets.length, index: i },
    });
    const btn = clamp(26, h * 0.5, 34);
    const locked = state.busy || state.autoplay.active || !!feature;
    const up = new IconButton('plus', { size: btn, glyph: Math.round(btn * 0.6), onTap: () => this.stepBetBy(1) });
    const down = new IconButton('minus', { size: btn, glyph: Math.round(btn * 0.6), onTap: () => this.stepBetBy(-1) });
    up.disabled = locked || i >= state.availableBets.length - 1;
    down.disabled = locked || i <= 0;
    up.label = 'bb-bet-up';
    down.label = 'bb-bet-down';
    const stepper = new Container();
    down.position.set(0, (h - btn) / 2);
    up.position.set(btn + 6, (h - btn) / 2);
    stepper.addChild(down, up);
    const stepperW = btn * 2 + 6;
    const betW = bet.measureSize().w;
    stepper.position.set(w - pad - stepperW, 0);
    bet.position.set(w - pad - stepperW - 10 - betW, (h - bet.measureSize().h) / 2);
    const balance = new Readout({
      label: this.host.t('Balance'),
      value: this.host.fmt(state.balance),
      valueSize: em * 1.05,
      maxWidth: Math.max(60, bet.x - pad * 2),
    });
    balance.position.set(pad, (h - balance.measureSize().h) / 2);
    band.addChild(bet, stepper, balance);
    return band;
  }

  private stepBetBy(dir: 1 | -1): void {
    this.host.actions.stepBet(dir);
    this.rebuild();
  }

  // ── confirm ─────────────────────────────────────────────────────────────────
  private select(bonus: BonusOption): void {
    if (this.isActive(bonus)) {
      this.host.actions.deactivateFeature();
      this.host.closeLayer();
      return;
    }
    if (!this.isAffordable(bonus)) return;
    this.openConfirm(bonus);
  }

  private openConfirm(bonus: BonusOption): void {
    this.removeConfirm();
    this.confirmBonus = bonus;
    const modal = new CardModal(this.host, { tag: 'bb-confirm', title: bonus.title, onClose: () => this.removeConfirm() });
    const em = modal.emSize;
    const price = bonus.priceMultiplier * this.host.state.bet;
    modal.body.add(
      makeText(bonus.description, { size: 0.96 * em, color: HB.fg, align: 'center', wrapWidth: modal.cardWidth - 2.4 * em, lineHeight: 0.96 * em * 1.45 }),
    );
    modal.body.add(makeText(this.host.fmt(price), { size: 1.6 * em, color: HB.fg, stroke: true, align: 'center' }));
    modal.setActions([
      { label: this.host.t('Cancel'), kind: 'ghost', onTap: () => this.removeConfirm() },
      { label: this.host.t(bonus.type === 'feature' ? 'Activate' : 'Buy'), kind: bonus.type === 'feature' ? 'red' : 'accent', onTap: () => this.commit(bonus) },
    ]);
    modal.build();
    this.confirm = modal;
    this.addChild(modal);
  }

  private commit(bonus: BonusOption): void {
    if (!this.isAffordable(bonus)) return;
    if (bonus.type === 'feature') this.host.actions.activateFeature(bonus);
    else this.host.actions.selectBuyBonus(bonus.id);
    this.host.closeLayer();
  }

  private removeConfirm(): void {
    if (this.confirm) {
      this.removeChild(this.confirm);
      this.confirm.destroy({ children: true });
      this.confirm = undefined;
      this.confirmBonus = undefined;
    }
  }

  // ── keyboard ────────────────────────────────────────────────────────────────
  onKey(e: KeyboardEvent): boolean {
    if (this.confirm && this.confirmBonus) {
      switch (e.code) {
        case 'Enter':
        case 'Space':
          this.commit(this.confirmBonus);
          return true;
        case 'Escape':
          this.removeConfirm();
          return true;
        default:
          return false;
      }
    }
    const bet = betDir(e);
    if (bet !== null) {
      this.stepBetBy(bet);
      return true;
    }
    switch (e.code) {
      case 'ArrowDown':
        this.scroll?.scrollBy(60);
        return true;
      case 'ArrowUp':
        this.scroll?.scrollBy(-60);
        return true;
      case 'Equal':
        this.stepBetBy(1);
        return true;
      case 'Minus':
        this.stepBetBy(-1);
        return true;
      case 'Escape':
        this.host.closeLayer();
        return true;
      default:
        return false;
    }
  }

  onRemove(): void {
    this.scroll?.destroy({ children: true });
    this.scroll = undefined;
  }
}

/** Five birds; the first `level` filled red. */
export function volatilityRow(level: number, size: number): Container {
  const c = new Container();
  const n = Math.max(0, Math.min(5, level));
  for (let i = 0; i < 5; i++) {
    const bird = makeIcon('volatility', size, { fill: i < n ? HB.red : HB.panel, ink: i < n ? HB.ink : HB.muted });
    bird.position.set(i * (size + 2), 0);
    c.addChild(bird);
  }
  c.addChild(new Graphics().rect(0, 0, 5 * size + 8, size).fill({ color: 0, alpha: 0 }));
  return c;
}

/** Borrow a game-supplied node: detach (don't destroy) it when the page is torn down. */
function persistent(node: Container): Container {
  const slot = new Container();
  slot.addChild(node);
  const destroySelf = Container.prototype.destroy.bind(slot);
  slot.destroy = () => {
    if (node.parent === slot) slot.removeChild(node);
    destroySelf({ children: false });
  };
  return slot;
}
