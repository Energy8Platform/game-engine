import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { createGizmo } from '../src/gizmo';
function target(x = 100, y = 100) {
  const view = new Container(); view.addChild(new Graphics().rect(-20, -20, 40, 40).fill(0xffffff)); view.position.set(x, y);
  return { node: 'n', view, props: { x, y, scale: 1, rotation: 0 } };
}
function boot(dpp = 1) {
  const layer = new Container(); const onEdit = vi.fn(); const onBodyClick = vi.fn();
  const gizmo = createGizmo({ layer, designPerPixel: () => dpp, snap: (p) => p, onEdit, onBodyClick });
  return { gizmo, layer, onEdit, onBodyClick };
}
describe('gizmo', () => {
  it('a body drag moves the view live and emits one edit with x,y in design units', () => {
    const { gizmo, onEdit } = boot(0.5); const t = target(); gizmo.attach(t);
    gizmo.drag('body', { x: 100, y: 100 }, { x: 140, y: 120 });
    expect(t.view.position).toMatchObject({ x: 120, y: 110 });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('n', { x: 120, y: 110 });
  });
  it('a corner drag scales uniformly; Shift scales about the centre', () => {
    const { gizmo, onEdit } = boot(); const t = target(); gizmo.attach(t);
    gizmo.drag('se', { x: 120, y: 120 }, { x: 140, y: 140 });   // opposite corner nw at (80,80): 40→60 → 1.5
    expect(onEdit).toHaveBeenLastCalledWith('n', { scale: 1.5 });
    gizmo.attach(target());
    gizmo.drag('se', { x: 120, y: 120 }, { x: 140, y: 140 }, { shift: true });   // centre (100,100): 20√2→40√2 → 2
    expect(onEdit).toHaveBeenLastCalledWith('n', { scale: 2 });
  });
  it('the rotate handle emits rotation', () => {
    const { gizmo, onEdit } = boot(); const t = target(); gizmo.attach(t);
    gizmo.drag('rotate', { x: 100, y: 60 }, { x: 140, y: 100 });   // 12 o'clock → 3 o'clock = +π/2
    expect(onEdit.mock.calls[0][1].rotation).toBeCloseTo(Math.PI / 2, 5);
  });
  it('a press without travel is a body click, not an edit; nudge is one edit', () => {
    const { gizmo, onEdit, onBodyClick } = boot(); const t = target(); gizmo.attach(t);
    gizmo.drag('body', { x: 100, y: 100 }, { x: 101, y: 100 });
    expect(onEdit).not.toHaveBeenCalled(); expect(onBodyClick).toHaveBeenCalledWith(101, 100);
    gizmo.nudge(1, 0); expect(onEdit).toHaveBeenCalledWith('n', { x: 101, y: 100 });
  });
  it('body drag runs through snap', () => {
    const layer = new Container(); const onEdit = vi.fn();
    const gizmo = createGizmo({ layer, designPerPixel: () => 1, snap: (p) => ({ x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 }), onEdit, onBodyClick: vi.fn() });
    const t = target(); gizmo.attach(t);
    gizmo.drag('body', { x: 100, y: 100 }, { x: 114, y: 100 });
    expect(t.view.position.x).toBe(110);
    expect(onEdit).toHaveBeenCalledWith('n', { x: 110, y: 100 });
  });
  it('consecutive gestures re-base on the view, not the props snapshot', () => {
    const { gizmo, onEdit } = boot(); const t = target(); gizmo.attach(t);
    gizmo.nudge(1, 0); gizmo.nudge(1, 0);
    expect(onEdit).toHaveBeenLastCalledWith('n', { x: 102, y: 100 });
    gizmo.drag('body', { x: 100, y: 100 }, { x: 110, y: 100 });
    gizmo.drag('body', { x: 110, y: 100 }, { x: 120, y: 100 });
    expect(onEdit).toHaveBeenLastCalledWith('n', { x: 122, y: 100 });
    expect(t.view.position.x).toBe(122);
  });
  it('alt reaches snap', () => {
    const layer = new Container(); const snap = vi.fn((p) => p);
    const gizmo = createGizmo({ layer, designPerPixel: () => 1, snap, onEdit: vi.fn(), onBodyClick: vi.fn() });
    gizmo.attach(target());
    gizmo.drag('body', { x: 100, y: 100 }, { x: 120, y: 100 }, { alt: true });
    expect(snap).toHaveBeenCalledWith(expect.anything(), true);
  });
  it('attach(null) hides; the frame follows the view on refresh', () => {
    const { gizmo, layer } = boot(); const t = target(); gizmo.attach(t);
    expect(layer.children.some((c) => c.visible)).toBe(true);
    t.view.position.set(300, 300); gizmo.refresh();
    const frame = layer.getChildByLabel?.('gizmo-frame') ?? layer.children[0];
    expect(frame.getBounds().x).toBeGreaterThan(250);
    const stranger = layer.addChild(new Container());
    gizmo.attach(null); expect(layer.children.filter((c) => c !== stranger).every((c) => !c.visible)).toBe(true);
    expect(stranger.visible).toBe(true);
  });
});
