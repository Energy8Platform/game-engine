import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic, SymbolsDoc } from '@energy8engine/contracts';
import { EMPTY } from '../src/shell/symbols-doc';
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
    // A frame carries no `known`: the last one read stays.
    expect(ctx.symbols.known()).toEqual(KNOWN);
    expect(listener).toHaveBeenCalledTimes(1);
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

  it('selecting a symbol clears scenes and flow; a scenes or flow selection clears the symbol; no ping-pong', async () => {
    const { ctx } = await harness(
      { 'GET /api/symbols': boot() },
      { scenes: [{ id: 'base_game', nodes: [] }] },
    );
    await vi.waitFor(() => expect(ctx.symbols.doc()).toEqual(TWO));
    ctx.scenes.select({ scene: 'base_game', node: null });
    ctx.shell.showSideRight('scenes');
    ctx.symbols.select({ id: '2', state: 'static' });
    expect(ctx.scenes.selected()).toBeNull();
    expect(ctx.shell.sideRight()).toBe('symbols');

    ctx.flow.select('start');
    expect(ctx.symbols.selected()).toBeNull();
    expect(ctx.flow.selected()).toBe('start');
    expect(ctx.shell.sideRight()).toBe('flow');
    ctx.symbols.select({ id: '2', state: 'static' });
    expect(ctx.flow.selected()).toBeNull();

    ctx.scenes.select({ scene: 'base_game', node: null });
    expect(ctx.symbols.selected()).toBeNull();
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: null });
    // Clearing one side never touches another.
    ctx.scenes.select(null);
    ctx.symbols.select({ id: '1', state: 'idle' });
    ctx.symbols.select(null);
    ctx.scenes.select({ scene: 'base_game', node: 'x' });
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: 'x' });
    expect(ctx.symbols.selected()).toBeNull();
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
