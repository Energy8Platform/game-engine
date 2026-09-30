import { Container, Graphics, Rectangle } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { FlexBox } from '../../pixi/primitives/flex';
import type { CardAction, CardOpts } from '../../pixi-hb/primitives/card';
import { STitlePlate, STextButton, sCloseButton, type SButtonKind } from './controls';
import { S } from '../theme';
import { stripMetrics } from './page';

/** Fraction of the screen a card modal may occupy (HB's MODAL_FIT). */
const MODAL_FIT = 0.86;

/** Card font-size knob — clamp(11px, 2% of the short side, 15px), as HB. */
function clampEm(w: number, h: number): number {
  return Math.max(11, Math.min(15, Math.min(w, h) * 0.02));
}

function kindOf(kind: CardAction['kind']): SButtonKind {
  return kind === 'red' ? 'red' : kind === 'ghost' ? 'ghost' : 'accent';
}

/** The S card modal — HB `CardModal`'s API with no backing (R3). The content block (the title plate
 *  centred on top, then the body and the actions) sits straight on the veil over the frosted game,
 *  and ✕ is a yellow plate in the screen's top-right corner. */
export class SCardModal extends Container implements ShellLayer {
  readonly tag?: string;
  readonly body: FlexBox;
  /** Absent when the title is empty. */
  readonly titlePlate?: STitlePlate;
  /** Rebuilt by resize() so its size and inset follow the current screen. */
  closeBtn?: Container;
  private onClose?: () => void;
  private host: PixiComponentContext;
  private veil = new Graphics();
  private cardRoot = new Container();
  private actionsRow = new Container();
  private actionsH = 0;
  private em: number;
  private cardW: number;
  private cardH = 0;
  /** Title plate height. */
  private headH: number;

  constructor(host: PixiComponentContext, opts: CardOpts) {
    super();
    this.host = host;
    this.tag = opts.tag;
    this.em = clampEm(host.screenW, host.screenH);
    this.cardW = Math.min((opts.maxEm ?? 28) * this.em, host.screenW * MODAL_FIT);
    this.headH = Math.round(2.4 * this.em);
    const closable = opts.closable !== false && !!opts.onClose;
    this.body = new FlexBox({ direction: 'column', align: 'center', gap: 1.05 * this.em, padding: 1.2 * this.em });
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.cardRoot.addChild(this.body, this.actionsRow);
    if (opts.title.trim()) {
      const titleMax = this.cardW - 2.4 * this.em;
      this.titlePlate = new STitlePlate(opts.title, this.headH, titleMax);
      this.cardRoot.addChild(this.titlePlate);
    }
    if (closable) {
      this.onClose = opts.onClose;
    }
    this.addChild(this.veil, this.cardRoot);
    this.placeClose(host.screenW, host.screenH);
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
    const top = this.titlePlate ? this.headH + Math.round(0.8 * this.em) : 0;
    this.body.setLayoutSize(this.cardW, undefined);
    const bodyH = this.body.outerHeight;
    this.cardH = top + bodyH + this.actionsH;
    this.titlePlate?.position.set((this.cardW - this.titlePlate.measureSize().w) / 2, 0);
    this.body.position.set(0, top);
    this.actionsRow.position.set(0, top + bodyH);
    this.resize(this.host.screenW, this.host.screenH);
  }

  resize(w: number, h: number): void {
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    this.placeClose(w, h);
    this.fit();
  }

  private placeClose(w: number, h: number): void {
    if (!this.onClose) return;
    const onClose = this.onClose;
    const strip = stripMetrics(h);
    this.closeBtn?.destroy({ children: true });
    this.closeBtn = sCloseButton(strip.height, () => onClose());
    this.closeBtn.position.set(w - strip.top - strip.height, strip.top);
    this.addChild(this.closeBtn);
  }

  /** Scale the card down to fit a short / narrow popout and keep it centred . */
  fit(): void {
    const W = this.host.screenW;
    const H = this.host.screenH;
    if (this.cardW <= 0 || this.cardH <= 0) return;
    const fullH = this.cardH;
    const s = Math.min(1, (W * MODAL_FIT) / this.cardW, (H * MODAL_FIT) / fullH);
    this.cardRoot.scale.set(s < 0.999 ? s : 1);
    const k = this.cardRoot.scale.x;
    this.cardRoot.position.set((W - this.cardW * k) / 2, (H - fullH * k) / 2);
  }
}
