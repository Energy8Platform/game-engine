import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic, SymbolsDoc } from '@energy8engine/contracts';
import { addSymbol, EMPTY } from '../src/shell/symbols-doc';
import { accept, boot, harness, KNOWN, TWO, type Answer } from './symbols-harness';

/** The service's own tests; the harness is shared with the document and Properties tests. */
const refusal: Diagnostic = {
  severity: 'error',
  plugin: 'symbols',
  where: 'symbols/1',
  message: 'a symbol needs an id',
};

describe('symbols service', () => {
  it('boots from GET /api/symbols (doc, known, diagnostics) and updates on `symbols` frames', async () => {
    const { ctx, socket, calls } = await harness({
      'GET /api/symbols': boot({ doc: TWO, known: KNOWN, diagnostics: [refusal] }),
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(TWO));
    expect(calls.filter((c) => c.url === '/api/symbols')).toEqual([
      { method: 'GET', url: '/api/symbols', body: undefined },
    ]);
    expect(ctx.symbols.known()).toEqual(KNOWN);
    expect(ctx.symbols.diagnostics()).toEqual([refusal]);

    const listener = vi.fn();
    ctx.symbols.subscribe(listener);
    socket.receive({ type: 'symbols', doc: EMPTY, diagnostics: [] });
    expect(ctx.symbols.doc()).toEqual(EMPTY);
    expect(ctx.symbols.diagnostics()).toEqual([]);
    // A frame carries no `known` of its own (unlike the GET/PUT answers
    // above) — the harness's default `game/spec.json` still answers
    // `KNOWN`, so the re-read this frame triggers lands the same value.
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(ctx.symbols.known()).toEqual(KNOWN));
  });

  it('a `symbols` frame re-reads `game/spec.json` and refreshes `known`', async () => {
    const grape = [{ id: '3', name: 'grape' }];
    const { ctx, socket } = await harness({
      'GET /api/symbols': boot({ doc: TWO, known: KNOWN, diagnostics: [] }),
      'GET /api/files/game/spec.json': () => ({ body: { symbols: grape } }),
    });
    await vi.waitFor(() => expect(ctx.symbols.known()).toEqual(KNOWN));
    const listener = vi.fn();
    ctx.symbols.subscribe(listener);
    socket.receive({ type: 'symbols', doc: TWO, diagnostics: [] });
    // The doc/diagnostics half of the frame applies at once...
    expect(listener).toHaveBeenCalledTimes(1);
    // ...`known` lands once the re-read resolves, same shape `game/spec.json`'s own field answers with.
    await vi.waitFor(() => expect(ctx.symbols.known()).toEqual(grape));
  });

  it('a `symbols` frame with no readable `game/spec.json` (missing, bad JSON) empties `known`, same as the host would report it', async () => {
    const { ctx, socket } = await harness({
      'GET /api/symbols': boot({ doc: TWO, known: KNOWN, diagnostics: [] }),
      'GET /api/files/game/spec.json': () => ({ status: 404, body: { diagnostics: [] } }),
    });
    await vi.waitFor(() => expect(ctx.symbols.known()).toEqual(KNOWN));
    socket.receive({ type: 'symbols', doc: TWO, diagnostics: [] });
    await vi.waitFor(() => expect(ctx.symbols.known()).toEqual([]));
  });

  it("a frame that arrives before the boot GET resolves wins; the GET's `known` still lands", async () => {
    let resolveGet!: (answer: Answer) => void;
    const pending = new Promise<Answer>((resolve) => {
      resolveGet = resolve;
    });
    const { ctx, socket } = await harness({ 'GET /api/symbols': () => pending });
    socket.receive({ type: 'symbols', doc: TWO, diagnostics: [] });
    expect(ctx.symbols.doc()).toEqual(TWO);
    resolveGet({ body: { doc: null, known: KNOWN, diagnostics: [refusal] } });
    await vi.waitFor(() => expect(ctx.symbols.known()).toEqual(KNOWN));
    expect(ctx.symbols.doc()).toEqual(TWO);
    expect(ctx.symbols.diagnostics()).toEqual([]);
  });

  it('two overlapping reducer `update`s apply in order on the latest doc — neither drops the other', async () => {
    const { ctx } = await harness({
      'GET /api/symbols': boot({ doc: EMPTY, known: KNOWN, diagnostics: [] }),
      'PUT /api/symbols': accept,
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(EMPTY));
    const first = ctx.symbols.update((d) => addSymbol(d, '1', 'cherry'));
    const second = ctx.symbols.update((d) => addSymbol(d, '2', 'lemon'));
    await Promise.all([first, second]);
    expect(ctx.symbols.doc()!.symbols.map((s) => s.id)).toEqual(['1', '2']);
  });

  it('a reducer that throws rejects its own `update`; the next one still runs — the chain does not wedge', async () => {
    const { ctx } = await harness({
      'GET /api/symbols': boot({ doc: EMPTY, known: KNOWN, diagnostics: [] }),
      'PUT /api/symbols': accept,
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(EMPTY));
    const broken = ctx.symbols.update(() => {
      throw new Error('reducer bug');
    });
    const next = ctx.symbols.update((d) => addSymbol(d, '1', 'cherry'));
    await expect(broken).rejects.toThrow('reducer bug');
    expect(await next).toEqual([]);
    expect(ctx.symbols.doc()!.symbols.map((s) => s.id)).toEqual(['1']);
  });

  it('a reducer that reduces to the same doc (by reference) skips the PUT', async () => {
    const { ctx, calls } = await harness({
      'GET /api/symbols': boot({ doc: TWO, known: KNOWN, diagnostics: [] }),
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(TWO));
    const before = calls.length;
    expect(await ctx.symbols.update((d) => d)).toEqual([]);
    expect(calls).toHaveLength(before);
  });

  it('a failed boot GET is one diagnostic of its own; doc stays null, known empty', async () => {
    const { ctx } = await harness({
      'GET /api/symbols': () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await vi.waitFor(() => expect(ctx.symbols.diagnostics()).toHaveLength(1));
    expect(ctx.symbols.diagnostics()[0]).toEqual(
      expect.objectContaining({ plugin: 'symbols', where: '/api/symbols', severity: 'error' }),
    );
    expect(ctx.symbols.diagnostics()[0].message).toContain('ECONNREFUSED');
    expect(ctx.symbols.doc()).toBeNull();
    expect(ctx.symbols.known()).toEqual([]);
  });

  it('registers the activity (order 37, opens the document), the document and the right side', async () => {
    const { ctx } = await harness({ 'GET /api/symbols': boot() });
    expect(ctx.slots.list('shell.activity')).toContainEqual(
      expect.objectContaining({ key: 'symbols', title: 'Symbols', order: 37, opens: 'document' }),
    );
    expect(ctx.slots.list('shell.document')).toContainEqual(
      expect.objectContaining({ key: 'symbols', closable: false }),
    );
    expect(ctx.slots.list('shell.sideRight')).toContainEqual(
      expect.objectContaining({ key: 'symbols', title: 'Properties' }),
    );
  });

  it('update PUTs { doc } and applies the answer; a refusal returns the host diagnostics, unreported', async () => {
    const changed: SymbolsDoc = { version: 1, symbols: [TWO.symbols[0]] };
    const known2 = [{ id: '1', name: 'cherry' }];
    const { ctx, calls } = await harness({
      'GET /api/symbols': boot(),
      'PUT /api/symbols': (body) =>
        (body as { doc: SymbolsDoc }).doc.symbols.length === 1
          ? { body: { doc: changed, known: known2, diagnostics: [] } }
          : { status: 400, body: { diagnostics: [refusal] } },
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(TWO));

    expect(await ctx.symbols.update(changed)).toEqual([]);
    expect(calls.at(-1)).toEqual({ method: 'PUT', url: '/api/symbols', body: { doc: changed } });
    expect(ctx.symbols.doc()).toEqual(changed);
    expect(ctx.symbols.known()).toEqual(known2);

    expect(await ctx.symbols.update(TWO)).toEqual([refusal]);
    expect(ctx.connection.diagnostics).toEqual([]);
    expect(ctx.symbols.doc()).toEqual(changed);
  });

  it('an accepted update records a step under "symbols"; undo PUTs the before doc and is not re-recorded; redo PUTs the after doc', async () => {
    const after: SymbolsDoc = { version: 1, symbols: [TWO.symbols[0]] };
    const { ctx, puts } = await harness({ 'GET /api/symbols': boot(), 'PUT /api/symbols': accept });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(TWO));

    expect(await ctx.symbols.update(after)).toEqual([]);
    expect(puts()).toEqual([{ doc: after }]);

    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: true,
      label: 'symbols',
    });
    expect(puts().at(-1)).toEqual({ doc: TWO });
    expect(ctx.symbols.doc()).toEqual(TWO);
    // The undo's own write is not recorded as a fresh step.
    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });

    expect(await ctx.history.redo(['symbols'])).toEqual({
      kind: 'redo',
      ok: true,
      label: 'symbols',
    });
    expect(puts().at(-1)).toEqual({ doc: after });
  });

  it('a refused update records nothing', async () => {
    const { ctx } = await harness({
      'GET /api/symbols': boot(),
      'PUT /api/symbols': () => ({ status: 400, body: { diagnostics: [refusal] } }),
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(TWO));

    expect(await ctx.symbols.update(TWO)).toEqual([refusal]);
    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
  });

  it('a reducer write records the doc it produced; before is the doc the queue ran it on', async () => {
    const { ctx, puts } = await harness({
      'GET /api/symbols': boot({ doc: EMPTY, known: KNOWN, diagnostics: [] }),
      'PUT /api/symbols': accept,
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(EMPTY));

    expect(await ctx.symbols.update((d) => addSymbol(d, '1', 'cherry'))).toEqual([]);
    expect(ctx.symbols.doc()!.symbols.map((s) => s.id)).toEqual(['1']);

    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: true,
      label: 'symbols',
    });
    expect(puts().at(-1)).toEqual({ doc: EMPTY });
    expect(ctx.symbols.doc()).toEqual(EMPTY);
    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
  });

  it('two back-to-back reducer writes each record their own step; undo #1 then #2 both succeed with the right bodies', async () => {
    const { ctx, puts } = await harness({
      'GET /api/symbols': boot({ doc: EMPTY, known: KNOWN, diagnostics: [] }),
      'PUT /api/symbols': accept,
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(EMPTY));

    const withOne = addSymbol(EMPTY, '1', 'cherry');
    const first = ctx.symbols.update((d) => addSymbol(d, '1', 'cherry'));
    const second = ctx.symbols.update((d) => addSymbol(d, '2', 'lemon'));
    await Promise.all([first, second]);
    expect(ctx.symbols.doc()!.symbols.map((s) => s.id)).toEqual(['1', '2']);

    // Undo #1 takes the SECOND reducer's own step back off first.
    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: true,
      label: 'symbols',
    });
    expect(puts().at(-1)).toEqual({ doc: withOne });
    expect(ctx.symbols.doc()!.symbols.map((s) => s.id)).toEqual(['1']);

    // Undo #2 takes the first reducer's step.
    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: true,
      label: 'symbols',
    });
    expect(puts().at(-1)).toEqual({ doc: EMPTY });
    expect(ctx.symbols.doc()).toEqual(EMPTY);

    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: 'nothing to undo',
    });
  });

  it('an undo pressed while a write is in flight refuses instead of racing it; once the write settles, undo works again', async () => {
    let resolvePut!: (answer: Answer) => void;
    const pendingPut = new Promise<Answer>((resolve) => {
      resolvePut = resolve;
    });
    let puts = 0;
    const { ctx, calls } = await harness({
      'GET /api/symbols': boot({ doc: EMPTY, known: KNOWN, diagnostics: [] }),
      'PUT /api/symbols': (body) => {
        puts += 1;
        // The second PUT — the one "in flight" when undo is pressed — is
        // held until the test releases it; every other one (the setup
        // write, and later the undo's own write) echoes back what it sent.
        return puts === 2
          ? pendingPut
          : { body: { doc: (body as { doc: SymbolsDoc }).doc, known: KNOWN, diagnostics: [] } };
      },
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(EMPTY));

    const withOne = addSymbol(EMPTY, '1', 'cherry');
    expect(await ctx.symbols.update(withOne)).toEqual([]);

    const withTwo = addSymbol(withOne, '2', 'lemon');
    const callsBeforeSecondWrite = calls.length;
    const inFlight = ctx.symbols.update(withTwo);
    // The write queue's own turn-taking is a microtask hop — wait for the
    // second PUT to actually have gone out (so it is truly "in flight")
    // before pressing undo.
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(callsBeforeSecondWrite));
    const callsBeforeUndo = calls.length;

    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: false,
      reason: "changed elsewhere since — can't undo",
    });
    // Refused before ever writing — no new PUT went out for the undo attempt.
    expect(calls).toHaveLength(callsBeforeUndo);

    resolvePut({ body: { doc: withTwo, known: KNOWN, diagnostics: [] } });
    expect(await inFlight).toEqual([]);

    // The write that just settled recorded its OWN step; undo now targets that one.
    expect(await ctx.history.undo(['symbols'])).toEqual({
      kind: 'undo',
      ok: true,
      label: 'symbols',
    });
    expect(ctx.symbols.doc()).toEqual(withOne);
  });

  it('the symbols tab scope is exactly "symbols"', async () => {
    const { ctx } = await harness({ 'GET /api/symbols': boot() });
    expect(ctx.history.keysFor('symbols')).toEqual(['symbols']);
    expect(ctx.history.keysFor('nope')).toEqual([]);
  });

  it('a transport failure on update is one diagnostic of its own, returned and reported', async () => {
    const { ctx } = await harness({
      'GET /api/symbols': boot(),
      'PUT /api/symbols': () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(TWO));
    const answer = await ctx.symbols.update(TWO);
    expect(answer).toEqual([
      expect.objectContaining({ plugin: 'symbols', where: '/api/symbols', severity: 'error' }),
    ]);
    expect(ctx.connection.diagnostics).toEqual(answer);
  });

  it('select is state only; an unchanged selection does not renotify; the side shows while selected', async () => {
    const { ctx, calls } = await harness({ 'GET /api/symbols': boot() });
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(TWO));
    const before = calls.length;
    const listener = vi.fn();
    ctx.symbols.subscribe(listener);
    ctx.shell.openContributed('symbols');
    expect(ctx.shell.sideRight()).toBeUndefined();

    ctx.symbols.select({ id: '1', state: 'win' });
    expect(ctx.symbols.selected()).toEqual({ id: '1', state: 'win' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ctx.shell.sideRight()).toBe('symbols');
    ctx.symbols.select({ id: '1', state: 'win' });
    expect(listener).toHaveBeenCalledTimes(1);
    ctx.symbols.select({ id: '1', state: 'idle' });
    expect(listener).toHaveBeenCalledTimes(2);

    ctx.symbols.select(null);
    expect(ctx.symbols.selected()).toBeNull();
    expect(ctx.shell.sideRight()).toBeUndefined();
    ctx.symbols.select(null);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(before);
  });

  it('the symbols, scenes and flow selections are independent; each shows beside its own tab', async () => {
    const { ctx } = await harness(
      { 'GET /api/symbols': boot() },
      { scenes: [{ id: 'base_game', nodes: [] }] },
    );
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(TWO));
    ctx.scenes.select({ scene: 'base_game', node: null });
    ctx.symbols.select({ id: '2', state: 'static' });
    ctx.flow.select('start');
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: null });
    expect(ctx.symbols.selected()).toEqual({ id: '2', state: 'static' });
    expect(ctx.flow.selected()).toBe('start');

    ctx.shell.openContributed('symbols');
    expect(ctx.shell.sideRight()).toBe('symbols');
    ctx.shell.openContributed('flow');
    expect(ctx.shell.sideRight()).toBe('flow');
    ctx.shell.activate('symbols');
    expect(ctx.shell.sideRight()).toBe('symbols');
  });

  it('accepts a PUT through update while the doc is null (no symbols.yml yet)', async () => {
    const { ctx, puts } = await harness({
      'GET /api/symbols': boot({ doc: null, known: KNOWN, diagnostics: [] }),
      'PUT /api/symbols': accept,
    });
    await vi.waitFor(() => expect(ctx.symbols.known()).toEqual(KNOWN));
    expect(ctx.symbols.doc()).toBeNull();
    expect(await ctx.symbols.update(EMPTY)).toEqual([]);
    expect(puts()).toEqual([{ doc: EMPTY }]);
    expect(ctx.symbols.doc()).toEqual(EMPTY);
  });
});
