import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { ShellHost, ShellLayer } from '../context';
import type { BonusOption } from '../types';
import { stepBet } from '../state';
import { effectiveAccent, contrastText } from '../colors';
import { makeText } from '../text';
import { makeIcon } from '../pixi-icon';
import { navButton } from '../primitives/overlay';
import { clamp } from '../primitives/overlay';
import { attachHover } from '../primitives/widgets';
import { roundedPath } from '../primitives/flex';

/** Buy-bonus overlay — art-forward cards (one per option), a live bet footer, and a confirm modal.
 *  Returns null when there are no bonus options. */
export function openBuyBonus(host: ShellHost): ShellLayer | null {
  const bonuses = host.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;
  return new BuyBonusOverlay(host, bonuses);
}

class BuyBonusOverlay extends Container implements ShellLayer {
  readonly tag = 'buybonus';
  private host: ShellHost;
  private bonuses: BonusOption[];
  private veil = new Graphics();
  private header = new Container();
  private strip = new Container(); // cards live here (drag-scrollable when wide)
  private stripMask = new Graphics();
  private footer = new Container();
  private confirm?: Container;
  private w = 0;
  private h = 0;
  private headerH = 44;
  private footerH = 44;
  private dragX = 0;

  constructor(host: ShellHost, bonuses: BonusOption[]) {
    super();
    this.host = host;
    this.bonuses = bonuses;
    this.addChild(this.veil, this.strip, this.header, this.footer);
    this.veil.eventMode = 'static';
    this.strip.mask = this.stripMask;
    this.addChild(this.stripMask);
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.headerH = clamp(40, 6.4 * (h / 100), 52);
    this.footerH = 44;
    this.veil.clear();
    this.veil.rect(0, 0, w, h).fill(this.host.tokens.backdrop);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    this.buildHeader();
    this.buildCards();
    this.buildFooter();
    if (this.confirm) {
      this.removeConfirm();
    }
  }

  private buildHeader(): void {
    this.header.removeChildren().forEach((c) => c.destroy({ children: true }));
    const pad = 10;
    const close = navButton(this.host, 'close', () => this.host.closeLayer());
    const titleSize = clamp(13, 2.6 * (this.h / 100), 16);
    const title = makeText(this.host.t('Buy bonus'), {
      size: titleSize,
      weight: '800',
      color: '#ffffff',
      letterSpacing: titleSize * 0.04,
      upper: true,
    });
    title.anchor.set(0.5);
    title.position.set(this.w / 2, this.headerH / 2 + pad / 2);
    close.position.set(this.w - 32 - pad, (this.headerH - 32) / 2 + pad / 2);
    this.header.addChild(title, close);
  }

  private buildCards(): void {
    this.strip.removeChildren().forEach((c) => c.destroy({ children: true }));
    const mobile = this.host.layout === 'mobile';
    const top = this.headerH + 6;
    const areaH = this.h - top - this.footerH - 6;
    const em = mobile ? 12 : clamp(7, 3.6 * (areaH / 100), 12);
    const cardW = Math.min(18 * em, this.w - 48);
    const gap = 14;

    const cards = this.bonuses.map((b) => this.buildCard(b, cardW, em, mobile, areaH));
    const cardH = Math.max(...cards.map((c) => c.height));
    for (const c of cards) c.setHeight(cardH);

    this.stripMask.clear();
    if (mobile) {
      // vertical stack — scroll vertically if it overflows (simple drag)
      let y = 0;
      const colX = (this.w - cardW) / 2;
      for (const c of cards) {
        c.node.position.set(colX, y);
        y += cardH + gap;
        this.strip.addChild(c.node);
      }
      this.stripMask.rect(0, top, this.w, areaH).fill(0xffffff);
      this.strip.position.set(0, top);
      this.enableDrag('y', areaH, y - gap);
    } else {
      // horizontal strip — centred, drag-scroll if it overflows
      const totalW = cards.length * cardW + (cards.length - 1) * gap;
      let x = Math.max(24, (this.w - totalW) / 2);
      const y = top + (areaH - cardH) / 2;
      for (const c of cards) {
        c.node.position.set(x, y);
        x += cardW + gap;
        this.strip.addChild(c.node);
      }
      this.stripMask.rect(0, top, this.w, areaH).fill(0xffffff);
      this.strip.position.set(0, 0);
      this.enableDrag('x', this.w, totalW + 48);
    }
  }

