import type { Container } from 'pixi.js';

export interface Pickable {
  node: string;
  view: Container;
}

/**
 * Topmost (last in array) view whose world bounds contain `point` (world
 * space). Null when none.
 *
 * A view that is a MASK (`mask: true`) has `measurable = false` — pixi
 * sets it on the mask, and `getBounds()` then answers an empty rect, so
 * the node could never be picked. For that one case the view's own
 * `getLocalBounds()` (the root is measured whatever `measurable` says) is
 * tested against the point brought into its local space.
 */
export function pickAt(views: readonly Pickable[], point: { x: number; y: number }): string | null {
  for (let i = views.length - 1; i >= 0; i--) {
    const { node, view } = views[i];
    if (!view.visible) continue;
    const b = view.getBounds();
    if (b.containsPoint(point.x, point.y)) return node;
    if (b.width === 0 && b.height === 0 && view.measurable === false) {
      const local = view.worldTransform.applyInverse(point);
      if (view.getLocalBounds().containsPoint(local.x, local.y)) return node;
    }
  }
  return null;
}
