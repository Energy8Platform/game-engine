import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SymbolChips } from '../src/shell/SymbolChips';
import { BoardPainter, type BoardShape } from '../src/shell/BoardPainter';

/**
 * Task 6's two reels-only editors, tested standalone — neither reads `ctx`
 * or a schemastery node, so no harness is needed (contrast
 * `reels-document.test.tsx`, which wires them through `ReelsDocument` and
 * a real `SchemaForm`). `SymbolChips` is a `fieldOverrides` entry plus the
 * project's known ids (`FieldProps & { known }` — see `SchemaForm`'s own
 * doc comment); `BoardPainter` is plain props, not a field at all (`board`
 * is `Schema.any()` — no `Field` kind renders it).
 */
const KNOWN_1_6 = ['1', '2', '3', '4', '5', '6'].map((id) => ({ id, name: id }));

/** `SymbolChips` only reads `value`/`onChange` off `FieldProps`; the rest
 * (`id`/`node`/`commit`/…) are supplied so the type checks, unused. */
function chips(value: unknown, onChange = vi.fn()) {
  render(
    <SymbolChips
      id="f"
      node={{ type: 'array' }}
      value={value}
      onChange={onChange}
      commit="blur"
      path="triggerSymbols"
      known={KNOWN_1_6}
    />,
  );
  return onChange;
}

describe('SymbolChips', () => {
  it('draws one chip per value entry, an unknown id marked, and the add select of the known ids not yet chosen', () => {
    chips(['6', 'x']);
    expect(screen.getByTestId('symbol-chip-6')).toHaveTextContent('6');
    expect(screen.getByTestId('symbol-chip-6')).not.toHaveClass('e8-chip-unknown');
    const unknown = screen.getByTestId('symbol-chip-x');
    expect(unknown).toHaveClass('e8-chip-unknown');
    expect(unknown).toHaveAttribute('title', 'not a symbol of this project');

    const add = screen.getByTestId('symbol-chips-add') as HTMLSelectElement;
    const optionIds = within(add)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '');
    expect(optionIds).toEqual(['1', '2', '3', '4', '5']);
  });

  it('picking an id from the add select appends it', () => {
    const onChange = chips(['6', 'x']);
    fireEvent.change(screen.getByTestId('symbol-chips-add'), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith(['6', 'x', '2']);
  });

  it('removing a chip calls onChange without it, by its own aria-label', () => {
    const onChange = chips(['6', 'x']);
    fireEvent.click(screen.getByRole('button', { name: 'remove 6' }));
    expect(onChange).toHaveBeenCalledWith(['x']);
  });

  it('an empty list shows the add select only', () => {
    chips([]);
    expect(screen.queryByTestId(/^symbol-chip-/)).toBeNull();
    expect(screen.getByTestId('symbol-chips-add')).toBeInTheDocument();
  });
});

const SHAPE_3x3: BoardShape = { cols: 3, rows: [3, 3, 3] };
const KNOWN = [
  { id: '4', name: 'four' },
  { id: '7', name: 'seven' },
];

function painter(board: unknown, shape: BoardShape, onChange = vi.fn()) {
  render(<BoardPainter board={board} shape={shape} known={KNOWN} onChange={onChange} />);
  return onChange;
}

describe('BoardPainter', () => {
  it('with no saved board, draws every shape cell empty (·)', () => {
    painter(undefined, SHAPE_3x3);
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        expect(screen.getByTestId(`board-cell-${c}-${r}`)).toHaveTextContent('·');
      }
    }
    expect(screen.queryByTestId('board-mismatch')).toBeNull();
  });

  it('clicking a cell opens a menu of the known ids + empty; picking one writes a full board with just that cell set', () => {
    const onChange = painter(undefined, SHAPE_3x3);
    fireEvent.click(screen.getByTestId('board-cell-1-2'));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const board = onChange.mock.calls[0][0] as (string | null)[][];
    expect(board).toHaveLength(3);
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        expect(board[c][r]).toBe(c === 1 && r === 2 ? '4' : null);
      }
    }
  });

  it('the menus own empty entry clears just that cell', () => {
    const board = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
    ];
    const onChange = painter(board, SHAPE_3x3);
    fireEvent.click(screen.getByTestId('board-cell-0-0'));
    fireEvent.click(screen.getByRole('button', { name: 'empty' }));
    const next = onChange.mock.calls[0][0] as (string | null)[][];
    expect(next[0][0]).toBeNull();
    expect(next[1][1]).toBe('5'); // untouched
  });

  it('board-clear writes undefined — the section removes the key', () => {
    const onChange = painter(undefined, SHAPE_3x3);
    fireEvent.click(screen.getByTestId('board-clear'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('a saved board whose shape differs from the grid shows board-mismatch and draws the SAVED cells, without writing', () => {
    const saved = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]; // 2 cols, not 3
    const onChange = painter(saved, SHAPE_3x3);
    expect(screen.getByTestId('board-mismatch')).toBeInTheDocument();
    expect(screen.getByTestId('board-cell-0-0')).toHaveTextContent('a');
    expect(screen.getByTestId('board-cell-1-2')).toHaveTextContent('f');
    expect(screen.queryByTestId('board-cell-2-0')).toBeNull(); // only 2 saved columns drawn
    expect(onChange).not.toHaveBeenCalled();
  });

  it('board-fit on a 2x3 saved board pads the missing 3rd column with null, keeping the saved cells', () => {
    const saved = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ];
    const onChange = painter(saved, SHAPE_3x3);
    fireEvent.click(screen.getByTestId('board-fit'));
    const fitted = onChange.mock.calls[0][0] as (string | null)[][];
    expect(fitted).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      [null, null, null],
    ]);
  });

  it('board-fit on a 4-column saved board (3-col shape) truncates the 4th column', () => {
    const saved = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
      ['j', 'k', 'l'],
    ];
    const onChange = painter(saved, SHAPE_3x3);
    fireEvent.click(screen.getByTestId('board-fit'));
    const fitted = onChange.mock.calls[0][0] as (string | null)[][];
    expect(fitted).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ]);
  });
});