  private enableDrag(axis: 'x' | 'y', view: number, content: number): void {
    this.dragX = 0;
    if (content <= view) {
      this.strip.eventMode = 'auto';
      return;
    }
    const max = content - view;
    this.strip.eventMode = 'static';
    this.strip.hitArea = new Rectangle(0, 0, this.w, this.h);
    let dragging = false;
    let last = 0;
    let base = 0;
    const baseY = this.strip.position.y;
    const baseX = this.strip.position.x;
    this.strip.removeAllListeners();
    this.strip.on('pointerdown', (e: FederatedPointerEvent) => {
      dragging = true;
      last = axis === 'x' ? e.global.x : e.global.y;
      base = this.dragX;
    });
    this.strip.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (!dragging) return;
      const cur = axis === 'x' ? e.global.x : e.global.y;
      this.dragX = Math.max(-max, Math.min(0, base + (cur - last)));
      if (axis === 'x') this.strip.position.x = baseX + this.dragX;
      else this.strip.position.y = baseY + this.dragX;
    });
    const up = (): void => {
      dragging = false;
    };
    this.strip.on('pointerup', up);
    this.strip.on('pointerupoutside', up);
  }

  // ── one card ──────────────────────────────────────────────────────────────
  private buildCard(bonus: BonusOption, cardW: number, em: number, mobile: boolean, areaH: number): BonusCard {
    const accent = effectiveAccent(bonus);
    const ink = contrastText(accent);
    const price = bonus.priceMultiplier * this.host.state.bet;
    const enabled = this.isAffordable(bonus);
    const card = new BonusCard({
      host: this.host,
      bonus,
      cardW,
      em,
      accent,
      ink,
      priceText: this.host.fmt(price),
      enabled,
      ctaLabel: this.host.t(bonus.type === 'feature' ? 'Activate' : 'Buy'),
      onSelect: () => {
        if (this.isAffordable(bonus)) this.openConfirm(bonus, accent, ink);
      },
    });
    void mobile;
    void areaH;
    return card;
  }

  private isAffordable(bonus: BonusOption): boolean {
    const s = this.host.state;
    if (s.busy || !s.buyBonusEnabled) return false;
    return bonus.priceMultiplier * s.bet <= s.balance;
  }

  // ── bet footer ──────────────────────────────────────────────────────────────
  private buildFooter(): void {
    this.footer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const pillH = 38;
    const pill = new Container();
    const bg = new Graphics();
    const step = (icon: 'minus' | 'plus', dir: 1 | -1): { node: Container; setDisabled: (d: boolean) => void } => {
      const b = new Container();
      const glyph = makeIcon(icon, 20, '#ffffff');
      glyph.position.set(6, 6);
      b.addChild(rectHit(32, 32), glyph);
      b.eventMode = 'static';
      b.cursor = 'pointer';
      let disabled = false;
      b.on('pointerover', () => !disabled && glyph.setColor(this.host.tokens.accent));
      b.on('pointerout', () => glyph.setColor('#ffffff'));
      b.on('pointertap', () => {
        if (disabled) return;
        const next = stepBet(this.host.state, dir);
        if (next === this.host.state.bet) return;
        this.host.state.bet = next;
        this.host.emit('betChange', next);
        this.host.render();
        this.buildCards();
        this.buildFooter();
      });
      return {
        node: b,
        setDisabled: (d) => {
          disabled = d;
          b.alpha = d ? 0.35 : 1;
        },
      };
    };
    const down = step('minus', -1);
    const up = step('plus', 1);
    const valWrap = new Container();
    const label = makeText(this.host.t('Bet'), { size: 7, weight: '600', color: this.host.tokens.plaqueLabel, letterSpacing: 1, upper: true });
    const value = makeText(this.host.fmt(this.host.state.bet), { size: 14, weight: '800', color: '#ffffff' });
    const valW = Math.max(80, value.width + 16, label.width + 16);
    label.position.set((valW - label.width) / 2, 2);
    value.position.set((valW - value.width) / 2, 11);
    valWrap.addChild(label, value);

    const padX = 5;
    down.node.position.set(padX, (pillH - 32) / 2);
    valWrap.position.set(padX + 32, (pillH - 28) / 2);
    up.node.position.set(padX + 32 + valW, (pillH - 32) / 2);
    const pillW = padX * 2 + 32 + valW + 32;
    bg.roundRect(0, 0, pillW, pillH, 999).fill(this.host.tokens.plaqueDark);
    pill.addChild(bg, down.node, valWrap, up.node);
    pill.position.set((this.w - pillW) / 2, this.h - this.footerH + (this.footerH - pillH) / 2);
    this.footer.addChild(pill);

    const i = this.host.state.availableBets.indexOf(this.host.state.bet);
    down.setDisabled(this.host.state.busy || i <= 0);
    up.setDisabled(this.host.state.busy || i >= this.host.state.availableBets.length - 1);
  }

  // ── confirm modal (stacked on top of the overlay) ─────────────────────────────
  private openConfirm(bonus: BonusOption, accent: string, ink: string): void {
    this.removeConfirm();
    const layer = new Container();
    const veil = new Graphics();
    veil.rect(0, 0, this.w, this.h).fill(this.host.tokens.backdrop);
    veil.eventMode = 'static';
    veil.hitArea = new Rectangle(0, 0, this.w, this.h);
    layer.addChild(veil);

    const em = clamp(11, Math.min(this.w, this.h) * 0.02, 15);
    const cardW = Math.min(28 * em, this.w * 0.86);
    const price = bonus.priceMultiplier * this.host.state.bet;

    // preview content (thumb, desc, vol, price) measured to size the card
    const body = new Container();
    let y = 1.2 * em;
    const title = makeText(bonus.title, { size: 1.2 * em, weight: '800', color: accent, letterSpacing: 1.2 * em * 0.04, upper: true, align: 'center', wrapWidth: cardW - 2.4 * em });
    title.position.set((cardW - title.width) / 2, y);
    body.addChild(title);
    y += title.height + 1.05 * em;
    const thumb = thumbNode(this.host, bonus, accent, 6.2 * em);
    thumb.position.set((cardW - 6.2 * em) / 2, y);
    body.addChild(thumb);
    y += 6.2 * em + 0.8 * em;
    const desc = makeText(bonus.description, { size: 0.96 * em, weight: '400', color: 'rgba(255,255,255,.82)', align: 'center', wrapWidth: cardW - 2.4 * em, lineHeight: 0.96 * em * 1.45 });
    desc.position.set((cardW - desc.width) / 2, y);
    body.addChild(desc);
    y += desc.height + 0.8 * em;
    if (bonus.volatility) {
      const vol = volatilityRow(this.host, bonus.volatility, accent, 2.1 * em);
      vol.position.set((cardW - vol.width) / 2, y);
      body.addChild(vol);
      y += 2.1 * em + 0.55 * em;
    }
    const priceText = makeText(this.host.fmt(price), { size: 1.6 * em, weight: '800', color: '#ffffff', align: 'center' });
    priceText.position.set((cardW - priceText.width) / 2, y);
    body.addChild(priceText);
    y += priceText.height + 1.2 * em;

    const ctaH = 3.1 * em;
    const cardH = y + ctaH;
    const card = new Container();
    const cardBg = new Graphics();
    cardBg.roundRect(0, 0, cardW, cardH, 1.3 * em).fill(this.host.tokens.plaqueSolid);
    card.addChild(cardBg, body);
    // footer: Cancel (ghost) + Buy/Activate (accent). No mask — round the outer bottom corners so
    // the buttons keep the card silhouette without a mask blocking their pointer events.
    const half = cardW / 2;
    const r = 1.3 * em;
    card.addChild(
      footerButton(this.host, this.host.t('Cancel'), 'ghost', half, ctaH, 0, y, () => this.removeConfirm(), undefined, r, 0),
      footerButton(this.host, this.host.t(bonus.type === 'feature' ? 'Activate' : 'Buy'), accent, half, ctaH, half, y, () => {
        if (!this.isAffordable(bonus)) return;
        if (bonus.type === 'feature') this.host.activateFeature(bonus);
        else this.host.emit('buyBonusSelect', { id: bonus.id });
        this.host.closeLayer();
      }, ink, 0, r),
    );
    card.position.set((this.w - cardW) / 2, (this.h - cardH) / 2);
    layer.addChild(card);

    // close X pinned to screen corner
    const close = navButton(this.host, 'close', () => this.removeConfirm(), 36);
    close.position.set(this.w - 36 - 12, 12);
    layer.addChild(close);

    this.confirm = layer;
    this.addChild(layer);
  }

  private removeConfirm(): void {
    if (this.confirm) {
      this.removeChild(this.confirm);
      this.confirm.destroy({ children: true });
      this.confirm = undefined;
    }
  }

  fit(): void {
    /* cards already sized to the area */
  }
  onRemove(): void {
    /* nothing extra */
  }
}

