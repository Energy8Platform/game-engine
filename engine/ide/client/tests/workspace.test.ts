import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'cordis';
import {
  diagnostic,
  type Diagnostic,
  type ServerMessage,
  type WorkspaceState,
} from '@energy8engine/contracts';
import { apply, type WorkspaceClientConfig } from '../src/plugins/workspace';
import { createIdeClient } from '../src/index';

/** These tests only care about `.message`/`.plugin` — severity/where are fixed filler. */
function d(message: string): Diagnostic {
  return diagnostic('error', 'workspace', 'test', message);
}

function ws(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    projects: [{ id: 'a', name: 'Game A' }],
    templates: [],
    active: 'a',
    previewUrl: 'http://game.test:5679',
    diagnostics: [],
    ...overrides,
  };
}

/** The slice of WebSocket this plugin needs, plus `receive()` — same shape as `diagnostics.test.ts`'s own. */
class FakeSocket {
  private listeners: ((event: { data: string }) => void)[] = [];
  readyState = 1;
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    if (type === 'message') this.listeners.push(listener);
  }
  send() {}
  close() {}
  receive(message: ServerMessage) {
    this.raw(JSON.stringify(message));
  }
  raw(data: string) {
    for (const listener of this.listeners) listener({ data });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A `fetchFn` that answers the boot GET with `boot` and every later call from `rest`, recording each call. */
function fakeFetch(boot: () => Promise<Response>, rest: () => Promise<Response> = boot) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return calls.length === 1 ? boot() : rest();
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

/**
 * A hand-built `ctx` with `provide`/`effect` and a `connection` carrying a
 * `report` spy — `apply()` called directly, the shape `diagnostics.test.ts`
 * and `files.test.ts` already use, so `harness()` returns synchronously.
 */
function harness(config: Partial<WorkspaceClientConfig> = {}, docs: FakeDoc[] = []) {
  const socket = new FakeSocket();
  const report = vi.fn();
  const shell = fakeShell(docs);
  const result = { connection: { report }, shell } as unknown as Context & {
    connection: { report: typeof report };
  };
  const fakeCtx = {
    effect: (execute: () => unknown) => execute(),
    provide: (key: string, value: unknown) => {
      (result as unknown as Record<string, unknown>)[key] = value;
    },
    connection: result.connection,
    shell,
  } as unknown as Context;
  apply(fakeCtx, { url: 'ws://x/ide', socketFactory: () => socket, ...config });
  return { ctx: result, socket, report, shell };
}

type FakeDoc = { key: string; dirty: boolean; closable: boolean };

/** The two members of `ShellService` the switch reads: the open tabs, and a forced close that drops one. */
function fakeShell(initial: FakeDoc[]) {
  let docs = [...initial];
  const close = vi.fn((key: string, opts?: { force?: boolean }) => {
    docs = docs.filter((doc) => doc.key !== key);
    return opts?.force === true;
  });
  return { documents: () => docs, close };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('workspace (client)', () => {
  it('asks the host once at boot and holds that answer', async () => {
    const { fetchFn, calls } = fakeFetch(async () => jsonResponse(ws()));
    const { ctx } = harness({ fetchFn });
    const listener = vi.fn();
    ctx.workspace.subscribe(listener);
    expect(ctx.workspace.state()).toBeNull();
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/workspace');
    expect(ctx.workspace.state()).toEqual(ws());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a boot GET that fails leaves the state unknown and says so once', async () => {
    const { fetchFn } = fakeFetch(() => Promise.reject(new Error('offline')));
    const { ctx, report } = harness({ fetchFn });
    await settle();
    expect(ctx.workspace.state()).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0].plugin).toBe('workspace');
    expect(report.mock.calls[0][0].message).toContain('offline');
  });

  it('a 200 that is not a workspace (no "projects" array) is a diagnostic, not a crash later', async () => {
    const { fetchFn } = fakeFetch(async () => jsonResponse({ rows: [], diagnostics: [] }));
    const { ctx, report } = harness({ fetchFn });
    await settle();
    expect(ctx.workspace.state()).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0].message).toContain('projects');
  });

  it('open() answered 200 with the wrong shape is one diagnostic and no state change', async () => {
    const { fetchFn } = fakeFetch(
      async () => jsonResponse(ws()),
      async () => jsonResponse({ ok: true }),
    );
    const { ctx, report } = harness({ fetchFn });
    await settle();
    const refusals = await ctx.workspace.open('a');
    expect(refusals).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(ctx.workspace.state()).toEqual(ws());
  });

  it('a workspace frame replaces the state and notifies', async () => {
    const { fetchFn } = fakeFetch(() => new Promise(() => {}));
    const { ctx, socket } = harness({ fetchFn });
    const listener = vi.fn();
    ctx.workspace.subscribe(listener);
    socket.receive({ type: 'workspace', workspace: ws({ active: null, previewUrl: null }) });
    expect(ctx.workspace.state()?.active).toBeNull();
    socket.receive({ type: 'workspace', workspace: ws() });
    expect(ctx.workspace.state()).toEqual(ws());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a frame that arrived before the boot GET answered is the newer fact — the GET does not overwrite it', async () => {
    let answer!: (res: Response) => void;
    const { fetchFn } = fakeFetch(() => new Promise<Response>((resolve) => (answer = resolve)));
    const { ctx, socket } = harness({ fetchFn });
    socket.receive({ type: 'workspace', workspace: ws({ active: 'a' }) });
    answer(jsonResponse(ws({ active: null })));
    await settle();
    expect(ctx.workspace.state()?.active).toBe('a');
  });

  it('frames of other types, and malformed ones, are ignored', async () => {
    const { fetchFn } = fakeFetch(() => new Promise(() => {}));
    const { ctx, socket } = harness({ fetchFn });
    const listener = vi.fn();
    ctx.workspace.subscribe(listener);
    socket.receive({ type: 'diagnostics', diagnostics: [] });
    socket.receive({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    socket.raw('not json');
    socket.raw('null');
    socket.raw('[1]');
    socket.raw('"workspace"');
    // A `workspace` frame whose state is missing or not a workspace.
    socket.raw('{"type":"workspace"}');
    socket.raw('{"type":"workspace","workspace":null}');
    socket.raw('{"type":"workspace","workspace":{"active":"a"}}');
    expect(ctx.workspace.state()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('open() POSTs the id; a 200 is no refusal and the body is the new state', async () => {
    const opened = ws({
      active: 'b',
      projects: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    const { fetchFn, calls } = fakeFetch(
      async () => jsonResponse(ws()),
      async () => jsonResponse(opened),
    );
    const { ctx, report } = harness({ fetchFn });
    await settle();
    const refusals = await ctx.workspace.open('b');
    expect(refusals).toEqual([]);
    expect(calls[1].url).toBe('/api/workspace/open');
    expect(calls[1].init?.method).toBe('POST');
    expect(JSON.parse(calls[1].init?.body as string)).toEqual({ id: 'b' });
    expect(ctx.workspace.state()).toEqual(opened);
    expect(report).not.toHaveBeenCalled();
  });

  it('a refusal (400/500 with diagnostics) is returned AND reported, one report per diagnostic', async () => {
    const said = [d('no such project "zzz"'), d('and another thing')];
    const { fetchFn } = fakeFetch(
      async () => jsonResponse(ws()),
      async () => jsonResponse({ diagnostics: said }, 400),
    );
    const { ctx, report } = harness({ fetchFn });
    await settle();
    const before = ctx.workspace.state();
    const refusals = await ctx.workspace.open('zzz');
    expect(refusals).toEqual(said);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls.map((call) => call[0])).toEqual(said);
    expect(ctx.workspace.state()).toBe(before);
  });

  it('a refusal whose body carries no diagnostics is still one diagnostic, not silence', async () => {
    const { fetchFn } = fakeFetch(
      async () => jsonResponse(ws()),
      async () => new Response('<html>nope</html>', { status: 500 }),
    );
    const { ctx, report } = harness({ fetchFn });
    await settle();
    const refusals = await ctx.workspace.open('a');
    expect(refusals).toHaveLength(1);
    expect(refusals[0].plugin).toBe('workspace');
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('a network failure on open() is one workspace diagnostic, returned and reported', async () => {
    const { fetchFn } = fakeFetch(
      async () => jsonResponse(ws()),
      () => Promise.reject(new Error('offline')),
    );
    const { ctx, report } = harness({ fetchFn });
    await settle();
    const refusals = await ctx.workspace.open('a');
    expect(refusals).toHaveLength(1);
    expect(refusals[0].plugin).toBe('workspace');
    expect(refusals[0].message).toContain('offline');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toEqual(refusals[0]);
  });

  it('is composed by createIdeClient, after connection and shell', async () => {
    const socket = new FakeSocket();
    const { fetchFn } = fakeFetch(() => new Promise(() => {}));
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    expect(typeof ctx.workspace.open).toBe('function');
    socket.receive({ type: 'workspace', workspace: ws() });
    expect(ctx.workspace.state()?.active).toBe('a');
    // The switch guard reads the real shell's tabs: a file tab open on
    // project `a` is gone once `b` is the active one.
    ctx.shell.open({ key: 'f:x.ts', title: 'x.ts', component: () => null, closable: true });
    socket.receive({ type: 'workspace', workspace: ws({ active: 'b' }) });
    expect(ctx.shell.documents()).toEqual([]);
  });

  describe('switching projects', () => {
    // `demo`: a plugin's own document, contributed closable — it goes with
    // the project like an `f:` tab does (final review F2). `composition`
    // is the app's, contributed `closable: false`, and stays.
    const tabs = (): FakeDoc[] => [
      { key: 'f:game/script.spin', dirty: false, closable: true },
      { key: 'f:a.ts', dirty: false, closable: true },
      { key: 'demo', dirty: false, closable: true },
      { key: 'composition', dirty: false, closable: false },
    ];

    it('a frame with a different active closes every closable document, by force, and nothing else', () => {
      const { fetchFn } = fakeFetch(() => new Promise(() => {}));
      const { socket, shell, report } = harness({ fetchFn }, tabs());
      socket.receive({ type: 'workspace', workspace: ws({ active: 'a' }) });
      socket.receive({ type: 'workspace', workspace: ws({ active: 'b' }) });
      expect(shell.close.mock.calls).toEqual([
        ['f:game/script.spin', { force: true }],
        ['f:a.ts', { force: true }],
        ['demo', { force: true }],
      ]);
      expect(shell.documents().map((doc) => doc.key)).toEqual(['composition']);
      expect(report).not.toHaveBeenCalled();
    });

    it('a dirty f: document lost that way is one warning naming its path', () => {
      const { fetchFn } = fakeFetch(() => new Promise(() => {}));
      const docs = tabs();
      docs[1].dirty = true;
      const { socket, report } = harness({ fetchFn }, docs);
      socket.receive({ type: 'workspace', workspace: ws({ active: 'a' }) });
      // The production sequence: the host says `null` while it closes `a`,
      // then names `b`. The warning is about `a` — where the file lived.
      socket.receive({ type: 'workspace', workspace: ws({ active: null }) });
      socket.receive({ type: 'workspace', workspace: ws({ active: 'b' }) });
      expect(report).toHaveBeenCalledTimes(1);
      const said = report.mock.calls[0][0] as Diagnostic;
      expect(said.severity).toBe('warning');
      expect(said.plugin).toBe('workspace');
      expect(said.where).toBe('a');
      expect(said.message).toBe('unsaved changes discarded on project switch: a.ts');
    });

    it('the first state seen closes nothing — it is the baseline, not a switch', () => {
      const { fetchFn } = fakeFetch(() => new Promise(() => {}));
      const { socket, shell } = harness({ fetchFn }, tabs());
      socket.receive({ type: 'workspace', workspace: ws({ active: 'a' }) });
      expect(shell.close).not.toHaveBeenCalled();
    });

    it('a frame with the same active closes nothing', () => {
      const { fetchFn } = fakeFetch(() => new Promise(() => {}));
      const { socket, shell } = harness({ fetchFn }, tabs());
      socket.receive({ type: 'workspace', workspace: ws({ active: 'a' }) });
      socket.receive({
        type: 'workspace',
        workspace: ws({ active: 'a', previewUrl: 'http://other' }),
      });
      expect(shell.close).not.toHaveBeenCalled();
    });

    it('a close with no project after it still names the project the file belonged to', () => {
      const { fetchFn } = fakeFetch(() => new Promise(() => {}));
      const { socket, report } = harness({ fetchFn }, [
        { key: 'f:a.ts', dirty: true, closable: true },
      ]);
      socket.receive({ type: 'workspace', workspace: ws({ active: 'a' }) });
      socket.receive({ type: 'workspace', workspace: ws({ active: null, previewUrl: null }) });
      expect((report.mock.calls[0][0] as Diagnostic).where).toBe('a');
    });
  });
});
