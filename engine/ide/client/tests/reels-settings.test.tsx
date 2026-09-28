import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompositionScreen } from '../src/screens/CompositionScreen';
import { harness, renderSettings, row } from './reels-harness';

/**
 * The Reels tab's right sidebar (`shell.sideRight` `reels`), rendered
 * through the plugin's own registration: `reels1`'s `grid`/`win`/`board`
 * sections plus the whole-row forms for `motion1`/`anticipation1`/
 * `cascade1`/`features1` — moved out of `ReelsDocument` (`reels-document.
 * test.tsx` keeps the canvas/toolbar/sync tests). Every edit is asserted
 * as the `{ id, config }` this component sent through `ctx.gameComposition
 * .update` — it never touches the canvas itself, that is `ReelsDocument`'s
 * own row-following effect.
 */
describe('ReelsSettings — sections', () => {
  it('with reels1 + motion1 only: grid/win/board/motion show, anticipation/cascade/features do not', async () => {
    const { ctx } = await harness([row('reels1'), row('motion1')]);
    renderSettings(ctx);
    for (const name of ['grid', 'win', 'board', 'motion']) {
      expect(screen.getByTestId(`reels-section-${name}`)).toBeInTheDocument();
    }
    for (const name of ['anticipation', 'cascade', 'features']) {
      expect(screen.queryByTestId(`reels-section-${name}`)).toBeNull();
    }
  });

  it('shows every section once every reel row is present', async () => {
    const { ctx } = await harness([
      row('reels1'),
      row('motion1'),
      row('anticipation1'),
      row('cascade1'),
      row('features1'),
    ]);
    renderSettings(ctx);
    for (const name of ['grid', 'win', 'board', 'motion', 'anticipation', 'cascade', 'features']) {
      expect(screen.getByTestId(`reels-section-${name}`)).toBeInTheDocument();
    }
  });

  it('the grid section is a SchemaForm rooted at grid, resettable; editing cols merges into reels1s whole config', async () => {
    const { ctx, updateCalls } = await harness([row('reels1', { win: { glow: false } })]);
    renderSettings(ctx);
    const cols = screen.getByLabelText('cols');
    fireEvent.change(cols, { target: { value: '6' } });
    expect(updateCalls).toHaveLength(0); // commit="blur": no write per keystroke
    fireEvent.blur(cols);
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({
      id: 'reels1',
      config: { win: { glow: false }, grid: { cols: 6 } },
    });
  });

  it('the motion section is the whole motion1 form; reset section writes {} and only shows when the row has a key', async () => {
    const { ctx, updateCalls } = await harness([row('reels1'), row('motion1', { style: 'strip' })]);
    renderSettings(ctx);
    const motionSection = screen.getByTestId('reels-section-motion');
    expect(within(motionSection).getByLabelText('style')).toHaveValue('strip');

    fireEvent.click(within(motionSection).getByRole('button', { name: 'reset section motion' }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({ id: 'motion1', config: {} });
  });

  it('a whole-row section with an empty config has no reset section button', async () => {
    const { ctx } = await harness([row('reels1'), row('motion1', {})]);
    renderSettings(ctx);
    const motionSection = screen.getByTestId('reels-section-motion');
    expect(within(motionSection).queryByRole('button', { name: /reset section/ })).toBeNull();
  });

  it('the grid section shows reset section only when reels1.config.grid is set, and drops just that key', async () => {
    const { ctx, updateCalls } = await harness([row('reels1', { grid: { cols: 6 } })]);
    renderSettings(ctx);
    const gridSection = screen.getByTestId('reels-section-grid');
    const winSection = screen.getByTestId('reels-section-win');
    expect(within(winSection).queryByRole('button', { name: /reset section/ })).toBeNull();

    fireEvent.click(within(gridSection).getByRole('button', { name: 'reset section grid' }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({ id: 'reels1', config: {} });
  });
});

// Composition stays mounted (hidden) while the Reels tab shows, drawing
// the SAME rows with the same `rowId` — every field id and radio `name`
// would collide if this sidebar drew its forms unprefixed, so a label
// here could toggle Composition's hidden copy instead of writing through
// this component's own handler.
describe('ReelsSettings — beside a mounted Composition', () => {
  it('the Reels enabled checkbox is reached by its own label and writes through the Reels handler once', async () => {
    const { ctx, updateCalls } = await harness([row('reels1'), row('anticipation1')]);
    // `EditorComposition` reads the IDE's own graph off `ctx.connection`;
    // an empty one is all this needs.
    ctx.provide('connection', {
      snapshot: null,
      diagnostics: [],
      subscribe: () => () => {},
      update: () => {},
      report: () => {},
    } as never);
    const composition = render(
      <div hidden>
        <CompositionScreen ctx={ctx} rows={ctx.gameComposition.rows!} />
      </div>,
    );
    renderSettings(ctx);

    const section = screen.getByTestId('reels-section-anticipation');
    const enabled = within(section).getByLabelText('enabled');
    expect(section).toContainElement(enabled);
    fireEvent.click(within(section).getByText('enabled'));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({ id: 'anticipation1', config: { enabled: true } });
    // Before `afterEach` disposes `ctx` — Composition reads `ctx.connection` on every render.
    composition.unmount();
  });
});

describe('ReelsSettings — symbol editors', () => {
  it('the Anticipation sections triggerSymbols is drawn by chips, off ctx.symbols.known()', async () => {
    const { ctx } = await harness([
      row('reels1'),
      row('anticipation1', { triggerSymbols: ['scatter'] }),
    ]);
    renderSettings(ctx);
    const section = screen.getByTestId('reels-section-anticipation');
    expect(within(section).getByTestId('symbol-chip-scatter')).toBeInTheDocument();
    expect(within(section).getByTestId('symbol-chips-add')).toBeInTheDocument();
  });

  it('the Win sections frameShake.onlyOnSymbols, switched on, is drawn by chips', async () => {
    const { ctx } = await harness([
      row('reels1', { win: { frameShake: { onlyOnSymbols: ['wild'] } } }),
    ]);
    renderSettings(ctx);
    const section = screen.getByTestId('reels-section-win');
    expect(within(section).getByRole('checkbox', { name: 'onlyOnSymbols' })).toBeChecked();
    expect(within(section).getByTestId('symbol-chip-wild')).toBeInTheDocument();
  });

  it('the Board section is the painter over reels1.board, shaped by grid.cols/rows', async () => {
    const { ctx } = await harness([row('reels1', { grid: { cols: 2, rows: 2 } })]);
    renderSettings(ctx);
    const section = screen.getByTestId('reels-section-board');
    for (const [c, r] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      expect(within(section).getByTestId(`board-cell-${c}-${r}`)).toHaveTextContent('·');
    }
    expect(within(section).queryByTestId('board-cell-2-0')).toBeNull();
  });

  it('the Board section shapes by rowsPerReel when set, not the uniform rows', async () => {
    const { ctx } = await harness([
      row('reels1', { grid: { cols: 2, rows: 3, rowsPerReel: [1, 2] } }),
    ]);
    renderSettings(ctx);
    const section = screen.getByTestId('reels-section-board');
    expect(within(section).getByTestId('board-cell-0-0')).toBeInTheDocument();
    expect(within(section).queryByTestId('board-cell-0-1')).toBeNull();
    expect(within(section).getByTestId('board-cell-1-1')).toBeInTheDocument();
    expect(within(section).queryByTestId('board-cell-1-2')).toBeNull();
  });

  // reel-core's `normalizeGrid` drops a `rowsPerReel` whose length isn't
  // `cols` — the board then has `rows` everywhere, and the painter must
  // measure against that same shape.
  it('a rowsPerReel whose length is not cols is ignored, as the reel system does', async () => {
    const { ctx } = await harness([
      row('reels1', { grid: { cols: 2, rows: 2, rowsPerReel: [1] } }),
    ]);
    renderSettings(ctx);
    const section = screen.getByTestId('reels-section-board');
    expect(within(section).getByTestId('board-cell-0-1')).toBeInTheDocument();
    expect(within(section).getByTestId('board-cell-1-1')).toBeInTheDocument();
    expect(within(section).queryByTestId('board-cell-0-2')).toBeNull();
  });

  it('painting a cell writes reels1 with { ...config, board }', async () => {
    const { ctx, updateCalls } = await harness([
      row('reels1', { grid: { cols: 2, rows: 1 }, win: { glow: false } }),
    ]);
    renderSettings(ctx);
    const section = screen.getByTestId('reels-section-board');
    fireEvent.click(within(section).getByTestId('board-cell-1-0'));
    fireEvent.click(within(section).getByRole('button', { name: 'scatter' }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({
      id: 'reels1',
      config: {
        grid: { cols: 2, rows: 1 },
        win: { glow: false },
        board: [[null], ['scatter']],
      },
    });
  });

  it('board-clear removes the board key entirely rather than writing an empty grid', async () => {
    const { ctx, updateCalls } = await harness([
      row('reels1', {
        grid: { cols: 1, rows: 1 },
        board: [['scatter']],
      }),
    ]);
    renderSettings(ctx);
    const section = screen.getByTestId('reels-section-board');
    fireEvent.click(within(section).getByTestId('board-clear'));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({ id: 'reels1', config: { grid: { cols: 1, rows: 1 } } });
  });
});
