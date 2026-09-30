// Fork of pixi-hb/components/BuyBonus.ts in the S look — behaviour unchanged.
import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import type { BonusOption } from '@/core/types';
import { groupBonusSlots } from '@/core/bonusGroups';
import { betDir } from '@/core/keyboard';
import { clamp } from '../../pixi-hb/primitives/overlay';
import { ScrollBox } from '../../pixi-hb/primitives/scroll';
import { makeIcon } from '../../pixi-hb/pixi-icon';
import { SCardModal } from '../primitives/card';
import { STitlePlate, STextButton, sCloseButton, S_SCROLL } from '../primitives/controls';
import { stripMetrics } from '../primitives/page';
import { SButton, SReadout, SBet } from '../widgets';
import { SKEW } from '../slab';
import { sIcon } from '../icons';
import { sLabel, sValue, sBody } from '../text';
import { S } from '../theme';

/** Buy-bonus: no frame — over the frosted game the S strip (a BUY BONUS title plate and a ✕ over the
 *  card column), a vertical, always-scrolling list of flat mode CARDS (two per row on a wide screen,
 *  one otherwise) and a balance / bet band pinned to the bottom. Each card: hero on its left third,
 *  then the title (with ‹ › when the slot is a `groupedBy` group), volatility, description and a
 *  bottom-pinned CTA. Returns null when there are no bonus options. */
export function openSBuyBonus(host: PixiComponentContext): ShellLayer | null {
  const bonuses = host.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;
  return new SBuyBonusPage(host, bonuses);
}

const BET_BAND_H = 64;
/** The band's two wide plates need 4.8 + 5 = 9.8 plate heights (BALANCE + BET widths); under that
 *  the band goes narrow and each plate's height is at most this share of the room. */
const WIDE_BAND_RH = 9.8;
const NARROW_RH_SHARE = 0.13;
const HERO_FRACTION = 0.33;
const CARD_GAP = 12;
/** Two cards per row from this content width up. */
const TWO_UP_MIN_W = 640;

export class SBuyBonusPage extends Container implements ShellLayer {
  readonly tag = 'buybonus';
  private host: PixiComponentContext;
  private veil = new Graphics();
  titlePlate?: STitlePlate;
  private closeBtn?: Container;
  /** Card slots — a `groupedBy` group is one slot with several members. */
  readonly slots: BonusOption[][];
  /** Which member each group slot shows; kept across rebuilds (bet steps, resizes). */
  private groupIndex = new Map<number, number>();
  private scroll?: ScrollBox;
  private band = new Container();
  private confirm?: SCardModal;
  private confirmBonus?: BonusOption;
  /** CTA per slot, in slot order — for tests. */
  ctas: STextButton[] = [];

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
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
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
    const strip = stripMetrics(this.h);
    const contentW = Math.min(1100, this.w - pad * 2 - ScrollBox.GUTTER);
    const left = (this.w - ScrollBox.GUTTER - contentW) / 2;
    // the title plate and ✕ in the screen corners
    this.titlePlate?.destroy({ children: true });
    this.closeBtn?.destroy({ children: true });
    const m = strip.top;
    this.titlePlate = new STitlePlate(this.host.t('Buy bonus'), strip.height, this.w - m * 4 - strip.height - ScrollBox.GUTTER);
    this.titlePlate.position.set(m, m);
    this.closeBtn = sCloseButton(strip.height, () => this.host.closeLayer());
    this.closeBtn.position.set(this.w - m - ScrollBox.GUTTER - strip.height, m);
    this.addChild(this.titlePlate, this.closeBtn);
    const top = strip.top + strip.height * 1.3;
    const betH = Math.min(BET_BAND_H, this.h * 0.16);
    const listH = this.h - top - betH - pad;
    const r = new Rectangle(0, top, this.w, listH);

    // the card list scrolls
    if (this.scroll) {
      this.removeChild(this.scroll);
      this.scroll.destroy({ children: true });
    }
    const scroll = new ScrollBox(this.host.canvas, this.host.ticker, S_SCROLL);
    this.scroll = scroll;
    this.addChildAt(scroll, 1);
    scroll.position.set(r.x, r.y);
    scroll.setViewport(r.width, listH);
    const cols = contentW >= TWO_UP_MIN_W ? 2 : 1;
    const cardW = (contentW - CARD_GAP * (cols - 1)) / cols;
    // never taller than the viewport — a short popout shows a whole card, not a slice of one
    const cardH = clamp(Math.min(150, listH), listH * (cols === 2 ? 0.6 : 0.55), 240);
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

