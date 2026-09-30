import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import { STitlePlate, sCloseButton, STextButton, SChip, SSlider, SStepSlider, SToggle, S_SCROLL } from '@/ui/pixi-s/primitives/controls';
import { sBody } from '@/ui/pixi-s/text';
import { FONT_FAMILY } from '@/ui/pixi-hb/text';
import { S, DISABLED_ALPHA } from '@/ui/pixi-s/theme';
import { makeContext } from '../pixi/_host';

const tap = (n: { emit(e: string, ...a: unknown[]): unknown }) => n.emit('pointertap', {});

describe('S overlay primitives', () => {
  it('a title plate is a yellow slab with ink caps, sized to its text, capped by maxW (long text scales in)', () => {
    const p = new STitlePlate('Game info', 60);
    expect(p.slab.face).toBe(S.yellow);
    expect(p.labelText.text).toBe('GAME INFO');
    expect(p.labelText.style.fill).toBe(S.ink);
    expect(p.measureSize().h).toBe(60);
    expect(p.measureSize().w).toBeGreaterThanOrEqual(180); // min 3h
    const long = new STitlePlate('A very long localized title that cannot fit', 40, 200);
    expect(long.measureSize().w).toBe(200);
    expect(long.labelText.x + long.labelText.width).toBeLessThanOrEqual(200);
  });

  it('the close button is a yellow square slab that taps', () => {
    const onTap = vi.fn();
    const b = sCloseButton(48, onTap);
    expect(b.face).toBe('yellow');
    expect(b.measureSize()).toEqual({ w: 48, h: 48 });
    tap(b);
    expect(onTap).toHaveBeenCalled();
  });

  it('text buttons: accent yellow/ink, red red/fg, ghost plate/fg; long labels fit; disabled is inert', () => {
    const onTap = vi.fn();
    const a = new STextButton('Buy', { w: 120, h: 40, kind: 'accent', onTap });
    expect([a.slab.face, a.labelText.style.fill, a.labelText.text]).toEqual([S.yellow, S.ink, 'BUY']);
    expect(new STextButton('x', { w: 80, h: 30, kind: 'red', onTap }).slab.face).toBe(S.red);
    const g = new STextButton('Cancel', { w: 80, h: 30, kind: 'ghost', onTap });
    expect([g.slab.face, g.labelText.style.fill]).toEqual([S.plate, S.fg]);
    g.emit('pointerover', {});
    expect([g.slab.face, g.labelText.style.fill]).toEqual([S.yellow, S.ink]);
    const long = new STextButton('Deactivate the legendary feature now', { w: 100, h: 30, kind: 'accent', onTap });
    expect(long.labelText.width).toBeLessThanOrEqual(100 - 16);
    a.disabled = true;
    tap(a);
    expect(onTap).not.toHaveBeenCalled();
    expect(a.alpha).toBe(DISABLED_ALPHA);
  });

  it('a chip is a plate with an fg value; selected turns it yellow with ink; it resizes to its column', () => {
    const onTap = vi.fn();
    const c = new SChip(makeContext(), '2', '€2.00', false, 14, onTap);
    expect(c.labelText.style.fill).toBe(S.fg);
    c.setSelected(true);
    expect(c.selected).toBe(true);
    expect(c.labelText.style.fill).toBe(S.ink);
    c.setLayoutSize(90, undefined);
    expect(c.measureSize().w).toBe(90);
    tap(c);
    expect(onTap).toHaveBeenCalledWith('2');
  });

  it('the slider: an 8-thick full-width track and a 12×24 rect thumb; setValue moves it without firing', () => {
    const onInput = vi.fn();
    const s = new SSlider(0.5, onInput);
    s.setLayoutSize(212, undefined);
    expect(s.trackRect).toEqual({ x: 0, y: 8, w: 212, h: 8 });
    expect(s.thumbRect).toEqual({ x: 100, y: 0, w: 12, h: 24 });
    s.setValue(1);
    expect(s.thumbRect.x).toBe(200);
    expect(onInput).not.toHaveBeenCalled();
    expect(s.measureSize()).toEqual({ w: 212, h: 24 });
  });

  it('the toggle: a 44×24 rect track, an 18-square knob left when off, right when on', () => {
    const onChange = vi.fn();
    const t = new SToggle(false, onChange);
    expect(t.knobRect).toEqual({ x: 3, y: 3, w: 18, h: 18 });
    tap(t);
    expect(onChange).toHaveBeenCalledWith(true);
    t.setValue(true);
    expect(t.knobRect.x).toBe(44 - 21);
    expect(t.measureSize()).toEqual({ w: 44, h: 24 });
  });

  it('body copy is Inter; the S scroll look is flat yellow', () => {
    expect(sBody('Rules', 14).style.fontFamily).toBe(FONT_FAMILY);
    expect(S_SCROLL).toEqual({ track: S.track, thumb: S.yellow, radius: 0 });
  });

  it('SStepSlider: the index maps to the thumb; a tap snaps to the nearest step; 1 step never divides by 0', () => {
    const onChange = vi.fn();
    const s = new SStepSlider(5, 2, onChange);
    s.layout(400, 40);
    const tw = Math.round(40 * 0.8);
    expect(s.thumbCenterX).toBeCloseTo(tw / 2 + (2 / 4) * (400 - tw), 5);
    s.setIndex(4);
    expect(s.thumbCenterX).toBeCloseTo(400 - tw / 2, 5);
    expect(onChange).not.toHaveBeenCalled();
    (s as unknown as { setFromX(x: number): void }).setFromX(0);
    expect(s.index).toBe(0);
    expect(onChange).toHaveBeenCalledWith(0);
    const one = new SStepSlider(1, 0, () => {});
    one.layout(300, 40);
    expect(Number.isFinite(one.thumbCenterX)).toBe(true);
    expect(one.thumbCenterX).toBeCloseTo(tw / 2, 5);
  });
});
