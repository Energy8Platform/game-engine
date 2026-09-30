import { Container, Graphics, Rectangle } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { FlexBox } from '../../pixi/primitives/flex';
import type { CardAction, CardOpts } from '../../pixi-hb/primitives/card';
import { STitlePlate, STextButton, sCloseButton, type SButtonKind } from './controls';
import { S } from '../theme';

/** Fraction of the screen a card modal may occupy (HB's MODAL_FIT). */
const MODAL_FIT = 0.86;

/** Card font-size knob — clamp(11px, 2% of the short side, 15px), as HB. */
function clampEm(w: number, h: number): number {
  return Math.max(11, Math.min(15, Math.min(w, h) * 0.02));
}

function kindOf(kind: CardAction['kind']): SButtonKind {
  return kind === 'red' ? 'red' : kind === 'ghost' ? 'ghost' : 'accent';
}

/** The S card modal — HB `CardModal`'s API in the S look: a flat black panel on the veil, a yellow
 *  title plate riding the card's top-left edge, a yellow ✕ plate top-right, the body column under
 *  them and a row of S text buttons. The pickers, the generic and replay modals and the buy-bonus
 *  confirm are forks that only swap this in. */
export class SCardModal extends Container implements ShellLayer {
  readonly tag?: string;
  readonly body: FlexBox;
  /** Absent when the title is empty. */
  readonly titlePlate?: STitlePlate;
  readonly closeBtn?: Container;
  private host: PixiComponentContext;
  private veil = new Graphics();
  private cardRoot = new Container();
  private bg = new Graphics();
  private actionsRow = new Container();
  private actionsH = 0;
  private em: number;
  private cardW: number;
  private cardH = 0;
  /** Title plate height, and how far the plates overhang the card's top edge. */
  private headH: number;
  private lift: number;
  /** The ✕ plate: 2.4em but never under 32 (a thumb target), its hit area padded to ≥ 44. */
  private closeSize: number;

  constructor(host: PixiComponentContext, opts: CardOpts) {
    super();
    this.host = host;
    this.tag = opts.tag;
    this.em = clampEm(host.screenW, host.screenH);
    this.cardW = Math.min((opts.maxEm ?? 28) * this.em, host.screenW * MODAL_FIT);
    this.headH = Math.round(2.4 * this.em);
    this.lift = Math.round(0.6 * this.em);
    this.closeSize = Math.max(32, this.headH);
    const closable = opts.closable !== false && !!opts.onClose;
    this.body = new FlexBox({ direction: 'column', align: 'center', gap: 1.05 * this.em, padding: 1.2 * this.em });
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.cardRoot.addChild(this.bg, this.body, this.actionsRow);
    if (opts.title.trim()) {
      const titleMax = this.cardW - 2.4 * this.em - (closable ? this.closeSize + 0.6 * this.em : 0);
      this.titlePlate = new STitlePlate(opts.title, this.headH, titleMax);
      this.cardRoot.addChild(this.titlePlate);
    }
    if (closable) {
      const size = this.closeSize;
      const p = Math.max(0, (44 - size) / 2);
      this.closeBtn = sCloseButton(size, () => opts.onClose!());
      this.closeBtn.hitArea = new Rectangle(-p, -p, size + 2 * p, size + 2 * p);
      this.cardRoot.addChild(this.closeBtn);
    }
    this.addChild(this.veil, this.cardRoot);
  }

  get emSize(): number {
    return this.em;
  }
  get cardWidth(): number {
    return this.cardW;
  }
  get cardAccent(): string {
    return S.yellow;
  }

  /** Footer buttons — a row of S text buttons inset from the card edge. */
  setActions(actions: CardAction[]): void {
    this.actionsRow.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!actions.length) return;
    const pad = 1.2 * this.em;
    const gap = 0.6 * this.em;
    const each = (this.cardW - pad * 2 - gap * (actions.length - 1)) / actions.length;
    const h = Math.round(3 * this.em);
    actions.forEach((a, i) => {
      const btn = new STextButton(a.label, { w: each, h, kind: kindOf(a.kind), size: this.em, onTap: a.onTap });
      btn.disabled = !!a.disabled;
      btn.position.set(pad + i * (each + gap), 0);
      this.actionsRow.addChild(btn);
    });
    this.actionsH = h + pad;
  }

  /** Measure body + actions, draw the card, place the plates. Call once after the body and actions. */
  build(): void {
    const top = this.headH - this.lift; // the plates' bottom edge, in card coordinates
    this.body.setLayoutSize(this.cardW, undefined);
    const bodyH = this.body.outerHeight;
    this.cardH = top + bodyH + this.actionsH;
    this.bg.clear().rect(0, 0, this.cardW, this.cardH).fill(S.panel);
    this.titlePlate?.position.set(1.2 * this.em, -this.lift);
    this.closeBtn?.position.set(this.cardW - 1.2 * this.em - this.closeSize, -this.lift);
    this.body.position.set(0, top);
    this.actionsRow.position.set(0, top + bodyH);
    this.resize(this.host.screenW, this.host.screenH);
  }

  resize(w: number, h: number): void {
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    this.fit();
  }

  /** Scale the card down to fit a short / narrow popout and keep it centred (plates included). */
  fit(): void {
    const W = this.host.screenW;
    const H = this.host.screenH;
    if (this.cardW <= 0 || this.cardH <= 0) return;
    const fullH = this.cardH + this.lift;
    const s = Math.min(1, (W * MODAL_FIT) / this.cardW, (H * MODAL_FIT) / fullH);
    this.cardRoot.scale.set(s < 0.999 ? s : 1);
    const k = this.cardRoot.scale.x;
    this.cardRoot.position.set((W - this.cardW * k) / 2, (H - fullH * k) / 2 + this.lift * k);
  }
}
