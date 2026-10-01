// Fork of pixi-hb/components/BuyBonus.ts in the S look.
import { Assets, Container, FillGradient, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import type { BonusOption } from '@/core/types';
import { groupBonusSlots } from '@/core/bonusGroups';
import { betDir } from '@/core/keyboard';
import { clamp } from '../../pixi-hb/primitives/overlay';
import { ScrollBox } from '../../pixi-hb/primitives/scroll';
import { STitlePlate, STextButton, sCloseButton, S_SCROLL } from '../primitives/controls';
import { stripMetrics, closeCorner } from '../primitives/page';
import { tween } from '../../pixi/motion-pixi';
import { SButton, SReadout, SBet } from '../widgets';
import { SKEW, SHADOW_OFFSET } from '../slab';
import { sIcon } from '../icons';
import { sLabel, sValue, sBody } from '../text';
import { S, SHADOW_ALPHA } from '../theme';

/** Buy-bonus: no frame — over the frosted game the S strip (a BUY BONUS title plate and a ✕ in the
 *  top corners), one horizontal row of portrait "ticket" cards (centred when they fit, else scrolling
 *  along x with the next card peeking in) and the BALANCE | BET plates at the bottom, with no panel
 *  behind them. A screen under 440 tall lays the row and the band out at 440 and draws them scaled
 *  down; the plate and ✕ stay at screen size, where every S overlay puts them. Each card:
 *  the hero fills the top and fades to black over the title zone (‹ › either side of the title when
 *  the slot is a `groupedBy` group), then the description, a dashed separator between two side
 *  notches, the volatility bars, the yellow price and a full-width CTA. Returns null when there are
 *  no bonus options. */
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
/** The page is laid out at least this tall; a shorter screen draws it scaled down. */
const MIN_PAGE_H = 440;
/** Card width / height. */
const ASPECT = 0.5;
const CARD_GAP = 14;
/** The hero's fade to black over the title zone — one shared gradient (local texture space fits it
 *  to each rect), so rebuilds do not leave a gradient texture behind per card. */
const FADE = new FillGradient({
  type: 'linear',
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
  colorStops: [
    { offset: 0, color: 'rgba(11,11,11,0)' },
    { offset: 1, color: S.plate },
  ],
  textureSpace: 'local',
});

export class SBuyBonusPage extends Container implements ShellLayer {
  readonly tag = 'buybonus';
  private host: PixiComponentContext;
  private veil = new Graphics();
  /** The row, the band and the confirm, laid out at the page's logical size and scaled by k (the
   *  veil, plate and ✕ stay at screen size). */
  private stage = new Container();
  titlePlate?: STitlePlate;
  private closeBtn?: Container;
  /** Card slots — a `groupedBy` group is one slot with several members. */
  readonly slots: BonusOption[][];
  /** Which member each group slot shows; kept across rebuilds (bet steps, resizes). */
  private groupIndex = new Map<number, number>();
  private scroll?: ScrollBox;
  private band = new Container();
  /** The confirm: a copy of the chosen card that flies to the centre, the CANCEL | BUY row in place
   *  of its CTA and the bonus it confirms (cleared as soon as the confirm starts going back). */
  flyer?: Container;
  actions?: Container;
  confirmBonus?: BonusOption;
  /** The state the open confirm was drawn for (see `stateSig`). */
  private confirmSig?: string;
  /** Puts the flyer `p` of the way from its card to the centre and the page parts at alpha 1 − p. */
  private flyAt?: (p: number) => void;
  private flyP = 0;
  /** Cancelers of the running confirm tweens. */
  private tweens: Array<() => void> = [];
  /** CTA per slot, in slot order — for tests. */
  ctas: STextButton[] = [];
  private cardW = 0;
  private cardH = 0;

  constructor(host: PixiComponentContext, bonuses: BonusOption[]) {
    super();
    this.host = host;
    this.slots = groupBonusSlots(bonuses);
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.stage.addChild(this.band);
    this.addChild(this.veil, this.stage);
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

  /** A card's em: 1/36 of its height. */
  cardEm(h: number): number {
    return h / 36;
  }

  /** The size the current cards were built at. */
  private cardSize(): { w: number; h: number } {
    return { w: this.cardW, h: this.cardH };
  }

  private w = 0;
  private h = 0;

  resize(w: number, h: number): void {
    const same = w === this.w && h === this.h;
    this.w = w;
    this.h = h;
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    // the bar re-sends the same size on every state change (balance, win, bet …): keep an open
    // confirm while what it shows and charges still holds; otherwise drop it (unanimated) and rebuild
    if (same && this.flyer && this.confirmSig === this.stateSig()) return;
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

  /** What a confirm's price and its BUY depend on. */
  private stateSig(): string {
    const s = this.host.state;
    return [s.bet, s.balance, s.busy, s.buyBonusEnabled, s.activeFeature?.id].join('|');
  }

  // ── page ────────────────────────────────────────────────────────────────────
  private rebuild(): void {
    this.removeConfirm(); // a resize or the end of a cancel drops the confirm, unanimated
    // the title plate and ✕ at screen size in the screen corners, above the stage, as on every S overlay
    const strip = stripMetrics(this.w, this.h);
    this.titlePlate?.destroy({ children: true });
    this.closeBtn?.destroy({ children: true });
    const m = strip.top;
    this.titlePlate = new STitlePlate(this.host.t('Buy bonus'), strip.height, this.w - m * 4 - strip.height - ScrollBox.GUTTER);
    this.titlePlate.position.set(m, m);
    const c = closeCorner(this.w, this.h);
    this.closeBtn = sCloseButton(c.size, () => (this.flyer ? this.cancelConfirm() : this.host.closeLayer()));
    this.closeBtn.position.set(c.x, c.y);
    this.addChild(this.titlePlate, this.closeBtn);

    // a short screen lays the row and the band out at MIN_PAGE_H and draws them scaled down
    const k = Math.min(1, this.h / MIN_PAGE_H);
    const W = this.w / k;
    const H = this.h / k;
    this.stage.scale.set(k);
    const em = clamp(11, H / 36, 15);
    const pad = clamp(12, em * 1.2, 20);

    // bet band — the two plates at the bottom edge, no backing
    const betH = Math.min(BET_BAND_H, H * 0.16);
    const bandW = Math.min(W - pad * 2, 900);
    const bandTop = H - betH - pad * 0.5;
    this.band.removeChildren().forEach((n) => n.destroy({ children: true }));
    const band = this.buildBetBand(bandW, betH);
    band.position.set((W - bandW) / 2, bandTop);
    this.band.addChild(band);

    // the card row, between the strip and the band; scrolls along x when it overflows
    const rowTop = (strip.top + strip.height * 1.3) / k; // under the screen-size strip
    const rowBottom = bandTop - pad * 0.5;
    const cardH = Math.min(rowBottom - rowTop - ScrollBox.GUTTER, (0.7 * W) / ASPECT, 640);
    const cardW = Math.round(cardH * ASPECT);
    this.cardW = cardW;
    this.cardH = cardH;
    const scrolled = this.scroll?.scrollPos ?? 0; // a rebuild (bet step, group flip) keeps the row where it was
    if (this.scroll) {
      this.stage.removeChild(this.scroll);
      this.scroll.destroy({ children: true });
    }
    const scroll = new ScrollBox(this.host.canvas, this.host.ticker, S_SCROLL, 'x');
    this.scroll = scroll;
    this.stage.addChildAt(scroll, 0);
    const viewW = W - 2 * pad;
    const viewH = cardH + ScrollBox.GUTTER;
    scroll.position.set(pad, rowTop + (rowBottom - rowTop - viewH) / 2);
    scroll.setViewport(viewW, viewH);
    const n = this.slots.length;
    const total = n * cardW + (n - 1) * CARD_GAP;
    const offset = total <= viewW ? (viewW - total) / 2 : 0;
    this.ctas = [];
    this.slots.forEach((_, i) => {
      const card = this.buildCard(i, cardW, cardH);
      card.position.set(offset + i * (cardW + CARD_GAP), 0);
      scroll.content.addChild(card);
    });
    scroll.refresh();
    scroll.scrollBy(scrolled);
  }

  /** A portrait ticket `w × h`: hero + fade + title zone on top, description, the notched dashed
   *  separator, then volatility / price / CTA pinned to the bottom. Its CTA lands in `ctas[slot]`. */
  buildCard(slot: number, w: number, h: number): Container {
    const bonus = this.current(slot);
    const nav = this.slots[slot].length > 1;
    const price = bonus.priceMultiplier * this.host.state.bet;
    const affordable = this.isAffordable(bonus);
    const active = this.isActive(bonus);
    const feature = bonus.type === 'feature';
    const em = this.cardEm(h);
    const pad = em * 1.2;
    const inner = w - 2 * pad;
    const card = new Container();
    card.label = `bb-card-${slot}`;
    // a drag across the row ends with a tap on whatever is under the finger — ignore it
    const tap = (fn: () => void) => () => {
      if (!this.scroll?.didDrag) fn();
    };

    // bottom-up: pad, CTA, price, volatility, then the separator
    const ctaH = em * 2.8;
    const ctaY = h - pad - ctaH;
    const cta = new STextButton(this.host.t(feature ? (active ? 'Deactivate' : 'Activate') : 'Buy'), {
      w: inner,
      h: ctaH,
      kind: feature ? 'red' : 'accent',
      size: em,
      onTap: tap(() => this.select(bonus)),
    });
    cta.label = `bb-cta-${slot}`;
    cta.disabled = !affordable && !active;
    cta.position.set(pad, ctaY);
    this.ctas[slot] = cta;
    const priceText = sValue(this.host.fmt(price), em * 2.2, S.yellow);
    priceText.label = 'bb-price';
    if (priceText.width > inner) priceText.scale.set(inner / priceText.width);
    priceText.position.set((w - priceText.width) / 2, ctaY - em * 0.8 - priceText.height);
    let above = priceText.y;
    let vol: Container | undefined;
    if (bonus.volatility) {
      vol = sVolatilityRow(bonus.volatility, em);
      vol.label = 'bb-vol';
      vol.position.set((w - vol.width) / 2, priceText.y - em * 0.5 - vol.height);
      above = vol.y;
    }
    const sepY = above - em;

    // body: one black plate with a notch either side at the separator, and the S drop shadow
    const nd = em * 0.6;
    const nh = em * 1.2;
    const pts = [0, 0, w, 0, w, sepY - nh / 2, w - nd, sepY, w, sepY + nh / 2, w, h, 0, h, 0, sepY + nh / 2, nd, sepY, 0, sepY - nh / 2];
    const shadow = new Graphics().poly(pts).fill({ color: S.shadow, alpha: SHADOW_ALPHA });
    shadow.position.set(SHADOW_OFFSET, SHADOW_OFFSET);
    const body = new Graphics().poly(pts).fill(S.plate);
    body.label = 'bb-body';

    // the title zone: two title lines from 40% down; the title wraps on words and shrinks (re-wrapped)
    // when a word is too wide or it needs a third line
    const titleTop = Math.round(0.4 * h);
    const titleW = inner - (nav ? 2 * (em * 2 + em * 0.5) : 0);
    const title = sLabel(bonus.title, em * 2, S.fg, titleW, 'center');
    title.label = 'bb-title';
    title.style.breakWords = false;
    const zoneH = 2 * title.style.lineHeight;
    const zoneBottom = titleTop + zoneH;
    for (let s = 1; s > 0.3 && (title.width > titleW + 0.5 || title.height > zoneH + 0.5); ) {
      s *= 0.9;
      title.style.wordWrapWidth = titleW / s;
      title.scale.set(s);
    }
    title.position.set((w - title.width) / 2, titleTop + (zoneH - title.height) / 2);

    const fade = new Graphics().rect(0, titleTop, w, zoneH).fill(FADE);
    fade.label = 'bb-fade';
    card.addChild(shadow, body, this.buildHero(bonus, w, zoneBottom, titleTop, em, price, affordable), fade, title);

    if (nav) {
      const size = em * 2;
      const g = Math.round(em);
      const y = titleTop + zoneH / 2 - size / 2;
      const prev = new SButton({ w: size, h: size, face: 'yellow', corners: SKEW.menu, glyph: sIcon('chevronLeft', g, S.ink), glyphSize: g, onTap: tap(() => this.step(slot, -1)) });
      const next = new SButton({ w: size, h: size, face: 'yellow', corners: SKEW.menu, glyph: sIcon('chevronRight', g, S.ink), glyphSize: g, onTap: tap(() => this.step(slot, 1)) });
      prev.label = `bb-prev-${slot}`;
      next.label = `bb-next-${slot}`;
      prev.position.set(pad, y);
      next.position.set(w - pad - size, y);
      card.addChild(prev, next);
    }

    // the description, clipped to the room above the separator (omitted when under 1.3 em)
    const descTop = zoneBottom + em * 0.6;
    const room = sepY - em * 0.6 - descTop;
    if (room >= em * 1.3) {
      const desc = sBody(bonus.description, em, S.muted, inner, 'center');
      desc.position.set((w - desc.width) / 2, descTop);
      const clip = new Graphics().rect(0, descTop, w, room).fill(0xffffff);
      desc.mask = clip;
      card.addChild(desc, clip);
    }

    // the dashed separator, notch tip to notch tip
    const sep = new Graphics();
    for (let x = nd; x + em * 0.5 <= w - nd; x += em * 0.9) sep.rect(x, sepY - 1, em * 0.5, 2);
    sep.fill(S.track);
    card.addChild(sep);
    if (vol) card.addChild(vol);
    card.addChild(priceText, cta);
    return card;
  }

  /** The hero fills the card from the top to the title zone's bottom (`h`), clipped to it: a
   *  thumbnail covers it like `object-fit: cover`; a custom node is the game's own layout and is
   *  fitted (contain) above the title (`0..titleTop`); otherwise a yellow / red face with the bonus
   *  mask. */
  private buildHero(bonus: BonusOption, w: number, h: number, titleTop: number, em: number, price: number, affordable: boolean): Container {
    const hero = new Container();
    hero.label = 'bb-hero';
    const clip = new Graphics().rect(0, 0, w, h).fill(0xffffff);
    hero.addChild(clip);
    hero.mask = clip;
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
      const s = b.width > 0 && b.height > 0 ? Math.min(1, (w - pad * 2) / b.width, (titleTop - pad * 2) / b.height) : 1;
      node.scale.set(s);
      node.position.set((w - b.width * s) / 2 - b.x * s, (titleTop - b.height * s) / 2 - b.y * s);
      hero.addChild(persistent(node));
    } else if (bonus.thumbnail) {
      const slot = new Container();
      slot.label = 'bb-thumb';
      hero.addChild(slot);
      Assets.load(bonus.thumbnail)
        .then((tex: Texture) => {
          if (slot.destroyed) return; // the page was rebuilt or closed while it loaded
          const sp = new Sprite(tex);
          const s = Math.max(w / tex.width, h / tex.height);
          sp.scale.set(s);
          sp.position.set((w - tex.width * s) / 2, (h - tex.height * s) / 2);
          slot.addChild(sp);
        })
        .catch(() => {});
    } else {
      const face = new Graphics().rect(0, 0, w, h).fill(bonus.type === 'feature' ? S.red : S.yellow);
      face.label = bonus.type === 'feature' ? 'bb-hero-red' : 'bb-hero-yellow';
      const size = Math.round(0.6 * Math.min(w, titleTop));
      const mask = sIcon('bonus', size, bonus.type === 'feature' ? S.fg : S.ink);
      mask.position.set((w - size) / 2, (titleTop - size) / 2);
      hero.addChild(face, mask);
    }
    return hero;
  }

  private buildBetBand(w: number, h: number): Container {
    const band = new Container();
    const { state } = this.host;
    // no panel any more, so no side inset: the plates line up with the card row's edges; `gap` only
    // separates them
    const gap = clamp(10, h * 0.25, 20);
    const room = w - gap;
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
    bet.position.set(w - bet.measureSize().w, (h - rh) / 2);
    const balance = new SReadout({ label: this.host.t('Balance'), value: this.host.fmt(state.balance), w: narrow ? Math.floor(room * 0.44) : Math.round(rh * 4.8), h: rh, labelSize, valueSize });
    balance.position.set(0, (h - rh) / 2);
    band.addChild(balance, bet);
    return band;
  }

  private stepBetBy(dir: 1 | -1): void {
    this.host.actions.stepBet(dir);
    this.rebuild();
  }

  // ── confirm ─────────────────────────────────────────────────────────────────
  private select(bonus: BonusOption): void {
    if (this.flyer) return; // a confirm is out
    if (this.isActive(bonus)) {
      this.host.actions.deactivateFeature();
      this.host.closeLayer();
      return;
    }
    if (!this.isAffordable(bonus)) return;
    this.openConfirm(bonus);
  }

  /** A copy of the card flies from its spot to the centre and grows (300ms) while the row, band and
   *  title plate fade out; then CANCEL | BUY (or ACTIVATE) fade in over its CTA (150ms). */
  private openConfirm(bonus: BonusOption): void {
    const slot = this.slots.findIndex((m) => m.includes(bonus));
    const card = this.scroll!.content.getChildByLabel(`bb-card-${slot}`)!;
    const { w: cw, h: ch } = this.cardSize();
    const k = this.stage.scale.x;
    const W = this.w / k;
    const H = this.h / k;
    // the flyer sits between the ✕ strip (its bottom plus one margin) and the bottom margin
    const strip = stripMetrics(this.w, this.h);
    const top = (strip.top * 2 + strip.height) / k;
    const m = strip.top / k;
    const s = Math.min(1.3, (H - top - m) / ch, (W - 2 * m) / cw);
    const to = { x: (W - cw * s) / 2, y: top + (H - m - top - ch * s) / 2 };
    const from = this.stage.toLocal(card.getGlobalPosition());

    const rowCta = this.ctas[slot];
    const flyer = this.buildCard(slot, cw, ch);
    const cta = this.ctas[slot]; // the copy's own CTA, which the actions replace
    this.ctas[slot] = rowCta;
    cta.visible = false;
    for (const c of flyer.children) {
      c.eventMode = 'none'; // taps on the copy do nothing
      if (/^bb-(prev|next)-/.test(c.label)) c.visible = false; // so its ‹ › would be dead buttons
    }
    flyer.label = 'bb-flyer';
    flyer.position.copyFrom(from);
    this.stage.addChild(flyer); // the ✕ is added after the stage, so it stays on top
    card.visible = false;
    this.scroll!.eventMode = 'none'; // no drag or wheel under the confirm; the rebuild's new box is live
    this.flyer = flyer;
    this.confirmBonus = bonus;
    this.confirmSig = this.stateSig();
    const parts = [this.scroll!, this.band, this.titlePlate!];
    this.flyAt = (p) => {
      if (this.destroyed || flyer.destroyed) return;
      this.flyP = p;
      flyer.position.set(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p);
      flyer.scale.set(1 + (s - 1) * p);
      for (const n of parts) {
        n.alpha = 1 - p;
        n.visible = p < 1; // alpha 0 still takes taps (the bet stepper, the other CTAs)
      }
    };
    this.tweens.push(
      tween(this.host.ticker, {
        duration: 300,
        onUpdate: (p) => this.flyAt?.(p),
        onComplete: () => {
          if (this.destroyed || flyer.destroyed) return;
          // in the CTA's slot, in card units, so the row scales with the flyer
          const feature = bonus.type === 'feature';
          const em = this.cardEm(ch);
          const bw = (cw - 2 * cta.x - em * 0.5) / 2;
          const actions = new Container();
          actions.label = 'bb-confirm-actions';
          const cancel = new STextButton(this.host.t('Cancel'), { w: bw, h: em * 2.8, kind: 'dim', size: em, onTap: () => this.cancelConfirm() });
          const ok = new STextButton(this.host.t(feature ? 'Activate' : 'Buy'), { w: bw, h: em * 2.8, kind: feature ? 'red' : 'accent', size: em, onTap: () => this.commit(bonus) });
          ok.x = bw + em * 0.5;
          actions.addChild(cancel, ok);
          actions.position.copyFrom(cta.position);
          actions.alpha = 0;
          actions.eventMode = 'none'; // takes taps once fully shown
          this.actions = actions;
          flyer.addChild(actions);
          this.tweens.push(
            tween(this.host.ticker, {
              duration: 150,
              onUpdate: (p) => {
                if (!actions.destroyed) actions.alpha = p;
              },
              onComplete: () => {
                if (!actions.destroyed) actions.eventMode = 'passive';
              },
            }),
          );
        },
      }),
    );
  }

  /** Escape, CANCEL and the ✕: the action row goes at once and the flyer flies back (250ms) while the
   *  page fades back in; then the page rebuilds (it gets back a custom hero the flyer borrowed, and
   *  any state change a same-size resize skipped). A second cancel on the way back is a no-op. */
  private cancelConfirm(): void {
    if (!this.flyer || !this.confirmBonus) return;
    this.confirmBonus = undefined;
    for (const stop of this.tweens.splice(0)) stop();
    this.actions?.destroy({ children: true });
    this.actions = undefined;
    const p0 = this.flyP;
    this.tweens.push(
      tween(this.host.ticker, {
        duration: 250,
        onUpdate: (p) => this.flyAt?.(p0 * (1 - p)),
        onComplete: () => {
          if (!this.destroyed) this.rebuild();
        },
      }),
    );
  }

  private commit(bonus: BonusOption): void {
    if (!this.isAffordable(bonus)) return;
    this.removeConfirm();
    if (bonus.type === 'feature') this.host.actions.activateFeature(bonus);
    else this.host.actions.selectBuyBonus(bonus.id);
    this.host.closeLayer();
  }

  /** Drop the confirm at once, before a rebuild or a close: tweens stopped, the flyer (and its
   *  actions) gone, the page parts back at alpha 1. The row card stays hidden: the rebuild replaces it. */
  private removeConfirm(): void {
    for (const stop of this.tweens.splice(0)) stop();
    if (!this.flyer) return;
    this.flyAt?.(0);
    this.flyer.destroy({ children: true });
    this.flyer = this.actions = this.flyAt = this.confirmBonus = this.confirmSig = undefined;
  }

  // ── keyboard ────────────────────────────────────────────────────────────────
  onKey(e: KeyboardEvent): boolean {
    if (this.flyer) {
      switch (e.code) {
        case 'Enter':
        case 'Space':
          if (this.confirmBonus) this.commit(this.confirmBonus); // not on the way back
          return true;
        case 'Escape':
          this.cancelConfirm();
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
      case 'ArrowRight':
      case 'ArrowDown':
        this.scroll?.scrollBy(this.cardSize().w + CARD_GAP);
        return true;
      case 'ArrowLeft':
      case 'ArrowUp':
        this.scroll?.scrollBy(-(this.cardSize().w + CARD_GAP));
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
    this.removeConfirm();
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