// ── card view ──────────────────────────────────────────────────────────────────
interface BonusCardOpts {
  host: ShellHost;
  bonus: BonusOption;
  cardW: number;
  em: number;
  accent: string;
  ink: string;
  priceText: string;
  enabled: boolean;
  ctaLabel: string;
  onSelect: () => void;
}

class BonusCard {
  readonly node = new Container();
  height = 0;
  private opts: BonusCardOpts;
  private bg = new Graphics();
  private cta: Container;
  private bottomBlock = new Container();
  private bottomH = 0;
  private ctaH: number;

  constructor(opts: BonusCardOpts) {
    this.opts = opts;
    const { host, bonus, cardW, em, accent } = opts;
    this.ctaH = 3.1 * em;
    const sidePad = 1.1 * em;
    const innerW = cardW - sidePad * 2;

    const top = new Container();
    let y = 1.25 * em;
    const title = makeText(bonus.title, { size: 1.3 * em, weight: '800', color: accent, letterSpacing: 1.3 * em * 0.04, upper: true, align: 'center', wrapWidth: innerW });
    title.position.set((cardW - title.width) / 2, y);
    top.addChild(title);
    y += title.height + 0.75 * em;
    const thumb = thumbNode(host, bonus, accent, 6.2 * em);
    thumb.position.set((cardW - 6.2 * em) / 2, y);
    top.addChild(thumb);
    y += 6.2 * em + 0.7 * em;
    const desc = makeText(bonus.description, { size: 0.96 * em, weight: '400', color: 'rgba(255,255,255,.82)', align: 'center', wrapWidth: innerW, lineHeight: 0.96 * em * 1.45 });
    desc.position.set((cardW - desc.width) / 2, y);
    top.addChild(desc);
    y += desc.height;
    this.topH = y;

    // bottom block: volatility + price
    let by = 0;
    if (bonus.volatility) {
      const vol = volatilityRow(host, bonus.volatility, accent, 2.1 * em);
      vol.position.set((cardW - vol.width) / 2, by);
      this.bottomBlock.addChild(vol);
      by += 2.1 * em + 0.55 * em;
    }
    const priceText = makeText(opts.priceText, { size: 1.6 * em, weight: '800', color: '#ffffff', align: 'center' });
    priceText.position.set((cardW - priceText.width) / 2, by);
    this.bottomBlock.addChild(priceText);
    by += priceText.height;
    this.bottomH = by;

    this.cta = ctaButton(host, opts.ctaLabel, accent, opts.ink, cardW, this.ctaH, opts.enabled, opts.onSelect, 1.4 * em);

    this.node.addChild(this.bg, top, this.bottomBlock, this.cta);
    if (opts.enabled) {
      this.node.eventMode = 'static';
      this.node.cursor = 'pointer';
      this.node.on('pointertap', opts.onSelect);
      // hover: accent outline (the DOM's box-shadow 0 0 0 1px card-acc). pointerenter/leave (not
      // over/out) so moving onto the inner CTA doesn't toggle the card hover off and on.
      this.node.on('pointerenter', () => { this.hovered = true; this.drawBg(); });
      this.node.on('pointerleave', () => { this.hovered = false; this.drawBg(); });
    } else {
      this.node.alpha = 0.62;
    }
    // provisional height (refined by setHeight once the row's max is known)
    this.setHeight(this.topH + 0.7 * this.opts.em + this.bottomH + 1.25 * this.opts.em + this.ctaH);
  }

