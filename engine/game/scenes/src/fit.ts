/**
 * How a fixed design resolution maps onto an arbitrary viewport — plain
 * arithmetic, moved here from `@energy8engine/stage`.
 */
import type { SafeArea } from '@energy8engine/contracts';

export interface Size {
  width: number;
  height: number;
}

export interface Fit {
  scale: number;
  x: number;
  y: number;
  /**
   * The SAFE rect (viewport minus insets) in DESIGN units — what a `pin`
   * measures from. Under `contain` with no insets it is the letterboxed
   * frame around the design (`left` ≤ 0 when the viewport is wider);
   * under `cover` it is the band of the design the viewport shows.
   */
  viewport: { left: number; top: number; right: number; bottom: number };
}

export const ZERO_INSETS: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * `'contain'` (default) fits the whole design inside the viewport,
 * letterboxed; `'cover'` fills the viewport, cropping the design.
 * Either way the result is centred — in the viewport MINUS `insets`
 * (a shell's bar, a notch): the fit is into that safe rect, then
 * offset by `(insets.left, insets.top)`. Zero insets are the fit of
 * old, exactly.
 */
export function fitStage(
  viewport: Size,
  design: Size,
  mode: 'contain' | 'cover' = 'contain',
  insets: SafeArea = ZERO_INSETS,
): Fit {
  const safe = {
    width: Math.max(1, viewport.width - insets.left - insets.right),
    height: Math.max(1, viewport.height - insets.top - insets.bottom),
  };
  const scaleX = safe.width / design.width;
  const scaleY = safe.height / design.height;
  const scale = mode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const x = (safe.width - design.width * scale) / 2 + insets.left;
  const y = (safe.height - design.height * scale) / 2 + insets.top;
  const left = (insets.left - x) / scale;
  const top = (insets.top - y) / scale;
  return {
    scale,
    x,
    y,
    viewport: { left, top, right: left + safe.width / scale, bottom: top + safe.height / scale },
  };
}
