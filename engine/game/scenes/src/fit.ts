/**
 * How a fixed design resolution maps onto an arbitrary viewport — plain
 * arithmetic, moved here from `@energy8engine/stage`.
 */
export interface Size {
  width: number;
  height: number;
}

export interface Fit {
  scale: number;
  x: number;
  y: number;
}

/**
 * `'contain'` (default) fits the whole design inside the viewport,
 * letterboxed; `'cover'` fills the viewport, cropping the design.
 * Either way the result is centred.
 */
export function fitStage(viewport: Size, design: Size, mode: 'contain' | 'cover' = 'contain'): Fit {
  const scaleX = viewport.width / design.width;
  const scaleY = viewport.height / design.height;
  const scale = mode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  return {
    scale,
    x: (viewport.width - design.width * scale) / 2,
    y: (viewport.height - design.height * scale) / 2,
  };
}