  private topH = 0;

  private hovered = false;

  /** Card background + border; the border turns accent on hover (DOM box-shadow 0 0 0 1px acc). */
  private drawBg(): void {
    const { cardW, em, host, accent, enabled } = this.opts;
    const w = this.hovered ? 2 : 1;
    this.bg.clear();
    this.bg
      .roundRect(w / 2, w / 2, cardW - w, this.height - w, 1.4 * em)
      .fill(host.tokens.plaqueGlass)
      .stroke({ color: this.hovered && enabled ? accent : host.tokens.plaqueLine, width: w });
  }

  setHeight(total: number): void {
    this.height = total;
    const { cardW, em } = this.opts;
    const bodyH = total - this.ctaH;
    // bottom block sits above the CTA, with the body bottom padding (.9em)
    this.bottomBlock.position.set(0, bodyH - 0.9 * em - this.bottomH);
    this.cta.position.set(0, bodyH);
    this.drawBg();
    // No node mask (it would block pointer events to the CTA). The CTA rounds its own bottom
    // corners to the card radius instead — see ctaButton().
    this.node.hitArea = new Rectangle(0, 0, cardW, total);
  }
}

// ── shared card bits ─────────────────────────────────────────────────────────
function thumbNode(host: ShellHost, bonus: BonusOption, accent: string, h: number): Container {
  const c = new Container();
  c.addChild(rectHit(h, h, 0)); // size anchor (transparent)
  if (bonus.thumbnail) {
    Assets.load(bonus.thumbnail)
      .then((tex: Texture) => {
        const sp = new Sprite(tex);
        const scale = Math.min((h * 18) / 6.2 / tex.width || 1, h / tex.height);
        const s = Math.min(h / tex.height, h / tex.width);
        sp.scale.set(s);
        sp.position.set((h - tex.width * s) / 2, (h - tex.height * s) / 2);
        void scale;
        c.addChild(sp);
      })
      .catch(() => {});
  } else {
    const gift = makeIcon('gift', h * 0.56, accent);
    gift.position.set((h - h * 0.56) / 2, (h - h * 0.56) / 2);
    c.addChild(gift);
  }
  return c;
}

