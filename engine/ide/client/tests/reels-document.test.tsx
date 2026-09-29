import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentMeta } from '../src/plugins/shell';
import type { SlotMeta } from '../src/plugins/slots';
import { CANVAS_SILENT } from '../src/shell/useCanvasSilence';
import { canvas, harness, renderDocument, renderSettings, row } from './reels-harness';

/**
 * The Reels document standalone: the toolbar and the reel lab canvas —
 * the sections that edit `reels1`/`motion1`/`anticipation1`/`cascade1`/
 * `features1`'s config are `ReelsSettings` now (`reels-settings.test.tsx`),
 * the tab's own right sidebar; this document never renders a form and
 * never writes — it only follows `ctx.gameComposition`'s rows and
 * re-applies whichever reel row's config changed to the canvas.
 */
describe('reels plugin — presence', () => {
  it('registers no activity/document/sideRight with no reels1 row; one arriving later registers them', async () => {
    const { ctx, setRows } = await harness([]);
    expect(ctx.slots.list('shell.activity').find((e) => e.key === 'reels')).toBeUndefined();
    expect(ctx.slots.list('shell.document').find((e) => e.key === 'reels')).toBeUndefined();
    expect(ctx.slots.list('shell.sideRight').find((e) => e.key === 'reels')).toBeUndefined();

    setRows([row('reels1')]);
    expect(ctx.slots.list('shell.activity').find((e) => e.key === 'reels')).toBeDefined();
    const doc = ctx.slots
      .list<SlotMeta & DocumentMeta>('shell.document')
      .find((e) => e.key === 'reels');
    expect(doc?.sideRight).toBe('reels');
    expect(ctx.slots.list('shell.sideRight').find((e) => e.key === 'reels')).toBeDefined();
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
    expect(ctx.slots.list('shell.sideRight').find((e) => e.key === 'reels')).toBeUndefined();
  });

  it('registers the history scope with reels1 present (the five reel row keys), and drops it when reels1 goes', async () => {
    const { ctx, setRows } = await harness([]);
    expect(ctx.history.keysFor('reels')).toEqual([]);

    setRows([row('reels1')]);
    expect(ctx.history.keysFor('reels')).toEqual([
      'row:reels1',
      'row:motion1',
      'row:anticipation1',
      'row:cascade1',
      'row:features1',
    ]);

    setRows([]);
    expect(ctx.history.keysFor('reels')).toEqual([]);
  });

  it('setSideRight("reels", …) follows the reels1 rows presence, shown once the Reels tab is active', async () => {
    const { ctx, setRows } = await harness([row('reels1')]);
    ctx.shell.openContributed('reels');
    expect(ctx.shell.sideRight()).toBe('reels');

    setRows([]);
    expect(ctx.shell.sideRight()).toBeUndefined();

    setRows([row('reels1')]);
    ctx.shell.openContributed('reels');
    expect(ctx.shell.sideRight()).toBe('reels');
  });
});

describe('ReelsDocument — no sections', () => {
  it('renders no section and no reels-settings, whatever rows are present', async () => {
    const { ctx } = await harness([
      row('reels1'),
      row('motion1'),
      row('anticipation1'),
      row('cascade1'),
      row('features1'),
    ]);
    renderDocument(ctx);
    for (const name of ['grid', 'win', 'board', 'motion', 'anticipation', 'cascade', 'features']) {
      expect(screen.queryByTestId(`reels-section-${name}`)).toBeNull();
    }
    expect(screen.queryByTestId('reels-settings')).toBeNull();
    expect(screen.getByTestId('reels-doc')).toBeInTheDocument();
    expect(screen.getByTestId('reels-toolbar')).toBeInTheDocument();
  });
});

