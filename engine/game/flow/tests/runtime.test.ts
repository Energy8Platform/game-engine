import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import type { FlowDoc } from '@energy8engine/contracts';
import * as runtime from '../src/runtime';

const fetchOk = (body: unknown) =>
  vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

const doc: FlowDoc = { version: 1, nodes: [{ id: 'b', kind: 'boot' }], edges: [] };

function boot(fetchFn = fetchOk({ doc, diagnostics: [], kinds: [] })) {
  const ctx = new Context();
  const fiber = ctx.plugin(runtime, { fetchFn });
  return { ctx, fiber };
}

describe('flow row', () => {
  it('provides events, flowNodes (built-ins registered) and flow; fetches /api/flow and replaces', async () => {
    const { ctx, fiber } = boot();
    await fiber;
    expect(ctx.get('events')).toBeDefined();
    expect(ctx.get('events')!.on).toBeTypeOf('function');
    expect(ctx.get('flowNodes')!.list().map((k) => k.kind).sort()).toEqual([
      'boot',
      'emit',
      'hide',
      'if',
      'merge',
      'on',
      'present',
      'set',
      'show',
      'spin',
      'step',
      'wait',
    ]);
    await ctx.get('flow')!.ready;
    expect(ctx.get('flow')!.doc()).toEqual(doc);
  });

  it('a `replace` that lands before the gated /api/flow fetch resolves wins over it', async () => {
    let resolveFetch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const gatedFetch = vi.fn(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;
    const { ctx, fiber } = boot(gatedFetch);
    await fiber;

    const raced: FlowDoc = { version: 1, nodes: [], edges: [] };
    ctx.get('flow')!.replace(raced);
    expect(ctx.get('flow')!.doc()).toEqual(raced);

    resolveFetch({ ok: true, json: async () => ({ doc, diagnostics: [], kinds: [] }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.get('flow')!.doc()).toEqual(raced);
  });

  it('a failed GET is one error diagnostic through ctx.diagnostics, and the row still applies', async () => {
    const report = vi.fn();
    const { ctx, fiber } = boot(vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    ctx.provide('diagnostics', { report });
    await fiber;
    await vi.waitFor(() =>
      expect(report).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'flow', where: '/api/flow' })),
    );
    expect(ctx.get('flow')).toBeDefined();
  });

  it('ready rejects on a failed GET when nothing replaced', async () => {
    const { ctx, fiber } = boot(vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    await fiber;
    await expect(ctx.get('flow')!.ready).rejects.toThrow('down');
  });

  it('ready resolves when a frame replaced first, even if the GET then fails', async () => {
    let rejectFetch!: (e: Error) => void;
    const gatedFetch = vi.fn(() => new Promise((_, reject) => { rejectFetch = reject; })) as unknown as typeof fetch;
    const { ctx, fiber } = boot(gatedFetch);
    await fiber;
    const raced: FlowDoc = { version: 1, nodes: [], edges: [] };
    ctx.get('flow')!.replace(raced);
    rejectFetch(new Error('down'));
    await expect(ctx.get('flow')!.ready).resolves.toBeUndefined();
    expect(ctx.get('flow')!.doc()).toEqual(raced);
  });

  it('a `doc: null` answer resolves ready and runs nothing', async () => {
    const { ctx, fiber } = boot(fetchOk({ doc: null, diagnostics: [], kinds: [] }));
    await fiber;
    await ctx.get('flow')!.ready;
    expect(ctx.get('flow')!.doc()).toBeNull();
  });

  it('dispose stops the run', async () => {
    const { ctx, fiber } = boot();
    await fiber;
    await ctx.get('flow')!.ready;
    const stopSpy = vi.spyOn(ctx.get('flow')!, 'stop');
    await fiber.dispose();
    expect(stopSpy).toHaveBeenCalled();
  });
});
