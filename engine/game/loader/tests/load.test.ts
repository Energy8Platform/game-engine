import { Context } from 'cordis';
import { describe, expect, it } from 'vitest';
import type { ResolvedRow } from '@energy8engine/contracts';
import { composeFromProject } from '../src/index';

/** A minimal `ResolvedRow`, shaped like `resolveComposition` (task 4) would emit it. */
function row(id: string): ResolvedRow {
  return { id, name: `@e/${id}`, config: {}, from: 'patch' };
}

/** A `fetchFn` that answers `GET /api/composition` with a fixed body, whatever URL it's asked for. */
function fakeFetch(body: { rows: ResolvedRow[]; diagnostics: unknown[] }): typeof fetch {
  return (async () =>
    ({
      ok: true,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe('composeFromProject', () => {
  it('applies each row runtime half, in composition order', async () => {
    const ctx = new Context();
    const order: string[] = [];

    // Row 'a' waits on a gate that opens only after several chained
    // microtask turns — deliberately NOT tied to whether row 'b' has been
    // imported yet, so a correct sequential loop (which never even calls
    // importModule('b') until 'a' has resolved) cannot deadlock waiting for
    // 'b' to open it. Row 'b' has no gate at all, so once its import is
    // actually started it resolves — and applies — almost immediately.
    //
    // Under a correct sequential loop, 'b' is not asked for until 'a' has
    // resolved, so the order comes out ['a', 'b'] no matter how many turns
    // the gate takes. Under `Promise.all`, both imports start at once: 'b'
    // has nothing to wait on and applies first, well before the gate can
    // open, producing ['b', 'a'] instead. The two implementations diverge
    // on a genuinely different, deterministic order — not a coincidence of
    // scheduling that could go either way on a slower machine. No real
    // timer is involved: the gate opens after a fixed number of chained
    // `.then()` turns, never a `setTimeout`, so there is nothing here for a
    // loaded CI box to race.
    let openGateA: () => void = () => {};
    const gateA = new Promise<void>((resolve) => {
      openGateA = resolve;
    });
    let ticks: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < 5; i++) ticks = ticks.then(() => undefined);
    void ticks.then(() => openGateA());

    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a'), row('b')], diagnostics: [] }),
      importModule: async (url) => {
        if (url.endsWith('/a')) await gateA;
        return { apply: () => order.push(url) };
      },
    });
    expect(order).toEqual(['/plugin-runtime/a', '/plugin-runtime/b']);
    expect(diags).toEqual([]);
  });

  it('a half with no apply is a no-op, not a failure', async () => {
    const ctx = new Context();
    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a')], diagnostics: [] }),
      importModule: async () => ({}),
    });
    expect(diags).toEqual([]);
  });

  it('one row failing to import does not stop the next row', async () => {
    const ctx = new Context();
    const applied: string[] = [];
    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a'), row('b')], diagnostics: [] }),
      importModule: async (url) => {
        if (url.endsWith('a')) throw new Error('boom');
        return { apply: () => applied.push(url) };
      },
    });
    expect(applied).toEqual(['/plugin-runtime/b']);
    expect(diags).toHaveLength(1);
    expect(diags[0].plugin).toBe('a');
  });

  it('apply() throwing synchronously becomes a diagnostic', async () => {
    const ctx = new Context();
    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a')], diagnostics: [] }),
      importModule: async () => ({
        apply: () => {
          throw new Error('nope');
        },
      }),
    });
    expect(diags).toHaveLength(1);
  });

  it('carries the host project diagnostics through', async () => {
    const ctx = new Context();
    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({
        rows: [],
        diagnostics: [{ severity: 'error', plugin: 'p', where: 'w', message: 'm' }],
      }),
      importModule: async () => ({}),
    });
    expect(diags).toHaveLength(1);
  });

  it('a failed composition fetch is a diagnostic, not a throw', async () => {
    const ctx = new Context();
    const diags = await composeFromProject(ctx, {
      fetchFn: async () => {
        throw new Error('offline');
      },
      importModule: async () => ({}),
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('offline');
  });

  it('a row config reaches the half', async () => {
    const ctx = new Context();
    let seen: unknown;
    await composeFromProject(ctx, {
      fetchFn: fakeFetch({
        rows: [{ id: 'a', name: '@e/a', config: { speed: 7 }, from: 'patch' }],
        diagnostics: [],
      }),
      importModule: async () => ({
        apply: (_c: Context, cfg: unknown) => {
          seen = cfg;
        },
      }),
    });
    expect(seen).toEqual({ speed: 7 });
  });
});
