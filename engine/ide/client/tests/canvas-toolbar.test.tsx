import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    viewport: null,
    onViewport: vi.fn(),
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

  it('the viewport select offers the design box and three device presets; a preset reports its size, design reports null', async () => {
    const props = mount();
    const select = screen.getByTestId('canvas-viewport') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      'design',
      'landscape',
      'phone-portrait',
      'phone-landscape',
      'custom',
    ]);
    expect(select.value).toBe('design');
    expect(screen.queryByTestId('canvas-viewport-size')).toBeNull();
    await userEvent.selectOptions(select, 'phone-portrait');
    expect(props.onViewport).toHaveBeenLastCalledWith({ width: 390, height: 844 });
    await userEvent.selectOptions(select, 'landscape');
    expect(props.onViewport).toHaveBeenLastCalledWith({ width: 1280, height: 720 });
    await userEvent.selectOptions(select, 'phone-landscape');
    expect(props.onViewport).toHaveBeenLastCalledWith({ width: 844, height: 390 });
    await userEvent.selectOptions(select, 'design');
    expect(props.onViewport).toHaveBeenLastCalledWith(null);
  });

  it('a given viewport selects its preset; an unlisted one reads as custom with the field showing it', () => {
    mount({ viewport: { width: 844, height: 390 } });
    expect((screen.getByTestId('canvas-viewport') as HTMLSelectElement).value).toBe(
      'phone-landscape',
    );
    cleanup();
    mount({ viewport: { width: 500, height: 500 } });
    expect((screen.getByTestId('canvas-viewport') as HTMLSelectElement).value).toBe('custom');
    expect(screen.getByTestId('canvas-viewport-size')).toBeTruthy();
  });

  it('custom… reveals a W×H field: Enter or blur with a size reports it (x, × or * between), a bad value keeps the last', async () => {
    const props = mount({ viewport: { width: 1280, height: 720 } });
    const select = screen.getByTestId('canvas-viewport') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'custom');
    expect(props.onViewport).not.toHaveBeenCalled();
    const field = screen.getByTestId('canvas-viewport-size') as HTMLInputElement;
    expect(field.value).toBe('1280×720');
    fireEvent.change(field, { target: { value: '800x600' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(props.onViewport).toHaveBeenLastCalledWith({ width: 800, height: 600 });
    fireEvent.change(field, { target: { value: ' 1024 * 768 ' } });
    fireEvent.blur(field);
    expect(props.onViewport).toHaveBeenLastCalledWith({ width: 1024, height: 768 });
    fireEvent.change(field, { target: { value: 'wide' } });
    fireEvent.blur(field);
    expect(props.onViewport).toHaveBeenCalledTimes(2);
    expect(field.value).toBe('1280×720'); // the prop is what it shows again: nothing was reported
    fireEvent.change(field, { target: { value: '0×10' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(props.onViewport).toHaveBeenCalledTimes(2);
  });

  it('the tree toggle reports and reflects the pane', async () => {
    const props = mount({ treeOpen: false });
    const toggle = screen.getByTestId('canvas-tree-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);
    expect(props.onTreeToggle).toHaveBeenCalledTimes(1);
  });
});
