import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import * as runtime from '../src/runtime';

const fetchOk = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

function boot(fetchFn = fetchOk({ scenes: [{ id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] }], diagnostics: [], nodeTypes: [] })) {
  const ctx = new Context();
  const app = { stage: new Container(), ticker: null };
  ctx.provide('renderer', { app });
  const fiber = ctx.plugin(runtime, { design: { width: 100, height: 50 }, fetchFn });
  return { ctx, app, fiber };
}

describe('scenes row', () => {
  it('provides nodeTypes, transitions, assetLoader, scenes; fetches /api/scenes and mounts', async () => {
    const { ctx, app, fiber } = boot();
    await fiber;
    expect(ctx.get('nodeTypes')!.list().map((t) => t.type).sort()).toEqual(['container', 'image', 'scene']);
    expect(ctx.get('transitions')!.ids()).toEqual(['cut', 'fade']);
    await vi.waitFor(() => expect(ctx.get('scenes')!.docs().has('a')).toBe(true));
    expect(app.stage.children).toContain(ctx.get('scenes')!.container);
  });

  it('a failed GET is one error diagnostic through ctx.diagnostics, and the row still applies', async () => {
    const report = vi.fn();
    const { ctx, fiber } = boot(vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    ctx.provide('diagnostics', { report });
    await fiber;
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'scenes', where: '/api/scenes' })));
    expect(ctx.get('scenes')).toBeDefined();
  });

  it('a `replace` that lands before the gated /api/scenes fetch resolves wins over it', async () => {
    let resolveFetch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const gatedFetch = vi.fn(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    ) as unknown as typeof fetch;
    const { ctx, fiber } = boot(gatedFetch);
    await fiber;

    ctx.get('scenes')!.replace([{ id: 'x', nodes: [] }]);
    expect(ctx.get('scenes')!.docs().has('x')).toBe(true);

    resolveFetch({
      ok: true,
      json: async () => ({ scenes: [{ id: 'a', nodes: [] }], diagnostics: [], nodeTypes: [] }),
    });
    // Flush the fetch/json microtasks the runtime's own async IIFE awaits.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.get('scenes')!.docs().has('x')).toBe(true);
    expect(ctx.get('scenes')!.docs().has('a')).toBe(false);
  });

  it('disposing the fiber detaches the design root without destroying foreign views', async () => {
    const { ctx, app, fiber } = boot();
    await fiber;
    const foreign = new Container();
    ctx.get('nodeTypes')!.register({ type: 'foreign', schema: (await import('schemastery')).default.object({}), mount: () => foreign, unmount: (v) => v.parent?.removeChild(v) });
    ctx.get('scenes')!.replace([{ id: 'a', nodes: [{ id: 'f', type: 'foreign', props: {} }] }]);
    await fiber.dispose();
    expect(app.stage.children).toEqual([]);
    expect(foreign.destroyed).toBe(false);
  });
});
