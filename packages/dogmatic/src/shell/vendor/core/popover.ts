/** Geometry for the bar-menu popover. Pure math over rectangles so the DOM and Pixi renderers
 *  place it identically — the renderers only supply measured sizes and apply the result. */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Surface { w: number; h: number }

export interface PopoverPlacement {
  /** Top-left of the popover card, in surface coordinates. */
  x: number;
  y: number;
  /** True space on the chosen side, in surface coordinates; may be less than minH on a very short surface. The row list scrolls inside it. */
  maxH: number;
  /** Arrow centre, relative to the card's left edge. `-1` when there is no anchor to point at. */
  arrowX: number;
  /** True when the card opens below the anchor (arrow flips to the top edge). */
  below: boolean;
}

export const POPOVER = {
  /** Keep-out from the surface edges. */
  margin: 8,
  /** Space between the anchor and the card. */
  gap: 8,
  /** Minimum distance from the arrow tip to either rounded corner. */
  arrowInset: 14,
  /** A card shorter than this does not fit — flip to the other side instead. */
  minH: 120,
  minW: 220,
  maxW: 320,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Card width: content width clamped to [minW, maxW] and never wider than the surface. */
export function popoverWidth(surfaceW: number, contentW: number): number {
  const hi = Math.min(POPOVER.maxW, surfaceW - POPOVER.margin * 2);
  return Math.max(0, clamp(contentW, Math.min(POPOVER.minW, hi), hi));
}

/** Place the card above the `anchor` (below if it does not fit), left-aligned to it and clamped
 *  inside the surface. `anchor === null` (no bar / hidden shell) centres it, arrow off.
 *
 *  `anchor` drives PLACEMENT (x, y, maxH, below) — normally the bar's whole plaque ("plate"), so the
 *  card sits flush with the bar as a whole rather than with whichever control opened it. `pointer` is
 *  the (optional) rect the ARROW points at — normally the burger button, which can sit anywhere
 *  inside the plate. Defaults to `anchor` when omitted, so every caller that only ever had one rect
 *  (i.e. every caller before `pointer` existed) keeps behaving exactly as it did before. */
export function placePopover(
  anchor: Rect | null,
  surface: Surface,
  size: { w: number; h: number },
  pointer: Rect | null = null,
): PopoverPlacement {
  const { margin, gap, arrowInset, minH } = POPOVER;
  if (!anchor) {
    const maxH = Math.max(0, surface.h - margin * 2);
    const h = Math.min(size.h, maxH);
    const rawY = (surface.h - h) / 2;
    const y = clamp(rawY, margin, Math.max(margin, surface.h - h - margin));
    return {
      x: Math.max(margin, (surface.w - size.w) / 2),
      y,
      maxH,
      arrowX: -1,
      below: false,
    };
  }
  const spaceAbove = anchor.y - gap - margin;
  const spaceBelow = surface.h - (anchor.y + anchor.h) - gap - margin;
  // Prefer above; flip only when the card would be squeezed below its usable minimum AND there is
  // genuinely more room on the other side.
  const below = spaceAbove < Math.min(size.h, minH) && spaceBelow > spaceAbove;
  const maxH = Math.max(0, below ? spaceBelow : spaceAbove);
  const h = Math.min(size.h, maxH);
  const x = clamp(anchor.x, margin, Math.max(margin, surface.w - size.w - margin));
  const rawY = below ? anchor.y + anchor.h + gap : anchor.y - gap - h;
  const y = clamp(rawY, margin, Math.max(margin, surface.h - h - margin));
  const arrowAnchor = pointer ?? anchor;
  const arrowX = clamp(arrowAnchor.x + arrowAnchor.w / 2 - x, arrowInset, Math.max(arrowInset, size.w - arrowInset));
  return { x, y, maxH, arrowX, below };
}
