/** Geometry for the bar-menu popover. Pure math over rectangles so the DOM and Pixi renderers
 *  place it identically — the renderers only supply measured sizes and apply the result. */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Surface { w: number; h: number }

export interface PopoverPlacement {
  /** Top-left of the popover card, in surface coordinates. */
  x: number;
  y: number;
  /** Height cap for the card on the chosen side; the row list scrolls inside it. */
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
  return clamp(contentW, Math.min(POPOVER.minW, hi), hi);
}

/** Place the card above the anchor (below if it does not fit), left-aligned to the anchor and
 *  clamped inside the surface. `anchor === null` (no bar / hidden shell) centres it, arrow off. */
export function placePopover(
  anchor: Rect | null,
  surface: Surface,
  size: { w: number; h: number },
): PopoverPlacement {
  const { margin, gap, arrowInset, minH } = POPOVER;
  if (!anchor) {
    return {
      x: Math.max(margin, (surface.w - size.w) / 2),
      y: Math.max(margin, (surface.h - size.h) / 2),
      maxH: Math.max(minH, surface.h - margin * 2),
      arrowX: -1,
      below: false,
    };
  }
  const spaceAbove = anchor.y - gap - margin;
  const spaceBelow = surface.h - (anchor.y + anchor.h) - gap - margin;
  // Prefer above; flip only when the card would be squeezed below its usable minimum AND there is
  // genuinely more room on the other side.
  const below = spaceAbove < Math.min(size.h, minH) && spaceBelow > spaceAbove;
  const maxH = Math.max(minH, below ? spaceBelow : spaceAbove);
  const h = Math.min(size.h, maxH);
  const x = clamp(anchor.x, margin, Math.max(margin, surface.w - size.w - margin));
  const y = below ? anchor.y + anchor.h + gap : anchor.y - gap - h;
  const arrowX = clamp(anchor.x + anchor.w / 2 - x, arrowInset, Math.max(arrowInset, size.w - arrowInset));
  return { x, y, maxH, arrowX, below };
}
