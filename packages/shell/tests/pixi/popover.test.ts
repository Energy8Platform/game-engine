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

describe('Pixi popover', () => {
  it('places its card above the anchor and points the arrow at it', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const pop = new Popover(host, {
      anchor: () => ({ x: 100, y: 540, w: 40, h: 40 }),
      onClose: () => {},
      build: () => new Container(),
    });
    pop.resize(1000, 600);
    expect(pop.cardX).toBe(100);
    expect(pop.cardY).toBeLessThan(540);
    expect(pop.arrowX).toBeCloseTo(20, 0); // anchor centre relative to the card
  });

  // Regression: `resize()` used to size the card from `popoverWidth(w, POPOVER.minW)` — passing the
  // MINIMUM as the "measured content width" input, so the card was always exactly POPOVER.minW no
  // matter what it held. Rows live inside a masked ScrollBox, so a label wider than minW was clipped
  // instead of growing the card (or, per spec, the DOM's outcome: grow up to the maxW/surface clamp).
  it('grows the card to fit a long label, clamped to the spec range', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });

    const short = new Popover(host, { anchor: () => null, onClose: () => {}, build: labelCard('Hi') });
    short.resize(1000, 600);
    expect(short.cardWidth).toBe(POPOVER.minW); // nothing to grow for — stays at the floor

    const long = new Popover(host, {
      anchor: () => null,
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
      anchor: () => null,
      onClose: () => {},
      build: labelCard('A genuinely long menu label that cannot possibly fit in 220 pixels'),
    });
    pop.resize(260, 600); // surface barely wider than minW — content-driven width is clamped down
    expect(pop.cardWidth).toBeLessThanOrEqual(260 - POPOVER.margin * 2);
    pop.resize(1000, 600); // surface grows back — the SAME long content should re-claim its width
    expect(pop.cardWidth).toBeGreaterThan(POPOVER.minW);
  });

  it('centres itself when there is no anchor', () => {
    const host = makeContext({ screenW: 1000, screenH: 600 });
    const pop = new Popover(host, { anchor: () => null, onClose: () => {}, build: () => new Container() });
    pop.resize(1000, 600);
    expect(pop.cardX).toBeGreaterThan(300);
    expect(pop.arrowVisible).toBe(false);
  });

  it('closes when the dismiss layer is tapped, not when the card is', () => {
    const onClose = vi.fn();
    const host = makeContext();
    const pop = new Popover(host, { anchor: () => null, onClose, build: () => new Container() });
    pop.resize(1000, 600);
    pop.dismissLayer.emit('pointertap');
    expect(onClose).toHaveBeenCalledOnce();
    pop.card.emit('pointertap');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lets Escape through to the controller', () => {
    const host = makeContext();
    const pop = new Popover(host, { anchor: () => null, onClose: () => {}, build: () => new Container() });
    expect(pop.onKey(new KeyboardEvent('keydown', { code: 'Escape' }))).toBe(false);
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
