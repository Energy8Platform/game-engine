import { Container, Graphics, Rectangle } from 'pixi.js';
import type { BubbleVariant } from '../assets';
import { Bubble, IconButton, PillButton, pivotOnTail, type PillKind } from '../components';
import { uiScale, type BmCtx, type Layer } from '../context';
import { bubblePop, ease, tween } from '../motion';
import { display, fitWidth } from '../text';
import { C, MOTION, SCRIM, SIZE, TYPE } from '../theme';

/** Screen edge → title / ✕ (§4.8: 48 / 40). */
export const EDGE_X = 48;
export const EDGE_Y = 40;
export const TITLE_H = 84;
/** The content column under the title strip. */
export const CONTENT_TOP = EDGE_Y + TITLE_H + 28;
export const CONTENT_MAX_W = 1240;

/** A title bubble (display 44 on a lime-outlined bubble, tail left). */
export function titleBubble(text: string, maxW: number, variant: BubbleVariant = 'ink-outline', h = TITLE_H): Bubble {
  const t = display(text, TYPE.title * (h / TITLE_H));
  const pad = 36;
  fitWidth(t, maxW - 2 * pad);
  const b = new Bubble({ variant, tail: 'l', width: Math.max(h * 1.6, t.width + 2 * pad), height: h });
  b.addChild(t);
  b.centre(t);
  return b;
}

/** The ✕: a lime-outlined bubble with its tail on the right, 88×84. */
export function closeButton(ctx: BmCtx, onTap: () => void): IconButton {
  return new IconButton(ctx.ticker, { icon: 'close', shape: 'bubble-r', width: SIZE.close.w, height: SIZE.close.h, outline: true, onTap });
}

export interface PanelOpts {
  title: string;
  /** Omit the ✕ (the replay summary). */
  closable?: boolean;
  onClose(): void;
  /** Lay the content out in `body` for a design-px screen of `w × h`; the column starts at `top`. */
  layout(body: Container, w: number, h: number, top: number): void;
}

/** §4.8 — every full-screen overlay: the blurred game (the renderer's snapshot) under a .55 scrim, the
 *  title bubble top-left, the ✕ top-right, the content below. Laid out in design px (1920×1080 on a
 *  landscape screen) and scaled to the screen; rebuilt on resize. Enters with panelIn; the title and
 *  ✕ pop from their tails 60ms later. */
export class Panel extends Container implements Layer {
  readonly scrim = new Graphics();
  readonly stage = new Container();
  body = new Container();
  title?: Bubble;
  closeBtn?: IconButton;
  protected ctx: BmCtx;
  protected opts: PanelOpts;
  private entered = false;
  private anims: Array<() => void> = [];
  /** The design size last laid out. */
  dw = 0;
  dh = 0;

  constructor(ctx: BmCtx, opts: PanelOpts) {
    super();
    this.ctx = ctx;
    this.opts = opts;
    this.scrim.eventMode = 'static'; // swallow taps to the game
    this.addChild(this.scrim, this.stage);
    this.resize(ctx.screenW, ctx.screenH);
  }

  resize(w: number, h: number): void {
    this.scrim.clear().rect(0, 0, w, h).fill(SCRIM);
    this.scrim.hitArea = new Rectangle(0, 0, w, h);
    const k = uiScale(w, h);
    this.dw = w / k;
    this.dh = h / k;
    this.stage.scale.set(k);
    this.stage.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.body = new Container();
    this.stage.addChild(this.body);
    this.opts.layout(this.body, this.dw, this.dh, CONTENT_TOP);
    const closeW = this.opts.closable === false ? 0 : SIZE.close.w;
    this.title = titleBubble(this.opts.title, this.dw - 2 * EDGE_X - closeW - 24);
    this.title.position.set(EDGE_X, EDGE_Y);
    this.stage.addChild(this.title);
    if (this.opts.closable !== false) {
      this.closeBtn = closeButton(this.ctx, () => this.opts.onClose());
      this.closeBtn.position.set(this.dw - EDGE_X - SIZE.close.w, EDGE_Y);
      this.stage.addChild(this.closeBtn);
    }
    if (!this.entered) this.enter();
  }

  private enter(): void {
    this.entered = true;
    const tk = this.ctx.ticker;
    this.scrim.alpha = 0;
    this.anims.push(tween(tk, { duration: MOTION.scrimIn.dur, ease: ease.linear, onUpdate: (p) => (this.scrim.alpha = p) }));
    const b = this.body;
    const cx = this.dw / 2;
    const cy = this.dh / 2;
    b.pivot.set(cx, cy);
    b.position.set(cx, cy);
    this.anims.push(
      tween(tk, {
        duration: MOTION.panelIn.dur,
        ease: ease.backOut(1.6),
        onUpdate: (p) => {
          if (b.destroyed) return;
          b.alpha = Math.min(1, p * 1.5);
          b.scale.set(MOTION.panelIn.scale + (1 - MOTION.panelIn.scale) * p);
        },
      }),
    );
    for (const n of [this.title, this.closeBtn]) {
      if (!n) continue;
      if (n instanceof Bubble) pivotOnTail(n);
      else {
        n.pivot.set(n.bw - 16, n.bh);
        n.position.set(n.x + n.bw - 16, n.y + n.bh);
      }
      this.anims.push(bubblePop(tk, n, 60));
    }
  }

