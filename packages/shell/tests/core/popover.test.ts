// @vitest-environment node
import { it, expect } from 'vitest';
import { placePopover, popoverWidth, POPOVER } from '@/core/popover';

const surface = { w: 1000, h: 600 };

it('opens above the anchor, left-aligned to it', () => {
  const p = placePopover({ x: 100, y: 540, w: 40, h: 40 }, surface, { w: 260, h: 300 });
  expect(p.below).toBe(false);
  expect(p.x).toBe(100);
  expect(p.y).toBe(540 - POPOVER.gap - 300);
  expect(p.arrowX).toBe(120 - 100); // anchor centre, relative to the popover
});

it('clamps x inside the surface margins', () => {
  const left = placePopover({ x: 2, y: 540, w: 40, h: 40 }, surface, { w: 260, h: 300 });
  expect(left.x).toBe(POPOVER.margin);
  const right = placePopover({ x: 980, y: 540, w: 40, h: 40 }, surface, { w: 260, h: 300 });
  expect(right.x).toBe(surface.w - 260 - POPOVER.margin);
});

it('keeps the arrow inside the rounded corners', () => {
  const p = placePopover({ x: 2, y: 540, w: 12, h: 12 }, surface, { w: 260, h: 300 });
  expect(p.arrowX).toBe(POPOVER.arrowInset);
});

it('flips below when there is not enough room above', () => {
  const p = placePopover({ x: 100, y: 20, w: 40, h: 40 }, surface, { w: 260, h: 300 });
  expect(p.below).toBe(true);
  expect(p.y).toBe(20 + 40 + POPOVER.gap);
  expect(p.maxH).toBe(surface.h - 60 - POPOVER.gap - POPOVER.margin);
});

it('caps maxH to the space on the chosen side', () => {
  const p = placePopover({ x: 100, y: 400, w: 40, h: 40 }, surface, { w: 260, h: 900 });
  expect(p.maxH).toBe(400 - POPOVER.gap - POPOVER.margin);
});

it('centres and hides the arrow without an anchor', () => {
  const p = placePopover(null, surface, { w: 260, h: 300 });
  expect(p.x).toBe((1000 - 260) / 2);
  expect(p.y).toBe((600 - 300) / 2);
  expect(p.arrowX).toBe(-1);
});

it('clamps the width between minW and the surface', () => {
  expect(popoverWidth(1000, 180)).toBe(POPOVER.minW);
  expect(popoverWidth(1000, 400)).toBe(POPOVER.maxW);
  expect(popoverWidth(240, 400)).toBe(240 - 16);
});

it('keeps the card inside the surface when both sides are short', () => {
  const p = placePopover({ x: 100, y: 100, w: 40, h: 100 }, { w: 1000, h: 300 }, { w: 260, h: 300 });
  // spaceAbove = 84, spaceBelow = 84, both under minH
  // maxH should be true space, not minH
  expect(p.maxH).toBe(84);
  // Card must fit inside surface
  expect(p.y).toBeGreaterThanOrEqual(POPOVER.margin);
  const bottomEdge = p.y + Math.min(300, p.maxH);
  expect(bottomEdge).toBeLessThanOrEqual(300 - POPOVER.margin);
});

it('handles very short surfaces with null anchor', () => {
  const p = placePopover(null, { w: 300, h: 100 }, { w: 260, h: 300 });
  // maxH should be true space available
  expect(p.maxH).toBe(100 - 16);
  // Card must fit inside surface
  expect(p.y).toBeGreaterThanOrEqual(POPOVER.margin);
  const bottomEdge = p.y + Math.min(300, p.maxH);
  expect(bottomEdge).toBeLessThanOrEqual(100 - POPOVER.margin);
});

it('handles a zero-height anchor', () => {
  const p = placePopover({ x: 100, y: 100, w: 40, h: 0 }, { w: 1000, h: 216 }, { w: 260, h: 300 });
  // spaceAbove = 92 - 8 - 8 = 76, spaceBelow = 216 - 100 - 0 - 8 - 8 = 100
  // Should pick below (100 > 76 and 76 < min(300, 120))
  expect(p.below).toBe(true);
  expect(p.y).toBeGreaterThanOrEqual(POPOVER.margin);
  const bottomEdge = p.y + Math.min(300, p.maxH);
  expect(bottomEdge).toBeLessThanOrEqual(216 - POPOVER.margin);
});

it('guards popoverWidth against negative values', () => {
  // Surface narrower than 2 * margin
  expect(popoverWidth(10, 400)).toBeGreaterThanOrEqual(0);
});

// ── `pointer` (defect 1: plate drives placement, pointer drives the arrow only) ──────────────────
it('computes arrowX from the pointer rect while placement still follows the plate anchor', () => {
  const plate = { x: 100, y: 540, w: 300, h: 40 }; // a wide plaque
  const pointer = { x: 130, y: 550, w: 20, h: 20 }; // e.g. a burger sitting inside it, off-centre
  const withoutPointer = placePopover(plate, surface, { w: 260, h: 300 });
  const withPointer = placePopover(plate, surface, { w: 260, h: 300 }, pointer);
  // placement is unchanged — it never reads `pointer`
  expect(withPointer.x).toBe(withoutPointer.x);
  expect(withPointer.y).toBe(withoutPointer.y);
  expect(withPointer.maxH).toBe(withoutPointer.maxH);
  expect(withPointer.below).toBe(withoutPointer.below);
  // the arrow follows the POINTER's centre (130+10=140), not the plate's (100+150=250)
  expect(withPointer.arrowX).toBe(140 - withPointer.x);
  expect(withPointer.arrowX).not.toBe(withoutPointer.arrowX);
});

