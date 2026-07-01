import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../context';
import type { BonusOption } from '@/core/types';
import { betDir } from '@/core/keyboard';
import { effectiveAccent, contrastText } from '@/core/colors';
import { makeText } from '../text';
import { makeIcon, makeRingedIcon } from '../pixi-icon';
import { navButton } from '../primitives/overlay';
import { clamp } from '../primitives/overlay';
import { attachHover } from '../primitives/widgets';
import { roundedPath } from '../primitives/flex';

/** Below this frame height (px), a wide/landscape popout (e.g. Popout S 400×225) stacks its cards
 *  vertically and scrolls — like mobile — so descriptions stay readable instead of shrinking to a
 *  ~4px floor. Wide + taller frames (Popout L and up) keep the centred horizontal row. */
const SHORT_STACK_H = 340;

/** Buy-bonus overlay — art-forward cards (one per option), a live bet footer, and a confirm modal.
 *  Returns null when there are no bonus options. */
export function openBuyBonus(host: PixiComponentContext): ShellLayer | null {
  const bonuses = host.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;
  return new BuyBonusOverlay(host, bonuses);
}

/** Pairing of a rendered CardView with its bonus data (affordability included). */
interface CardEntry {
  view: CardView;
  bonus: BonusOption;
  affordable: boolean;
}

class BuyBonusOverlay extends Container implements ShellLayer {
  readonly tag = 'buybonus';
  private host: PixiComponentContext;
  private bonuses: BonusOption[];
  private veil = new Graphics();
  private header = new Container();
  private strip = new Container(); // cards live here (drag-scrollable when wide)
  private stripMask = new Graphics();
  private footer = new Container();
  private confirm?: Container;
  /** The bonus shown in the current confirm dialog (set by openConfirm, cleared by removeConfirm). */
  private confirmBonus?: BonusOption;
  private w = 0;
  private h = 0;
  private headerH = 44;
  private footerH = 44;
  private chromeScale = 1; // header + bet footer shrink with the frame on short popouts (see resize)
  /** All card entries (view + bonus + affordable flag), rebuilt by buildCards(). */
  private cardEntries: CardEntry[] = [];
  /** Keyboard focus index into the affordable subset of cardEntries. -1 = none. */
  private focusIndex = -1;
  /** true when cards are stacked vertically (mobile, or a short landscape popout). */
  private stack = false;
  // Drag-scroll state. The drag is handled on the (unmasked) overlay, not the masked strip — a mask
  // prunes pointer events outside its band, stalling globalpointermove mid-drag so later cards never
  // scroll into reach. The overlay sees the whole screen, so the scroll runs the full range.
  private dragX = 0;
  private dragAxis: 'x' | 'y' = 'y';
  private dragMax = 0;
  private dragBaseX = 0;
  private dragBaseY = 0;
  private bandTop = 0;
  private bandH = 0;
  private dragging = false;
  private dragFrom = 0;
  private dragBase = 0;
  private dragged = false; // a tap that actually moved → suppress the card select

  constructor(host: PixiComponentContext, bonuses: BonusOption[]) {
    super();
    this.host = host;
    this.bonuses = bonuses;
    this.addChild(this.veil, this.strip, this.header, this.footer);
    this.veil.eventMode = 'static';
    this.strip.mask = this.stripMask;
    this.addChild(this.stripMask);
    this.eventMode = 'static';
    this.on('pointerdown', this.onDragDown);
    this.on('globalpointermove', this.onDragMove);
    this.on('pointerup', this.onDragUp);
    this.on('pointerupoutside', this.onDragUp);
    this.resize(host.screenW, host.screenH);
  }

  private onDragDown = (e: FederatedPointerEvent): void => {
    if (this.confirm || this.dragMax <= 0) return;
    const gy = e.global.y;
    if (gy < this.bandTop || gy > this.bandTop + this.bandH) return; // only within the card band
    this.dragging = true;
    this.dragged = false;
    this.dragFrom = this.dragAxis === 'x' ? e.global.x : e.global.y;
    this.dragBase = this.dragX;
  };
  private onDragMove = (e: FederatedPointerEvent): void => {
    if (!this.dragging) return;
    const cur = this.dragAxis === 'x' ? e.global.x : e.global.y;
    if (Math.abs(cur - this.dragFrom) > 4) this.dragged = true;
    this.dragX = Math.max(-this.dragMax, Math.min(0, this.dragBase + (cur - this.dragFrom)));
    if (this.dragAxis === 'x') this.strip.position.x = this.dragBaseX + this.dragX;
    else this.strip.position.y = this.dragBaseY + this.dragX;
  };
  private onDragUp = (): void => {
    this.dragging = false;
  };

