import { describe, it, expect } from 'vitest';
import { resolveFrameStyle, DEFAULT_CELL_FRAME_STYLE } from '../src/grid/SymbolCell';

/**
 * `resolveFrameStyle` merges a partial `CellFrameStyle` onto
 * `DEFAULT_CELL_FRAME_STYLE` PER STATE — the fix for the shallow
 * `{ ...DEFAULT, ...partial }` spread that lost a state's `alpha` the
 * instant a caller (the Reels document's colour picker) sent only its
 * `color`. See `SymbolCell.ts` and `symbolCell.test.ts`'s "colour-only
 * idle draws a finite alpha" for the draw-call-level proof of the same fix.
 */
describe('resolveFrameStyle', () => {
  it('a colour-only idle keeps the default alpha; the colour is the one set', () => {
    const style = resolveFrameStyle({ idle: { color: 0xff0000 } });
    expect(style.idle).toEqual({ color: 0xff0000, alpha: DEFAULT_CELL_FRAME_STYLE.idle.alpha });
  });

  it('a set alpha of exactly 0 is used, not treated as unset', () => {
    const style = resolveFrameStyle({ idle: { alpha: 0 } });
    expect(style.idle).toEqual({ color: DEFAULT_CELL_FRAME_STYLE.idle.color, alpha: 0 });
  });

  it('winning: an explicit alpha keeps the default winning colour', () => {
    const style = resolveFrameStyle({ winning: { alpha: 0.5 } });
    expect(style.winning).toEqual({ color: DEFAULT_CELL_FRAME_STYLE.winning.color, alpha: 0.5 });
  });

  it('an absent radius falls back to the default (8)', () => {
    expect(resolveFrameStyle({}).radius).toBe(8);
    expect(resolveFrameStyle().radius).toBe(8);
  });

  it('an undefined value inside a partial state is ignored, not spread over the default', () => {
    const style = resolveFrameStyle({ idle: { color: 1, alpha: undefined } });
    expect(style.idle).toEqual({ color: 1, alpha: DEFAULT_CELL_FRAME_STYLE.idle.alpha });
  });

  it('removed and fresh states resolve the same way as idle/winning', () => {
    const style = resolveFrameStyle({ removed: { color: 2 }, fresh: { alpha: 0.1 } });
    expect(style.removed).toEqual({ color: 2, alpha: DEFAULT_CELL_FRAME_STYLE.removed.alpha });
    expect(style.fresh).toEqual({ color: DEFAULT_CELL_FRAME_STYLE.fresh.color, alpha: 0.1 });
  });

  it('no partial at all resolves to the plain defaults', () => {
    expect(resolveFrameStyle()).toEqual(DEFAULT_CELL_FRAME_STYLE);
    expect(resolveFrameStyle(undefined)).toEqual(DEFAULT_CELL_FRAME_STYLE);
  });
});
