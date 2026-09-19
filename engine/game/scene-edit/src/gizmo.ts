// Transform gizmo — the on-canvas move / scale / rotate manipulator for the selected
// node. Port of the old `transformGizmo.ts` onto scene-node props: 4 corner handles, a
// rotate handle, and a body drag to move. During a gesture the VIEW is updated live; the
// doc is written ONCE at pointer-up via `onEdit(node, { only the changed keys })`, so a
// mouse transform lands on the undo stack as a single step. Bounds are re-read on
// `refresh()`, so the gizmo follows the node as the host relayouts.

import { Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js';

export type HandleId = 'nw' | 'ne' | 'se' | 'sw' | 'rotate' | 'body';

export interface GizmoTarget {
  node: string;
  view: Container;
  /**
   * Values are a typed carrier only — a gesture's base is read from the
   * VIEW at pointer-down. `width`/`height` are the exception in one way:
   * whether the node CARRIES them is read from here, because that is what
   * decides whether a corner drag edits them or `scale`.
   */
  props: { x: number; y: number; scale: number; rotation: number; width?: number; height?: number };
}

export interface GizmoOptions {
  /**
   * Where the gizmo draws (above the scene root). Must have an identity world transform:
   * the frame and hit areas are drawn in global (screen) coords as layer-local.
   */
  layer: Container;
  /** Screen→design: the scene root's world scale (1/scale). */
  designPerPixel(): number;
  snap(p: { x: number; y: number }, alt: boolean): { x: number; y: number };
  /** ONE per gesture end. */
  onEdit(node: string, props: Partial<GizmoTarget['props']>): void;
  /**
   * A press inside the selection box that never moved. The body covers the whole selected
   * node so it can be dragged, which also makes it swallow every click there — the host
   * re-picks at this point instead.
   */
  onBodyClick(globalX: number, globalY: number): void;
}

export interface Gizmo {
  /**
   * Draws frame+handles from `view.getBounds()`; null hides. The same node again (its view
   * remounted, as a `replace` does) keeps a gesture in flight on the new view.
   */
  attach(target: GizmoTarget | null): void;
  /** Re-read bounds (call every frame while attached). */
  refresh(): void;
  /** Run a full handle drag programmatically (agent/tests). Screen coords. */
  drag(handle: HandleId, from: Point, to: Point, mods?: { shift?: boolean; alt?: boolean }): void;
  /**
   * Move the selection by a discrete amount (arrow keys). Deliberately NOT a synthetic drag:
   * a drag ignores travel below the click threshold, which would swallow a 1px nudge.
   */
  nudge(dxDesign: number, dyDesign: number): void;
  destroy(): void;
}

type Point = { x: number; y: number };
type Mods = { shift?: boolean; alt?: boolean };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CORNERS: HandleId[] = ['nw', 'ne', 'se', 'sw'];
const HS = 9; // handle size
const ROTATE_STEM = 24; // px above the top edge
const CLICK_SLOP = 3; // px before a press counts as a drag

/** Screen position of each handle for a bounding box. */
function handlePoint(box: Box, id: Exclude<HandleId, 'body'>): Point {
  const { x, y, width: w, height: h } = box;
  switch (id) {
    case 'nw': return { x, y };
    case 'ne': return { x: x + w, y };
    case 'se': return { x: x + w, y: y + h };
    case 'sw': return { x, y: y + h };
    case 'rotate': return { x: x + w / 2, y: y - ROTATE_STEM };
  }
}

const OPPOSITE: Record<Exclude<HandleId, 'rotate' | 'body'>, Exclude<HandleId, 'rotate' | 'body'>> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };

export function createGizmo(o: GizmoOptions): Gizmo {
  const { layer } = o;
  layer.eventMode = 'static';
  const frame = new Graphics();
  frame.label = 'gizmo-frame';
  layer.addChild(frame);
  const handleGfx = new Map<HandleId, Graphics>();
  for (const id of [...CORNERS, 'rotate' as HandleId]) {
    const g = new Graphics();
    g.eventMode = 'static';
    g.cursor = cursorFor(id);
    g.on('pointerdown', (e: FederatedPointerEvent) => { e.stopPropagation(); onDown(id, e.global, { shift: e.shiftKey, alt: e.altKey }); });
    handleGfx.set(id, g);
    layer.addChild(g);
  }
  // A transparent body catcher for move-drags (below the handles).
  const body = new Graphics();
  body.eventMode = 'static';
  body.cursor = 'move';
  body.on('pointerdown', (e: FederatedPointerEvent) => { e.stopPropagation(); onDown('body', e.global, { shift: e.shiftKey, alt: e.altKey }); });
  layer.addChildAt(body, 1);

  let target: GizmoTarget | null = null;
  let drag:
    | { handle: HandleId; start: Point; anchor: Point; startAngle: number; mods: Mods; moved: boolean; base: GizmoTarget['props'] }
    | null = null;
  const gfx = [frame, body, ...handleGfx.values()];
  const baseOf = (t: GizmoTarget): GizmoTarget['props'] => ({
    x: t.view.position.x, y: t.view.position.y, scale: t.view.scale.x, rotation: t.view.rotation,
    ...(t.props.width !== undefined ? { width: t.view.width } : {}),
    ...(t.props.height !== undefined ? { height: t.view.height } : {}),
  });

  const boxOf = (t: GizmoTarget): Box => {
    const b = t.view.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  };

  const onDown = (h: HandleId, at: Point, mods: Mods): void => {
    if (!target) return;
    const box = boxOf(target);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Corner scale is measured against the opposite corner, or the centre with Shift.
    const anchor = h === 'body' || h === 'rotate' || mods.shift ? center : handlePoint(box, OPPOSITE[h]);
    drag = {
      handle: h,
      start: { x: at.x, y: at.y },
      anchor,
      startAngle: Math.atan2(at.y - center.y, at.x - center.x),
      mods: { shift: !!mods.shift, alt: !!mods.alt },
      moved: false,
      base: baseOf(target),
    };
  };

  const onMove = (at: Point): void => {
    if (!drag || !target) return;
    if (!drag.moved && Math.hypot(at.x - drag.start.x, at.y - drag.start.y) >= CLICK_SLOP) drag.moved = true;
    if (!drag.moved) return; // a press that has not travelled yet is still a potential click
    const { view } = target;
    const props = drag.base;
    if (drag.handle === 'body') {
      const s = o.designPerPixel();
      const p = o.snap({ x: props.x + (at.x - drag.start.x) * s, y: props.y + (at.y - drag.start.y) * s }, !!drag.mods.alt);
      view.position.set(p.x, p.y);
    } else if (drag.handle === 'rotate') {
      const angle = Math.atan2(at.y - drag.anchor.y, at.x - drag.anchor.x);
      view.rotation = props.rotation + (angle - drag.startAngle);
    } else {
      const before = Math.hypot(drag.start.x - drag.anchor.x, drag.start.y - drag.anchor.y) || 1;
      const after = Math.hypot(at.x - drag.anchor.x, at.y - drag.anchor.y);
      const f = Math.max(0.01, after / before);
      // A node sized in design px is resized, not scaled — otherwise the
      // preview would move under the cursor and the pointer-up edit would
      // write a `scale` the next `applyCommon` throws away for `width`.
      if (props.width === undefined && props.height === undefined) view.scale.set(props.scale * f);
      else {
        if (props.width !== undefined) view.width = props.width * f;
        if (props.height !== undefined) view.height = props.height * f;
      }
    }
    redraw();
  };

  const onUp = (at: Point): void => {
    if (!drag || !target) { drag = null; return; }
    const { handle, moved, base } = drag;
    drag = null;
    if (!moved) {
      // Body press that never moved = a selection click, not a move.
      if (handle === 'body') o.onBodyClick(at.x, at.y);
      return;
    }
    const { node, view } = target;
    if (handle === 'body') o.onEdit(node, { x: view.position.x, y: view.position.y });
    else if (handle === 'rotate') o.onEdit(node, { rotation: view.rotation });
    else if (base.width === undefined && base.height === undefined) o.onEdit(node, { scale: view.scale.x });
    else o.onEdit(node, {
      ...(base.width !== undefined ? { width: view.width } : {}),
      ...(base.height !== undefined ? { height: view.height } : {}),
    });
  };
  const onPointerMove = (e: FederatedPointerEvent): void => onMove(e.global);
  const onPointerUp = (e: FederatedPointerEvent): void => onUp(e.global);
  layer.on('globalpointermove', onPointerMove);
  layer.on('pointerup', onPointerUp);
  layer.on('pointerupoutside', onPointerUp);

  const redraw = (): void => {
    for (const g of gfx) g.visible = target !== null;
    if (!target) return;
    const box = boxOf(target);
    frame.clear();
    frame.rect(box.x, box.y, box.width, box.height).stroke({ color: 0x4dd0ff, width: 1.5, alpha: 0.9 });
    // rotate stem
    const rot = handlePoint(box, 'rotate');
    frame.moveTo(box.x + box.width / 2, box.y).lineTo(rot.x, rot.y).stroke({ color: 0x4dd0ff, width: 1, alpha: 0.6 });
    body.clear();
    body.rect(box.x, box.y, box.width, box.height).fill({ color: 0xffffff, alpha: 0.001 });
    body.hitArea = new Rectangle(box.x, box.y, box.width, box.height);
    for (const id of [...CORNERS, 'rotate' as HandleId]) {
      const g = handleGfx.get(id)!;
      g.clear();
      const p = handlePoint(box, id as Exclude<HandleId, 'body'>);
      if (id === 'rotate') g.circle(p.x, p.y, HS / 1.6).fill({ color: 0x4dd0ff }).stroke({ color: 0x06283d, width: 2 });
      else g.rect(p.x - HS / 2, p.y - HS / 2, HS, HS).fill({ color: 0x4dd0ff }).stroke({ color: 0x06283d, width: 2 });
      g.hitArea = new Rectangle(p.x - HS, p.y - HS, HS * 2, HS * 2);
    }
  };

  return {
    attach(t) {
      // The same node again (its view remounted under a gesture) keeps the gesture; another, or none, ends it.
      if (t?.node !== target?.node) drag = null;
      target = t;
      redraw();
    },
    refresh: redraw,
    nudge(dxDesign, dyDesign) {
      if (!target) return;
      const { node, view } = target;
      const p = { x: view.position.x + dxDesign, y: view.position.y + dyDesign };
      view.position.set(p.x, p.y);
      o.onEdit(node, p);
      redraw();
    },
    drag(h, from, to, mods = {}) {
      onDown(h, from, mods);
      onMove(to);
      onUp(to);
    },
    destroy() {
      layer.off('globalpointermove', onPointerMove);
      layer.off('pointerup', onPointerUp);
      layer.off('pointerupoutside', onPointerUp);
      for (const g of gfx) g.destroy();
    },
  };
}

function cursorFor(id: HandleId): string {
  switch (id) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'rotate': return 'grab';
    default: return 'move';
  }
}
