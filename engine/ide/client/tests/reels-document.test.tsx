import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Context } from 'cordis';
import Schema from 'schemastery';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameCompositionRow, SymbolsDoc } from '@energy8engine/contracts';
import * as slots from '../src/plugins/slots';
import * as reels from '../src/plugins/reels';
import { CompositionScreen } from '../src/screens/CompositionScreen';

/**
 * Task 5's own harness — `symbols-harness.tsx`'s shape, trimmed to what
 * `reels.tsx` and `ReelsDocument` actually read: `slots` for real (the
 * plugin registers into it, the test reads it back the same way `Shell`
 * would), and bare `gameComposition`/`workspace`/`symbols` stubs — no
 * socket, no fetch, nothing else either ever touches. `reels.tsx` only
 * injects `gameComposition`/`slots`; `ReelsDocument` also reads `workspace`
 * and (Task 6) `symbols` directly (`useWorkspace`/`useSymbols`, same as
 * `SymbolsDocument`), so those stubs ride along even though the plugin
 * itself never declares either.
 */
const json = (schema: Schema) => JSON.parse(JSON.stringify(schema.toJSON()));

/** The chips override's and the board painter's `known` — a small, fixed
 * set unless a test overrides it via `harness`'s `opts.known`. */
const KNOWN_SYMBOLS = [
  { id: 'scatter', name: 'Scatter' },
  { id: 'wild', name: 'Wild' },
];

const REELS_SCHEMA = json(
  Schema.object({
    grid: Schema.object({
      cols: Schema.number().default(5),
      rows: Schema.number().default(3),
      rowsPerReel: Schema.array(Schema.number()),
    }),
    win: Schema.object({
      glow: Schema.boolean().default(true),
      frameShake: Schema.object({
        enabled: Schema.boolean().default(false),
        onlyOnSymbols: Schema.union([Schema.const(null), Schema.array(Schema.string())]).default(
          null,
        ),
      }),
    }),
    board: Schema.any(),
  }),
);
const MOTION_SCHEMA = json(Schema.object({ style: Schema.string().default('swap') }));
const ANTICIPATION_SCHEMA = json(
  Schema.object({
    enabled: Schema.boolean().default(false),
    triggerSymbols: Schema.array(Schema.string()).default(['scatter']),
    threshold: Schema.natural().default(2),
  }),
);
const CASCADE_SCHEMA = json(Schema.object({ gravity: Schema.boolean().default(true) }));
const FEATURES_SCHEMA = json(
  Schema.object({ walkWild: Schema.object({ enabled: Schema.boolean().default(false) }) }),
);

const SCHEMAS: Record<string, unknown> = {
  reels1: REELS_SCHEMA,
  motion1: MOTION_SCHEMA,
  anticipation1: ANTICIPATION_SCHEMA,
  cascade1: CASCADE_SCHEMA,
  features1: FEATURES_SCHEMA,
};

function row(id: string, config: Record<string, unknown> = {}): GameCompositionRow {
  return {
    id,
    name: id,
    config,
    from: 'bundle:test',
    runtimeUrl: null,
    schema: SCHEMAS[id] ?? null,
    hot: true,
  };
}

const PREVIEW_URL = 'http://127.0.0.1:5682';

const built: Context[] = [];
afterEach(async () => {
  for (const ctx of built.splice(0)) await ctx.fiber.dispose();
});

