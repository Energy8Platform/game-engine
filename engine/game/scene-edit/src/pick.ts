import type { Container } from 'pixi.js';

export interface Pickable {
  node: string;
  view: Container;
}

/** Topmost (last in array) view whose world bounds contain `point` (world space). Null when none. */
export function pickAt(views: readonly Pickable[], point: { x: number; y: number }): string | null {
  for (let i = views.length - 1; i >= 0; i--) {
    const { node, view } = views[i];
    if (!view.visible) continue;
    if (view.getBounds().containsPoint(point.x, point.y)) return node;
  }
  return null;
}