    // bet band — a flat panel pinned to the bottom edge
    this.band.removeChildren().forEach((c) => c.destroy({ children: true }));
    const bandW = Math.min(this.w - pad * 2, 900);
    const bg = new Graphics().rect(0, 0, bandW, betH).fill(S.panel);
    const band = this.buildBetBand(bandW, betH);
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
    card.addChild(new Graphics().rect(0, 0, w, h).fill(S.panel));

    const heroW = Math.round(w * HERO_FRACTION);
    card.addChild(this.buildHero(bonus, heroW, h, em, price, affordable));

    const pad = clamp(8, em * 0.9, 14);
    const colX = heroW + pad;
    const colW = w - colX - pad;
    let y = pad;

    // right column, everything flush right: [‹ ›] … TITLE / bars / description … price / [CTA]
    const nav = members.length > 1;
    const arrow = clamp(24, em * 2, 30);
    const right = colX + colW;
    const title = sLabel(bonus.title, em * 1.3, S.fg);
    const titleRoom = colW - (nav ? arrow * 2 + 6 + 10 : 0);
    if (title.width > titleRoom) title.scale.set(titleRoom / title.width);
    const rowH = Math.max(title.height, nav ? arrow : 0);
    title.anchor.set(1, 0.5);
    title.position.set(right, y + rowH / 2);
    card.addChild(title);
    if (nav) {
      const g = Math.round(arrow * 0.5);
      const prev = new SButton({ w: arrow, h: arrow, face: 'yellow', corners: SKEW.menu, glyph: makeIcon('back', g, { ink: S.ink, fill: S.ink }), glyphSize: g, onTap: () => this.step(slot, -1) });
      const next = new SButton({ w: arrow, h: arrow, face: 'yellow', corners: SKEW.menu, glyph: makeIcon('chevronRight', g, { ink: S.ink, fill: S.ink }), glyphSize: g, onTap: () => this.step(slot, 1) });
      prev.label = `bb-prev-${slot}`;
      next.label = `bb-next-${slot}`;
      prev.position.set(colX, y + (rowH - arrow) / 2);
      next.position.set(colX + arrow + 6, y + (rowH - arrow) / 2);
      card.addChild(prev, next);
    }
    y += rowH + pad * 0.5;

    if (bonus.volatility) {
      const vol = sVolatilityRow(bonus.volatility, em);
      vol.position.set(right - vol.width, y);
      card.addChild(vol);
      y += em * 1.1 + pad * 0.5;
    }

    // bottom-pinned: the price over the CTA, both flush right
    const ctaH = clamp(30, em * 2.6, 40);
    const ctaY = h - pad - ctaH;
    const ctaLabel = bonus.type === 'feature' ? (active ? 'Deactivate' : 'Activate') : 'Buy';
    const ctaText = this.host.t(ctaLabel);
    const probe = sLabel(ctaText, em * 0.95, S.ink);
    const ctaW = Math.min(colW, Math.max(120, probe.width + em * 2.4));
    probe.destroy();
    const cta = new STextButton(ctaText, {
      w: ctaW,
      h: ctaH,
      kind: bonus.type === 'feature' ? 'red' : 'accent',
      size: em * 0.95,
      onTap: () => this.select(bonus),
    });
    cta.label = `bb-cta-${slot}`;
    cta.disabled = !affordable && !active;
    cta.position.set(right - ctaW, ctaY);
    card.addChild(cta);
    this.ctas.push(cta);
    const priceText = sValue(this.host.fmt(price), em * 1.3, S.fg);
    if (priceText.width > colW) priceText.scale.set(colW / priceText.width);
    priceText.position.set(right - priceText.width, ctaY - pad * 0.4 - priceText.height);
    card.addChild(priceText);

