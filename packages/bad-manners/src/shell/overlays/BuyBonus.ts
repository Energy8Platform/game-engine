import { Assets, Container, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js';
import type { BonusOption } from '@energy8platform/shell';
import { Field, PillButton, glyph, volatility } from '../components';
import { bonusBuyLocked, type BmCtx, type Layer } from '../context';
import { ProgressBar, ScrollBox } from '../scroll';
import { body as bodyText, display, num } from '../text';
import { C, SIZE, TYPE } from '../theme';
import { CardModal, EDGE_X, Panel, buildCard } from './panel';

// §5.2 Buy Bonus: the Panel frame, a horizontal strip of 340×720 cards (scaled to the room, scrolling
// along x when they overflow) with a scroll-progress bar under it, BALANCE | BET at the bottom, and a
// small confirm card over the strip.

/** Card design size (§5.2) and the gap between cards. */
const CW = 340;
const CH = 720;
/** The plates' rounding (§3.3) and the card outline. */
const RADIUS = 12;
const BORDER = 3;
const GAP = 20;
const PAD = 24;
/** The art fills the card top down to here; the name sits over its bottom edge. */
const ART_H = 340;
const NAME_LH = 48;
const CHEVRON = 40;

/** null when buy bonus is off or there are no options. */
export function openBuyBonus(ctx: BmCtx): Layer | null {
  const bonuses = ctx.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;
  return new BuyBonusPanel(ctx, bonuses);
}

/** Options sharing a `groupedBy` key take ONE slot (‹ › flip through them), placed where the first
 *  member is; options with a `custom` renderer never group. (Copy of the shell's core helper.) */
export function groupBonusSlots(bonuses: readonly BonusOption[]): BonusOption[][] {
  const slots: BonusOption[][] = [];
  const byKey = new Map<string, BonusOption[]>();
  for (const b of bonuses) {
    const key = b.groupedBy;
    if (!key || b.custom) {
      slots.push([b]);
      continue;
    }
    const open = byKey.get(key);
    if (open) open.push(b);
    else {
      const slot = [b];
      byKey.set(key, slot);
      slots.push(slot);
    }
  }
  return slots;
}

export class BuyBonusPanel extends Panel {
  readonly slots: BonusOption[][];
  /** Which member each group slot shows; kept across rebuilds. */
  private groupIndex = new Map<number, number>();
  private scroll?: ScrollBox;
  /** Card width in body (design) px, for keyboard scrolling. */
  private cardW = CW;
  /** CTA per slot (tests). */
  ctas: PillButton[] = [];
  confirm?: CardModal;
  confirmBonus?: BonusOption;
  private confirmSig = '';
  private sw = 0;
  private sh = 0;
  /** Panel's constructor calls resize() before this class's fields exist — ignore that one. */
  private live = false;

  constructor(ctx: BmCtx, bonuses: BonusOption[]) {
    super(ctx, { title: ctx.t('Buy bonus'), onClose: () => ctx.closeLayer(), layout: () => {} });
    this.slots = groupBonusSlots(bonuses);
    this.opts.layout = (b, w, h, top) => this.layoutBody(b, w, h, top);
    this.live = true;
    this.resize(ctx.screenW, ctx.screenH);
  }

  /** The bar re-sends the same size on every state change: an open confirm survives that while what
   *  it shows and charges still holds; anything else drops it and rebuilds. */
  resize(w: number, h: number): void {
    if (!this.live) return;
    const same = w === this.sw && h === this.sh;
    this.sw = w;
    this.sh = h;
    if (this.confirm && this.confirmSig !== this.sig()) this.closeConfirm();
    if (this.confirm && same) return;
    super.resize(w, h);
    this.confirm?.resize(w, h);
  }

  private rebuild(): void {
    super.resize(this.sw, this.sh);
  }

  current(slot: number): BonusOption {
    const m = this.slots[slot];
    return m[(this.groupIndex.get(slot) ?? 0) % m.length];
  }

  private step(slot: number, dir: 1 | -1): void {
    const n = this.slots[slot].length;
    if (n < 2) return;
    this.groupIndex.set(slot, ((((this.groupIndex.get(slot) ?? 0) + dir) % n) + n) % n);
    this.rebuild();
  }

  private affordable(b: BonusOption): boolean {
    const s = this.ctx.state;
    return !bonusBuyLocked(s) && b.priceMultiplier * s.bet <= s.balance;
  }

  private isActive(b: BonusOption): boolean {
    return this.ctx.state.activeFeature?.id === b.id;
  }

  /** What a confirm's price and its BUY depend on. */
  private sig(): string {
    const s = this.ctx.state;
    return [s.bet, s.balance, s.busy, s.autoplay.active, s.buyBonusEnabled, s.activeFeature?.id].join('|');
  }

  private betLocked(): boolean {
    return this.ctx.state.busy || this.ctx.state.autoplay.active;
  }

  private stepBet(dir: 1 | -1): void {
    if (this.betLocked()) return;
    this.ctx.actions.stepBet(dir);
    this.rebuild(); // prices follow the bet
  }

  // ── layout ──────────────────────────────────────────────────────────────────
  private layoutBody(root: Container, dw: number, dh: number, top: number): void {
    const keep = this.scroll?.scrollPos ?? 0; // the old box is already destroyed; its position still reads
    const { state } = this.ctx;

    // bottom band: BALANCE (tail l) left, BET (tail r, ±) right
    const bandY = dh - 28 - SIZE.field.h;
    const balance = new Field(this.ctx.ticker, { label: this.ctx.t('Balance'), value: this.ctx.fmt(state.balance), tail: 'l', key: 'bb-balance' });
    const i = state.availableBets.indexOf(state.bet);
    const locked = this.betLocked();
    const bet = new Field(this.ctx.ticker, {
      label: this.ctx.t('Bet'),
      value: this.ctx.fmt(state.bet),
      tail: 'r',
      key: 'bb-bet',
      stepper: { onStep: (d) => this.stepBet(d), downDisabled: locked || i <= 0, upDisabled: locked || i >= state.availableBets.length - 1 },
    });
    balance.position.set(EDGE_X, bandY);
    bet.position.set(dw - EDGE_X - bet.fw, bandY);

    // the strip, between the title and the progress bar; cards keep 1:2 and shrink to the room
    const barY = bandY - 32;
    const viewW = dw - 2 * EDGE_X;
    const cardH = Math.max(200, Math.min(CH, barY - 16 - top));
    const q = cardH / CH;
    this.cardW = CW * q;
    const scroll = new ScrollBox(this.ctx.canvas, 'x');
    this.scroll = scroll;
    scroll.position.set(EDGE_X, top);
    scroll.setViewport(viewW, cardH);
    const n = this.slots.length;
    const total = n * this.cardW + (n - 1) * GAP;
    const x0 = total < viewW ? (viewW - total) / 2 : 0;
    this.ctas = [];
    this.slots.forEach((_, s) => {
      const card = this.buildCard(s);
      card.scale.set(q);
      card.position.set(x0 + s * (this.cardW + GAP), 0);
      scroll.content.addChild(card);
    });
    const bar = new ProgressBar(viewW, 8);
    bar.position.set(EDGE_X, barY);
    scroll.onScroll = () => bar.set(scroll.seen);
    scroll.refresh();
    scroll.scrollBy(keep);
    bar.visible = scroll.maxScroll > 0; // a strip that fits has nothing to track

    root.addChild(scroll, bar, balance, bet);
  }

  /** One 340×720 card (design px; the caller scales it). */
  private buildCard(slot: number): Container {
    const bonus = this.current(slot);
    const nav = this.slots[slot].length > 1;
    const price = bonus.priceMultiplier * this.ctx.state.bet;
    const ok = this.affordable(bonus);
    const active = this.isActive(bonus);
    const feature = bonus.type === 'feature';
    const inner = CW - 2 * PAD;
    // a drag across the strip ends with a tap on whatever is under the finger — ignore it
    const tap = (fn: () => void) => () => {
      if (!this.scroll?.didDrag) fn();
    };
    const card = new Container();
    card.label = `bb-card-${slot}`;
    card.addChild(new Graphics().roundRect(0, 0, CW, CH, RADIUS).fill(C.ink), this.buildArt(bonus, price, ok));

    // bottom-up: CTA, price, volatility
    const ctaH = SIZE.pill.h;
    const ctaY = CH - PAD - ctaH;
    const cta = new PillButton(this.ctx.ticker, {
      label: this.ctx.t(feature ? (active ? 'Active' : 'Activate') : 'Buy'),
      kind: active || !feature ? 'primary' : 'secondary-white',
      icon: active ? 'check' : undefined,
      width: inner,
      height: ctaH,
      onTap: tap(() => this.select(bonus)),
    });
    cta.disabled = !ok && !active;
    cta.position.set(PAD, ctaY);
    this.ctas[slot] = cta;
    const priceT = num(this.ctx.fmt(price), TYPE.price);
    if (priceT.width > inner) priceT.scale.set(inner / priceT.width);
    priceT.position.set((CW - priceT.width) / 2, ctaY - 12 - priceT.height);
    let above = priceT.y;
    if (bonus.volatility) {
      const vol = volatility(bonus.volatility);
      vol.position.set((CW - vol.width) / 2, priceT.y - 10 - vol.height);
      card.addChild(vol);
      above = vol.y;
    }
    const descBottom = above - 22;

    // the name over the art's bottom edge: two lines at most, re-wrapped smaller until it fits
    const zoneH = 2 * NAME_LH;
    const zoneTop = ART_H + 16 - zoneH;
    const nameW = inner - (nav ? 2 * (CHEVRON + 12) : 0);
    const name = display(bonus.title, TYPE.cardTitle, C.paper, { wrap: nameW, align: 'center', stroke: 6, lineHeight: NAME_LH });
    name.style.breakWords = false;
    for (let s = 1; s > 0.3 && (name.width > nameW + 0.5 || name.height / s > zoneH + 12); ) {
      s *= 0.9;
      name.style.wordWrapWidth = nameW / s;
      name.scale.set(s);
    }
    name.position.set((CW - name.width) / 2, zoneTop + (zoneH - name.height) / 2);
    card.addChild(name);
    if (nav) {
      const cy = zoneTop + zoneH / 2;
      card.addChild(this.chevron('chevron-left', PAD + CHEVRON / 2, cy, tap(() => this.step(slot, -1))));
      card.addChild(this.chevron('chevron-right', CW - PAD - CHEVRON / 2, cy, tap(() => this.step(slot, 1))));
    }

    // the description, clipped to the room above the volatility / price
    const descTop = zoneTop + zoneH + 14;
    const room = descBottom - descTop;
    if (room >= 28 && bonus.description) {
      const desc = bodyText(bonus.description, 20, C.paper, { wrap: inner, align: 'center' });
      desc.position.set((CW - desc.width) / 2, descTop);
      const clip = new Graphics().rect(0, descTop, CW, room).fill(0xffffff);
      desc.mask = clip;
      card.addChild(desc, clip);
    }
    // the outline, over the art: grey, the accent on the active feature
    const border = new Graphics()
      .roundRect(BORDER / 2, BORDER / 2, CW - BORDER, CH - BORDER, RADIUS - BORDER / 2)
      .stroke({ width: BORDER, color: active ? C.lime : C.grey600 });
    card.addChild(priceT, cta, border);
    return card;
  }

  /** A lime chevron with a 64×64 hit box, centred at (x, y). */
  private chevron(icon: 'chevron-left' | 'chevron-right', x: number, y: number, onTap: () => void): Container {
    const c = new Container();
    c.addChild(glyph(icon, CHEVRON, C.lime));
    c.position.set(x, y);
    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.hitArea = new Rectangle(-32, -32, 64, 64);
    c.on('pointertap', onTap);
    return c;
  }

  /** The art, clipped to the card top: a thumbnail cover-fit, a game `custom` node fitted (contain,
   *  borrowed — never destroyed), else a grey700 plate with the buy glyph. */
  private buildArt(bonus: BonusOption, price: number, ok: boolean): Container {
    const art = new Container();
    // rounded at the card's top corners only (the mask runs past the art's square bottom)
    const clip = new Graphics().roundRect(0, 0, CW, ART_H + RADIUS, RADIUS).fill(0xffffff);
    art.addChild(clip);
    art.mask = clip;
    if (bonus.custom) {
      const node = bonus.custom({
        bonus,
        bet: this.ctx.state.bet,
        price,
        priceText: this.ctx.fmt(price),
        disabled: !ok,
        accent: `#${C.lime.toString(16).padStart(6, '0')}`,
        select: () => this.select(bonus),
      }) as Container;
      const b = node.getLocalBounds();
      const s = b.width > 0 && b.height > 0 ? Math.min(1, CW / b.width, ART_H / b.height) : 1;
      node.scale.set(s);
      node.position.set((CW - b.width * s) / 2 - b.x * s, (ART_H - b.height * s) / 2 - b.y * s);
      art.addChild(borrowed(node));
    } else if (bonus.thumbnail) {
      const url = bonus.thumbnail;
      const holder = new Container();
      art.addChild(holder);
      const put = (tex: Texture): void => {
        if (holder.destroyed) return; // rebuilt or closed while it loaded
        const sp = new Sprite(tex);
        const s = Math.max(CW / tex.width, ART_H / tex.height);
        sp.scale.set(s);
        sp.position.set((CW - tex.width * s) / 2, (ART_H - tex.height * s) / 2);
        holder.addChild(sp);
      };
      // rebuilds come on every state change: a cached texture goes in at once (no flicker)
      if (Assets.cache.has(url)) put(Assets.get<Texture>(url));
      else Assets.load<Texture>(url).then(put).catch(() => {});
    } else {
      const g = glyph('buy', 160, C.grey500);
      g.position.set(CW / 2, ART_H / 2 - 40);
      art.addChild(new Graphics().rect(0, 0, CW, ART_H).fill(C.grey700), g);
    }
    return art;
  }

  // ── confirm ─────────────────────────────────────────────────────────────────
  private select(bonus: BonusOption): void {
    if (this.confirm) return;
    if (this.isActive(bonus)) {
      this.ctx.actions.deactivateFeature();
      this.ctx.closeLayer();
      return;
    }
    if (!this.affordable(bonus)) return;
    const feature = bonus.type === 'feature';
    const verb = this.ctx.t(feature ? 'Activate' : 'Buy');
    const price = this.ctx.fmt(bonus.priceMultiplier * this.ctx.state.bet);
    this.confirmBonus = bonus;
    this.confirmSig = this.sig();
    this.confirm = buildCard(this.ctx, {
      title: `${verb} ${bonus.title}?`,
      onClose: () => this.closeConfirm(),
      content: (box, w) => {
        const t = num(price, TYPE.price);
        if (t.width > w) t.scale.set(w / t.width);
        t.position.set((w - t.width) / 2, 0);
        box.addChild(t);
        return t.height;
      },
      actions: [
        { label: this.ctx.t('Cancel'), kind: 'secondary-white', onTap: () => this.closeConfirm() },
        { label: verb, kind: 'primary', onTap: () => this.commit(bonus) },
      ],
    }) as CardModal;
    this.stage.eventMode = 'none'; // the strip, stepper and wheel sleep under the confirm
    this.addChild(this.confirm);
  }

  private closeConfirm(): void {
    const c = this.confirm;
    if (!c) return;
    this.confirm = this.confirmBonus = undefined;
    c.onRemove();
    this.removeChild(c);
    c.destroy({ children: true });
    this.stage.eventMode = 'passive';
  }

  private commit(bonus: BonusOption): void {
    if (!this.affordable(bonus)) return;
    this.closeConfirm();
    if (bonus.type === 'feature') this.ctx.actions.activateFeature(bonus);
    else this.ctx.actions.selectBuyBonus(bonus.id);
    this.ctx.closeLayer();
  }

  // ── keyboard ────────────────────────────────────────────────────────────────
  onKey(e: KeyboardEvent): boolean {
    if (this.confirm) {
      if (e.code === 'Escape') {
        this.closeConfirm();
        return true;
      }
      if (e.code === 'Enter' && this.confirmBonus) {
        this.commit(this.confirmBonus);
        return true;
      }
      return false;
    }
    const up = e.code === 'NumpadAdd' || (e.shiftKey && e.code === 'ArrowUp') || e.code === 'Equal';
    const down = e.code === 'NumpadSubtract' || (e.shiftKey && e.code === 'ArrowDown') || e.code === 'Minus';
    if (up || down) {
      this.stepBet(up ? 1 : -1);
      return true;
    }
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      this.scroll?.scrollBy((e.code === 'ArrowRight' ? 1 : -1) * (this.cardW + GAP));
      return true;
    }
    return false; // Escape: the controller closes the layer
  }

  onRemove(): void {
    this.closeConfirm();
    super.onRemove();
  }
}

/** Wrap a game-supplied node so tearing the card down detaches it instead of destroying it. */
function borrowed(node: Container): Container {
  const slot = new Container();
  slot.addChild(node);
  const destroySelf = Container.prototype.destroy.bind(slot);
  slot.destroy = () => {
    if (node.parent === slot) slot.removeChild(node);
    destroySelf({ children: false });
  };
  return slot;
}
