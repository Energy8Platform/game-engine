import { Container, Graphics, type Ticker } from 'pixi.js';
import type { ScrollHint } from '@/core/scrollHint';
import { prefersReducedMotion } from '@/core/motion';
import { makeIcon } from '../pixi-icon';

/**
 * The Pixi half of the scroll affordance — the drawn counterpart to the DOM's `data-scroll`.
 *
 * A ScrollBox masks, drags and swallows the wheel; a buy-bonus strip drags its cards. Neither drew
 * anything to say so, and in a 400×225 Stake popout that is most of the overlay content out of
 * sight with no way to know it. Both now own one of these and feed it a `ScrollHint`.
 *
 * Three marks, matching the DOM shell exactly:
 *   • a thumb — the standing "this scrolls";
 *   • a scrim at whichever edge hides content, so the content reads as continuing rather than as
 *     ending in a hard cut;
 *   • a chevron at rest, retired for good the first time the region moves.
 *
 * Everything is drawn in the PARENT's coordinate space from an explicit viewport rect, so an owner
 * whose content is offset (a ScrollBox translates its content, a strip translates itself) does not
 * have to unwind that transform to place the marks.
 */

export type ScrollAxis = 'y' | 'x';

export interface ScrollViewport {
  x: number;
  y: number;
  w: number;
  h: number;
  axis: ScrollAxis;
}

export interface ThumbBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Thickness of the thumb, and how far it is inset from the edge it rides. */
const THUMB_THICK = 4;
const THUMB_INSET = 3;
/** Shortest thumb we will draw in pixels — the fractional floor still degenerates on a tiny frame. */
const THUMB_MIN_PX = 22;
/** Depth of the edge scrim. */
const SCRIM = 34;
const SCRIM_ALPHA = 0.72;

/** The overlay chrome — plaques, bar, backdrop — is scheme-independent in this shell (see
 *  resolveTheme: those tokens are fixed, only the palette behind them flips). The affordance is
 *  chrome, so it is a fixed neutral too: white marks over a tint of the same hue as the veil, which
 *  makes the fade read as content dissolving INTO the overlay rather than as a grey band on top. */
const SCRIM_TINT = 0x0c111c;

const CUE_R = 11;
const CUE_BOB = 4;
const CUE_PERIOD = 1600; // ms

export interface ScrimSlice {
  /** Distance inward from the faded edge. */
  offset: number;
  thickness: number;
  alpha: number;
}

/**
 * The scrim's alpha ramp, densest AT the edge and clear by `depth` inward.
 *
 * Exported because the direction is the whole point and is easy to get backwards: an inverted ramp
 * draws a hard-edged dark band floating over the content instead of a fade into the frame, and it
 * looks deliberate enough that nobody questions it. The squared falloff keeps the outer half of the
 * ramp faint, so the scrim reads as content thinning out rather than as a panel laid on top.
 */
export function scrimRamp(depth: number): ScrimSlice[] {
  const slices = Math.max(1, Math.round(depth));
  const thickness = depth / slices;
  const out: ScrimSlice[] = [];
  for (let i = 0; i < slices; i++) {
    const offset = i * thickness;
    const t = 1 - (offset + thickness / 2) / depth; // 1 at the edge → 0 at `depth`
    out.push({ offset, thickness, alpha: SCRIM_ALPHA * t * t });
  }
  return out;
}

export class ScrollAffordanceView extends Container {
  private thumb = new Graphics();
  private scrim = new Graphics();
  private cue = new Container();
  private ticker?: Ticker;
  private bounds: ThumbBounds | null = null;
  private cueOn = false;
  // Once the region has moved the player knows the gesture; re-offering it on every return to the
  // top would nag rather than inform.
  private cueRetired = false;
  private cueBaseY = 0;
  private elapsed = 0;
  private tick?: (t: Ticker) => void;

  constructor(ticker?: Ticker) {
    super();
    this.ticker = ticker;
    this.eventMode = 'none'; // decoration: never intercept the drag it is advertising
    this.addChild(this.scrim, this.thumb, this.cue);
    this.buildCue();
    this.visible = false;
  }

  /** Where the thumb is drawn, in the parent's space — `null` when nothing is drawn. */
  get thumbBounds(): ThumbBounds | null {
    return this.visible ? this.bounds : null;
  }

  get cueVisible(): boolean {
    return this.visible && this.cueOn;
  }

  /** Re-draw for a viewport and a hint. Cheap enough to call on every scroll frame. */
  update(vp: ScrollViewport, hint: ScrollHint): void {
    if (this.destroyed) return;
    if (!hint.overflowing) {
      this.visible = false;
      this.bounds = null;
      this.showCue(false);
      return;
    }
    this.visible = true;
    // Any movement off the start retires the cue permanently.
    if (!hint.atStart) this.cueRetired = true;

    this.drawThumb(vp, hint);
    this.drawScrim(vp, hint);
    this.placeCue(vp);
    this.showCue(hint.atStart && !this.cueRetired);
  }

