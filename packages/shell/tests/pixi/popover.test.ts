import './setup-canvas';
import { describe, it, expect, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { Popover } from '@/ui/pixi/primitives/popover';
import { Toggle } from '@/ui/pixi/primitives/controls';
import { makeContext } from './_host';

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
