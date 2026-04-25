import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pixi.js before importing FlexContainer
vi.mock('pixi.js', () => {
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    x = 0;
    y = 0;
    _width = 0;
    _height = 0;
    visible = true;
    eventMode = 'auto';
    _flexConfig?: any;

    get width() { return this._width; }
    set width(v: number) { this._width = v; }
    get height() { return this._height; }
    set height(v: number) { this._height = v; }

    addChild(...children: MockContainer[]) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
      return children[0];
    }

    addChildAt(child: MockContainer, index: number) {
      child.parent = this;
      this.children.splice(index, 0, child);
      return child;
    }

    removeChild(...children: MockContainer[]) {
      for (const child of children) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
          this.children.splice(idx, 1);
          child.parent = null;
        }
      }
      return children[0];
    }

    getChildIndex(child: MockContainer) {
      return this.children.indexOf(child);
    }

    getLocalBounds() {
      return { x: 0, y: 0, width: this._width, height: this._height };
    }

    destroy() {
      this.children.length = 0;
    }
  }

  class MockGraphics extends MockContainer {
    roundRect() { return this; }
    rect() { return this; }
    circle() { return this; }
    fill() { return this; }
    stroke() { return this; }
    clear() { return this; }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
  };
});

import { FlexContainer, type FlexItemConfig } from '../src/ui/FlexContainer';
import { Container } from 'pixi.js';

function makeChild(w: number, h: number): Container & { _flexConfig?: FlexItemConfig } {
  const c = new Container();
  (c as any)._width = w;
  (c as any)._height = h;
  return c as any;
}

/** Make a child whose visual origin is its center (like Button/Label with anchor 0.5). */
function makeCenteredChild(w: number, h: number): Container & { _flexConfig?: FlexItemConfig } {
  const c = new Container();
  (c as any)._width = w;
  (c as any)._height = h;
  (c as any).getLocalBounds = () => ({ x: -w / 2, y: -h / 2, width: w, height: h });
  return c as any;
}