async function harness(
  rows: GameCompositionRow[] | null,
  opts: {
    update?: (
      id: string,
      config: Record<string, unknown>,
    ) => Promise<{ reload: boolean; diagnostics: unknown[] }>;
    known?: { id: string; name: string }[];
    symbolsDoc?: SymbolsDoc | null;
  } = {},
) {
  const ctx = new Context();
  built.push(ctx);
  await ctx.plugin(slots);
  const workspace = {
    projects: [],
    templates: [],
    active: 'first',
    previewUrl: PREVIEW_URL,
    diagnostics: [],
  };
  ctx.provide('workspace', {
    state: () => workspace,
    subscribe: () => () => {},
    open: async () => [],
    create: async () => [],
  });
  // Bare `useSymbols` shape, same reason `workspace` is stubbed rather than
  // booting the real plugin (see this file's own top comment): the chips
  // override and the board painter both read `ctx.symbols.known()`/`.doc()`
  // through it, and neither `reels.tsx` nor this document need the rest of
  // the real service (sockets, PUTs, selection).
  ctx.provide('symbols', {
    doc: () => opts.symbolsDoc ?? null,
    known: () => opts.known ?? KNOWN_SYMBOLS,
    diagnostics: () => [],
    selected: () => null,
    select: () => {},
    update: async () => [],
    subscribe: () => () => {},
  });
  const listeners = new Set<() => void>();
  const updateCalls: { id: string; config: Record<string, unknown> }[] = [];
  const service = {
    rows,
    diagnostics: [] as unknown[],
    reloads: 0,
    transitions: [] as string[],
    status: null,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async update(id: string, config: Record<string, unknown>) {
      updateCalls.push({ id, config });
      const answer = opts.update
        ? await opts.update(id, config)
        : { reload: false, diagnostics: [] };
      // Same shape the real service applies on success: the row's config
      // replaced in `rows`, so a later `sendRows` (and the next render)
      // sees what was just written.
      if (answer.diagnostics.length === 0 && service.rows) {
        service.rows = service.rows.map((r) => (r.id === id ? { ...r, config } : r));
      }
      for (const fn of listeners) fn();
      return answer;
    },
  };
  ctx.provide('gameComposition', service as never);
  await ctx.plugin(reels);
  // `act()`: a service mutation notifies the mounted document's
  // subscription synchronously, outside any testing-library event helper
  // — same reason `symbols-document.test.tsx`'s `bumpReloads()` calls are
  // wrapped (see its own `act(() => bumpReloads())`).
  const setRows = (next: GameCompositionRow[] | null) => {
    act(() => {
      service.rows = next;
      for (const fn of listeners) fn();
    });
  };
  return { ctx, updateCalls, setRows };
}

function renderDocument(ctx: Context) {
  const entry = ctx.slots.list('shell.document').find((e) => e.key === 'reels');
  if (!entry) throw new Error('reels did not register a shell.document entry');
  return render(<entry.component ctx={ctx} />);
}

/**
 * The canvas iframe, `symbols-harness.tsx`'s `canvas()` trick: stub
 * `contentWindow.postMessage` so a request can be read back, and answer
 * whatever the test configures (`{ ok: true }` by default — every lab
 * action's happy path) through the same `e8:ide:res` wire frame the real
 * canvas would send. `ready()` fires the `e8:ide:evt` frame the document's
 * `rpc.on('ready', …)` listens for.
 */
function canvas() {
  const iframe = screen.getByTitle('reels canvas') as HTMLIFrameElement;
  const win = iframe.contentWindow as Window & { postMessage: ReturnType<typeof vi.fn> };
  const answers = new Map<string, unknown>();
  const respond = (id: number, result: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'e8:ide:res', id, ok: true, result },
        origin: PREVIEW_URL,
        source: iframe.contentWindow,
      }),
    );
  win.postMessage = vi.fn((data: unknown) => {
    const req = data as { type?: string; id?: number; method?: string };
    if (req.type !== 'e8:ide:req' || typeof req.id !== 'number') return;
    respond(req.id, answers.get(req.method!) ?? { ok: true });
  });
  const posted = () => win.postMessage.mock.calls.map((c) => c[0]);
  const reqs = (method: string) =>
    posted()
      .filter((m) => m.type === 'e8:ide:req' && m.method === method)
      .map((m) => m.params);
  const ready = () =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'e8:ide:evt', event: 'ready', payload: { reels: true } },
        origin: PREVIEW_URL,
        source: iframe.contentWindow,
      }),
    );
  return {
    iframe,
    posted,
    reqs,
    ready,
    setAnswer: (m: string, result: unknown) => answers.set(m, result),
  };
}

describe('reels plugin — activity/document presence', () => {
  it('registers no activity/document with no reels1 row; one arriving later registers it', async () => {
    const { ctx, setRows } = await harness([]);
    expect(ctx.slots.list('shell.activity').find((e) => e.key === 'reels')).toBeUndefined();
    expect(ctx.slots.list('shell.document').find((e) => e.key === 'reels')).toBeUndefined();

    setRows([row('reels1')]);
    expect(ctx.slots.list('shell.activity').find((e) => e.key === 'reels')).toBeDefined();
    expect(ctx.slots.list('shell.document').find((e) => e.key === 'reels')).toBeDefined();
  });

  it('with rows still null (the boot GET has not answered), registers nothing either', async () => {
    const { ctx } = await harness(null);
    expect(ctx.slots.list('shell.activity').find((e) => e.key === 'reels')).toBeUndefined();
  });

  it('unregisters again if reels1 later drops out of the composition', async () => {
    const { ctx, setRows } = await harness([row('reels1')]);
    expect(ctx.slots.list('shell.activity').find((e) => e.key === 'reels')).toBeDefined();
    setRows([]);
    expect(ctx.slots.list('shell.activity').find((e) => e.key === 'reels')).toBeUndefined();
  });
});

