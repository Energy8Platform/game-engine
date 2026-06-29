import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { FlexBox, type Sizable } from '@/ui/pixi/primitives/flex';
import { ScrollBox } from '@/ui/pixi/primitives/scroll';

// A measurable mock leaf — a real Pixi Container with a Graphics rect, so getLocalBounds()
// reports its size (no canvas/GPU needed). This drives the FlexBox engine with known sizes so
// we can assert exact positions + that nothing slides outside its container.
class Box extends Container implements Sizable {
  w: number;
  h: number;
  private g = new Graphics();
  constructor(w: number, h: number) {
    super();
    this.w = w;
    this.h = h;
    this.addChild(this.g);
    this.redraw();
  }
  private redraw(): void {
    this.g.clear();
    this.g.rect(0, 0, this.w, this.h).fill(0xffffff);
  }
  setLayoutSize(w: number | undefined, h: number | undefined): void {
    if (w != null) this.w = w;
    if (h != null) this.h = h;
    this.redraw();
  }
  measureSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }
}

/** Assert every child is fully inside [0,outerW]×[0,outerH] — i.e. nothing "slid off". */
function expectInside(fb: FlexBox, boxes: Box[]): void {
  for (const b of boxes) {
    expect(b.position.x).toBeGreaterThanOrEqual(-0.001);
    expect(b.position.y).toBeGreaterThanOrEqual(-0.001);
    expect(b.position.x + b.measureSize().w).toBeLessThanOrEqual(fb.outerWidth + 0.01);
    expect(b.position.y + b.measureSize().h).toBeLessThanOrEqual(fb.outerHeight + 0.01);
    expect(Number.isNaN(b.position.x)).toBe(false);
    expect(Number.isNaN(b.position.y)).toBe(false);
  }
}

describe('FlexBox engine — positioning & scaling', () => {
  it('row: lays out children left-to-right with gaps', () => {
    const fb = new FlexBox({ direction: 'row', gap: 10 });
    const a = new Box(20, 10), b = new Box(30, 10), c = new Box(40, 10);
    fb.add(a).add(b).add(c);
    fb.layout();
    expect(a.position.x).toBe(0);
    expect(b.position.x).toBe(30); // 20 + gap 10
    expect(c.position.x).toBe(70); // 30 + 30 + 10
    expect(fb.outerWidth).toBe(110); // 90 content + 2×10 gap
    expectInside(fb, [a, b, c]);
  });

  it('row + padding offsets content and grows the box', () => {
    const fb = new FlexBox({ direction: 'row', padding: 10 });
    const a = new Box(20, 10);
    fb.add(a);
    fb.layout();
    expect(a.position.x).toBe(10);
    expect(a.position.y).toBe(10);
    expect(fb.outerWidth).toBe(40); // 20 + 2×10
    expect(fb.outerHeight).toBe(30);
  });

  it('justify space-between spreads to the edges (no overflow)', () => {
    const fb = new FlexBox({ direction: 'row', width: 200, justify: 'space-between' });
    const a = new Box(20, 10), b = new Box(30, 10), c = new Box(40, 10);
    fb.add(a).add(b).add(c);
    fb.layout();
    expect(a.position.x).toBe(0);
    expect(c.position.x + 40).toBeCloseTo(200, 5); // last child flush to the right edge
    expect(b.position.x).toBeGreaterThan(a.position.x);
    expectInside(fb, [a, b, c]);
  });

  it('justify center keeps equal margins', () => {
    const fb = new FlexBox({ direction: 'row', width: 200, justify: 'center', gap: 10 });
    const a = new Box(20, 10), b = new Box(30, 10);
    fb.add(a).add(b);
    fb.layout();
    const leftMargin = a.position.x;
    const rightMargin = 200 - (b.position.x + 30);
    expect(leftMargin).toBeCloseTo(rightMargin, 5);
    expectInside(fb, [a, b]);
  });

  it('align center centres children on the cross axis', () => {
    const fb = new FlexBox({ direction: 'row', height: 50, align: 'center' });
    const a = new Box(20, 10);
    fb.add(a);
    fb.layout();
    expect(a.position.y).toBe(20); // (50-10)/2
  });

  it('flexGrow distributes free main space', () => {
    const fb = new FlexBox({ direction: 'row', width: 200 });
    const a = new Box(20, 10), b = new Box(30, 10);
    fb.add(a, { grow: 1 }).add(b);
    fb.layout();
    expect(a.measureSize().w).toBeCloseTo(170, 5); // 20 + free(150)
    expect(b.position.x).toBeCloseTo(170, 5);
    expect(b.position.x + 30).toBeCloseTo(200, 5);
    expectInside(fb, [a, b]);
  });

  it('align stretch sizes a Sizable child to the cross axis', () => {
    const fb = new FlexBox({ direction: 'column', width: 100, align: 'stretch' });
    const a = new Box(20, 10);
    fb.add(a);
    fb.layout();
    expect(a.measureSize().w).toBe(100); // stretched to container width
  });

  it('column stacks top-to-bottom and reports height', () => {
    const fb = new FlexBox({ direction: 'column', gap: 8 });
    const a = new Box(40, 12), b = new Box(40, 20);
    fb.add(a).add(b);
    fb.layout();
    expect(a.position.y).toBe(0);
    expect(b.position.y).toBe(20); // 12 + gap 8
    expect(fb.outerHeight).toBe(40); // 32 content + 8 gap
    expectInside(fb, [a, b]);
  });

  it('fixed-size box draws its background to the outer size', () => {
    const fb = new FlexBox({ direction: 'row', width: 240, height: 56, background: { fill: '#000', radius: 16 } });
    fb.add(new Box(50, 20));
    fb.layout();
    expect(fb.outerWidth).toBe(240);
    expect(fb.outerHeight).toBe(56);
  });
});

describe('ScrollBox', () => {
  it('reports scrollable distance for content taller than the viewport', () => {
    // Regression: getLocalBounds() on the masked content was clipped to the mask, so a tall
    // overlay (game info) reported maxScroll ≈ 0 and could not scroll.
    const sb = new ScrollBox();
    sb.content.addChild(new Graphics().rect(0, 0, 300, 2000).fill(0xffffff));
    sb.setViewport(300, 500); // calls refresh()
    expect(sb.maxScrollY).toBeGreaterThan(1400); // ~2000 content − 500 view
  });

  it('does not scroll when content fits', () => {
    const sb = new ScrollBox();
    sb.content.addChild(new Graphics().rect(0, 0, 300, 200).fill(0xffffff));
    sb.setViewport(300, 500);
    expect(sb.maxScrollY).toBe(0);
  });
});
