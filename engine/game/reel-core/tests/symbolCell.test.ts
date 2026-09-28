import { describe, it, expect, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { SymbolCell, type CellData, type SymbolCellConfig } from '../src/grid/SymbolCell';
import type { SymbolResolver, SymbolView } from '../src/grid/SymbolView';
// The barrel re-export, not the direct module — proves `DEFAULT_CELL_FRAME_STYLE` is public API.
import { DEFAULT_CELL_FRAME_STYLE } from '../src';

const resolver: SymbolResolver = vi.fn((id: string) => {
  const v = new Container() as any;
  v.__id = id;
  return v;
});

describe('SymbolCell', () => {
  it('calls the resolver with the symbol id and mounts the view on setData', () => {
    const cell = new SymbolCell({ size: 100, resolve: resolver });
    cell.setData({ symbol: 'A' });
    expect(resolver).toHaveBeenCalledWith('A');
    expect((cell.view as any).__id).toBe('A');
  });
  it('clears the view when symbol is null', () => {
    const cell = new SymbolCell({ size: 100, resolve: resolver });
    cell.setData({ symbol: 'A' });
    cell.setData({ symbol: null });
    expect(cell.view).toBeNull();
  });
  it('styles the frame graphics by state', () => {
    const cell = new SymbolCell({
      size: 100, resolve: resolver,
      frameStyle: { winning: { color: 0x00ff00, alpha: 0.9 }, idle: { color: 0x111111, alpha: 0.3 } },
    });
    cell.setState({ winning: true });
    const frame = cell.children.find((c) => c instanceof Graphics) as any;
    expect(frame.tint).toBe(0x00ff00); // frame styling stored on the graphics' last fill (asserted via a stored field)
    expect(cell.frameStyleKey).toBe('winning');
  });
  it('shows the ×N multiplier badge only when multiplier is set', () => {
    const cell = new SymbolCell({ size: 100, resolve: resolver });
    cell.setData({ symbol: 'A', multiplier: 3 });
    expect(cell.hasBadge('multiplier')).toBe(true);
    cell.setData({ symbol: 'A' });
    expect(cell.hasBadge('multiplier')).toBe(false);
  });
  it('exports its frame defaults and draws its idle frame with them', () => {
    expect(DEFAULT_CELL_FRAME_STYLE.idle).toEqual({ color: 0x223047, alpha: 0.34 });
    expect(DEFAULT_CELL_FRAME_STYLE.radius).toBe(8);
    expect(Object.isFrozen(DEFAULT_CELL_FRAME_STYLE)).toBe(true);
    const cell = new SymbolCell({ size: 96, resolve: resolver });
    // the frame is the first child; its tint is the idle colour (`_drawFrame` stores it)
    expect((cell.children[0] as { tint: number }).tint).toBe(0x223047);
  });

  // The bug this fixes: a colour-only `idle` used to lose `alpha` to a
  // shallow `{ ...DEFAULT, ...frameStyle }` spread (the whole `idle` object
  // got replaced, `alpha` came back `undefined`, Pixi's fill got `NaN`).
  // Read the frame Graphics' own fill instruction — same approach
  // `@energy8engine/scene-edit`'s `plugin.test.ts` uses to check alpha —
  // rather than a new test-only field.
  it('a colour-only idle frameStyle draws the idle frame with a finite (default) alpha', () => {
    const cell = new SymbolCell({
      size: 100,
      resolve: resolver,
      frameStyle: { idle: { color: 0xff0000 } },
    });
    const frame = cell.children[0] as Graphics;
    const fill = (frame.context as unknown as { instructions: { action: string; data: { style: { alpha: number } } }[] })
      .instructions.find((i) => i.action === 'fill')!;
    expect(fill.data.style.alpha).toBe(0.34);
    expect(frame.tint).toBe(0xff0000);
  });
});

describe('F9 — a cell keeps its view for the same symbol', () => {
  const resolve = vi.fn(() => new Container() as unknown as SymbolView);
  const cell = () => new SymbolCell({ size: { width: 10, height: 10 }, resolve } as SymbolCellConfig);

  it('the same symbol keeps the view object; the data is the new record', () => {
    const c = cell();
    c.setData({ symbol: 'orb', band: 'green' } as CellData);
    const first = c.view;
    resolve.mockClear();
    c.setData({ symbol: 'orb', band: 'red' } as CellData);
    expect(c.view).toBe(first);
    expect(resolve).not.toHaveBeenCalled();
    expect((c.data as CellData & { band: string }).band).toBe('red');
  });

  it('a different symbol replaces the view', () => {
    const c = cell();
    c.setData({ symbol: 'a' });
    const first = c.view;
    c.setData({ symbol: 'b' });
    expect(c.view).not.toBe(first);
  });

  it('null clears it, and a symbol after null resolves again', () => {
    const c = cell();
    c.setData({ symbol: 'a' });
    c.setData({ symbol: null });
    expect(c.view).toBeNull();
    c.setData({ symbol: 'a' });
    expect(c.view).not.toBeNull();
  });
});
