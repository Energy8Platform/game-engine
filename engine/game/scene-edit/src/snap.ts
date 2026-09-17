export interface SnapOptions {
  on: boolean;
  step: number;
  design: { width: number; height: number };
  /** Snap to the design centre within `threshold`. Default true — applies even when `on` is false. */
  centre?: boolean;
  /** Distance (design units) within which an axis snaps to the design centre. Default 4. */
  threshold?: number;
}

function snapAxis(v: number, size: number, o: SnapOptions): number {
  const stepped = o.on ? Math.round(v / o.step) * o.step : v;
  if (o.centre === false) return stepped;
  const centre = size / 2;
  const threshold = o.threshold ?? 4;
  return Math.abs(stepped - centre) <= threshold ? centre : stepped;
}

export function snapPoint(p: { x: number; y: number }, o: SnapOptions): { x: number; y: number } {
  return {
    x: snapAxis(p.x, o.design.width, o),
    y: snapAxis(p.y, o.design.height, o),
  };
}
