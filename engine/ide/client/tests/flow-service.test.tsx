import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic, FlowDoc, FlowKindInfo, FlowTraceEntry } from '@energy8engine/contracts';
import { harness, renderDocument, type Answer } from './flow-harness';

/** The service's own tests; the harness is shared with `flow-document.test.tsx`. */
const DOC: FlowDoc = {
  version: 1,
  nodes: [{ id: 'start', kind: 'boot', ui: { x: 40, y: 80 } }],
  edges: [],
};
const KINDS: FlowKindInfo[] = [{ kind: 'boot', outs: ['ok'], trigger: true, schema: {} }];
const refusal: Diagnostic = {
  severity: 'error',
  plugin: 'flow',
  where: 'flow.yml',
  message: 'bad node',
};

const boot =
  (body: unknown = { doc: DOC, diagnostics: [], kinds: [] }) =>
  () => ({ body });

describe('flow service', () => {
  it('boots from GET /api/flow, updates on `flow` and `flow-kinds` frames', async () => {
    const { ctx, socket, calls } = await harness({ 'GET /api/flow': boot() });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));
    expect(calls).toEqual([{ method: 'GET', url: '/api/flow', body: undefined }]);
    expect(ctx.flow.kinds()).toEqual([]);

    const listener = vi.fn();
    ctx.flow.subscribe(listener);
    const doc2: FlowDoc = { version: 1, nodes: [], edges: [] };
    socket.receive({ type: 'flow', doc: doc2, diagnostics: [refusal] });
    expect(ctx.flow.doc()).toEqual(doc2);
    expect(ctx.flow.diagnostics()).toEqual([refusal]);
    socket.receive({ type: 'flow-kinds', kinds: KINDS });
    expect(ctx.flow.kinds()).toEqual(KINDS);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a frame that arrives before the boot GET resolves wins', async () => {
    let resolveGet!: (answer: Answer) => void;
    const pending = new Promise<Answer>((resolve) => {
      resolveGet = resolve;
    });
    const { ctx, socket } = await harness({ 'GET /api/flow': () => pending });

    socket.receive({ type: 'flow', doc: DOC, diagnostics: [] });
    expect(ctx.flow.doc()).toEqual(DOC);

    resolveGet({ body: { doc: null, diagnostics: [], kinds: KINDS } });
    // The GET's `kinds` is newer than nothing and does land; its `doc` does not.
    await vi.waitFor(() => expect(ctx.flow.kinds()).toEqual(KINDS));
    expect(ctx.flow.doc()).toEqual(DOC);
  });

  it("a flow-kinds frame that arrives before the boot GET resolves wins over the GET's own kinds", async () => {
    let resolveGet!: (answer: Answer) => void;
    const pending = new Promise<Answer>((resolve) => {
      resolveGet = resolve;
    });
    const { ctx, socket } = await harness({ 'GET /api/flow': () => pending });

    socket.receive({ type: 'flow-kinds', kinds: KINDS });
    expect(ctx.flow.kinds()).toEqual(KINDS);

    const otherKinds: FlowKindInfo[] = [{ kind: 'wait', outs: [], trigger: false, schema: {} }];
    resolveGet({ body: { doc: DOC, diagnostics: [], kinds: otherKinds } });
    // The GET's `doc` is newer than nothing and does land; its `kinds` do not.
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));
    expect(ctx.flow.kinds()).toEqual(KINDS);
  });

  it('registers the activity that opens the flow document', async () => {
    const { ctx } = await harness({ 'GET /api/flow': boot() });
    expect(ctx.slots.list('shell.activity')).toEqual([
      expect.objectContaining({ key: 'flow', icon: 'git-branch', order: 36, opens: 'document' }),
    ]);
  });

  it('update PUTs the document and applies the answer; a refusal returns the host diagnostics', async () => {
    const changed: FlowDoc = { version: 1, nodes: [], edges: [] };
    const { ctx, calls } = await harness({
      'GET /api/flow': boot(),
      'PUT /api/flow': (body) =>
        (body as FlowDoc).nodes.length === 0
          ? { body: { doc: changed, diagnostics: [], kinds: KINDS } }
          : { status: 400, body: { diagnostics: [refusal] } },
    });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));

    expect(await ctx.flow.update(changed)).toEqual([]);
    expect(calls[1]).toEqual({ method: 'PUT', url: '/api/flow', body: changed });
    expect(ctx.flow.doc()).toEqual(changed);
    expect(ctx.flow.kinds()).toEqual(KINDS);

    expect(await ctx.flow.update(DOC)).toEqual([refusal]);
    // A host refusal is the host's to say; it is not re-reported as this plugin's.
    expect(ctx.connection.diagnostics).toEqual([]);
    // The refused write leaves the last-applied document alone.
    expect(ctx.flow.doc()).toEqual(changed);
  });

  it('an accepted update records a step under "flow"; undo PUTs the before doc and is not re-recorded; redo PUTs the after doc', async () => {
    const after: FlowDoc = { version: 1, nodes: [], edges: [] };
    const { ctx, calls } = await harness({
      'GET /api/flow': boot(),
      // Echoes back whatever was PUT — the person's edit, the undo's
      // write and the redo's write all go through this same route.
      'PUT /api/flow': (body) => ({ body: { doc: body, diagnostics: [], kinds: KINDS } }),
    });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));

    expect(await ctx.flow.update(after)).toEqual([]);
    expect(calls).toHaveLength(2);

    expect(await ctx.history.undo(['flow'])).toEqual({ kind: 'undo', ok: true, label: 'flow' });
    expect(calls.at(-1)).toEqual({ method: 'PUT', url: '/api/flow', body: DOC });
    expect(ctx.flow.doc()).toEqual(DOC);
    // The undo's own write is not recorded as a fresh step.
    expect(await ctx.history.undo(['flow'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });

    expect(await ctx.history.redo(['flow'])).toEqual({ kind: 'redo', ok: true, label: 'flow' });
    expect(calls.at(-1)).toEqual({ method: 'PUT', url: '/api/flow', body: after });
  });

  it('a PUT answered 200 with a warning still records a step (only a non-2xx is a refusal); undo writes the before doc', async () => {
    const after: FlowDoc = {
      version: 1,
      nodes: [{ id: 'n', kind: 'boot', ui: { x: 0, y: 0 } }],
      edges: [],
    };
    const warning: Diagnostic = {
      severity: 'warning',
      plugin: 'flow',
      where: 'n',
      message: 'has no incoming edge',
    };
    const { ctx, calls } = await harness({
      'GET /api/flow': boot(),
      'PUT /api/flow': (body) => ({ body: { doc: body, diagnostics: [warning], kinds: [] } }),
    });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));

    expect(await ctx.flow.update(after)).toEqual([]);
    expect(ctx.flow.diagnostics()).toEqual([warning]);

    expect(await ctx.history.undo(['flow'])).toEqual({ kind: 'undo', ok: true, label: 'flow' });
    expect(calls.at(-1)).toEqual({ method: 'PUT', url: '/api/flow', body: DOC });
    expect(ctx.flow.doc()).toEqual(DOC);
  });

  it('an undo pressed while a write is in flight refuses instead of racing it; the next write settling makes undo work again', async () => {
    const v0: FlowDoc = {
      version: 1,
      nodes: [{ id: 'start', kind: 'boot', ui: { x: 0, y: 0 } }],
      edges: [],
    };
    const v1: FlowDoc = { version: 1, nodes: [], edges: [] };
    let resolvePut!: (answer: { body: unknown }) => void;
    const pendingPut = new Promise<{ body: unknown }>((resolve) => {
      resolvePut = resolve;
    });
    let puts = 0;
    const { ctx, calls } = await harness({
      'GET /api/flow': boot(),
      'PUT /api/flow': () => {
        puts += 1;
        // The first write (setting up a step to try to undo) answers at
        // once; the second — the one "in flight" when undo is pressed —
        // is held until the test releases it.
        return puts === 1 ? { body: { doc: v0, diagnostics: [], kinds: [] } } : pendingPut;
      },
    });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));

    expect(await ctx.flow.update(v0)).toEqual([]);

    const inFlight = ctx.flow.update(v1);
    const callsBeforeUndo = calls.length;

    expect(await ctx.history.undo(['flow'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: "changed elsewhere since — can't undo",
    });
    // Refused before ever writing — no PUT went out for the undo attempt.
    expect(calls).toHaveLength(callsBeforeUndo);

    resolvePut({ body: { doc: v1, diagnostics: [], kinds: [] } });
    expect(await inFlight).toEqual([]);

    // The write that just settled recorded its OWN step; undo now targets that one.
    expect(await ctx.history.undo(['flow'])).toEqual({ kind: 'undo', ok: true, label: 'flow' });
    expect(calls.at(-1)).toEqual({ method: 'PUT', url: '/api/flow', body: v0 });
  });

  it('a refused update records nothing', async () => {
    const { ctx } = await harness({
      'GET /api/flow': boot(),
      'PUT /api/flow': () => ({ status: 400, body: { diagnostics: [refusal] } }),
    });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));

    expect(await ctx.flow.update({ version: 1, nodes: [], edges: [] })).toEqual([refusal]);
    expect(await ctx.history.undo(['flow'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
  });

  it('the write that creates flow.yml (doc was null) records nothing — undo would need a delete', async () => {
    const { ctx, calls } = await harness({
      'GET /api/flow': boot({ doc: null, diagnostics: [], kinds: [] }),
      'PUT /api/flow': () => ({ body: { doc: DOC, diagnostics: [], kinds: [] } }),
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(await ctx.flow.update(DOC)).toEqual([]);
    expect(await ctx.history.undo(['flow'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
  });

  it('the flow tab scope is exactly "flow"', async () => {
    const { ctx } = await harness({ 'GET /api/flow': boot() });
    expect(ctx.history.keysFor('flow')).toEqual(['flow']);
    expect(ctx.history.keysFor('scene:a')).toEqual([]);
  });

  it('a transport failure on update is one diagnostic of its own, returned and reported', async () => {
    const { ctx } = await harness({
      'GET /api/flow': boot(),
      'PUT /api/flow': () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));
    const answer = await ctx.flow.update(DOC);
    expect(answer).toEqual([
      expect.objectContaining({ plugin: 'flow', where: '/api/flow', severity: 'error' }),
    ]);
    expect(answer[0].message).toContain('ECONNREFUSED');
    expect(ctx.connection.diagnostics).toEqual(answer);
  });

  it('flow-trace entries append, cap at 500, and a different run drops the previous run\'s entries', async () => {
    const { ctx, socket } = await harness({ 'GET /api/flow': boot() });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));

    const entry = (run: number, node: string, at: number): FlowTraceEntry => ({
      run,
      node,
      out: null,
      at,
    });
    socket.receive({ type: 'flow-trace', entries: [entry(1, 'start', 0)] });
    const first = ctx.flow.trace();
    socket.receive({ type: 'flow-trace', entries: [entry(1, 'a', 1)] });
    expect(ctx.flow.trace()).toEqual([entry(1, 'start', 0), entry(1, 'a', 1)]);
    // A later frame of the same run is a new array — what a React effect keyed on it sees.
    expect(ctx.flow.trace()).not.toBe(first);
    expect(first).toEqual([entry(1, 'start', 0)]);

    // A higher run number drops the older run's entries first.
    socket.receive({ type: 'flow-trace', entries: [entry(2, 'start', 2)] });
    expect(ctx.flow.trace()).toEqual([entry(2, 'start', 2)]);

    // A LOWER run number is a new run too, not a stale one: the interpreter's
    // counter restarts at 1 on every `replace` (a node drag, a reload).
    socket.receive({ type: 'flow-trace', entries: [entry(1, 'again', 3)] });
    expect(ctx.flow.trace()).toEqual([entry(1, 'again', 3)]);
    socket.receive({ type: 'flow-trace', entries: [entry(2, 'start', 4)] });
    expect(ctx.flow.trace()).toEqual([entry(2, 'start', 4)]);

    // Capped at 500: pushing past the cap drops the oldest of this run.
    const many = Array.from({ length: 500 }, (_, i) => entry(2, `n${i}`, i + 10));
    socket.receive({ type: 'flow-trace', entries: many });
    expect(ctx.flow.trace()).toHaveLength(500);
    expect(ctx.flow.trace()[0]).toEqual(entry(2, 'n0', 10));

    socket.receive({ type: 'flow-trace', entries: [entry(2, 'overflow', 999)] });
    expect(ctx.flow.trace()).toHaveLength(500);
    expect(ctx.flow.trace().at(-1)).toEqual(entry(2, 'overflow', 999));
    expect(ctx.flow.trace()[0]).toEqual(entry(2, 'n1', 11));
  });

  it('run 3, then run 1 (the counter reset by a replace): the trace holds run 1\'s entries', async () => {
    const { ctx, socket } = await harness({ 'GET /api/flow': boot() });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));

    const entry = (run: number, node: string, at: number): FlowTraceEntry => ({
      run,
      node,
      out: null,
      at,
    });
    socket.receive({ type: 'flow-trace', entries: [entry(3, 'idle', 0), entry(3, 'spin', 1)] });
    expect(ctx.flow.trace()).toEqual([entry(3, 'idle', 0), entry(3, 'spin', 1)]);
    socket.receive({ type: 'flow-trace', entries: [entry(1, 'start', 2)] });
    socket.receive({ type: 'flow-trace', entries: [entry(1, 'base', 3)] });
    expect(ctx.flow.trace()).toEqual([entry(1, 'start', 2), entry(1, 'base', 3)]);
  });

  it('one flow-trace frame carrying two runs keeps only the later run\'s entries', async () => {
    const { ctx, socket } = await harness({ 'GET /api/flow': boot() });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));

    const entry = (run: number, node: string, at: number): FlowTraceEntry => ({
      run,
      node,
      out: null,
      at,
    });
    socket.receive({
      type: 'flow-trace',
      entries: [entry(1, 'start', 0), entry(1, 'a', 1), entry(2, 'start', 2), entry(2, 'b', 3)],
    });
    expect(ctx.flow.trace()).toEqual([entry(2, 'start', 2), entry(2, 'b', 3)]);
  });

  it('select is state only — no request, and does not renotify an unchanged selection', async () => {
    const { ctx, calls } = await harness({ 'GET /api/flow': boot() });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));
    const before = calls.length;
    const listener = vi.fn();
    ctx.flow.subscribe(listener);

    ctx.flow.select('start');
    expect(ctx.flow.selected()).toBe('start');
    expect(listener).toHaveBeenCalledTimes(1);

    ctx.flow.select('start');
    expect(listener).toHaveBeenCalledTimes(1);

    ctx.flow.select(null);
    expect(ctx.flow.selected()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    expect(calls).toHaveLength(before);
  });

  it('FlowDocument renders flow-empty, and the create button PUTs the one-boot doc', async () => {
    const { ctx, calls } = await harness({
      'GET /api/flow': boot({ doc: null, diagnostics: [], kinds: [] }),
      'PUT /api/flow': () => ({ body: { doc: DOC, diagnostics: [], kinds: [] } }),
    });
    const user = userEvent.setup();
    renderDocument(ctx);
    expect(await screen.findByTestId('flow-empty')).toHaveTextContent('no flow.yml — create one');
    expect(screen.queryByTestId('flow-canvas')).toBeNull();

    await user.click(screen.getByTestId('flow-create'));
    await vi.waitFor(() =>
      expect(calls.at(-1)).toEqual({ method: 'PUT', url: '/api/flow', body: DOC }),
    );
  });

  it('FlowDocument renders flow-broken (no create button) for an existing-but-unparseable flow.yml', async () => {
    const { ctx } = await harness({
      'GET /api/flow': boot({ doc: null, diagnostics: [refusal], kinds: [] }),
    });
    renderDocument(ctx);
    expect(await screen.findByTestId('flow-broken')).toHaveTextContent(refusal.message);
    expect(screen.queryByTestId('flow-empty')).toBeNull();
    expect(screen.queryByTestId('flow-create')).toBeNull();
    expect(screen.queryByTestId('flow-canvas')).toBeNull();
  });

  it('FlowDocument renders the canvas placeholder and diagnostics once a flow.yml exists', async () => {
    const { ctx } = await harness({
      'GET /api/flow': boot({ doc: DOC, diagnostics: [refusal], kinds: [] }),
    });
    renderDocument(ctx);
    expect(await screen.findByTestId('flow-canvas')).toBeTruthy();
    expect(screen.getByTestId('flow-diagnostics')).toHaveTextContent(
      'error: flow.yml — bad node',
    );
    expect(screen.queryByTestId('flow-empty')).toBeNull();
  });
});