function volatilityRow(host: ShellHost, level: number, accent: string, size: number): Container {
  const c = new Container();
  const n = Math.max(0, Math.min(5, level));
  let x = 0;
  for (let i = 0; i < 5; i++) {
    const bolt = makeIcon('lightning', size, i < n ? accent : 'rgba(255,255,255,.18)');
    bolt.position.set(x, 0);
    c.addChild(bolt);
    x += size;
  }
  return c;
}

function ctaButton(host: ShellHost, label: string, accent: string, ink: string, w: number, h: number, enabled: boolean, onTap: () => void, radius = 0): Container {
  const c = new Container();
  const bg = new Graphics();
  const fill = enabled ? accent : '#8d939e';
  const draw = (hover: boolean): void => {
    bg.clear();
    roundedPath(bg, 0, 0, w, h, [0, 0, radius, radius]); // rounded bottom corners (card silhouette)
    bg.fill(fill);
    if (hover) {
      roundedPath(bg, 0, 0, w, h, [0, 0, radius, radius]);
      bg.fill({ color: '#ffffff', alpha: 0.1 }); // ≈ filter:brightness(1.06)
    }
  };
  draw(false);
  const t = makeText(label, { size: 1.05 * (h / 3.1), weight: '800', color: enabled ? ink : '#3a3f47', letterSpacing: 0.5, upper: true, align: 'center' });
  t.position.set((w - t.width) / 2, (h - t.height) / 2);
  c.addChild(bg, t);
  if (enabled) {
    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.hitArea = new Rectangle(0, 0, w, h);
    attachHover(c, () => draw(true), () => draw(false));
    c.on('pointertap', onTap);
  }
  return c;
}

function footerButton(host: ShellHost, label: string, kind: 'ghost' | string, w: number, h: number, x: number, y: number, onTap: () => void, ink?: string, blRadius = 0, brRadius = 0): Container {
  const c = new Container();
  const bg = new Graphics();
  const fill = kind === 'ghost' ? host.tokens.plaqueGlassHover : kind;
  const draw = (hover: boolean): void => {
    bg.clear();
    roundedPath(bg, 0, 0, w, h, [0, 0, brRadius, blRadius]);
    bg.fill(fill);
    if (hover) {
      roundedPath(bg, 0, 0, w, h, [0, 0, brRadius, blRadius]);
      bg.fill({ color: '#ffffff', alpha: 0.1 });
    }
  };
  draw(false);
  const color = kind === 'ghost' ? '#ffffff' : ink ?? contrastText(kind);
  const t = makeText(label, { size: h / 3.1, weight: '800', color, letterSpacing: 0.5, upper: true, align: 'center' });
  t.position.set((w - t.width) / 2, (h - t.height) / 2);
  c.addChild(bg, t);
  c.position.set(x, y);
  c.eventMode = 'static';
  c.cursor = 'pointer';
  c.hitArea = new Rectangle(0, 0, w, h);
  attachHover(c, () => draw(true), () => draw(false));
  c.on('pointertap', onTap);
  return c;
}

function rectHit(w: number, h: number, alpha = 0): Graphics {
  const g = new Graphics();
  g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha });
  return g;
}
