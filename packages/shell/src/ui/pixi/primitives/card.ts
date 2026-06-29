import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../context';
import { contrastText } from '@/core/colors';
import { makeIcon } from '../pixi-icon';
import { makeText } from '../text';
import { attachHover, attachPress } from './widgets';
import { FlexBox, roundedPath } from './flex';

/** Fraction of the frame a card modal may occupy (GameShell.MODAL_FIT). */
const MODAL_FIT = 0.86;

export interface CardAction {
  label: string;
  /** 'accent' (filled accent), 'ghost' (glass), or an explicit CSS colour. */
  kind: 'accent' | 'ghost' | string;
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

/** A centred card on a frosted backdrop: accent title heading, vertical body, full-bleed footer
 *  buttons (corners clipped by the card silhouette), and an overlay ✕ pinned to the screen corner.
 *  Shared by the buy-bonus confirm, the bet/autoplay pickers, the generic + replay modals. */
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
    this.accent = opts.accent ?? host.tokens.accent;
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
      weight: '800',
      color: this.accent,
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

  /** Full-bleed footer buttons, flush to the card's bottom edge. */
  setActions(actions: CardAction[]): void {
    this.actionsRow.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!actions.length) return;
    const each = this.cardW / actions.length;
    const h = 3.1 * this.em;
    const r = 1.3 * this.em; // card corner radius — only the outermost buttons round at the bottom
    actions.forEach((a, i) => {
      const btn = this.makeButton(a, each, h, i === 0 ? r : 0, i === actions.length - 1 ? r : 0);
      btn.position.set(i * each, 0);
      this.actionsRow.addChild(btn);
    });
    this.actionsH = h;
  }

  private makeButton(a: CardAction, w: number, h: number, blRadius: number, brRadius: number): Container {
    const root = new Container();
    const fill =
      a.kind === 'accent' ? (a.accent ?? this.accent) : a.kind === 'ghost' ? this.host.tokens.plaqueGlassHover : a.kind;
    const ink = a.kind === 'ghost' ? '#ffffff' : a.kind === 'accent' ? '#ffffff' : contrastText(fill);
    const bg = new Graphics();
    const draw = (hover: boolean): void => {
      bg.clear();
      roundedPath(bg, 0, 0, w, h, [0, 0, brRadius, blRadius]); // square top (flush to body), rounded bottom
      bg.fill(a.disabled ? '#8d939e' : fill);
      if (hover && !a.disabled) {
        roundedPath(bg, 0, 0, w, h, [0, 0, brRadius, blRadius]);
        bg.fill({ color: '#ffffff', alpha: 0.12 }); // ≈ filter:brightness(1.08), a touch stronger
      }
    };
    draw(false);
    const label = makeText(a.label, {
      size: this.em,
      weight: '800',
      color: a.disabled ? '#3a3f47' : ink,
      letterSpacing: this.em * 0.04,
      upper: true,
      align: 'center',
    });
    label.anchor.set(0.5);
    label.position.set(w / 2, h / 2);
    root.addChild(bg, label);
    if (!a.disabled) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = new Rectangle(0, 0, w, h);
      attachHover(root, () => draw(true), () => draw(false));
      root.on('pointertap', () => a.onTap());
    }
    return root;
  }

  private addClose(onClose: () => void): void {
    const size = 36;
    const root = new Container();
    const bg = new Graphics();
    const draw = (hover: boolean): void => {
      bg.clear();
      bg.circle(size / 2, size / 2, size / 2);
      bg.fill(hover ? this.host.tokens.plaqueGlass : this.host.tokens.plaqueDark);
    };
    draw(false);
    const glyph = makeIcon('close', 20, '#ffffff');
    glyph.position.set((size - 20) / 2, (size - 20) / 2);
    root.addChild(bg, glyph);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(0, 0, size, size);
    attachHover(root, () => {
      draw(true);
      glyph.setColor(this.host.tokens.accent);
    }, () => {
      draw(false);
      glyph.setColor('#ffffff');
    });
    attachPress(root, 0.92, onClose);
    this.closeBtn = root;
    this.addChild(root); // pinned to the screen corner, not the card
  }

  /** Measure body + actions, draw the card background/mask, then place everything. Call once
   *  after the body content and actions are set. */
  build(): void {
    this.body.setLayoutSize(this.cardW, undefined);
    const bodyH = this.body.outerHeight;
    this.cardH = bodyH + this.actionsH;

    this.bg.clear();
    this.bg.roundRect(0, 0, this.cardW, this.cardH, 1.3 * this.em);
    this.bg.fill(this.host.tokens.plaqueSolid);

    this.body.position.set(0, 0);
    this.actionsRow.position.set(0, bodyH);

    this.resize(this.host.screenW, this.host.screenH);
  }

  resize(w: number, h: number): void {
    this.veil.clear();
    this.veil.rect(0, 0, w, h);
    this.veil.fill(this.host.tokens.backdrop);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    this.recentre(w, h);
    this.fit();
  }

  private recentre(w: number, h: number): void {
    this.cardRoot.position.set((w - this.cardW) / 2, (h - this.cardH) / 2);
    if (this.closeBtn) this.closeBtn.position.set(w - 36 - 12, 12);
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
