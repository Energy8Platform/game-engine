import { Context, type Fiber } from 'cordis';
import { describe, expect, it } from 'vitest';
import type { GameCompositionRow } from '@energy8engine/contracts';
import { composeFromProject } from '../src/index';

/** A minimal `GameCompositionRow`, shaped like `runtime-assets.ts`'s `/api/composition` would emit it (no dev-game — the raw route). */
function row(id: string): GameCompositionRow {
  return {
    id,
    name: `@e/${id}`,
    config: {},
    from: 'patch',
    runtimeUrl: `/plugin-runtime/${id}`,
    schema: null,
    hot: false,
  };
}

/** A `fetchFn` that answers `GET /api/composition` with a fixed body, whatever URL it's asked for. */
function fakeFetch(body: { rows: GameCompositionRow[]; diagnostics: unknown[] }): typeof fetch {
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

  it('a row with no runtime half (runtimeUrl: null) is skipped, not a failure', async () => {
    const ctx = new Context();
    const imported: string[] = [];
    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({
        rows: [{ ...row('a'), runtimeUrl: null }],
        diagnostics: [],
      }),
      importModule: async (url) => {
        imported.push(url);
        return { apply: () => {} };
      },
    });
    expect(imported).toEqual([]);
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

  it('apply() throwing synchronously becomes a diagnostic naming the row and the URL it loaded', async () => {
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
    expect(diags[0].plugin).toBe('a');
    // The URL, not only the row id. A native `import()` failure says
    // "Failed to fetch dynamically imported module" and names nothing; a
    // throw out of `apply` names nothing either. This is often the only
    // address a person gets for the row that broke, and the loader is the
    // only place that holds it at the moment it fails.
    expect(diags[0].message).toContain('/plugin-runtime/a');
    expect(diags[0].message).toContain('nope');
  });

  it('apply() rejecting asynchronously becomes a diagnostic naming the row, not an unhandled rejection', async () => {
    // The mutation this test exists to catch: dropping the `await` on
    // `module.apply?.(ctx, row.config)` in `src/index.ts`. A synchronous
    // throw lands in the surrounding try/catch either way — this needs an
    // `apply` that returns a REJECTED PROMISE instead, which only an
    // awaited call can ever observe. Left unawaited, this rejection
    // becomes a genuine unhandled promise rejection outside vitest's
    // control (not just a wrong assertion) — see this file's own
    // "mutation, verified in both directions" note below for how that was
    // actually observed, not just reasoned about.
    const ctx = new Context();
    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a')], diagnostics: [] }),
      importModule: async () => ({
        apply: async () => {
          throw new Error('async nope');
        },
      }),
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].plugin).toBe('a');
    expect(diags[0].message).toContain('async nope');
  });

  it('applies only the rows the caller planned, and carries the plan diagnostics', async () => {
    // The mutation this catches: ignoring `plan` and applying
    // `composition.rows` anyway. A seam has exactly one provider, so a
    // loader that quietly applies both candidates has already done the
    // thing the seam exists to prevent — and the diagnostic explaining
    // the choice would never reach the screen either.
    const ctx = new Context();
    const applied: string[] = [];

    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a'), row('b')], diagnostics: [] }),
      importModule: async (url) => ({ apply: () => applied.push(url) }),
      plan: (rows) => ({
        rows: rows.filter((r) => r.id === 'b'),
        diagnostics: [{ severity: 'error', plugin: 'seam', where: 'plan', message: 'a lost' }],
      }),
    });

    expect(applied).toEqual(['/plugin-runtime/b']);
    expect(diags.map((d) => d.message)).toEqual(['a lost']);
  });

  it('awaits the plan, so what the caller brings up is in place before the first row applies', async () => {
    // `plan` is where a caller composes what only IT can supply — the
    // session, the mount, the art — and a row applied before that landed
    // would read a context that isn't ready yet.
    const ctx = new Context();
    const order: string[] = [];

    await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a')], diagnostics: [] }),
      importModule: async () => ({ apply: () => order.push('row') }),
      plan: async (rows) => {
        await Promise.resolve();
        order.push('plan');
        return { rows, diagnostics: [] };
      },
    });

    expect(order).toEqual(['plan', 'row']);
  });

  it('a plan that throws composes nothing and says so, rather than falling back to everything', async () => {
    const ctx = new Context();
    const applied: string[] = [];

    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a')], diagnostics: [] }),
      importModule: async () => ({ apply: () => applied.push('a') }),
      plan: () => {
        throw new Error('plan blew up');
      },
    });

    expect(applied).toEqual([]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('plan blew up');
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

  /**
   * A caller needs to tell the HOST's own diagnostics apart from everything
   * else in the array this returns — the editor already holds the host's,
   * over its own channel, so a game forwarding its list must not send them
   * again (see `LoadOptions.onHostDiagnostics`). Only this function knows
   * which is which by the time they are merged.
   */
  it('announces the host project diagnostics, as the very objects it returns', async () => {
    const hostSaid = { severity: 'error' as const, plugin: 'p', where: 'w', message: 'the host' };
    const seen: unknown[] = [];
    const ctx = new Context();
    const diags = await composeFromProject(ctx, {
      // One host diagnostic and one of the loader's own (`bad1` fails to
      // import), so a hook that simply forwarded everything would be caught.
      fetchFn: fakeFetch({ rows: [row('bad1')], diagnostics: [hostSaid] }),
      importModule: async () => {
        throw new Error('this module does not exist');
      },
      onHostDiagnostics: (list) => seen.push(...list),
    });

    expect(seen).toHaveLength(1);
    // Identity, not equality: the caller matches these against the returned
    // array by reference, so a copy here would silently break it.
    expect(seen[0]).toBe(diags[0]);
    expect(diags).toHaveLength(2);
  });

  it('does not call the hook when the host said nothing', async () => {
    let calls = 0;
    const ctx = new Context();
    await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [], diagnostics: [] }),
      importModule: async () => ({}),
      onHostDiagnostics: () => {
        calls += 1;
      },
    });
    expect(calls).toBe(0);
  });

  it('a hook that throws does not stop the composition', async () => {
    const applied: string[] = [];
    const ctx = new Context();
    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({
        rows: [row('r1')],
        diagnostics: [{ severity: 'error', plugin: 'p', where: 'w', message: 'the host' }],
      }),
      importModule: async () => ({ apply: () => applied.push('r1') }),
      onHostDiagnostics: () => {
        throw new Error('a caller hook blew up');
      },
    });
    expect(applied).toEqual(['r1']);
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
        rows: [
          {
            id: 'a',
            name: '@e/a',
            config: { speed: 7 },
            from: 'patch',
            schema: null,
            hot: false,
            runtimeUrl: '/plugin-runtime/a',
          },
        ],
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

