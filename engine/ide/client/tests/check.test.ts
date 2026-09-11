import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import { apply, type CheckConfig } from '../src/plugins/check';
import { createIdeClient } from '../src/index';

function jsonOnce(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      ...init,
    })) as unknown as typeof fetch;
}

/**
 * Same shape as `files.test.ts`'s harness, for the same reason: `check.apply()`
 * is entirely synchronous (closures over `fetchFn`, one `ctx.provide` call,
 * no boot-time fetch), so a hand-built `ctx` exposing only `provide` is
 * enough to run the real plugin code.
 */
function harness(config: CheckConfig = {}): Context {
  const result = {} as Context;
  const fakeCtx = {
    provide: (key: string, value: unknown) => {
      (result as unknown as Record<string, unknown>)[key] = value;
    },
  } as unknown as Context;
  apply(fakeCtx, config);
  return result;
}

describe('check', () => {
  it('passes the host’s diagnostics through unchanged', async () => {
    const d = {
      severity: 'error',
      plugin: 'schema',
      where: 'line 3',
      message: 'record block has no name',
      at: { line: 3 },
    };
    const ctx = harness({ fetchFn: jsonOnce({ diagnostics: [d] }) });
    expect((await ctx.check.check('record {\n}\n')).diagnostics).toEqual([d]);
  });

  it('a dead network is a diagnostic of the client’s own', async () => {
    const ctx = harness({ fetchFn: () => Promise.reject(new Error('offline')) });
    const { diagnostics } = await ctx.check.check('x');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('offline');
  });

  it('a body carrying diagnostics is carried, even when it lacks the key we asked for', async () => {
    // The mistake slice 5 made once: `tree()` checked its own key first and
    // threw away the host's explanation. `/api/check` has no key of its own
    // to prefer — its whole body is `{ diagnostics }` — but the same
    // mistake reappears as a status check: the host's real 400 answer for a
    // malformed POST (see `engine/ide/host/src/plugins/schema.ts`) still
    // carries a `diagnostics` array in its body. Deciding "not ok, so this
    // is a client-authored failure" before reading that body would throw
    // the host's own words away exactly the way `tree()` once did.
    const said = diagnostic(
      'error',
      'schema',
      '/api/check',
      'POST /api/check needs a JSON body shaped {"source": string}',
    );
    const ctx = harness({ fetchFn: jsonOnce({ diagnostics: [said] }, { status: 400 }) });
    const { diagnostics } = await ctx.check.check('x');
    expect(diagnostics).toEqual([said]);
  });

  it('valid JSON with no "diagnostics" array is a diagnostic too, not a silent success', async () => {
    // The gap `files.test.ts:174` already closes for `write`: a 200 whose
    // body parses fine but is not the shape asked for must not read as
    // "nothing wrong" — this is the `Array.isArray` check doing the work,
    // not the `res.json()` catch above it.
    const ctx = harness({ fetchFn: jsonOnce({ notDiagnostics: [] }) });
    const { diagnostics } = await ctx.check.check('x');
    expect(diagnostics).toHaveLength(1);
  });

  it('is on the context the real createIdeClient hands back', async () => {
    // `layout` shipped as a service every unit test proved and no running
    // IDE had — nothing composed it into `createIdeClient`. This goes
    // through the real thing, not a harness.
    const ctx = await createIdeClient({ url: 'ws://localhost:1/ide' });
    expect(typeof ctx.check.check).toBe('function');
  });
});
