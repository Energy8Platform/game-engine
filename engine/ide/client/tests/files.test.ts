import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { apply, type FilesConfig, type FilesService } from '../src/plugins/files';
import { createIdeClient } from '../src/index';

/** These tests only care about `.message` — severity/plugin/where are fixed filler. */
function d(message: string): Diagnostic {
  return diagnostic('error', 'files', 'test', message);
}

function jsonOnce(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      ...init,
    })) as unknown as typeof fetch;
}

/**
 * A hand-built `ctx` exposing only `provide`, then `apply()` called
 * directly against it — the shape `diagnostics.test.ts` already uses, not
 * the real, async `createIdeClient()` shape `game-composition.test.ts`
 * uses. Picked because `files.apply()` is entirely synchronous (it wires
 * closures over `fetchFn` and calls `ctx.provide` once — no boot-time
 * fetch, no listeners to register), so a plain function call is enough to
 * run the real plugin code, and because every test below calls `harness()`
 * with no `await` — `const ctx = harness(...)` — which only a synchronous
 * return supports.
 *
 * The one test this shape cannot cover — whether `createIdeClient` itself
 * composes `files` at all — does not use this harness: it calls
 * `createIdeClient` directly, the same trap `layout` fell into last slice
 * (proved by every unit test, absent from the running app).
 */
function harness(config: FilesConfig = {}): Context {
  const result = {} as Context;
  const fakeCtx = {
    provide: (key: string, value: unknown) => {
      (result as unknown as Record<string, unknown>)[key] = value;
    },
  } as unknown as Context;
  apply(fakeCtx, config);
  return result;
}

describe('files', () => {
  it('asks the host for the tree and hands back what it got', async () => {
    const ctx = harness({
      fetchFn: jsonOnce({ entries: [{ path: 'a.txt', kind: 'file', size: 3 }], diagnostics: [] }),
    });
    const { entries } = await ctx.files.tree();
    expect(entries.map((e) => e.path)).toEqual(['a.txt']);
  });

  it('a host that answers with diagnostics passes them through unchanged', async () => {
    // The client does not rewrite someone else's message: the host wrote
    // it because the host knows the cause.
    const said = d('the project directory is gone');
    const ctx = harness({ fetchFn: jsonOnce({ entries: [], diagnostics: [said] }) });
    const { diagnostics } = await ctx.files.tree();
    expect(diagnostics).toEqual([said]);
  });

  it('a host that does not answer at all is a diagnostic of the client’s own', async () => {
    // The network died. Silence is not an empty tree.
    const ctx = harness({ fetchFn: () => Promise.reject(new Error('offline')) });
    const { entries, diagnostics } = await ctx.files.tree();
    expect(entries).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('offline');
  });

  it('a body that is not the shape we asked for is a diagnostic, not a crash', async () => {
    const ctx = harness({ fetchFn: async () => new Response('<html>nope</html>') });
    const { diagnostics } = await ctx.files.tree();
    expect(diagnostics).toHaveLength(1);
  });

  it('urlFor escapes a path with a space in it', () => {
    const ctx = harness();
    expect(ctx.files.urlFor('art/my logo.png')).toBe('/api/files/art/my%20logo.png');
  });

  it('urlFor escapes a literal plus, per segment, without eating the slash', () => {
    // A `+` that reaches the host unescaped reads as a space
    // (`@cordisjs/plugin-server` decodes path captures the same way it
    // decodes a query string) — see files.ts's own comment. Encoding the
    // whole joined path in one call would also escape the `/` separator;
    // this checks both traps at once.
    const ctx = harness();
    expect(ctx.files.urlFor('a+b/c+d.txt')).toBe('/api/files/a%2Bb/c%2Bd.txt');
  });

  it('reads a file and hands back its bytes', async () => {
    const ctx = harness({
      fetchFn: (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch,
    });
    const { bytes, diagnostics } = await ctx.files.read('a.txt');
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
    expect(diagnostics).toEqual([]);
  });

  it('a read the host refuses (404, diagnostics body) passes the refusal through unchanged', async () => {
    // The ordinary refusal path — a non-2xx with a diagnostics body is
    // the host answering, not the client failing to reach it. Overwriting
    // this with a client-authored "404" message would throw away the
    // reason the host already gave.
    const said = d('"missing.txt" was not found: ENOENT');
    const ctx = harness({ fetchFn: jsonOnce({ diagnostics: [said] }, { status: 404 }) });
    const { bytes, diagnostics } = await ctx.files.read('missing.txt');
    expect(bytes).toBeUndefined();
    expect(diagnostics).toEqual([said]);
  });

  it('writes a file and reports success as no diagnostics', async () => {
    const ctx = harness({ fetchFn: jsonOnce({ diagnostics: [] }) });
    const { diagnostics } = await ctx.files.write('a.txt', new Uint8Array([1]));
    expect(diagnostics).toEqual([]);
  });

  it('a write the host refuses (400, diagnostics body) passes the refusal through unchanged', async () => {
    const said = d('"../escape.txt" resolves outside the project');
    const ctx = harness({ fetchFn: jsonOnce({ diagnostics: [said] }, { status: 400 }) });
    const { diagnostics } = await ctx.files.write('../escape.txt', new Uint8Array([1]));
    expect(diagnostics).toEqual([said]);
  });

  it('a write that never reaches the host is a diagnostic of the client’s own', async () => {
    const ctx = harness({ fetchFn: () => Promise.reject(new Error('offline')) });
    const { diagnostics } = await ctx.files.write('a.txt', new Uint8Array([1]));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('offline');
  });

  it('removes a file and reports success as no diagnostics', async () => {
    const ctx = harness({ fetchFn: jsonOnce({ diagnostics: [] }) });
    const { diagnostics } = await ctx.files.remove('a.txt');
    expect(diagnostics).toEqual([]);
  });

  it('a remove the host refuses passes the refusal through unchanged', async () => {
    const said = d('"a.txt" is a directory, not a file — remove() does not remove directories');
    const ctx = harness({ fetchFn: jsonOnce({ diagnostics: [said] }, { status: 400 }) });
    const { diagnostics } = await ctx.files.remove('a.txt');
    expect(diagnostics).toEqual([said]);
  });

  it('is on the context the real createIdeClient hands back', async () => {
    // `layout` in the previous slice was proved by every unit test and
    // absent from the running app — nothing composed it in
    // `createIdeClient`. This goes through the real thing, not a harness.
    const ctx = await createIdeClient({ url: 'ws://localhost:1/ide' });
    expect(typeof ctx.files.tree).toBe('function');
  });
});