  /** Configure the scroll for the current layout (axis, the strip's resting position, the card band
   *  the drag is allowed to start in, and the max travel). The overlay's listeners read these. */
  private setDragRange(axis: 'x' | 'y', baseX: number, baseY: number, bandTop: number, bandH: number, max: number): void {
    this.dragAxis = axis;
    this.dragBaseX = baseX;
    this.dragBaseY = baseY;
    this.bandTop = bandTop;
    this.bandH = bandH;
    this.dragMax = Math.max(0, max);
    this.dragX = 0;
    this.dragging = false;
    this.strip.eventMode = 'auto'; // visual-only; its children (cards) are still hit-tested in-band
    this.strip.position.set(baseX, baseY);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    // Chrome (header + bet footer) scales with the frame height: full size by Popout L (≈450px tall),
    // shrinking to 0.72 on a short Popout S so it doesn't dwarf the (already shrunk) cards. Mirrors the
    // DOM shell's vh-clamped buy-bonus chrome.
    this.chromeScale = clamp(0.72, h / 450, 1);
    this.headerH = 44 * this.chromeScale;
    this.footerH = 46 * this.chromeScale;
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
    const sc = this.chromeScale;
    const pad = 10 * sc;
    const navSz = 32 * sc;
    const close = navButton(this.host, 'close', () => this.host.closeLayer(), navSz);
    const titleSize = 16 * sc;
    const title = makeText(this.host.t('Buy bonus'), {
      size: titleSize,
      weight: '800',
      color: '#ffffff',
      letterSpacing: titleSize * 0.04,
      upper: true,
    });
    title.anchor.set(0.5);
    title.position.set(this.w / 2, this.headerH / 2 + pad / 2);
    close.position.set(this.w - navSz - pad, (this.headerH - navSz) / 2 + pad / 2);
    this.header.addChild(title, close);
  }

  private buildCards(): void {
    this.strip.removeChildren().forEach((c) => c.destroy({ children: true }));
    // Stack (readable vertical list + scroll) on mobile OR on a short landscape popout; a shrink-to-fit
    // horizontal row on wide + tall frames. See SHORT_STACK_H.
    const stack = this.host.layout === 'mobile' || this.h <= SHORT_STACK_H;
    this.stack = stack;
    const top = this.headerH + 6;
    const areaH = this.h - top - this.footerH - 6;
    const gap = 14;
    const n = Math.max(1, this.bonuses.length);
    // The whole card is laid out in `em`; pick the largest em that fits BOTH dimensions of the
    // available area, so the card is always fully visible (no horizontal clip, CTA never under the
    // footer). emH keeps the card height within the band between header and footer; emW makes the
    // N cards (+ gaps + 24px side margins) fit the frame width. min() of the two = the binding fit.
    // Floor 4 is a last-resort so a 400×225 popout still shows the CTA (then X-drag scrolls the slack).
    const emH = 3.4 * (areaH / 100);
    const emW = stack
      ? (this.w - 48) / 18 // vertical stack: a single card spans the width
      : (this.w - 48 - (n - 1) * gap) / (18 * n); // row: N cards + gaps fit the frame width
    const em = stack ? Math.min(12, emW) : clamp(4, Math.min(emH, emW), 12);
    const cardW = Math.min(18 * em, this.w - 48);

    const cards = this.bonuses.map((b) => this.buildCard(b, cardW, em, stack, areaH));
    const cardH = Math.max(...cards.map((c) => c.height));
    for (const c of cards) c.setHeight(cardH);

    // Rebuild card entries for keyboard navigation
    this.cardEntries = this.bonuses.map((b, i) => ({
      view: cards[i],
      bonus: b,
      affordable: this.isAffordable(b),
    }));
    // Restore or init keyboard focus on the first affordable card
    const affordable = this.cardEntries.filter((e) => e.affordable);
    if (affordable.length > 0) {
      if (this.focusIndex < 0) this.focusIndex = 0;
      else this.focusIndex = Math.min(this.focusIndex, affordable.length - 1);
      this.applyFocusRing();
    } else {
      this.focusIndex = -1;
    }

    this.stripMask.clear();
    if (stack) {
      // vertical stack — scroll vertically if it overflows (simple drag)
      let y = 0;
      const colX = (this.w - cardW) / 2;
      for (const c of cards) {
        c.node.position.set(colX, y);
        y += cardH + gap;
        this.strip.addChild(c.node);
      }
      this.stripMask.rect(0, top, this.w, areaH).fill(0xffffff);
      this.setDragRange('y', 0, top, top, areaH, y - gap - areaH);
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
      this.setDragRange('x', 0, 0, top, areaH, totalW + 48 - this.w);
    }
  }

