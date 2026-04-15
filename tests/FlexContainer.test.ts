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

describe('FlexContainer', () => {
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
});
