import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics, type FederatedPointerEvent } from 'pixi.js';
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
  it('a corner drag on a node that carries `width` resizes it instead of scaling', () => {
    const { gizmo, onEdit } = boot();
    const view = new Container();
    view.addChild(new Graphics().rect(-20, -20, 40, 40).fill(0xffffff));
    view.position.set(100, 100);
    view.width = 100;   // what `applyCommon` did for `props.width`
    gizmo.attach({ node: 'n', view, props: { x: 100, y: 100, scale: 1, rotation: 0, width: 100 } });
    // box (50,80)-(150,120); nw anchor (50,80): (100,40) → (150,60) = 1.5
    gizmo.drag('se', { x: 150, y: 120 }, { x: 200, y: 140 });
    expect(view.width).toBeCloseTo(150, 5);
    expect(view.scale.y).toBe(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenLastCalledWith('n', { width: expect.closeTo(150, 5) });
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
  it('attach with the same node mid-gesture moves the gesture onto the new view; another node ends it', () => {
    const { gizmo, layer, onEdit } = boot(); const t = target(); gizmo.attach(t);
    const body = layer.children[1];
    const ev = (x: number, y: number) => ({ global: { x, y }, stopPropagation() {}, shiftKey: false, altKey: false }) as unknown as FederatedPointerEvent;
    body.emit('pointerdown', ev(100, 100));
    const remounted = target(); gizmo.attach(remounted);   // the same node, a new view (a `replace` remounted it)
    layer.emit('globalpointermove', ev(120, 100));
    layer.emit('pointerup', ev(120, 100));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('n', { x: 120, y: 100 });
    expect(remounted.view.position.x).toBe(120);
    expect(t.view.position.x).toBe(100);
    body.emit('pointerdown', ev(120, 100));
    gizmo.attach({ ...target(), node: 'other' });
    layer.emit('globalpointermove', ev(140, 100));
    layer.emit('pointerup', ev(140, 100));
    expect(onEdit).toHaveBeenCalledTimes(1);
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