describe('FlexContainer', () => {
  describe('measureChild — center-anchor compensation (regression guard)', () => {
    it('preserves ox/oy from bounds even when layoutWidth/layoutHeight pin the size', () => {
      // Reconciler auto-propagates `width={44}` to `_flexConfig.layoutWidth = 44`.
      // Prior to the fix, measureChild early-returned {ox: 0, oy: 0} whenever both
      // dimensions were pinned, erasing the center-anchor compensation for Button/Label.
      // Layout then placed those elements at the wrong y in rows with alignItems=center.
      const btn = new Container() as Container & { _flexConfig?: any };
      btn._flexConfig = { layoutWidth: 44, layoutHeight: 44 };
      (btn as any).getLocalBounds = () => ({ x: -22, y: -22, width: 44, height: 44 });

      const row = new FlexContainer({ direction: 'row', alignItems: 'center' });
      row.resize(200, 82);

      // A tall FlexContainer sibling so the row cross-axis is actually 82px.
      const col = new FlexContainer({ direction: 'column' });
      col.resize(100, 82);

      row.addFlexChild(btn);
      row.addFlexChild(col);
      row.updateLayout();

      // alignItems=center: child.y should be `(82 - 44)/2 - ox = 19 - (-22) = 41`,
      // so the visual center (y + bounds.y + bounds.height/2 = 41 + (-22) + 22 = 41)
      // coincides with the row's vertical center (82/2 = 41). col starts at y=0 and
      // spans 82, so its visual center is also 41 → both align.
      const btnVisualCenter = btn.y + (-22) + 22;
      const colVisualCenter = col.y + 82 / 2;
      expect(btnVisualCenter).toBe(colVisualCenter);
      expect(btnVisualCenter).toBe(41);
    });
  });

  describe('flexExclude', () => {
    it('excludes children with flexExclude from layout', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 10 });
      fc.resize(400, 100);

      const a = makeChild(50, 30);
      const bg = makeChild(400, 100);
      const b = makeChild(50, 30);

      fc.addFlexChild(a);
      fc.addFlexChild(bg, { flexExclude: true });
      fc.addFlexChild(b);
      fc.updateLayout();

      // bg should not affect layout — a and b should be laid out as if bg doesn't exist
      expect(a.x).toBe(0);
      expect(b.x).toBe(60); // 50 + 10 gap

      // bg position should be unchanged (not repositioned by layout)
      // It stays at default 0,0 since it's excluded
    });

    it('flexExclude child remains in display list', () => {
      const fc = new FlexContainer();
      const child = makeChild(10, 10);
      fc.addFlexChild(child, { flexExclude: true });

      expect(fc.children.length).toBe(1);
    });
  });

  describe('flexShrink', () => {
    it('shrinks items proportionally when content overflows', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 0 });
      fc.resize(100, 50);

      const a = makeChild(80, 30);
      const b = makeChild(80, 30);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      // Total = 160, available = 100, overflow = 60
      // Both have flexShrink=1 (default), so shrink equally proportional to size
      // a shrinks by 60 * (80/160) = 30 → 50
      // b shrinks by 60 * (80/160) = 30 → 50
      expect(a.width).toBe(50);
      expect(b.width).toBe(50);
    });

    it('does not shrink items with flexShrink: 0', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 0 });
      fc.resize(100, 50);

      const fixed = makeChild(80, 30);
      const flexible = makeChild(80, 30);
      fc.addFlexChild(fixed, { flexShrink: 0 });
      fc.addFlexChild(flexible);
      fc.updateLayout();

      // fixed stays at 80 (flexShrink: 0)
      // flexible absorbs all overflow: 80 - 60 = 20
      expect(fixed.width).toBe(80);
      expect(flexible.width).toBe(20);
    });

    it('does not shrink when content fits', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 0 });
      fc.resize(200, 50);

      const a = makeChild(80, 30);
      const b = makeChild(80, 30);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      expect(a.width).toBe(80);
      expect(b.width).toBe(80);
    });
  });

  describe('alignSelf', () => {
    it('overrides parent alignItems for individual child', () => {
      const fc = new FlexContainer({ direction: 'row', alignItems: 'start' });
      fc.resize(400, 100);

      const a = makeChild(50, 30);
      const b = makeChild(50, 30);
      fc.addFlexChild(a);
      fc.addFlexChild(b, { alignSelf: 'end' });
      fc.updateLayout();

      // a: alignItems=start → y=0
      expect(a.y).toBe(0);
      // b: alignSelf=end → y = crossSize - height = 100 - 30 = 70
      expect(b.y).toBe(70);
    });

    it('alignSelf center works', () => {
      const fc = new FlexContainer({ direction: 'row', alignItems: 'start' });
      fc.resize(400, 100);

      const child = makeChild(50, 20);
      fc.addFlexChild(child, { alignSelf: 'center' });
      fc.updateLayout();

      // center: y = (100 - 20) / 2 = 40
      expect(child.y).toBe(40);
    });

    it('alignSelf auto falls back to parent alignItems', () => {
      const fc = new FlexContainer({ direction: 'row', alignItems: 'end' });
      fc.resize(400, 100);

      const child = makeChild(50, 30);
      fc.addFlexChild(child, { alignSelf: 'auto' });
      fc.updateLayout();

      // auto → uses parent's 'end' → y = 100 - 30 = 70
      expect(child.y).toBe(70);
    });
  });

  // ─── New tests ─────────────────────────────────────────

  describe('auto-sizing (no explicit width/height)', () => {
    it('computes _computedWidth and _computedHeight from content', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 10 });
      const a = makeChild(100, 30);
      const b = makeChild(50, 40);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      // width = 100 + 10 + 50 = 160, height = max(30, 40) = 40
      expect(fc._computedWidth).toBe(160);
      expect(fc._computedHeight).toBe(40);
    });

    it('includes padding in computed size', () => {
      const fc = new FlexContainer({ direction: 'row', padding: 10 });
      const a = makeChild(100, 30);
      fc.addFlexChild(a);
      fc.updateLayout();

      // width = 10 + 100 + 10 = 120, height = 10 + 30 + 10 = 50
      expect(fc._computedWidth).toBe(120);
      expect(fc._computedHeight).toBe(50);
    });

    it('getContentSize returns computed dimensions', () => {
      const fc = new FlexContainer({ direction: 'column', gap: 5 });
      const a = makeChild(100, 30);
      const b = makeChild(80, 40);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      const size = fc.getContentSize();
      // column: width = max(100, 80) = 100, height = 30 + 5 + 40 = 75
      expect(size.width).toBe(100);
      expect(size.height).toBe(75);
    });

    it('positions children correctly without explicit size', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 10 });
      const a = makeChild(50, 30);
      const b = makeChild(60, 20);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      expect(a.x).toBe(0);
      expect(a.y).toBe(0);
      expect(b.x).toBe(60); // 50 + 10
      expect(b.y).toBe(0);
    });

    it('cross-axis alignment works without explicit size (centers to tallest)', () => {
      const fc = new FlexContainer({ direction: 'row', alignItems: 'center' });
      const tall = makeChild(50, 60);
      const short = makeChild(50, 20);
      fc.addFlexChild(tall);
      fc.addFlexChild(short);
      fc.updateLayout();

      // short centered against tallest (60): y = (60 - 20) / 2 = 20
      expect(tall.y).toBe(0);
      expect(short.y).toBe(20);
    });

    it('does not shrink items when auto-sized', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 0 });
      // No resize — auto-sized
      const a = makeChild(100, 30);
      const b = makeChild(100, 30);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      // No shrinking since container auto-sizes to fit
      expect(a.width).toBe(100);
      expect(b.width).toBe(100);
    });

    it('transition from auto to explicit via resize()', () => {
      const fc = new FlexContainer({ direction: 'row', justifyContent: 'center', gap: 0 });
      const a = makeChild(50, 30);
      fc.addFlexChild(a);
      fc.updateLayout();

      // Auto-sized: no centering effect
      expect(a.x).toBe(0);

      // Now resize to explicit size — centering should work
      fc.resize(200, 100);
      // center: offset = (200 - 50) / 2 = 75
      expect(a.x).toBe(75);
    });
  });

  describe('alignItems center with explicit container size', () => {
    it('centers single child in container cross axis', () => {
      const fc = new FlexContainer({ direction: 'row', alignItems: 'center' });
      fc.resize(400, 600);
      const child = makeChild(100, 200);
      fc.addFlexChild(child);
      fc.updateLayout();

      // y = (600 - 200) / 2 = 200
      expect(child.y).toBe(200);
    });

    it('centers in column direction (cross = width)', () => {
      const fc = new FlexContainer({ direction: 'column', alignItems: 'center' });
      fc.resize(600, 400);
      const child = makeChild(200, 50);
      fc.addFlexChild(child);
      fc.updateLayout();

      // x = (600 - 200) / 2 = 200
      expect(child.x).toBe(200);
    });

    it('multi-line centering uses line cross size', () => {
      const fc = new FlexContainer({
        direction: 'row',
        alignItems: 'center',
        flexWrap: true,
        gap: 0,
      });
      fc.resize(100, 200);

      // Two items that won't fit on one line
      const a = makeChild(60, 40);
      const b = makeChild(60, 20);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      // Line 1: a (60x40), line cross = 40, a centered in 40 → y=0
      expect(a.y).toBe(0);
      // Line 2: b (60x20), line cross = 20, b centered in 20 → y=40
      expect(b.y).toBe(40);
    });
  });

  describe('individual padding props', () => {
    it('paddingTop/Right/Bottom/Left override base padding', () => {
      const fc = new FlexContainer({
        direction: 'row',
        padding: 10,
        paddingLeft: 20,
        paddingTop: 30,
      });
      fc.resize(400, 100);

      const child = makeChild(50, 30);
      fc.addFlexChild(child);
      fc.updateLayout();

      // paddingLeft=20 overrides 10, paddingTop=30 overrides 10
      expect(child.x).toBe(20);
      expect(child.y).toBe(30);
    });

    it('individual props work without base padding', () => {
      const fc = new FlexContainer({
        direction: 'row',
        paddingLeft: 15,
        paddingTop: 5,
      });
      fc.resize(400, 100);

      const child = makeChild(50, 30);
      fc.addFlexChild(child);
      fc.updateLayout();

      expect(child.x).toBe(15);
      expect(child.y).toBe(5);
    });
  });

  describe('flexExclude absolute positioning', () => {
    it('positions child with top/left', () => {
      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 300);

      const abs = makeChild(50, 50);
      fc.addFlexChild(abs, { flexExclude: true, top: 10, left: 20 });
      fc.updateLayout();

      expect(abs.x).toBe(20);
      expect(abs.y).toBe(10);
    });

    it('positions child with bottom/right', () => {
      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 300);

      const abs = makeChild(50, 50);
      fc.addFlexChild(abs, { flexExclude: true, bottom: 10, right: 20 });
      fc.updateLayout();

      // x = 400 - 50 - 20 = 330
      // y = 300 - 50 - 10 = 240
      expect(abs.x).toBe(330);
      expect(abs.y).toBe(240);
    });

    it('does not affect layout of flex children', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 10 });
      fc.resize(400, 100);

      const a = makeChild(50, 30);
      const abs = makeChild(200, 200);
      const b = makeChild(50, 30);

      fc.addFlexChild(a);
      fc.addFlexChild(abs, { flexExclude: true, top: 0, left: 0 });
      fc.addFlexChild(b);
      fc.updateLayout();

      // a and b laid out as if abs doesn't exist
      expect(a.x).toBe(0);
      expect(b.x).toBe(60); // 50 + 10
    });

    it('compensates for center-anchor origin when positioning via left/top', () => {
      // Children with centered visual origin (e.g. Button, Label) should behave
      // consistently with normal flex children: `left`/`top` describe the visual
      // top-left corner, not the child's internal (0,0) point.
      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 300);

      const centered = makeCenteredChild(80, 40);
      fc.addFlexChild(centered, { flexExclude: true, top: 50, left: 100 });
      fc.updateLayout();

      // Visual rect must be (100, 50) → (180, 90). With a centered origin,
      // child.x/y must be shifted by +w/2, +h/2 so rendering lines up.
      expect(centered.x).toBe(140); // 100 - (-40)
      expect(centered.y).toBe(70);  // 50  - (-20)
    });

    it('centerX/centerY position the visual center (normal child)', () => {
      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 300);

      const el = makeChild(80, 40);
      fc.addFlexChild(el, { flexExclude: true, centerX: 200, centerY: 150 });
      fc.updateLayout();

      // Visual center at (200, 150) → top-left at (160, 130). ox/oy = 0 for normal child.
      expect(el.x).toBe(160);
      expect(el.y).toBe(130);
    });

    it('centerX/centerY position the visual center (centered-anchor child)', () => {
      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 300);

      const el = makeCenteredChild(80, 40);
      fc.addFlexChild(el, { flexExclude: true, centerX: 200, centerY: 150 });
      fc.updateLayout();

      // Visual center at (200, 150). For a centered-origin child, child.x/y IS the center
      // — so child.x = centerX - w/2 - ox = 200 - 40 - (-40) = 200.
      expect(el.x).toBe(200);
      expect(el.y).toBe(150);
    });

    it('centerX accepts percentage strings', () => {
      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 300);

      const el = makeChild(100, 50);
      fc.addFlexChild(el, { flexExclude: true, centerX: '50%', centerY: '50%' });
      fc.updateLayout();

      // 50% of 400 = 200, 50% of 300 = 150. Visual rect centered → top-left (150, 125).
      expect(el.x).toBe(150);
      expect(el.y).toBe(125);
    });

    it('Button and Graphics with the same centerX/centerY align visually', () => {
      // Button-like: 4 view-children all at (-w/2..w/2), plus a centered-anchor Text.
      // We simulate the worst-case Pixi behavior where getLocalBounds unions ALL children
      // (including invisible ones). Since every child has symmetric bounds around (0,0),
      // the union is also symmetric → ox = -w/2, oy = -h/2.
      const button = new Container();
      const BTN_W = 128, BTN_H = 128;
      (button as any).getLocalBounds = () => ({
        x: -BTN_W / 2,
        y: -BTN_H / 2,
        width: BTN_W,
        height: BTN_H,
      });

      // Graphics-like: a circle at (0, 0) with radius 64 → bounds (-64, -64, 128, 128).
      const graphics = new Container();
      const GFX_W = 148, GFX_H = 148;
      (graphics as any).getLocalBounds = () => ({
        x: -GFX_W / 2,
        y: -GFX_H / 2,
        width: GFX_W,
        height: GFX_H,
      });

      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(800, 600);

      const CENTER_X = 400;
      const CENTER_Y = 520;
      fc.addFlexChild(button as any,   { flexExclude: true, centerX: CENTER_X, centerY: CENTER_Y });
      fc.addFlexChild(graphics as any, { flexExclude: true, centerX: CENTER_X, centerY: CENTER_Y });
      fc.updateLayout();

      // For a symmetric-origin child, pixi.x should equal centerX (the visual center sits at pixi.x/y).
      expect(button.x).toBe(CENTER_X);
      expect(button.y).toBe(CENTER_Y);
      expect(graphics.x).toBe(CENTER_X);
      expect(graphics.y).toBe(CENTER_Y);

      // Visual centers computed from pixi.x/y + local bounds center — must coincide.
      const buttonCenter = {
        x: button.x + (button as any).getLocalBounds().x + (button as any).getLocalBounds().width / 2,
        y: button.y + (button as any).getLocalBounds().y + (button as any).getLocalBounds().height / 2,
      };
      const graphicsCenter = {
        x: graphics.x + (graphics as any).getLocalBounds().x + (graphics as any).getLocalBounds().width / 2,
        y: graphics.y + (graphics as any).getLocalBounds().y + (graphics as any).getLocalBounds().height / 2,
      };
      expect(buttonCenter).toEqual(graphicsCenter);
      expect(buttonCenter).toEqual({ x: CENTER_X, y: CENTER_Y });
    });

    it('asymmetric local bounds (Pixi Text font-metrics case) still land visual center at centerX/Y', () => {
      // Real-world failure mode: Pixi Text with anchor 0.5 can return asymmetric local
      // bounds because font ascender/descender differ. If a Button's composite bounds
      // inherit this asymmetry, ox ≠ -w/2 and the visual center is offset from pixi.x.
      // This test verifies our ox/oy formula handles non-symmetric origins correctly —
      // we position the BOUNDS CENTER at centerX/Y regardless of where (0,0) falls
      // inside the bounds.
      const btn = new Container();
      // e.g. text descender pushes bottom edge further down: bounds = (-64, -60, 128, 128)
      const boundsX = -64, boundsY = -60, w = 128, h = 128;
      (btn as any).getLocalBounds = () => ({ x: boundsX, y: boundsY, width: w, height: h });

      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 400);
      fc.addFlexChild(btn as any, { flexExclude: true, centerX: 200, centerY: 200 });
      fc.updateLayout();

      const visualCenter = {
        x: btn.x + boundsX + w / 2,
        y: btn.y + boundsY + h / 2,
      };
      expect(visualCenter).toEqual({ x: 200, y: 200 });
    });

    it('centerX honors real bounds when layoutWidth disagrees with getLocalBounds()', () => {
      // Real-world failure mode caught in the field: reconciler auto-propagates
      // `width={128}` to `layoutWidth=128` on a Button, but the Button's actual
      // getLocalBounds() reports 130×130 because text/stroke bleed slightly.
      // If positioning math uses `layoutWidth` for the size-subtraction but
      // `bounds.x` for the origin, the visual center drifts by (bounds.width - w)/2.
      // We position by REAL bounds to keep the visual center on centerX.
      const btn = new Container();
      (btn as any)._flexConfig = { layoutWidth: 128, layoutHeight: 128 };
      const bx = -65, by = -65, bw = 130, bh = 130; // real bounds slightly larger
      (btn as any).getLocalBounds = () => ({ x: bx, y: by, width: bw, height: bh });

      const circle = new Container();
      const cx = -74, cy = -74, cw = 148, ch = 148;
      (circle as any).getLocalBounds = () => ({ x: cx, y: cy, width: cw, height: ch });

      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(800, 600);
      fc.addFlexChild(btn as any,    { flexExclude: true, centerX: 400, centerY: 520 });
      fc.addFlexChild(circle as any, { flexExclude: true, centerX: 400, centerY: 520 });
      fc.updateLayout();

      // Both visual centers MUST land on (400, 520) regardless of bounds shape.
      const btnCenter    = { x: btn.x    + bx + bw / 2, y: btn.y    + by + bh / 2 };
      const circleCenter = { x: circle.x + cx + cw / 2, y: circle.y + cy + ch / 2 };
      expect(btnCenter).toEqual({ x: 400, y: 520 });
      expect(circleCenter).toEqual({ x: 400, y: 520 });
      expect(btnCenter).toEqual(circleCenter);
    });

    it('left/right/top/bottom honor real bounds when layoutWidth disagrees', () => {
      // Same consistency for edge anchoring: visual edges should hit the requested
      // offsets, computed from the real bounding box rather than layout config.
      const el = new Container();
      (el as any)._flexConfig = { layoutWidth: 100, layoutHeight: 100 };
      const bx = -52, by = -52, bw = 104, bh = 104;
      (el as any).getLocalBounds = () => ({ x: bx, y: by, width: bw, height: bh });

      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 400);
      fc.addFlexChild(el as any, { flexExclude: true, right: 20, bottom: 10 });
      fc.updateLayout();

      // Visual right edge = el.x + bx + bw  should equal  400 - 20 = 380
      // Visual bottom edge = el.y + by + bh should equal  400 - 10 = 390
      expect(el.x + bx + bw).toBe(380);
      expect(el.y + by + bh).toBe(390);
    });

    it('centerX takes precedence over left/right', () => {
      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 300);

      const el = makeChild(80, 40);
      fc.addFlexChild(el, { flexExclude: true, centerX: 200, left: 999, right: 999 });
      fc.updateLayout();

      expect(el.x).toBe(160);
    });

    it('compensates for center-anchor origin when positioning via right/bottom', () => {
      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 300);

      const centered = makeCenteredChild(80, 40);
      fc.addFlexChild(centered, { flexExclude: true, bottom: 10, right: 20 });
      fc.updateLayout();

      // Visual rect must be (300, 250) → (380, 290).
      // x = 400 - 80 - 20 = 300 (visual left), so child.x = 300 - (-40) = 340
      // y = 300 - 40 - 10 = 250 (visual top),  so child.y = 250 - (-20) = 270
      expect(centered.x).toBe(340);
      expect(centered.y).toBe(270);
    });
  });

  describe('percentage sizes', () => {
    it('resolves percentage width/height on child FlexContainer', () => {
      const parent = new FlexContainer({ direction: 'column', gap: 0 });
      parent.resize(800, 600);

      const child = new FlexContainer({ width: '100%', height: '50%', direction: 'row' });
      parent.addFlexChild(child);
      parent.updateLayout();

      // child should resolve to 800 x 300
      expect(child._explicitWidth).toBe(800);
      expect(child._explicitHeight).toBe(300);
    });

    it('resolves percentage layoutWidth on regular children', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 0 });
      fc.resize(400, 100);

      const a = makeChild(100, 30);
      const b = makeChild(100, 30);
      fc.addFlexChild(a, { layoutWidth: '50%', layoutHeight: 30 });
      fc.addFlexChild(b);
      fc.updateLayout();

      // a's layoutWidth = 50% of 400 = 200
      // a positioned at x=0, b at x=200
      expect(a.x).toBe(0);
      expect(b.x).toBe(200);
    });

    it('percentage without parent available space resolves to 0', () => {
      // No explicit size on parent → pctRef = 0 → percentage can't resolve
      const parent = new FlexContainer({ direction: 'row' });
      const child = new FlexContainer({ width: '50%', height: '50%' });
      parent.addFlexChild(child);
      parent.updateLayout();

      // Can't resolve percentage without parent size
      expect(child._explicitWidth).toBe(0);
      expect(child._explicitHeight).toBe(0);
    });
  });

  describe('alignContent', () => {
    it('alignContent center distributes lines to center', () => {
      const fc = new FlexContainer({
        direction: 'row',
        flexWrap: true,
        alignContent: 'center',
        gap: 0,
      });
      fc.resize(100, 200);

      // Two lines of items
      const a = makeChild(60, 30); // line 1
      const b = makeChild(60, 30); // line 2
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      // Total cross = 30 + 30 = 60, free = 200 - 60 = 140, offset = 70
      expect(a.y).toBe(70);
      expect(b.y).toBe(100); // 70 + 30
    });

    it('alignContent end pushes lines to end', () => {
      const fc = new FlexContainer({
        direction: 'row',
        flexWrap: true,
        alignContent: 'end',
        gap: 0,
      });
      fc.resize(100, 200);

      const a = makeChild(60, 30);
      const b = makeChild(60, 30);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      // Total cross = 60, free = 140, offset = 140
      expect(a.y).toBe(140);
      expect(b.y).toBe(170); // 140 + 30
    });

    it('alignContent space-between spreads lines', () => {
      const fc = new FlexContainer({
        direction: 'row',
        flexWrap: true,
        alignContent: 'space-between',
        gap: 0,
      });
      fc.resize(100, 200);

      const a = makeChild(60, 30);
      const b = makeChild(60, 30);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      // Total cross = 60, free = 140, extraGap = 140 / 1 = 140
      // Line 1: y = 0, Line 2: y = 0 + 30 + 140 = 170
      expect(a.y).toBe(0);
      expect(b.y).toBe(170);
    });

    it('alignContent stretch expands line cross sizes', () => {
      const fc = new FlexContainer({
        direction: 'row',
        flexWrap: true,
        alignContent: 'stretch',
        alignItems: 'center',
        gap: 0,
      });
      fc.resize(100, 200);

      const a = makeChild(60, 30);
      const b = makeChild(60, 30);
      fc.addFlexChild(a);
      fc.addFlexChild(b);
      fc.updateLayout();

      // Total cross = 60, free = 140, extra per line = 70
      // Line 1 cross = 30 + 70 = 100, line 2 cross = 30 + 70 = 100
      // a centered in 100: y = (100 - 30) / 2 = 35
      expect(a.y).toBe(35);
      // b in line 2: crossOffset = 100, centered in 100: y = 100 + (100 - 30) / 2 = 135
      expect(b.y).toBe(135);
    });
  });

  describe('FlexContainer child resize (Bug 1)', () => {
    it('flexGrow calls resize on FlexContainer children', () => {
      const parent = new FlexContainer({ direction: 'row', gap: 0 });
      parent.resize(400, 100);

      const child = new FlexContainer({ direction: 'column' });
      // Give child some initial content so it has computed size
      const innerChild = makeChild(50, 50);
      child.addFlexChild(innerChild);
      child.updateLayout();

      parent.addFlexChild(child, { flexGrow: 1 });
      parent.updateLayout();

      // flexGrow should resize the child FlexContainer to fill 400px
      expect(child._explicitWidth).toBe(400);
    });

    it('stretch calls resize on FlexContainer children', () => {
      const parent = new FlexContainer({ direction: 'row', alignItems: 'stretch' });
      parent.resize(400, 100);

      const child = new FlexContainer({ direction: 'column' });
      const innerChild = makeChild(50, 30);
      child.addFlexChild(innerChild);
      child.updateLayout();

      parent.addFlexChild(child);
      parent.updateLayout();

      // stretch should resize the child FlexContainer height to 100
      expect(child._explicitHeight).toBe(100);
    });
  });

  describe('nested FlexContainer measurement', () => {
    it('parent measures child FlexContainer using computed dimensions', () => {
      const parent = new FlexContainer({ direction: 'row', gap: 10 });
      parent.resize(800, 400);

      const child1 = new FlexContainer({ direction: 'column' });
      const a = makeChild(100, 50);
      child1.addFlexChild(a);
      child1.updateLayout();

      const child2 = makeChild(60, 30);

      parent.addFlexChild(child1);
      parent.addFlexChild(child2);
      parent.updateLayout();

      // child1 computed: 100x50, child2: 60x30
      // child2.x = 100 + 10 = 110
      expect(child2.x).toBe(110);
    });
  });

  describe('computed dimensions with explicit size', () => {
    it('uses explicit size for computed when set', () => {
      const fc = new FlexContainer({ direction: 'row' });
      fc.resize(400, 200);
      const child = makeChild(50, 30);
      fc.addFlexChild(child);
      fc.updateLayout();

      expect(fc._computedWidth).toBe(400);
      expect(fc._computedHeight).toBe(200);
    });
  });

  describe('suspendLayout / resumeLayout', () => {
    it('suspends layout during batch add, flushes on resume', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 10 });
      fc.resize(400, 100);

      fc.suspendLayout();

      const a = makeChild(50, 30);
      const b = makeChild(60, 40);
      const c = makeChild(70, 20);
      // addChild would normally trigger updateLayout each time
      fc.addChild(a);
      fc.addChild(b);
      fc.addChild(c);

      // Layout not yet applied — positions should still be default
      // (addChild adds to _layoutChildren but skips updateLayout)
      // Note: positions may be 0 since layout hasn't run

      fc.resumeLayout();

      // Now all children should be correctly positioned
      expect(a.x).toBe(0);
      expect(b.x).toBe(60); // 50 + 10
      expect(c.x).toBe(130); // 50 + 10 + 60 + 10
    });

    it('addChildAt respects suspend', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 0 });
      fc.resize(400, 100);

      fc.suspendLayout();

      const a = makeChild(50, 30);
      const b = makeChild(60, 30);
      fc.addChild(a);
      fc.addChildAt(b, 0); // insert before a

      fc.resumeLayout();

      // b first, then a
      expect(b.x).toBe(0);
      expect(a.x).toBe(60);
    });

    it('multiple suspend calls are safe, single resume flushes', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 0 });
      fc.resize(200, 50);

      fc.suspendLayout();
      fc.suspendLayout(); // double suspend

      const a = makeChild(50, 30);
      fc.addChild(a);

      fc.resumeLayout(); // single resume should flush
      expect(a.x).toBe(0);
      expect(fc._computedWidth).toBe(200);
    });

    it('updateLayout() bails when suspended', () => {
      const fc = new FlexContainer({ direction: 'row', gap: 10 });
      fc.resize(400, 100);

      const a = makeChild(50, 30);
      fc.addFlexChild(a);
      fc.updateLayout(); // initial layout
      expect(a.x).toBe(0);

      fc.suspendLayout();

      const b = makeChild(60, 30);
      fc.addFlexChild(b);
      // Explicit updateLayout should bail — layout stays stale
      fc.updateLayout();
      // b should NOT be positioned yet (layout didn't run)
      expect(b.x).toBe(0); // default, not laid out

      fc.resumeLayout();
      // Now both positioned correctly
      expect(a.x).toBe(0);
      expect(b.x).toBe(60); // 50 + 10
    });

    it('resize() defers when suspended', () => {
      const fc = new FlexContainer({ direction: 'row', justifyContent: 'center', gap: 0 });
      fc.resize(200, 50);

      const a = makeChild(50, 30);
      fc.addFlexChild(a);
      fc.updateLayout();
      expect(a.x).toBe(75); // centered: (200-50)/2

      fc.suspendLayout();
      fc.resize(400, 50); // should defer
      // Layout hasn't re-run yet
      expect(a.x).toBe(75); // still old position

      fc.resumeLayout();
      expect(a.x).toBe(175); // centered: (400-50)/2
    });
  });
});
