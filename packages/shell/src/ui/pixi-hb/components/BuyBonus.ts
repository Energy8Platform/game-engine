import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import type { BonusOption } from '@/core/types';
import { betDir } from '@/core/keyboard';
import { makeText } from '../text';
import { makeIcon } from '../pixi-icon';
import { Frame, clamp } from '../primitives/overlay';
import { CardModal } from '../primitives/card';
import { ScrollBox } from '../primitives/scroll';
import { IconButton, Readout, TextButton } from '../primitives/widgets';
import { HB, BORDER } from '../theme';

/** Buy-bonus as ONE page in the HB frame: a hero on the left third, the option's title (with ‹ ›
 *  when there is more than one), volatility, description and a bottom-pinned CTA on the right, and
 *  a balance / bet band along the bottom. `groupedBy` groups are flattened — the arrows walk every
 *  option in config order. Returns null when there are no bonus options. */
export function openBuyBonus(host: PixiComponentContext): ShellLayer | null {
  const bonuses = host.config.features.buyBonus;
  if (bonuses === false || bonuses.length === 0) return null;
  return new BuyBonusPage(host, bonuses);
}

const BET_BAND_H = 64;
const HERO_FRACTION = 0.33;

export class BuyBonusPage extends Frame {
  private bonuses: BonusOption[];
  /** Which option the page shows. Kept across bet steps / resizes. */
  index = 0;
  private page = new Container();
  private descScroll?: ScrollBox;
  private confirm?: CardModal;
  private confirmBonus?: BonusOption;
  /** The CTA of the current page — public so tests can read its label/face. */
  cta?: TextButton;

  constructor(host: PixiComponentContext, bonuses: BonusOption[]) {
    super(host, { tag: 'buybonus', title: host.t('Buy bonus'), onClose: () => host.closeLayer() });
    this.bonuses = bonuses;
    this.addChildAt(this.page, 2);
    this.resize(host.screenW, host.screenH);
  }

  get current(): BonusOption {
    return this.bonuses[this.index];
  }

  resize(w: number, h: number): void {
    this.layoutFrame(w, h);
    this.removeConfirm();
    this.rebuild();
  }

  /** Step to another option (wraps). */
  step(dir: 1 | -1): void {
    const n = this.bonuses.length;
    if (n < 2) return;
    this.index = (this.index + dir + n) % n;
    this.rebuild();
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
    this.descScroll?.destroy({ children: true });
    this.descScroll = undefined;
    this.page.removeChildren().forEach((c) => c.destroy({ children: true }));
    const r = this.inner;
    const em = clamp(11, r.height / 26, 16);
    const bonus = this.current;
    const price = bonus.priceMultiplier * this.host.state.bet;
    const affordable = this.isAffordable(bonus);
    const active = this.isActive(bonus);

    const betH = Math.min(BET_BAND_H, r.height * 0.22);
    const upperH = r.height - betH;
    const heroW = Math.round(r.width * HERO_FRACTION);

    // rules: hero | column, and above the bet band
    const rules = new Graphics();
    rules.rect(heroW, 0, BORDER, upperH).fill(HB.line);
    rules.rect(0, upperH, r.width, BORDER).fill(HB.line);
    this.page.addChild(rules);

    // hero
    const hero = this.buildHero(bonus, heroW, upperH, em, price, affordable);
    this.page.addChild(hero);

    // right column
    const pad = clamp(10, em * 1.2, 20);
    const colX = heroW + BORDER + pad;
    const colW = r.width - colX - pad;
    let y = pad;

    const titleRow = new Container();
    const nav = this.bonuses.length > 1;
    const arrow = clamp(26, em * 2.2, 36);
    const title = makeText(bonus.title, {
      size: em * 1.5,
      weight: '700',
      heading: true,
      color: HB.fg,
      upper: true,
      align: 'center',
      letterSpacing: em * 0.06,
    });
    // a long title shrinks to its slot rather than breaking mid-word
    const titleRoom = colW - (nav ? (arrow + 8) * 2 : 0);
    if (title.width > titleRoom) title.scale.set(titleRoom / title.width);
    title.anchor.set(0.5, 0);
    title.position.set(colW / 2, 0);
    titleRow.addChild(title);
    if (nav) {
      const prev = new IconButton('back', { size: arrow, glyph: Math.round(arrow * 0.5), onTap: () => this.step(-1) });
      const next = new IconButton('chevronRight', { size: arrow, glyph: Math.round(arrow * 0.5), onTap: () => this.step(1) });
      prev.label = 'bb-prev';
      next.label = 'bb-next';
      const rowH = Math.max(title.height, arrow);
      prev.position.set(0, (rowH - arrow) / 2);
      next.position.set(colW - arrow, (rowH - arrow) / 2);
      title.position.y = (rowH - title.height) / 2;
      titleRow.addChild(prev, next);
    }
    titleRow.position.set(colX, y);
    this.page.addChild(titleRow);
    y += Math.max(title.height, nav ? arrow : 0) + pad * 0.6;

    if (bonus.volatility) {
      const vol = volatilityRow(bonus.volatility, em * 1.6);
      vol.position.set(colX + (colW - vol.width) / 2, y);
      this.page.addChild(vol);
      y += em * 1.6 + pad * 0.6;
    }

    // bottom-pinned action row: price | CTA side by side, or stacked when the column is narrow
    const ctaH = clamp(34, em * 3, 46);
    const priceText = makeText(this.host.fmt(price), { size: em * 1.3, color: HB.fg, stroke: true });
    const stacked = colW < priceText.width + 100 + pad;
    const actionY = upperH - pad - ctaH;
    const ctaW = stacked ? colW : Math.min(colW * 0.6, Math.max(100, colW - priceText.width - pad));
    const priceRoom = stacked ? colW : colW - ctaW - pad;
    if (priceText.width > priceRoom) priceText.scale.set(priceRoom / priceText.width);
    if (stacked) priceText.position.set(colX + (colW - priceText.width) / 2, actionY - pad * 0.5 - priceText.height);
    else priceText.position.set(colX, actionY + (ctaH - priceText.height) / 2);
    const ctaLabel = bonus.type === 'feature' ? (active ? 'Deactivate' : 'Activate') : 'Buy';
    const cta = new TextButton(this.host.t(ctaLabel), {
      w: ctaW,
      h: ctaH,
      face: bonus.type === 'feature' ? 'red' : 'orange',
      size: em,
      onTap: () => this.select(bonus),
    });
    cta.label = 'bb-cta';
    cta.disabled = !affordable && !active;
    cta.position.set(colX + colW - ctaW, actionY);
    this.cta = cta;
    this.page.addChild(priceText, cta);

    // description — scrolls if it can't fit between the title block and the action row
    const descH = (stacked ? priceText.y : actionY) - pad * 0.6 - y;
    if (descH >= em * 1.4) {
      const desc = makeText(bonus.description, {
        size: em,
        color: HB.fg,
        wrapWidth: colW - ScrollBox.GUTTER,
        lineHeight: em * 1.4,
        align: 'left',
      });
      const box = new ScrollBox(this.host.canvas, this.host.ticker);
      box.content.addChild(desc);
      box.setViewport(colW, descH);
      box.position.set(colX, y);
      this.descScroll = box;
      this.page.addChild(box);
    }

    // bet band
    this.page.addChild(this.buildBetBand(r.width, betH, upperH + BORDER, em));
    this.page.position.set(r.x, r.y);
  }

