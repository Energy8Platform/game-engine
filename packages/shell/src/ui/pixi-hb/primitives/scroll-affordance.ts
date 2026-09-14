import { Container, Graphics } from 'pixi.js';
import type { ScrollHint } from '@/core/scrollHint';
import { HB } from '../theme';

/**
 * The HB scroll affordance: an always-visible orange scrollbar (thumb on a dark groove) at the
 * trailing edge of the viewport. No scrim, no bobbing chevron — the bar is the whole message. Drawn
 * in the PARENT's coordinate space from an explicit viewport rect (same contract as ui/pixi).
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

export const THUMB_THICK = 6;
export const THUMB_INSET = 5;
const THUMB_MIN_PX = 24;

export class ScrollAffordanceView extends Container {
  private thumb = new Graphics();
  private bounds: ThumbBounds | null = null;
  private track: ThumbBounds | null = null;

  constructor() {
    super();
    this.eventMode = 'none'; // decoration: the ScrollBox handles the thumb drag itself
    this.addChild(this.thumb);
    this.visible = false;
  }

  /** Where the thumb is drawn, in the parent's space — `null` when nothing is drawn. */
  get thumbBounds(): ThumbBounds | null {
    return this.visible ? this.bounds : null;
  }

  /** The groove the thumb rides — `null` when nothing is drawn. */
  get trackBounds(): ThumbBounds | null {
    return this.visible ? this.track : null;
  }

  /** Kept for API parity with ui/pixi's affordance (there is no chevron cue here). */
  get cueVisible(): boolean {
    return false;
  }

  update(vp: ScrollViewport, hint: ScrollHint): void {
    if (this.destroyed) return;
    if (!hint.overflowing) {
      this.visible = false;
      this.bounds = null;
      this.track = null;
      return;
    }
    this.visible = true;
    const along = vp.axis === 'y' ? vp.h : vp.w;
    const trackLen = Math.max(0, along - THUMB_INSET * 2);
    const len = Math.max(Math.min(trackLen, THUMB_MIN_PX), trackLen * hint.thumbSize);
    const travel = Math.max(0, trackLen - len);
    const progress = hint.thumbSize < 1 ? hint.thumbOffset / (1 - hint.thumbSize) : 0;
    const at = THUMB_INSET + travel * progress;
    if (vp.axis === 'y') {
      const x = vp.x + vp.w - THUMB_INSET - THUMB_THICK;
      this.track = { x, y: vp.y + THUMB_INSET, w: THUMB_THICK, h: trackLen };
      this.bounds = { x, y: vp.y + at, w: THUMB_THICK, h: len };
    } else {
      const y = vp.y + vp.h - THUMB_INSET - THUMB_THICK;
      this.track = { x: vp.x + THUMB_INSET, y, w: trackLen, h: THUMB_THICK };
      this.bounds = { x: vp.x + at, y, w: len, h: THUMB_THICK };
    }
    const t = this.track;
    const b = this.bounds;
    this.thumb.clear();
    this.thumb.roundRect(t.x, t.y, t.w, t.h, THUMB_THICK / 2).fill(HB.track);
    this.thumb.roundRect(b.x, b.y, b.w, b.h, THUMB_THICK / 2).fill(HB.orange);
  }
}
