import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CanvasToolbar } from '../src/shell/CanvasToolbar';

/**
 * The toolbar holds no state: it draws the zoom it is given and reports
 * every gesture through a callback. `SceneDocument` owns the numbers
 * (the fit needs the stage's box, which lives there).
 */
function mount(over: Partial<Parameters<typeof CanvasToolbar>[0]> = {}) {
  const props = {
    zoom: 1,
    onZoom: vi.fn(),
    grid: { on: false, step: 16 as const },
    onGrid: vi.fn(),
    treeOpen: true,
    onTreeToggle: vi.fn(),
    ...over,
  };
  render(<CanvasToolbar {...props} />);
  return props;
}

describe('CanvasToolbar', () => {
  it('shows the zoom as a percentage; − and + step it by 1.25, clamped; Fit asks for the fit', async () => {
    const props = mount({ zoom: 0.5 });
    expect(screen.getByTestId('canvas-toolbar')).toBeTruthy();
    expect(screen.getByTestId('canvas-zoom')).toHaveTextContent('50%');
    await userEvent.click(screen.getByTestId('canvas-zoom-in'));
    expect(props.onZoom).toHaveBeenLastCalledWith(0.625);
    await userEvent.click(screen.getByTestId('canvas-zoom-out'));
    expect(props.onZoom).toHaveBeenLastCalledWith(0.4);
    await userEvent.click(screen.getByTestId('canvas-fit'));
    expect(props.onZoom).toHaveBeenLastCalledWith(null);
  });

  it('clamps the zoom to [0.1, 4]', async () => {
    const top = mount({ zoom: 4 });
    await userEvent.click(screen.getByTestId('canvas-zoom-in'));
    expect(top.onZoom).toHaveBeenLastCalledWith(4);
  });

  it('grid toggle and step report the whole grid state', async () => {
    const props = mount();
    const grid = screen.getByTestId('canvas-grid') as HTMLInputElement;
    expect(grid.checked).toBe(false);
    await userEvent.click(grid);
    expect(props.onGrid).toHaveBeenLastCalledWith({ on: true, step: 16 });
    const step = screen.getByTestId('canvas-grid-step') as HTMLSelectElement;
    expect([...step.options].map((o) => o.value)).toEqual(['8', '16', '32']);
    await userEvent.selectOptions(step, '32');
    expect(props.onGrid).toHaveBeenLastCalledWith({ on: false, step: 32 });
  });

  it('the tree toggle reports and reflects the pane', async () => {
    const props = mount({ treeOpen: false });
    const toggle = screen.getByTestId('canvas-tree-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);
    expect(props.onTreeToggle).toHaveBeenCalledTimes(1);
  });
});