describe('ReelsDocument — canvas sync', () => {
  it('sends the canvas every present reel rows current config on ready, and nothing before it', async () => {
    const { ctx } = await harness([
      row('reels1', { grid: { cols: 5 } }),
      row('motion1', { style: 'swap' }),
    ]);
    renderDocument(ctx);
    const c = canvas();
    expect(c.reqs('rows')).toHaveLength(0);
    c.ready();
    await waitFor(() => expect(c.reqs('rows')).toHaveLength(1));
    expect(c.reqs('rows')[0]).toEqual({
      rows: [
        { id: 'reels1', config: { grid: { cols: 5 } } },
        { id: 'motion1', config: { style: 'swap' } },
      ],
    });
  });

  // An edit reaching the composition from anywhere — the Composition
  // screen, a remote frame, the settings sidebar — re-applies on the
  // canvas: only the row whose config actually changed, and only once.
  it('a reels1 config change pushed as a composition frame re-applies just that row', async () => {
    const { ctx, setRows } = await harness([
      row('reels1', { grid: { cols: 5 } }),
      row('motion1', { style: 'swap' }),
    ]);
    renderDocument(ctx);
    const c = canvas();
    c.ready();
    await waitFor(() => expect(c.reqs('rows')).toHaveLength(1));

    setRows([row('reels1', { grid: { cols: 6 } }), row('motion1', { style: 'swap' })]);
    await waitFor(() => expect(c.reqs('rows')).toHaveLength(2));
    expect(c.reqs('rows')[1]).toEqual({
      rows: [{ id: 'reels1', config: { grid: { cols: 6 } } }],
    });
  });

  it('a frame where no reel row changed sends nothing', async () => {
    const { ctx, setRows } = await harness([row('reels1'), row('motion1')]);
    renderDocument(ctx);
    const c = canvas();
    c.ready();
    await waitFor(() => expect(c.reqs('rows')).toHaveLength(1));

    setRows([row('reels1'), row('motion1')]); // a fresh array, identical configs
    await act(async () => {});
    expect(c.reqs('rows')).toHaveLength(1);
  });

  it('a non-reel row change sends nothing', async () => {
    const { ctx, setRows } = await harness([row('reels1')]);
    renderDocument(ctx);
    const c = canvas();
    c.ready();
    await waitFor(() => expect(c.reqs('rows')).toHaveLength(1));

    setRows([row('reels1'), row('other1', { x: 1 })]);
    await act(async () => {});
    expect(c.reqs('rows')).toHaveLength(1);
  });

  // A settings write the host answers with diagnostics leaves the row's
  // config as it was, so the canvas has nothing new to apply.
  it('a write that comes back with diagnostics does not re-send the canvas', async () => {
    const { ctx, updateCalls } = await harness([row('reels1', { grid: { cols: 5 } })], {
      update: async () => ({ reload: false, diagnostics: [{ severity: 'error' }] }),
    });
    renderDocument(ctx);
    renderSettings(ctx);
    const c = canvas();
    c.ready();
    await waitFor(() => expect(c.reqs('rows')).toHaveLength(1));

    const cols = screen.getByLabelText('cols');
    fireEvent.change(cols, { target: { value: '6' } });
    fireEvent.blur(cols);
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    await act(async () => {});
    expect(c.reqs('rows')).toHaveLength(1);
  });

  // A row the canvas answers each verdict for; a `failed` one shows.
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

  // `anticipation1` present with an EMPTY config — no `enabled` key at all
  // — is exactly what `e8-base` composes the row with (its own schema
  // default is `false`, and the bundle's comment says so: "composed but
  // OFF"). Caught end to end in `reels.spec.ts` against the real
  // `first-slot` project, which is exactly this shape (no patch touches
  // `anticipation1` at all).
  it('reels-action-scatters is disabled with anticipation1 present but its config empty (the row default)', async () => {
    const { ctx } = await harness([row('reels1'), row('anticipation1', {})]);
    renderDocument(ctx);
    expect(screen.getByTestId('reels-action-scatters')).toBeDisabled();
  });

  // An empty trigger list has nothing to seed a scatter board with, and a
  // disabled Scatters says why it is disabled.
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

describe('ReelsDocument — canvas error/silence', () => {
  it("the canvas' own error event shows its message in reels-action-status", async () => {
    const { ctx } = await harness([row('reels1')]);
    renderDocument(ctx);
    const c = canvas();
    c.error({ message: 'boom' });
    expect(await screen.findByTestId('reels-action-status')).toHaveTextContent('boom');
  });

  it('no ready within 10s of mount shows the silence text', async () => {
    const { ctx } = await harness([row('reels1')]);
    vi.useFakeTimers();
    try {
      renderDocument(ctx);
      canvas();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.getByTestId('reels-action-status')).toHaveTextContent(CANVAS_SILENT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a ready before 10s means no silence text', async () => {
    const { ctx } = await harness([row('reels1')]);
    vi.useFakeTimers();
    try {
      renderDocument(ctx);
      const c = canvas();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      c.ready();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.getByTestId('reels-action-status')).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });

  // An error, then a remount (a new canvas key) that DOES answer ready —
  // the old error must not survive over a working canvas.
  it('an error, then a remount and ready, clears the status', async () => {
    const { ctx, bumpReloads } = await harness([row('reels1')]);
    renderDocument(ctx);
    const c1 = canvas();
    c1.error({ message: 'boom' });
    expect(await screen.findByTestId('reels-action-status')).toHaveTextContent('boom');

    bumpReloads(); // a new canvasKey: the iframe remounts
    const c2 = canvas();
    c2.ready();
    expect(screen.getByTestId('reels-action-status')).toHaveTextContent('');
  });

  // An `error` counts as the canvas answering too — its own message must
  // outlive the silence timer, not get overwritten by CANVAS_SILENT.
  it('an error with no ready after it: the error text survives past 10s', async () => {
    const { ctx } = await harness([row('reels1')]);
    vi.useFakeTimers();
    try {
      renderDocument(ctx);
      const c = canvas();
      c.error({ message: 'boom' });
      expect(screen.getByTestId('reels-action-status')).toHaveTextContent('boom');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.getByTestId('reels-action-status')).toHaveTextContent('boom');
    } finally {
      vi.useRealTimers();
    }
  });

  it('no preview address: no canvas, so no silence text — none left over once a canvas appears', async () => {
    const { ctx, setPreviewUrl } = await harness([row('reels1')], { previewUrl: null });
    vi.useFakeTimers();
    try {
      renderDocument(ctx);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      setPreviewUrl('http://127.0.0.1:5682');
      canvas();
      expect(screen.getByTestId('reels-action-status')).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });

  it("a status the canvas did not set (a row it couldn't apply) survives a later ready", async () => {
    const { ctx } = await harness([row('reels1')]);
    renderDocument(ctx);
    const c = canvas();
    c.setAnswer('rows', { results: [{ id: 'reels1', result: 'failed' }] });
    c.ready();
    await waitFor(() =>
      expect(screen.getByTestId('reels-action-status')).toHaveTextContent(
        "couldn't apply reels1 on the canvas",
      ),
    );
    c.setAnswer('rows', { results: [{ id: 'reels1', result: 'updated' }] });
    c.ready();
    await act(async () => {});
    expect(screen.getByTestId('reels-action-status')).toHaveTextContent(
      "couldn't apply reels1 on the canvas",
    );
  });
});