describe('ReelsDocument — sections', () => {
  it('with reels1 + motion1 only: grid/win/board/motion show, anticipation/cascade/features do not', async () => {
    const { ctx } = await harness([row('reels1'), row('motion1')]);
    renderDocument(ctx);
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
    renderDocument(ctx);
    for (const name of ['grid', 'win', 'board', 'motion', 'anticipation', 'cascade', 'features']) {
      expect(screen.getByTestId(`reels-section-${name}`)).toBeInTheDocument();
    }
  });

  it('the grid section is a SchemaForm rooted at grid, resettable; editing cols merges into reels1s whole config', async () => {
    const { ctx, updateCalls } = await harness([row('reels1', { win: { glow: false } })]);
    renderDocument(ctx);
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
    renderDocument(ctx);
    const motionSection = screen.getByTestId('reels-section-motion');
    expect(within(motionSection).getByLabelText('style')).toHaveValue('strip');

    fireEvent.click(within(motionSection).getByRole('button', { name: 'reset section motion' }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({ id: 'motion1', config: {} });
  });

  it('a whole-row section with an empty config has no reset section button', async () => {
    const { ctx } = await harness([row('reels1'), row('motion1', {})]);
    renderDocument(ctx);
    const motionSection = screen.getByTestId('reels-section-motion');
    expect(within(motionSection).queryByRole('button', { name: /reset section/ })).toBeNull();
  });

  it('the grid section shows reset section only when reels1.config.grid is set, and drops just that key', async () => {
    const { ctx, updateCalls } = await harness([row('reels1', { grid: { cols: 6 } })]);
    renderDocument(ctx);
    const gridSection = screen.getByTestId('reels-section-grid');
    const winSection = screen.getByTestId('reels-section-win');
    expect(within(winSection).queryByRole('button', { name: /reset section/ })).toBeNull();

    fireEvent.click(within(gridSection).getByRole('button', { name: 'reset section grid' }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({ id: 'reels1', config: {} });
  });
});

// Final review I1: Composition stays mounted (hidden) while the Reels
// document shows, drawing the SAME rows with the same `rowId` — every field
// id and radio `name` collided, so a Reels label pointed at Composition's
// hidden copy and its write skipped the canvas `rows` sync.
describe('ReelsDocument — beside a mounted Composition', () => {
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
    renderDocument(ctx);
    const c = canvas();

    const section = screen.getByTestId('reels-section-anticipation');
    const enabled = within(section).getByLabelText('enabled');
    expect(section).toContainElement(enabled);
    fireEvent.click(within(section).getByText('enabled'));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({ id: 'anticipation1', config: { enabled: true } });
    // Only the Reels handler re-sends the canvas — Composition's own write does not.
    await waitFor(() => expect(c.reqs('rows')).toHaveLength(1));
    // Before `afterEach` disposes `ctx` — Composition reads `ctx.connection` on every render.
    composition.unmount();
  });
});

describe('ReelsDocument — symbol editors (Task 6)', () => {
  it('the Anticipation sections triggerSymbols is drawn by chips, off ctx.symbols.known()', async () => {
    const { ctx } = await harness([
      row('reels1'),
      row('anticipation1', { triggerSymbols: ['scatter'] }),
    ]);
    renderDocument(ctx);
    const section = screen.getByTestId('reels-section-anticipation');
    expect(within(section).getByTestId('symbol-chip-scatter')).toBeInTheDocument();
    expect(within(section).getByTestId('symbol-chips-add')).toBeInTheDocument();
  });

  it('the Win sections frameShake.onlyOnSymbols, switched on, is drawn by chips', async () => {
    const { ctx } = await harness([
      row('reels1', { win: { frameShake: { onlyOnSymbols: ['wild'] } } }),
    ]);
    renderDocument(ctx);
    const section = screen.getByTestId('reels-section-win');
    expect(within(section).getByRole('checkbox', { name: 'onlyOnSymbols' })).toBeChecked();
    expect(within(section).getByTestId('symbol-chip-wild')).toBeInTheDocument();
  });

  it('the Board section is the painter over reels1.board, shaped by grid.cols/rows', async () => {
    const { ctx } = await harness([row('reels1', { grid: { cols: 2, rows: 2 } })]);
    renderDocument(ctx);
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
    renderDocument(ctx);
    const section = screen.getByTestId('reels-section-board');
    expect(within(section).getByTestId('board-cell-0-0')).toBeInTheDocument();
    expect(within(section).queryByTestId('board-cell-0-1')).toBeNull();
    expect(within(section).getByTestId('board-cell-1-1')).toBeInTheDocument();
    expect(within(section).queryByTestId('board-cell-1-2')).toBeNull();
  });

  // Final review M6: reel-core's `normalizeGrid` drops a `rowsPerReel`
  // whose length isn't `cols` — the board then has `rows` everywhere, and
  // the painter must measure against that same shape.
  it('a rowsPerReel whose length is not cols is ignored, as the reel system does', async () => {
    const { ctx } = await harness([
      row('reels1', { grid: { cols: 2, rows: 2, rowsPerReel: [1] } }),
    ]);
    renderDocument(ctx);
    const section = screen.getByTestId('reels-section-board');
    expect(within(section).getByTestId('board-cell-0-1')).toBeInTheDocument();
    expect(within(section).getByTestId('board-cell-1-1')).toBeInTheDocument();
    expect(within(section).queryByTestId('board-cell-0-2')).toBeNull();
  });

  it('painting a cell writes reels1 with { ...config, board }', async () => {
    const { ctx, updateCalls } = await harness([
      row('reels1', { grid: { cols: 2, rows: 1 }, win: { glow: false } }),
    ]);
    renderDocument(ctx);
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
    renderDocument(ctx);
    const section = screen.getByTestId('reels-section-board');
    fireEvent.click(within(section).getByTestId('board-clear'));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toEqual({ id: 'reels1', config: { grid: { cols: 1, rows: 1 } } });
  });
});

describe('ReelsDocument — canvas sync', () => {
  it('sends the canvas every reel rows current config on ready, and just the written row after a successful write', async () => {
    const { ctx } = await harness([
      row('reels1', { grid: { cols: 5 } }),
      row('motion1', { style: 'swap' }),
    ]);
    renderDocument(ctx);
    const c = canvas();
    c.ready();
    await waitFor(() => expect(c.reqs('rows')).toHaveLength(1));
    expect(c.reqs('rows')[0]).toEqual({
      rows: [
        { id: 'reels1', config: { grid: { cols: 5 } } },
        { id: 'motion1', config: { style: 'swap' } },
      ],
    });

    // Final review M1: a write re-applies only the row it wrote — every
    // re-applied row rebuilds on the canvas, and the others did not change.
    fireEvent.change(screen.getByLabelText('cols'), { target: { value: '6' } });
    fireEvent.blur(screen.getByLabelText('cols'));
    await waitFor(() => expect(c.reqs('rows')).toHaveLength(2));
    expect(c.reqs('rows')[1]).toEqual({
      rows: [{ id: 'reels1', config: { grid: { cols: 6 } } }],
    });
  });

  // Final review M5: the canvas answers each row's verdict; a `failed` one
  // used to vanish.
  it("a row the canvas answers 'failed' for shows in reels-action-status", async () => {
    const { ctx } = await harness([row('reels1'), row('motion1')]);
    renderDocument(ctx);
    const c = canvas();
    c.setAnswer('rows', {
      results: [
        { id: 'reels1', result: 'failed' },
        { id: 'motion1', result: 'updated' },
      ],
    });
    c.ready();
    await waitFor(() =>
      expect(screen.getByTestId('reels-action-status')).toHaveTextContent(
        "couldn't apply reels1 on the canvas",
      ),
    );
  });

  it('a write that comes back with diagnostics does not re-send the canvas', async () => {
    const { ctx } = await harness([row('reels1')], {
      update: async () => ({ reload: false, diagnostics: [{ severity: 'error' }] as never }),
    });
    renderDocument(ctx);
    const c = canvas();
    fireEvent.change(screen.getByLabelText('cols'), { target: { value: '6' } });
    fireEvent.blur(screen.getByLabelText('cols'));
    await waitFor(() => expect(screen.getByLabelText('cols')).toHaveValue(6 as unknown as number));
    expect(c.reqs('rows')).toHaveLength(0);
  });
});

describe('ReelsDocument — canvas actions', () => {
  it('reels-action-spin sends spin', async () => {
    const { ctx } = await harness([row('reels1')]);
    renderDocument(ctx);
    const c = canvas();
    fireEvent.click(screen.getByTestId('reels-action-spin'));
    await waitFor(() => expect(c.reqs('spin')).toHaveLength(1));
  });

  it('reels-action-scatters sends anticipation1s triggerSymbols/threshold, defaulting when unset, and gates on presence/enabled', async () => {
    const { ctx, setRows } = await harness([row('reels1')]);
    renderDocument(ctx);
    expect(screen.getByTestId('reels-action-scatters')).toBeDisabled();

    setRows([row('reels1'), row('anticipation1', { enabled: true })]);
    expect(screen.getByTestId('reels-action-scatters')).toBeEnabled();
    const c = canvas();
    fireEvent.click(screen.getByTestId('reels-action-scatters'));
    await waitFor(() => expect(c.reqs('scatters')).toHaveLength(1));
    expect(c.reqs('scatters')[0]).toEqual({ triggers: ['scatter'], threshold: 2 });

    setRows([
      row('reels1'),
      row('anticipation1', { enabled: false, triggerSymbols: ['wild'], threshold: 3 }),
    ]);
    expect(screen.getByTestId('reels-action-scatters')).toBeDisabled();
  });

  // Fix round 1: `anticipation1` present with an EMPTY config — no
  // `enabled` key at all — is exactly what `e8-base` composes the row
  // with (its own schema default is `false`, and the bundle's comment
  // says so: "composed but OFF"). The gate used to read `enabled !==
  // false`, so an absent key (`undefined !== false`) came out enabled —
  // the opposite of the row's own stated default. Caught end to end in
  // `reels.spec.ts` against the real `first-slot` project, which is
  // exactly this shape (no patch touches `anticipation1` at all).
  it('reels-action-scatters is disabled with anticipation1 present but its config empty (the row default)', async () => {
    const { ctx } = await harness([row('reels1'), row('anticipation1', {})]);
    renderDocument(ctx);
    expect(screen.getByTestId('reels-action-scatters')).toBeDisabled();
  });

  // Final review M3/M4: an empty trigger list has nothing to seed a
  // scatter board with, and a disabled Scatters used to say nothing about why.
  it('reels-action-scatters is disabled with an empty trigger list, and says why it is disabled', async () => {
    const { ctx, setRows } = await harness([row('reels1'), row('anticipation1', {})]);
    renderDocument(ctx);
    const scatters = screen.getByTestId('reels-action-scatters');
    expect(scatters).toHaveAttribute('title', 'turn on Anticipation › enabled');

    setRows([row('reels1'), row('anticipation1', { enabled: true, triggerSymbols: [] })]);
    expect(scatters).toBeDisabled();
    expect(scatters).toHaveAttribute('title', 'no trigger symbols');

    setRows([row('reels1'), row('anticipation1', { enabled: true })]);
    expect(scatters).toBeEnabled();
    expect(scatters).not.toHaveAttribute('title');
  });

  it('reels-action-tumble exists only with cascade1', async () => {
    const { ctx, setRows } = await harness([row('reels1')]);
    renderDocument(ctx);
    expect(screen.queryByTestId('reels-action-tumble')).toBeNull();
    setRows([row('reels1'), row('cascade1')]);
    expect(screen.getByTestId('reels-action-tumble')).toBeInTheDocument();
  });

  it('while an action is in flight, all shown actions are disabled', async () => {
    const { ctx } = await harness([row('reels1'), row('cascade1')]);
    renderDocument(ctx);
    canvas();
    fireEvent.click(screen.getByTestId('reels-action-spin'));
    expect(screen.getByTestId('reels-action-spin')).toBeDisabled();
    expect(screen.getByTestId('reels-action-win')).toBeDisabled();
    expect(screen.getByTestId('reels-action-tumble')).toBeDisabled();
    expect(screen.getByTestId('reels-action-scatters')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('reels-action-spin')).toBeEnabled());
  });

  it('an { ok: false, reason } answer shows in reels-action-status', async () => {
    const { ctx } = await harness([row('reels1')]);
    renderDocument(ctx);
    const c = canvas();
    c.setAnswer('spin', { ok: false, reason: 'no symbols' });
    fireEvent.click(screen.getByTestId('reels-action-spin'));
    await waitFor(() =>
      expect(screen.getByTestId('reels-action-status')).toHaveTextContent('no symbols'),
    );
  });
});