  private buildHero(bonus: BonusOption, w: number, h: number, em: number, price: number, affordable: boolean): Container {
    const hero = new Container();
    hero.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0 }));
    const pad = em;
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
      const size = Math.min(boxW, boxH) * 0.8;
      const bird = makeIcon('bonus', size, { fill: bonus.type === 'feature' ? HB.red : HB.orange });
      bird.position.set(pad + (boxW - size) / 2, pad + (boxH - size) / 2);
      hero.addChild(bird);
    }
    return hero;
  }

  private buildBetBand(w: number, h: number, y: number, em: number): Container {
    const band = new Container();
    band.position.set(0, y);
    const { state } = this.host;
    const pad = clamp(10, em * 1.2, 20);
    // (balance is added after the bet group so it can take whatever width is left)

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
    const stepper = new Container();
    if (locked) {
      const cross = makeIcon('close', btn, { ink: HB.fg, fill: HB.panel });
      cross.position.set(0, (h - btn) / 2);
      stepper.addChild(cross);
    } else {
      const up = new IconButton('plus', { size: btn, glyph: Math.round(btn * 0.6), onTap: () => this.stepBetBy(1) });
      const down = new IconButton('minus', { size: btn, glyph: Math.round(btn * 0.6), onTap: () => this.stepBetBy(-1) });
      up.disabled = i >= state.availableBets.length - 1;
      down.disabled = i <= 0;
      up.label = 'bb-bet-up';
      down.label = 'bb-bet-down';
      down.position.set(0, (h - btn) / 2);
      up.position.set(btn + 6, (h - btn) / 2);
      stepper.addChild(down, up);
    }
    const stepperW = locked ? btn : btn * 2 + 6;
    const betW = bet.measureSize().w;
    // bet group hugs the right edge; balance hugs the left and shrinks into what's left
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
    const modal = new CardModal(this.host, {
      tag: 'bb-confirm',
      title: bonus.title,
      onClose: () => this.removeConfirm(),
    });
    const em = modal.emSize;
    const price = bonus.priceMultiplier * this.host.state.bet;
    modal.body.add(
      makeText(bonus.description, {
        size: 0.96 * em,
        color: HB.fg,
        align: 'center',
        wrapWidth: modal.cardWidth - 2.4 * em,
        lineHeight: 0.96 * em * 1.45,
      }),
    );
    modal.body.add(makeText(this.host.fmt(price), { size: 1.6 * em, color: HB.fg, stroke: true, align: 'center' }));
    modal.setActions([
      { label: this.host.t('Cancel'), kind: 'ghost', onTap: () => this.removeConfirm() },
      {
        label: this.host.t(bonus.type === 'feature' ? 'Activate' : 'Buy'),
        kind: bonus.type === 'feature' ? 'red' : 'accent',
        onTap: () => this.commit(bonus),
      },
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
      case 'ArrowRight':
        this.step(1);
        return true;
      case 'ArrowLeft':
        this.step(-1);
        return true;
      case 'Enter':
      case 'Space':
        this.select(this.current);
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
    this.descScroll?.destroy({ children: true });
    this.descScroll = undefined;
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

