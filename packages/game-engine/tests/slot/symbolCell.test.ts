import { describe, it, expect, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { SymbolCell } from '../../src/slot/grid/SymbolCell';
import type { SymbolResolver } from '../../src/slot/grid/SymbolView';

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
});