    // description fills what's left (clipped to the card), flush right
    const descH = priceText.y - pad * 0.5 - y;
    if (descH >= em * 1.3) {
      const desc = sBody(bonus.description, em * 0.95, S.muted, colW, 'right');
      const clip = new Graphics().rect(0, 0, colW, descH).fill(0xffffff);
      const wrap = new Container();
      wrap.position.set(colX, y);
      desc.position.x = colW - desc.width;
      wrap.addChild(desc, clip);
      desc.mask = clip;
      card.addChild(wrap);
    }
    return card;
  }

  /** The hero fills its whole third like `object-fit: cover` — the art keeps its aspect and is
   *  cropped (top/bottom or sides) to the zone, clipped to it. A custom node is the game's own
   *  layout and is fitted (contain) instead. */
  private buildHero(bonus: BonusOption, w: number, h: number, em: number, price: number, affordable: boolean): Container {
    const hero = new Container();
    hero.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0 }));
    const ix = 0;
    const iw = w;
    const ih = h;
    const clip = new Graphics().rect(0, 0, w, h).fill(0xffffff);
    hero.addChild(clip);
    hero.mask = clip;
    const cover = (node: Container, nw: number, nh: number): void => {
      const s = Math.max(iw / nw, ih / nh);
      node.scale.set(s);
      node.position.set(ix + (iw - nw * s) / 2, ix + (ih - nh * s) / 2);
    };
    if (bonus.custom) {
      const node = bonus.custom({
        bonus,
        bet: this.host.state.bet,
        price,
        priceText: this.host.fmt(price),
        disabled: !affordable,
        accent: S.yellow,
        select: () => this.select(bonus),
      }) as Container;
      const pad = em * 0.8;
      const b = node.getLocalBounds();
      const s = b.width > 0 && b.height > 0 ? Math.min(1, (w - pad * 2) / b.width, (h - pad * 2) / b.height) : 1;
      node.scale.set(s);
      node.position.set((w - b.width * s) / 2 - b.x * s, (h - b.height * s) / 2 - b.y * s);
      hero.addChild(persistent(node));
    } else if (bonus.thumbnail) {
      const slot = new Container();
      hero.addChild(slot);
      Assets.load(bonus.thumbnail)
        .then((tex: Texture) => {
          if (slot.destroyed) return;
          const sp = new Sprite(tex);
          cover(sp, tex.width, tex.height);
          slot.addChild(sp);
        })
        .catch(() => {});
    } else {
      const face = new Graphics().rect(0, 0, w, h).fill(bonus.type === 'feature' ? S.red : S.yellow);
      face.label = bonus.type === 'feature' ? 'bb-hero-red' : 'bb-hero-yellow';
      const size = Math.round(Math.min(w, h) * 0.7);
      const mask = sIcon('mask', size, bonus.type === 'feature' ? S.fg : S.ink);
      mask.position.set((w - size) / 2, (h - size) / 2);
      hero.addChild(face, mask);
    }
    return hero;
  }

  private buildBetBand(w: number, h: number): Container {
    const band = new Container();
    const { state } = this.host;
    const pad = clamp(10, h * 0.25, 20);
    const room = w - pad * 3;
    // a band too narrow for the two wide plates (phone) lowers them (the mobile bar's 40 at most, less
    // on a smaller phone) and splits the room 44 / 56 — the bet's ± squares are h wide, so it needs
    // the larger share to stay readable
    const narrow = room < h * 0.78 * WIDE_BAND_RH;
    const rh = Math.round(narrow ? Math.min(h * 0.78, 40, room * NARROW_RH_SHARE) : h * 0.78);
    const i = state.availableBets.indexOf(state.bet);
    const feature = state.activeFeature;
    const locked = state.busy || state.autoplay.active || !!feature;
    const labelSize = Math.round(rh * 0.27);
    const valueSize = Math.round(rh * 0.41);
    const bet = new SBet({
      label: feature ? feature.title : this.host.t('Bet'),
      value: this.host.fmt(feature ? state.bet * feature.priceMultiplier : state.bet),
      w: narrow ? Math.floor(room * 0.56) : Math.round(rh * 5),
      h: rh,
      labelSize,
      valueSize,
      stepper: true,
      onStep: (dir) => this.stepBetBy(dir),
    });
    bet.up!.disabled = locked || i >= state.availableBets.length - 1;
    bet.down!.disabled = locked || i <= 0;
    bet.up!.label = 'bb-bet-up';
    bet.down!.label = 'bb-bet-down';
    bet.position.set(w - pad - bet.measureSize().w, (h - rh) / 2);
    const balance = new SReadout({ label: this.host.t('Balance'), value: this.host.fmt(state.balance), w: narrow ? Math.floor(room * 0.44) : Math.round(rh * 4.8), h: rh, labelSize, valueSize });
    balance.position.set(pad, (h - rh) / 2);
    band.addChild(balance, bet);
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
    const modal = new SCardModal(this.host, { tag: 'bb-confirm', title: bonus.title, onClose: () => this.removeConfirm() });
    const em = modal.emSize;
    const price = bonus.priceMultiplier * this.host.state.bet;
    modal.body.add(sBody(bonus.description, 0.96 * em, S.fg, modal.cardWidth - 2.4 * em, 'center'));
    modal.body.add(sValue(this.host.fmt(price), 1.6 * em, S.fg));
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

/** Five flat bars; the first `level` filled yellow, the rest the track colour. */
export function sVolatilityRow(level: number, em: number): Container {
  const c = new Container();
  const n = Math.max(0, Math.min(5, level));
  const bw = Math.round(em * 0.5);
  const bh = Math.round(em * 1.1);
  const gap = Math.max(2, Math.round(em * 0.25));
  const g = new Graphics();
  for (let i = 0; i < 5; i++) g.rect(i * (bw + gap), 0, bw, bh).fill(i < n ? S.yellow : S.track);
  c.addChild(g);
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