/**
 * Every row is applied through its own cordis fiber (`ctx.plugin`), not a
 * plain `apply(ctx, config)` call. That is what makes a row hot-updatable
 * later (`fiber.update(config)` disposes the row's effects and re-runs
 * `apply`) and what makes the root's dispose take every row down with it.
 * `onApplied` hands each fiber to the caller as it is created.
 */
describe('composeFromProject — one fiber per row', () => {
  it('hands the caller a fiber per applied row, keyed by row id, in order', async () => {
    const ctx = new Context();
    const seen: string[] = [];
    const fibers = new Map<string, Fiber>();
    await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a'), row('b')], diagnostics: [] }),
      importModule: async () => ({ apply: () => {} }),
      onApplied: (id, fiber) => {
        seen.push(`${id}:${fiber.state}`);
        fibers.set(id, fiber);
      },
    });
    // Handed over while LOADING (1) — before `apply` ran — and ACTIVE (2)
    // once the composition returns. (`FiberState` is a const enum: no
    // runtime value to import, so the numbers are spelled out.)
    expect(seen).toEqual(['a:1', 'b:1']);
    expect([...fibers.values()].map((f) => f.state)).toEqual([2, 2]);
  });

  it('fiber.update(config) runs the row effect disposers, then apply again with the new config', async () => {
    const ctx = new Context();
    const log: string[] = [];
    let fiber!: Fiber;
    await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a')], diagnostics: [] }),
      importModule: async () => ({
        apply: (c: Context, cfg: { n?: number }) => {
          log.push(`apply:${cfg.n ?? 0}`);
          c.effect(() => () => {
            log.push(`dispose:${cfg.n ?? 0}`);
          });
        },
      }),
      onApplied: (_id, f) => {
        fiber = f;
      },
    });

    fiber.update({ n: 1 });
    await fiber.await();

    expect(log).toEqual(['apply:0', 'dispose:0', 'apply:1']);
  });

  it('disposing the root disposes every row fiber', async () => {
    const ctx = new Context();
    const disposed: string[] = [];
    await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('a'), row('b')], diagnostics: [] }),
      importModule: async (url) => ({
        apply: (c: Context) => {
          c.effect(() => () => {
            disposed.push(url);
          });
        },
      }),
    });

    await ctx.fiber.dispose();

    expect(disposed.sort()).toEqual(['/plugin-runtime/a', '/plugin-runtime/b']);
  });

  it('a half declaring `inject` waits for that service; one whose service never comes is a diagnostic, not silence', async () => {
    const ctx = new Context();
    const applied: string[] = [];
    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('stage1'), row('renderer1')], diagnostics: [] }),
      importModule: async (url) =>
        url.endsWith('stage1')
          ? {
              inject: ['renderer', 'never'],
              apply: (c: Context) => {
                applied.push(`stage1 saw ${typeof (c as any).renderer}`);
              },
            }
          : {
              apply: (c: Context) => {
                c.provide('renderer', { app: {} });
              },
            },
    });

    expect(applied).toEqual([]);
    expect(diags).toHaveLength(1);
    expect(diags[0].plugin).toBe('stage1');
    expect(diags[0].message).toContain('"never"');
    expect(diags[0].message).not.toContain('"renderer"');
  });

  it('a half declaring `inject` on a service an EARLIER row provided reads it strictly', async () => {
    const ctx = new Context();
    const applied: string[] = [];
    const diags = await composeFromProject(ctx, {
      fetchFn: fakeFetch({ rows: [row('renderer1'), row('stage1')], diagnostics: [] }),
      importModule: async (url) =>
        url.endsWith('stage1')
          ? {
              inject: ['renderer'],
              apply: (c: Context) => {
                applied.push(`stage1 saw ${typeof (c as any).renderer}`);
              },
            }
          : {
              apply: (c: Context) => {
                c.provide('renderer', { app: {} });
              },
            },
    });

    expect(diags).toEqual([]);
    expect(applied).toEqual(['stage1 saw object']);
  });
});