  onRemove(): void {
    for (const a of this.anims) a();
  }
}

// ── small card modal ─────────────────────────────────────────────────────────
export interface CardAction {
  label: string;
  kind?: PillKind;
  disabled?: boolean;
  onTap(): void;
}

export interface CardOpts {
  title: string;
  titleVariant?: BubbleVariant;
  closable?: boolean;
  onClose(): void;
  /** Card width in design px (720 by default). */
  width?: number;
  /** Fill the card's content area (`w` wide) from y = 0; return its height. */
  content(box: Container, w: number): number;
  actions?: CardAction[];
}

const CARD_PAD = 40;

/** The small PanelFrame (§5.2 confirm, §5.7 errors): an ink card (r6) centred over the scrim, the title
 *  bubble on its top edge, an optional ✕, the content, then a row of pills. Scaled to fit. */
export function buildCard(ctx: BmCtx, o: CardOpts): Layer {
  return new CardModal(ctx, o);
}

export class CardModal extends Container implements Layer {
  readonly scrim = new Graphics();
  readonly card = new Container();
  actions: PillButton[] = [];
  private ctx: BmCtx;
  private o: CardOpts;
  private entered = false;
  private anims: Array<() => void> = [];

  constructor(ctx: BmCtx, o: CardOpts) {
    super();
    this.ctx = ctx;
    this.o = o;
    this.scrim.eventMode = 'static';
    this.addChild(this.scrim, this.card);
    this.resize(ctx.screenW, ctx.screenH);
  }

  resize(w: number, h: number): void {
    this.scrim.clear().rect(0, 0, w, h).fill(SCRIM);
    this.scrim.hitArea = new Rectangle(0, 0, w, h);
    this.card.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.actions = [];
    const cw = this.o.width ?? 720;
    const inner = cw - 2 * CARD_PAD;
    const tk = this.ctx.ticker;

    const title = titleBubble(this.o.title, cw - 2 * CARD_PAD - (this.o.closable ? SIZE.close.w + 16 : 0), this.o.titleVariant, 76);
    title.position.set(CARD_PAD - 12, -38);
    const box = new Container();
    const boxH = this.o.content(box, inner);
    box.position.set(CARD_PAD, 38 + 32);
    let y = box.y + boxH;
    const acts = this.o.actions ?? [];
    if (acts.length) {
      y += 36;
      const gap = 20;
      const bw = Math.min(300, (inner - gap * (acts.length - 1)) / acts.length);
      const rowW = bw * acts.length + gap * (acts.length - 1);
      acts.forEach((a, i) => {
        const p = new PillButton(tk, { label: a.label, kind: a.kind ?? 'primary', width: bw, height: 64, onTap: a.onTap });
        p.disabled = !!a.disabled;
        p.position.set((cw - rowW) / 2 + i * (bw + gap), y);
        this.actions.push(p);
      });
      y += 64;
    }
    const ch = y + CARD_PAD;
    const bg = new Graphics().roundRect(0, 0, cw, ch, 6).fill(C.ink);
    bg.eventMode = 'static';
    this.card.addChild(bg, box, ...this.actions, title);
    if (this.o.closable) {
      const x = closeButton(this.ctx, () => this.o.onClose());
      x.position.set(cw - CARD_PAD - SIZE.close.w + 12, -42);
      this.card.addChild(x);
    }
    // fit: design scale, then shrink to the screen (title overhang included)
    const k = Math.min(uiScale(w, h), (w * 0.94) / cw, (h * 0.9) / (ch + 42));
    this.card.scale.set(k);
    this.card.pivot.set(cw / 2, (ch - 42) / 2);
    this.card.position.set(w / 2, h / 2);
    if (!this.entered) {
      this.entered = true;
      const c = this.card;
      this.scrim.alpha = 0;
      this.anims.push(tween(tk, { duration: MOTION.scrimIn.dur, ease: ease.linear, onUpdate: (p) => (this.scrim.alpha = p) }));
      this.anims.push(
        tween(tk, {
          duration: MOTION.panelIn.dur,
          ease: ease.backOut(1.6),
          onUpdate: (p) => {
            if (c.destroyed) return;
            c.alpha = Math.min(1, p * 1.5);
            c.scale.set(k * (MOTION.panelIn.scale + (1 - MOTION.panelIn.scale) * p));
          },
        }),
      );
    }
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'Enter') {
      const a = (this.o.actions ?? []).find((x) => !x.disabled && (x.kind ?? 'primary') === 'primary');
      if (a) {
        a.onTap();
        return true;
      }
    }
    if (e.code === 'Escape' && !this.o.closable) return true; // not dismissable
    return false;
  }

  onRemove(): void {
    for (const a of this.anims) a();
  }
}