it('omitting the pointer is identical to today (arrow follows the anchor)', () => {
  const cases: Array<[typeof surface, { w: number; h: number }]> = [
    [surface, { w: 260, h: 300 }],
  ];
  for (const [surf, size] of cases) {
    for (const anchor of [
      { x: 100, y: 540, w: 40, h: 40 },
      { x: 2, y: 540, w: 12, h: 12 },
      { x: 100, y: 20, w: 40, h: 40 },
    ]) {
      const withExplicitNull = placePopover(anchor, surf, size, null);
      const withNoFourthArg = placePopover(anchor, surf, size);
      expect(withExplicitNull).toEqual(withNoFourthArg);
    }
  }
});

it('clamps the pointer-derived arrowX inside the rounded corners', () => {
  const plate = { x: 100, y: 540, w: 400, h: 60 };
  // pointer near the plate's left edge — its centre alone would land inside the arrow inset
  const left = placePopover(plate, surface, { w: 260, h: 300 }, { x: 100, y: 550, w: 12, h: 12 });
  expect(left.arrowX).toBe(POPOVER.arrowInset);
  // pointer near the plate's right edge — its centre alone would overshoot the far corner
  const right = placePopover(plate, surface, { w: 260, h: 300 }, { x: 388, y: 550, w: 12, h: 12 });
  expect(right.arrowX).toBe(260 - POPOVER.arrowInset);
});

// ── Missing combination (review finding 7): `below` placement was never exercised together with a
// DISTINCT pointer — the arrow must still track the POINTER's centre (not the plate's), clamped
// inside the rounded corners, even once the card has flipped to sit below the anchor. ─────────────
it('below placement still derives arrowX from a distinct pointer, not the plate', () => {
  const plate = { x: 100, y: 20, w: 400, h: 40 }; // near the top edge → forces the flip to `below`
  const pointer = { x: 130, y: 30, w: 20, h: 20 }; // off-centre inside the plate
  const withoutPointer = placePopover(plate, surface, { w: 260, h: 300 });
  const withPointer = placePopover(plate, surface, { w: 260, h: 300 }, pointer);
  expect(withoutPointer.below).toBe(true); // sanity: this scenario really does flip
  expect(withPointer.below).toBe(true);
  // placement (x/y/maxH/below) is unaffected by the pointer — only the arrow reads it
  expect(withPointer.x).toBe(withoutPointer.x);
  expect(withPointer.y).toBe(withoutPointer.y);
  expect(withPointer.maxH).toBe(withoutPointer.maxH);
  // the arrow follows the POINTER's centre (130+10=140), not the plate's (100+200=300)
  expect(withPointer.arrowX).toBe(140 - withPointer.x);
  expect(withPointer.arrowX).not.toBe(withoutPointer.arrowX);
});

it('below placement clamps the pointer-derived arrowX inside the rounded corners', () => {
  const plate = { x: 100, y: 20, w: 400, h: 40 }; // same top-edge plate — forces `below`
  // pointer near the plate's left edge — its centre alone would land inside the arrow inset
  const left = placePopover(plate, surface, { w: 260, h: 300 }, { x: 100, y: 30, w: 12, h: 12 });
  expect(left.below).toBe(true);
  expect(left.arrowX).toBe(POPOVER.arrowInset);
  // pointer near the plate's right edge — its centre alone would overshoot the far corner
  const right = placePopover(plate, surface, { w: 260, h: 300 }, { x: 488, y: 30, w: 12, h: 12 });
  expect(right.below).toBe(true);
  expect(right.arrowX).toBe(260 - POPOVER.arrowInset);
});

it('a pointer without an anchor keeps the centred, arrow-less fallback', () => {
  const pointer = { x: 400, y: 300, w: 40, h: 40 };
  const p = placePopover(null, surface, { w: 260, h: 300 }, pointer);
  expect(p.x).toBe((1000 - 260) / 2);
  expect(p.y).toBe((600 - 300) / 2);
  expect(p.arrowX).toBe(-1);
});

it('ensures the card stays within margins after both-sides-short flip', () => {
  // Verify the three reviewer reproductions stay inside the surface
  const p1 = placePopover({ x: 100, y: 100, w: 40, h: 100 }, { w: 1000, h: 300 }, { w: 260, h: 300 });
  expect(p1.y + Math.min(300, p1.maxH)).toBeLessThanOrEqual(300 - POPOVER.margin);

  const p2 = placePopover({ x: 100, y: 100, w: 40, h: 0 }, { w: 1000, h: 216 }, { w: 260, h: 300 });
  expect(p2.y + Math.min(300, p2.maxH)).toBeLessThanOrEqual(216 - POPOVER.margin);

  const p3 = placePopover(null, { w: 300, h: 100 }, { w: 260, h: 300 });
  expect(p3.y + Math.min(300, p3.maxH)).toBeLessThanOrEqual(100 - POPOVER.margin);
});
