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
