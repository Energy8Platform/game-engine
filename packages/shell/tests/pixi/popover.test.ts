import './setup-canvas';
import { describe, it, expect, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { Popover } from '@/ui/pixi/primitives/popover';
import { Toggle } from '@/ui/pixi/primitives/controls';
import { FlexBox } from '@/ui/pixi/primitives/flex';
import { makeText } from '@/ui/pixi/text';
import { POPOVER } from '@/core/popover';
import { makeContext } from './_host';

/** A single-row column whose only content is one label, wide enough that its natural width alone
 *  determines the card width — mirrors the shape (but not the specifics) of a real menu row. */
function labelCard(text: string): (width: number) => Container {
  return () => {
    const col = new FlexBox({ direction: 'column', padding: 8 });
    col.add(makeText(text, { size: 13, weight: '600', color: '#ffffff' }));
    return col;
  };
}

/** A build() whose content measures to an EXACT known (w, h) regardless of the width parameter it's
 *  called with — isolates the local↔screen scale-conversion arithmetic from FlexBox/text specifics. */
function fixedCard(w: number, h: number): (width: number) => Container {
  return () => {
    const c = new Container();
    c.addChild(new Graphics().rect(0, 0, w, h).fill('#000000'));
    return c;
  };
}

describe('Pixi popover', () => {
  it('places its card above the plate and points the arrow at it (no separate pointer)', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const pop = new Popover(host, {
      plate: () => ({ x: 100, y: 540, w: 40, h: 40 }),
      onClose: () => {},
      build: () => new Container(),
    });
    pop.resize(1000, 600);
    expect(pop.cardX).toBe(100);
    expect(pop.cardY).toBeLessThan(540);
    expect(pop.arrowX).toBeCloseTo(20, 0); // plate centre relative to the card — no pointer given
  });

  // Regression: `resize()` used to size the card from `popoverWidth(w, POPOVER.minW)` — passing the
  // MINIMUM as the "measured content width" input, so the card was always exactly POPOVER.minW no
  // matter what it held. Rows live inside a masked ScrollBox, so a label wider than minW was clipped
  // instead of growing the card (or, per spec, the DOM's outcome: grow up to the maxW/surface clamp).
  it('grows the card to fit a long label, clamped to the spec range', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });

    const short = new Popover(host, { plate: () => null, onClose: () => {}, build: labelCard('Hi') });
    short.resize(1000, 600);
    expect(short.cardWidth).toBe(POPOVER.minW); // nothing to grow for — stays at the floor

    const long = new Popover(host, {
      plate: () => null,
      onClose: () => {},
      build: labelCard('A genuinely long menu label that cannot possibly fit in 220 pixels'),
    });
    long.resize(1000, 600);
    expect(long.cardWidth).toBeGreaterThan(POPOVER.minW);
    expect(long.cardWidth).toBeLessThanOrEqual(Math.min(POPOVER.maxW, 1000 - POPOVER.margin * 2));
  });

  it('re-measures on every resize, so the card can still grow on a wider surface', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const pop = new Popover(host, {
      plate: () => null,
      onClose: () => {},
      build: labelCard('A genuinely long menu label that cannot possibly fit in 220 pixels'),
    });
    pop.resize(260, 600); // surface barely wider than minW — content-driven width is clamped down
    expect(pop.cardWidth).toBeLessThanOrEqual(260 - POPOVER.margin * 2);
    pop.resize(1000, 600); // surface grows back — the SAME long content should re-claim its width
    expect(pop.cardWidth).toBeGreaterThan(POPOVER.minW);
  });

  it('centres itself when there is no plate', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const pop = new Popover(host, { plate: () => null, onClose: () => {}, build: () => new Container() });
    pop.resize(1000, 600);
    expect(pop.cardX).toBeGreaterThan(300);
    expect(pop.arrowVisible).toBe(false);
  });

  it('closes when the dismiss layer is tapped, not when the card is', () => {
    const onClose = vi.fn();
    const host = makeContext();
    const pop = new Popover(host, { plate: () => null, onClose, build: () => new Container() });
    pop.resize(1000, 600);
    pop.dismissLayer.emit('pointertap');
    expect(onClose).toHaveBeenCalledOnce();
    pop.card.emit('pointertap');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lets Escape through to the controller', () => {
    const host = makeContext();
    const pop = new Popover(host, { plate: () => null, onClose: () => {}, build: () => new Container() });
    expect(pop.onKey(new KeyboardEvent('keydown', { code: 'Escape' }))).toBe(false);
  });

  // ── plate vs pointer (defect 1: the card sits above the WHOLE plaque; only the arrow follows the
  // burger) ──────────────────────────────────────────────────────────────────────────────────────
  describe('plate vs pointer', () => {
    it('places the card by the PLATE and points the arrow at a distinct POINTER', () => {
      const host = makeContext({ screenW: 1000, screenH: 600 });
      const pop = new Popover(host, {
        plate: () => ({ x: 40, y: 500, w: 400, h: 70 }), // a wide plaque
        pointer: () => ({ x: 100, y: 516, w: 36, h: 36 }), // the burger, well inside it
        onClose: () => {},
        build: fixedCard(224, 284), // +pad*2 (8) each dim → content measures 240×300
      });
      pop.resize(1000, 600);
      // left edge flush with the PLATE's left edge (40), not the pointer's (100)
      expect(pop.cardX).toBe(40);
      // bottom edge clears the PLATE's top edge (500) by the usual 8px gap — never overlaps the bar
      expect(pop.cardY + 300).toBeLessThanOrEqual(500 - POPOVER.gap);
      // arrow centred on the POINTER's centre (100+18=118), NOT the plate's own centre (40+200=240)
      expect(pop.arrowX).toBeCloseTo(118 - 40, 5);
    });

    it('clamps a pointer-derived arrow inside the card\'s rounded corners', () => {
      const host = makeContext({ screenW: 1000, screenH: 600 });
      const pop = new Popover(host, {
        plate: () => ({ x: 100, y: 540, w: 400, h: 60 }),
        pointer: () => ({ x: 100, y: 550, w: 12, h: 12 }), // hard against the plate's own left edge
        onClose: () => {},
        build: fixedCard(224, 284),
      });
      pop.resize(1000, 600);
      expect(pop.arrowX).toBe(POPOVER.arrowInset);
    });

    it('falls back to the pointer for PLACEMENT when no plate resolves', () => {
      const host = makeContext({ screenW: 1000, screenH: 600 });
      const pop = new Popover(host, {
        plate: () => null,
        pointer: () => ({ x: 100, y: 540, w: 40, h: 40 }),
        onClose: () => {},
        build: () => new Container(),
      });
      pop.resize(1000, 600);
      expect(pop.cardX).toBe(100); // placement follows the pointer when the plate can't be resolved
      expect(pop.arrowVisible).toBe(true);
    });

    it('a pointer without a plate keeps the centred, arrow-less fallback', () => {
      const host = makeContext({ screenW: 1000, screenH: 600 });
      const pop = new Popover(host, {
        plate: () => null,
        pointer: () => null,
        onClose: () => {},
        build: () => new Container(),
      });
      pop.resize(1000, 600);
      expect(pop.cardX).toBeGreaterThan(300);
      expect(pop.arrowVisible).toBe(false);
    });
  });

  // ── scale (defect 2: the card matches the bar's own fit-scale) ────────────────────────────────
  describe('scale', () => {
    it('scales the card by the injected factor, and a scaled card still lands fully inside the surface', () => {
      const host = makeContext({ screenW: 420, screenH: 600 });
      const pop = new Popover(host, {
        plate: () => ({ x: 10, y: 520, w: 380, h: 60 }),
        pointer: () => ({ x: 190, y: 532, w: 36, h: 36 }),
        scale: () => 0.5,
        onClose: () => {},
        build: fixedCard(484, 284), // +pad*2 each dim → content measures 500×300 LOCAL (unscaled)
      });
      pop.resize(420, 600);

      // typography/padding/row-heights all scale together via one transform on the whole card
      expect(pop.card.scale.x).toBeCloseTo(0.5, 5);
      expect(pop.card.scale.y).toBeCloseTo(0.5, 5);
      // cardWidth is the resolved SCREEN-space width (250), not the 500 LOCAL width the card is
      // actually laid out at before the scale shrinks it back down.
      expect(pop.cardWidth).toBeCloseTo(250, 5);

      // Once its own scale is applied, the card must still land fully inside the surface.
      const left = pop.cardX;
      const top = pop.cardY;
      const screenH = Math.min(300, 1008) * 0.5; // min(local content height, local max-height) * s
      expect(left).toBeGreaterThanOrEqual(POPOVER.margin);
      expect(top).toBeGreaterThanOrEqual(POPOVER.margin);
      expect(left + pop.cardWidth).toBeLessThanOrEqual(420 - POPOVER.margin);
      expect(top + screenH).toBeLessThanOrEqual(600 - POPOVER.margin);

      // arrow still on the pointer's centre (190+18=208 screen px) — arrowX is stored in screen units
      expect(pop.arrowX).toBeCloseTo(208 - left, 5);
    });
  });
});

describe('Toggle', () => {
  it('flips on tap and paints its knob', () => {
    const onChange = vi.fn();
    const t = new Toggle(false, onChange);
    expect(t.value).toBe(false);
    t.emit('pointertap');
    expect(onChange).toHaveBeenCalledWith(true);
    t.setValue(true);
    expect(t.value).toBe(true);
    expect(t.children.some((c) => c instanceof Graphics)).toBe(true);
  });
});