  // ── one card ──────────────────────────────────────────────────────────────
  private buildCard(bonus: BonusOption, cardW: number, em: number, stack: boolean, areaH: number): CardView {
    const accent = effectiveAccent(bonus);
    const ink = contrastText(accent);
    const price = bonus.priceMultiplier * this.host.state.bet;
    const enabled = this.isAffordable(bonus);
    const select = (): void => {
      if (this.dragged) return; // a scroll gesture, not a tap
      if (this.isAffordable(bonus)) this.openConfirm(bonus, accent, ink);
    };
    // Game-supplied card UI (BonusOption.custom): the shell keeps the card slot + the buy/confirm
    // flow via ctx.select(); the game owns the interior. (DOM .ge-bonus-card--custom: no shell bg.)
    if (bonus.custom) {
      const content = bonus.custom({
        bonus,
        bet: this.host.state.bet,
        price,
        priceText: this.host.fmt(price),
        disabled: !enabled,
        accent,
        select,
      });
      return new CustomCard(content as Container, cardW);
    }
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
      onSelect: select,
    });
    void stack;
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
    // The bet pill reads too large next to the (shrunk) cards, so size it at ~0.82 of the chrome
    // scale. It still centres in the full-height footer band (footerH stays on chromeScale).
    const sc = this.chromeScale * 0.82;
    const pillH = 38 * sc;
    const stepSz = 32 * sc;
    const glyphSz = 20 * sc;
    const pill = new Container();
    const bg = new Graphics();
    const step = (icon: 'minus' | 'plus', dir: 1 | -1): { node: Container; setDisabled: (d: boolean) => void } => {
      const b = new Container();
      const glyph = makeIcon(icon, glyphSz, '#ffffff');
      glyph.position.set((stepSz - glyphSz) / 2, (stepSz - glyphSz) / 2);
      b.addChild(rectHit(stepSz, stepSz), glyph);
      b.eventMode = 'static';
      b.cursor = 'pointer';
      let disabled = false;
      b.on('pointerover', () => !disabled && glyph.setColor(this.host.tokens.accent));
      b.on('pointerout', () => glyph.setColor('#ffffff'));
      b.on('pointertap', () => {
        if (disabled) return;
        this.host.actions.stepBet(dir);
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
    const label = makeText(this.host.t('Bet'), { size: 7 * sc, weight: '600', color: this.host.tokens.plaqueLabel, letterSpacing: 1, upper: true });
    const value = makeText(this.host.fmt(this.host.state.bet), { size: 14 * sc, weight: '800', color: '#ffffff' });
    const valW = Math.max(80 * sc, value.width + 16 * sc, label.width + 16 * sc);
    label.position.set((valW - label.width) / 2, 2 * sc);
    value.position.set((valW - value.width) / 2, 11 * sc);
    valWrap.addChild(label, value);

    const padX = 5 * sc;
    down.node.position.set(padX, (pillH - stepSz) / 2);
    valWrap.position.set(padX + stepSz, (pillH - 28 * sc) / 2);
    up.node.position.set(padX + stepSz + valW, (pillH - stepSz) / 2);
    const pillW = padX * 2 + stepSz + valW + stepSz;
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
    this.confirmBonus = bonus;
    const layer = new Container();
    const veil = new Graphics();
    // The confirm sits over the BRIGHT opaque bonus cards, not the frosted game behind the overlay,
    // so the standard ~50%-alpha `backdrop` tint barely dims them. Use a denser fill (same tint) so
    // the confirm reads as a proper modal layer above the cards.
    veil.rect(0, 0, this.w, this.h).fill({ color: 0x0c111c, alpha: 0.82 });
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
      const vol = volatilityRow(this.host, bonus.volatility, accent, 2.2 * em);
      vol.position.set((cardW - vol.width) / 2, y);
      body.addChild(vol);
      y += 2.2 * em + 0.55 * em;
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
        if (bonus.type === 'feature') this.host.actions.activateFeature(bonus);
        else this.host.actions.selectBuyBonus(bonus.id);
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
      this.confirmBonus = undefined;
    }
  }

  // ── keyboard navigation ────────────────────────────────────────────────────

  /** Step the bet by `dir` and re-render the bar, cards (affordability + price) and footer when it
   *  actually changed. Shared by the keyboard bet keys (the footer ± buttons keep their own copy). */
  private stepBetBy(dir: 1 | -1): void {
    this.host.actions.stepBet(dir);
    this.buildCards();
    this.buildFooter();
  }

  /** Apply or clear the focus ring on affordable cards. */
  private applyFocusRing(): void {
    const affordable = this.cardEntries.filter((ce) => ce.affordable);
    for (let i = 0; i < affordable.length; i++) {
      const view = affordable[i].view;
      if (view instanceof BonusCard) {
        view.setFocused(i === this.focusIndex);
      }
    }
  }

  /** Two-phase keyboard handler.
   *  Browse phase: arrows move focus; +/- step bet; Enter/Space opens confirm; Escape closes.
   *  Confirm phase: Enter/Space buys/activates; Escape returns to browse. */
  onKey(e: KeyboardEvent): boolean {
    // Vertical stack (mobile / short popout) → Up/Down navigate; horizontal row → Left/Right.
    const stack = this.stack;

    if (this.confirm && this.confirmBonus) {
      // ── Confirm phase ──
      switch (e.code) {
        case 'Enter':
        case 'Space': {
          const bonus = this.confirmBonus;
          if (!this.isAffordable(bonus)) return true;
          if (bonus.type === 'feature') this.host.actions.activateFeature(bonus);
          else this.host.actions.selectBuyBonus(bonus.id);
          this.host.closeLayer();
          return true;
        }
        case 'Escape':
          this.removeConfirm();
          return true;
        default:
          return false;
      }
    }

    // ── Browse phase ──
    const affordable = this.cardEntries.filter((ce) => ce.affordable);
    const last = affordable.length - 1;

    // Bet stepping mirrors the bar's keys (Shift+↑/↓, Shift+=/-, Numpad ±). Checked BEFORE arrow
    // navigation so a bare arrow still moves card focus while a Shift+arrow changes the bet.
    const bet = betDir(e);
    if (bet !== null) { this.stepBetBy(bet); return true; }

    // Determine navigation direction from key code + layout
    const fwdKey = e.code === 'ArrowRight' || (stack && e.code === 'ArrowDown');
    const bwdKey = e.code === 'ArrowLeft' || (stack && e.code === 'ArrowUp');

    if (fwdKey) {
      if (last < 0) return true;
      if (this.focusIndex < last) { this.focusIndex++; this.applyFocusRing(); }
      return true;
    }
    if (bwdKey) {
      if (last < 0) return true;
      if (this.focusIndex > 0) { this.focusIndex--; this.applyFocusRing(); }
      return true;
    }

    switch (e.code) {
      case 'Enter':
      case 'Space':
        if (last < 0 || this.focusIndex < 0) return true;
        {
          const entry = affordable[this.focusIndex];
          const accent = effectiveAccent(entry.bonus);
          const ink = contrastText(accent);
          this.openConfirm(entry.bonus, accent, ink);
        }
        return true;
      // Bare =/- also step the bet (the Shift+=/- and Numpad variants are handled by betDir above).
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

  fit(): void {
    /* cards already sized to the area */
  }
  onRemove(): void {
    /* nothing extra */
  }
}

// ── card view ──────────────────────────────────────────────────────────────────
/** A card in the strip — the default `BonusCard` or a game-supplied `CustomCard`. The overlay only
 *  needs its display node, its natural height, and a way to stretch it to the row's tallest card. */
interface CardView {
  node: Container;
  height: number;
  setHeight(total: number): void;
}

/** Wrapper for a game-supplied custom card (`BonusOption.custom`). The shell keeps the card slot (sizing +
 *  the scroll/confirm flow via `ctx.select`); the game owns the visuals — no shell bg/border, like
 *  the DOM's `.ge-bonus-card--custom`. */
class CustomCard implements CardView {
  readonly node = new Container();
  height = 0;
  constructor(content: Container, _cardW: number) {
    this.node.addChild(content);
    this.height = Math.max(1, content.getLocalBounds().height);
  }
  setHeight(total: number): void {
    this.height = total; // the game owns its own layout; we only record the slot height
  }
}

interface BonusCardOpts {
  host: PixiComponentContext;
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

class BonusCard implements CardView {
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

    // disabled (.ge-bonus-off): the title and the lit volatility bolts desaturate to grey, on top of
    // the whole-card 0.62 alpha — matches the DOM, where they aren't just dimmed but recoloured.
    const titleColor = opts.enabled ? accent : 'rgba(255,255,255,.6)';
    const volColor = opts.enabled ? accent : 'rgba(255,255,255,.4)';

    const top = new Container();
    let y = 1.25 * em;
    const title = makeText(bonus.title, { size: 1.3 * em, weight: '800', color: titleColor, letterSpacing: 1.3 * em * 0.04, upper: true, align: 'center', wrapWidth: innerW });
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
      const vol = volatilityRow(host, bonus.volatility, volColor, 2.2 * em);
      vol.position.set((cardW - vol.width) / 2, by);
      this.bottomBlock.addChild(vol);
      by += 2.2 * em + 0.55 * em;
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
  private focused = false;

  /** Set keyboard focus ring on this card (reuses the hover/accent outline visual). */
  setFocused(focused: boolean): void {
    this.focused = focused;
    this.drawBg();
  }

  /** Card background + border; the border turns accent on hover or keyboard focus
   *  (DOM box-shadow 0 0 0 1px card-acc). */
  private drawBg(): void {
    const { cardW, em, host, accent, enabled } = this.opts;
    const active = this.hovered || this.focused;
    const w = active ? 2 : 1;
    this.bg.clear();
    this.bg
      .roundRect(w / 2, w / 2, cardW - w, this.height - w, 1.4 * em)
      .fill(host.tokens.plaqueGlass)
      .stroke({ color: active && enabled ? accent : host.tokens.plaqueLine, width: w });
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
function thumbNode(host: PixiComponentContext, bonus: BonusOption, accent: string, h: number): Container {
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

function volatilityRow(_host: PixiComponentContext, level: number, accent: string, size: number): Container {
  const c = new Container();
  const n = Math.max(0, Math.min(5, level));
  let x = 0;
  for (let i = 0; i < 5; i++) {
    // active = solid accent bolt; inactive = solid black bolt, dimmed (fill==ring, 1px hairline ring
    // per the DOM: .ge-bonus-vol svg path { stroke-width:1; fill/stroke = accent (on) / #000 (off) })
    const active = i < n;
    const col = active ? accent : '#000000';
    const bolt = makeRingedIcon('turbo1', size, col, col, 1);
    bolt.alpha = active ? 1 : 0.5;
    bolt.position.set(x, 0);
    c.addChild(bolt);
    x += size;
  }
  return c;
}

function ctaButton(host: PixiComponentContext, label: string, accent: string, ink: string, w: number, h: number, enabled: boolean, onTap: () => void, radius = 0): Container {
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

function footerButton(host: PixiComponentContext, label: string, kind: 'ghost' | string, w: number, h: number, x: number, y: number, onTap: () => void, ink?: string, blRadius = 0, brRadius = 0): Container {
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
