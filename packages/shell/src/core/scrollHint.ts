/**
 * What a scrollable region should ADVERTISE about itself.
 *
 * A slot in a Stake popout is 400×225. At that size the game-info overlay holds twelve screens of
 * content, the buy-bonus switches to a vertical card stack, and the menu popover hides its last
 * row — all of them scroll, and (before this module) none of them said so. macOS makes it worse:
 * overlay scrollbars stay invisible until something is already scrolling, so the very affordance a
 * player needs BEFORE they touch anything is the one the OS withholds. A certification reviewer
 * reads that as content the player can't reach.
 *
 * The maths lives here, apart from both renderers, for one reason: the DOM shell reads
 * `scrollTop`/`scrollHeight` while the Pixi shell tracks its own offset against a mask, and those
 * two must never disagree about whether a fade belongs at the bottom edge. Renderers decide how a
 * thumb LOOKS; this decides when there is one and where it sits.
 */

/** Fractions of a pixel are layout rounding, not reachable content. */
const EPSILON = 1;

/** Landing within half a pixel of an edge counts as arriving: a browser settles a flung scroll on
 *  199.5 of 200, and a fade left glowing over content the player has already reached reads as a
 *  bug. */
const EDGE_EPSILON = 0.5;

/**
 * Shortest thumb we will draw, as a fraction of its track.
 *
 * The honest ratio for game info at Popout S is 8% — an 18px speck on a 226px track, which reads
 * as a rendering artifact rather than a scrollbar. Floored at 18% it stays recognisably a thumb,
 * and it still travels the whole track, so the position it reports remains truthful even though
 * its length no longer is. That is the right trade: length is decoration, position is information.
 */
export const SCROLL_THUMB_MIN = 0.18;

/** One axis of a scroll region. Named for the Y axis because that is the common case; the
 *  buy-bonus strip passes its width metrics through the same fields. */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface ScrollHint {
  /** There is content past an edge — draw the affordance at all. */
  overflowing: boolean;
  /** Nothing above/left of the viewport: suppress the leading fade. */
  atStart: boolean;
  /** Nothing below/right of the viewport: suppress the trailing fade and the chevron. */
  atEnd: boolean;
  /** Thumb length as a fraction of the track, in `[SCROLL_THUMB_MIN, 1]`. */
  thumbSize: number;
  /** Thumb's leading edge as a fraction of the track, in `[0, 1 - thumbSize]`. */
  thumbOffset: number;
  /** Scrollable distance in pixels — 0 when the content fits. */
  maxScroll: number;
}

/** Resolve one axis of a scroll region into everything a renderer needs to draw its affordance. */
export function scrollHint(m: ScrollMetrics): ScrollHint {
  const view = Math.max(0, m.clientHeight);
  const content = Math.max(0, m.scrollHeight);
  const maxScroll = Math.max(0, content - view);

  if (maxScroll <= EPSILON || view <= 0) {
    // Both edges are "the edge" when there is nowhere to go — callers gate every fade on the
    // matching flag, so a region that fits draws nothing without needing to check `overflowing`.
    return { overflowing: false, atStart: true, atEnd: true, thumbSize: 1, thumbOffset: 0, maxScroll: 0 };
  }

  const at = Math.max(0, Math.min(maxScroll, m.scrollTop));
  const thumbSize = Math.min(1, Math.max(SCROLL_THUMB_MIN, view / content));
  const progress = at / maxScroll;
  return {
    overflowing: true,
    atStart: at <= EDGE_EPSILON,
    atEnd: maxScroll - at <= EDGE_EPSILON,
    thumbSize,
    thumbOffset: progress * (1 - thumbSize),
    maxScroll,
  };
}

/** The three-state tag both renderers put on a scroll region, so CSS and tests can name it.
 *  `none` when the content fits — the attribute is removed rather than set to it. */
export type ScrollEdge = 'none' | 'start' | 'mid' | 'end';

export function scrollEdge(h: ScrollHint): ScrollEdge {
  if (!h.overflowing) return 'none';
  if (h.atStart) return 'start';
  return h.atEnd ? 'end' : 'mid';
}
