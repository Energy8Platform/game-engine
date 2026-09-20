import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { shape } from '../src/builtin';

const props = (over: Record<string, unknown> = {}) => shape.schema(over as never);

describe('shape', () => {
  it('declares its contract: no accept, no assetProps, sane defaults', () => {
    expect(shape.type).toBe('shape');
    expect(shape.accept).toBeUndefined();
    expect(shape.assetProps).toBeUndefined();
    expect(props()).toMatchObject({
      kind: 'rect',
      width: 100,
      height: 100,
      radius: 8,
      fill: '#ffffff',
      fillAlpha: 1,
      stroke: '',
      strokeWidth: 0,
    });
  });

  it("each kind's local bounds", () => {
    const rect = shape.mount(props({ width: 40, height: 20 }), null as never) as Graphics;
    expect(rect.getLocalBounds()).toMatchObject({ minX: 0, minY: 0, maxX: 40, maxY: 20 });

    const roundRect = shape.mount(
      props({ kind: 'roundRect', width: 40, height: 20, radius: 5 }),
      null as never,
    ) as Graphics;
    // Rounded corners still bound the same box.
    expect(roundRect.getLocalBounds()).toMatchObject({ minX: 0, minY: 0, maxX: 40, maxY: 20 });

    const circle = shape.mount(props({ kind: 'circle', radius: 15 }), null as never) as Graphics;
    expect(circle.getLocalBounds()).toMatchObject({ minX: -15, minY: -15, maxX: 15, maxY: 15 });

    const ellipse = shape.mount(
      props({ kind: 'ellipse', width: 40, height: 20 }),
      null as never,
    ) as Graphics;
    expect(ellipse.getLocalBounds()).toMatchObject({ minX: -20, minY: -10, maxX: 20, maxY: 10 });

    for (const g of [rect, roundRect, circle, ellipse]) g.destroy();
  });

  it("fill: '' draws stroke only; strokeWidth: 0 draws neither", () => {
    const strokeOnly = shape.mount(
      props({ width: 40, height: 20, fill: '', stroke: '#ff0000', strokeWidth: 4 }),
      null as never,
    ) as Graphics;
    // The stroke's own width extends the bounds outward from the 40×20 fill box.
    expect(strokeOnly.getLocalBounds()).toMatchObject({ minX: -2, minY: -2, maxX: 42, maxY: 22 });

    const neither = shape.mount(
      props({ width: 40, height: 20, fill: '', stroke: '#ff0000', strokeWidth: 0 }),
      null as never,
    ) as Graphics;
    expect(neither.getLocalBounds()).toMatchObject({ minX: 0, minY: 0, maxX: 0, maxY: 0 });

    strokeOnly.destroy();
    neither.destroy();
  });

  it('update clears and redraws to a new size, not accumulating geometry', () => {
    const view = shape.mount(props({ width: 40, height: 20 }), null as never) as Graphics;
    expect(view.getLocalBounds()).toMatchObject({ minX: 0, minY: 0, maxX: 40, maxY: 20 });
    shape.update!(view, props({ width: 80, height: 40 }), null as never);
    expect(view.getLocalBounds()).toMatchObject({ minX: 0, minY: 0, maxX: 80, maxY: 40 });
    view.destroy();
  });

  it('fillAlpha reaches the fill style and survives a redraw', () => {
    const view = shape.mount(props({ width: 40, height: 20, fillAlpha: 0.5 }), null as never) as Graphics;
    expect(view.fillStyle.alpha).toBe(0.5);
    expect(() =>
      shape.update!(view, props({ width: 80, height: 40, fillAlpha: 0.5 }), null as never),
    ).not.toThrow();
    expect(view.fillStyle.alpha).toBe(0.5);
    view.destroy();
  });

  it('an invalid colour is refused by the SCHEMA, so nothing ever redraws with it', () => {
    // Same answer as the common `tint` prop, one step earlier than it used
    // to be: the check no longer waits for `update` to trip over `Color`,
    // so a refused colour cannot leave a half-drawn shape behind.
    expect(() => props({ fill: 'not-a-colour' })).toThrow();
    expect(() => props({ stroke: 'not-a-colour' })).toThrow();
    expect(() => props({ fill: 'rebeccapurple' })).not.toThrow();
    // And if one slips past the schema anyway, `update` is all-or-nothing:
    // the old geometry stands rather than being cleared and left empty.
    const view = shape.mount(props({ width: 40, height: 20 }), null as never) as Graphics;
    const bad = { ...props({ width: 80, height: 40 }), fill: 'not-a-colour' };
    expect(() => shape.update!(view, bad as never, null as never)).toThrow();
    expect(view.getLocalBounds()).toMatchObject({ maxX: 40, maxY: 20 });
    view.destroy();
  });
});
