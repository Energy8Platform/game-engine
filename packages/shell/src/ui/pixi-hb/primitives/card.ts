import { Container, Graphics, Rectangle } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { makeText } from '../text';
import { TextButton, type Face } from './widgets';
import { FlexBox } from '../../pixi/primitives/flex';
import { HB, BORDER } from '../theme';
import { plaque } from './plaque';
import { navButton } from './overlay';

/** Fraction of the frame a card modal may occupy (GameShell.MODAL_FIT). */
const MODAL_FIT = 0.86;

export interface CardAction {
  label: string;
  /** 'accent' (orange), 'ghost' (beige), 'red' (feature), or an explicit face name. */
  kind: 'accent' | 'ghost' | 'red' | string;
  onTap: () => void;
  /** accent colour for the 'accent' kind (defaults to shell accent / card accent). */
  accent?: string;
  disabled?: boolean;
}

export interface CardOpts {
  title: string;
  accent?: string;
  closable?: boolean;
  /** unused for now — backdrop blur is approximated by the veil tint. */
  blur?: number;
  onClose?: () => void;
  tag?: string;
  /** Max card width in em (default 28). The bet picker uses 44em to fit 6 chips/row. */
  maxEm?: number;
}

/** A centred HB plaque card on a dark veil: Space Grotesk title, vertical body, a row of plaque
 *  buttons at the bottom, and an orange ✕ pinned to the card's top-right corner. Shared by the
 *  buy-bonus confirm, the bet/autoplay pickers, the generic + replay modals. */
export class CardModal extends Container implements ShellLayer {
  readonly tag?: string;
  readonly body: FlexBox;
  private host: PixiComponentContext;
  private opts: CardOpts;
  private veil = new Graphics();
  private cardRoot = new Container();
  private bg = new Graphics();
  private actionsRow = new Container();
  private actionsH = 0;
  private closeBtn?: Container;
  private em: number;
  private cardW: number;
  private cardH = 0;
  private accent: string;

  constructor(host: PixiComponentContext, opts: CardOpts) {
    super();
    this.host = host;
    this.opts = opts;
    this.tag = opts.tag;
    this.accent = opts.accent ?? HB.orange;
    this.em = clampEm(host.screenW, host.screenH);
    this.cardW = Math.min((opts.maxEm ?? 28) * this.em, host.screenW * 0.86);

    this.body = new FlexBox({
      direction: 'column',
      align: 'center',
      gap: 1.05 * this.em,
      padding: 1.2 * this.em,
    });
    const title = makeText(opts.title, {
      size: 1.2 * this.em,
      weight: '700',
      heading: true,
      color: HB.fg,
      letterSpacing: 1.2 * this.em * 0.04,
      upper: true,
      align: 'center',
      wrapWidth: this.cardW - 2.4 * this.em,
    });
    this.body.add(title);

    this.veil.eventMode = 'static';
    // No mask on cardRoot: a masked container blocks pointer events to its children (chips/buttons
    // wouldn't hover). The only thing that needs clipping is the full-bleed action buttons' bottom
    // corners, which we round directly (setActions) — the body content never reaches the corners.
    this.cardRoot.addChild(this.bg, this.body, this.actionsRow);
    this.addChild(this.veil, this.cardRoot);

    if (opts.closable !== false && opts.onClose) this.addClose(opts.onClose);
  }

  get emSize(): number {
    return this.em;
  }
  get cardWidth(): number {
    return this.cardW;
  }
  get cardAccent(): string {
    return this.accent;
  }

  /** Footer buttons — a row of plaques inset from the card edge. */
  setActions(actions: CardAction[]): void {
    this.actionsRow.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!actions.length) return;
    const pad = 1.2 * this.em;
    const gap = 0.6 * this.em;
    const each = (this.cardW - pad * 2 - gap * (actions.length - 1)) / actions.length;
    const h = 3 * this.em;
    actions.forEach((a, i) => {
      const face: Face = a.kind === 'accent' ? 'orange' : a.kind === 'ghost' ? 'beige' : a.kind === 'red' ? 'red' : 'orange';
      const btn = new TextButton(a.label, { w: each, h, face, size: this.em, onTap: a.onTap });
      btn.disabled = !!a.disabled;
      btn.position.set(pad + i * (each + gap), 0);
      this.actionsRow.addChild(btn);
    });
    this.actionsH = h + pad;
  }

  private addClose(onClose: () => void): void {
    this.closeBtn = navButton(this.host, 'close', onClose, 32);
    this.cardRoot.addChild(this.closeBtn); // rides the card's top-right corner
  }

  /** Measure body + actions, draw the card background/mask, then place everything. Call once
   *  after the body content and actions are set. */
  build(): void {
    this.body.setLayoutSize(this.cardW, undefined);
    const bodyH = this.body.outerHeight;
    this.cardH = bodyH + this.actionsH;

    plaque(this.bg, this.cardW, this.cardH, { fill: HB.panel });

    this.body.position.set(0, 0);
    this.actionsRow.position.set(0, bodyH);

    this.resize(this.host.screenW, this.host.screenH);
  }

  resize(w: number, h: number): void {
    this.veil.clear();
    this.veil.rect(0, 0, w, h);
    this.veil.fill(HB.backdrop);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    this.recentre(w, h);
    this.fit();
  }

  private recentre(w: number, h: number): void {
    this.cardRoot.position.set((w - this.cardW) / 2, (h - this.cardH) / 2);
    if (this.closeBtn) this.closeBtn.position.set(this.cardW - 32 - BORDER - 6, BORDER + 6);
  }

  /** Scale the card down to fit a short/narrow popout (GameShell.fitSheet). */
  fit(): void {
    const availW = this.host.screenW;
    const availH = this.host.screenH;
    if (this.cardW <= 0 || this.cardH <= 0) return;
    const s = Math.min(1, (availW * MODAL_FIT) / this.cardW, (availH * MODAL_FIT) / this.cardH);
    this.cardRoot.scale.set(s < 0.999 ? s : 1);
    // keep the scaled card centred
    const sw = this.cardW * this.cardRoot.scale.x;
    const sh = this.cardH * this.cardRoot.scale.y;
    this.cardRoot.position.set((availW - sw) / 2, (availH - sh) / 2);
  }
}

/** Card font-size knob — clamp(11px, 2cqmin, 15px) of the shell root. */
function clampEm(w: number, h: number): number {
  return Math.max(11, Math.min(15, Math.min(w, h) * 0.02));
}