  private drawThumb(vp: ScrollViewport, hint: ScrollHint): void {
    const along = vp.axis === 'y' ? vp.h : vp.w;
    const track = Math.max(0, along - THUMB_INSET * 2);
    const len = Math.max(Math.min(track, THUMB_MIN_PX), track * hint.thumbSize);
    // Recover the travel from the (possibly floored) length so the thumb still reaches both ends.
    const travel = Math.max(0, track - len);
    const progress = hint.thumbSize < 1 ? hint.thumbOffset / (1 - hint.thumbSize) : 0;
    const at = THUMB_INSET + travel * progress;

    this.bounds =
      vp.axis === 'y'
        ? { x: vp.x + vp.w - THUMB_INSET - THUMB_THICK, y: vp.y + at, w: THUMB_THICK, h: len }
        : { x: vp.x + at, y: vp.y + vp.h - THUMB_INSET - THUMB_THICK, w: len, h: THUMB_THICK };

    const b = this.bounds;
    this.thumb.clear();
    // A faint track behind the thumb: on a dark overlay a lone thumb can read as a stray highlight;
    // with the groove behind it, it reads as a scrollbar.
    if (vp.axis === 'y') {
      this.thumb
        .roundRect(b.x, vp.y + THUMB_INSET, THUMB_THICK, track, THUMB_THICK / 2)
        .fill({ color: 0xffffff, alpha: 0.1 });
    } else {
      this.thumb
        .roundRect(vp.x + THUMB_INSET, b.y, track, THUMB_THICK, THUMB_THICK / 2)
        .fill({ color: 0xffffff, alpha: 0.1 });
    }
    this.thumb.roundRect(b.x, b.y, b.w, b.h, THUMB_THICK / 2).fill({ color: 0xffffff, alpha: 0.55 });
  }

  /** Stacked 1px slices rather than a gradient fill: no texture, no backend-specific paths, and at
   *  one device pixel per slice there is nothing left to band. */
  private drawScrim(vp: ScrollViewport, hint: ScrollHint): void {
    this.scrim.clear();
    const depth = Math.min(SCRIM, (vp.axis === 'y' ? vp.h : vp.w) / 3);
    if (depth <= 0) return;
    for (const { offset, thickness, alpha } of scrimRamp(depth)) {
      // `offset` is measured INWARD from whichever edge is being faded.
      if (!hint.atEnd) {
        if (vp.axis === 'y') this.scrim.rect(vp.x, vp.y + vp.h - offset - thickness, vp.w, thickness);
        else this.scrim.rect(vp.x + vp.w - offset - thickness, vp.y, thickness, vp.h);
        this.scrim.fill({ color: SCRIM_TINT, alpha });
      }
      if (!hint.atStart) {
        if (vp.axis === 'y') this.scrim.rect(vp.x, vp.y + offset, vp.w, thickness);
        else this.scrim.rect(vp.x + offset, vp.y, thickness, vp.h);
        this.scrim.fill({ color: SCRIM_TINT, alpha });
      }
    }
  }

  private buildCue(): void {
    const disc = new Graphics();
    disc.circle(0, 0, CUE_R).fill({ color: 0x0b0f18, alpha: 0.9 });
    disc.circle(0, 0, CUE_R).stroke({ color: 0xffffff, alpha: 0.22, width: 1 });
    const size = Math.round(CUE_R * 1.3);
    const glyph = makeIcon('chevronDown', size, '#ffffff');
    glyph.position.set(-size / 2, -size / 2);
    this.cue.addChild(disc, glyph);
    this.cue.visible = false;
  }

  private placeCue(vp: ScrollViewport): void {
    // Bottom-centre for a vertical region; hugging the trailing edge for a horizontal one.
    if (vp.axis === 'y') {
      this.cue.x = vp.x + vp.w / 2;
      this.cueBaseY = vp.y + vp.h - CUE_R - 6;
    } else {
      this.cue.x = vp.x + vp.w - CUE_R - 6;
      this.cueBaseY = vp.y + vp.h / 2;
      this.cue.rotation = -Math.PI / 2; // chevron points the way the strip moves
    }
    this.cue.y = this.cueBaseY;
  }

  private showCue(on: boolean): void {
    if (on === this.cueOn) return;
    this.cueOn = on;
    this.cue.visible = on;
    if (on) this.startBob();
    else this.stopBob();
  }

  private startBob(): void {
    // A player who asked for stillness still needs the hint; they just do not need it moving.
    if (this.tick || !this.ticker || prefersReducedMotion()) return;
    this.elapsed = 0;
    this.tick = (t: Ticker) => {
      this.elapsed += t.deltaMS;
      const phase = (this.elapsed % CUE_PERIOD) / CUE_PERIOD;
      this.cue.y = this.cueBaseY + Math.sin(phase * Math.PI * 2) * (CUE_BOB / 2) + CUE_BOB / 2;
    };
    this.ticker.add(this.tick);
  }

  private stopBob(): void {
    if (!this.tick) return;
    this.ticker?.remove(this.tick);
    this.tick = undefined;
    this.cue.y = this.cueBaseY;
  }

  destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.stopBob();
    super.destroy(options);
  }
}
