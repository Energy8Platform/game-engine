import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import type {
  Diagnostic,
  FlowDoc,
  FlowKindInfo,
  FlowTraceEntry,
  ServerMessage,
} from '@energy8engine/contracts';
import type { WebSocketLike } from '../src/plugins/connection';
import * as connection from '../src/plugins/connection';
import * as slots from '../src/plugins/slots';
import * as shell from '../src/plugins/shell';
import * as flow from '../src/plugins/flow';
import type { ScenesService } from '../src/plugins/scenes';

/**
 * The `flow` service booted on a real `Context` with the real
 * `connection` (fake socket), `slots` and `shell` — the plugins it
 * injects — plus a stub `scenes` (unused today, injected for Task 9's
 * mutual deselect: composing the real plugin here would drag in its own
 * `workspace`/`gameComposition`/`assetNodeTypes`/`files` chain for
 * nothing this plugin reads).
 */
class FakeSocket implements WebSocketLike {
  listeners: Record<string, ((event: any) => void)[]> = {};
  readyState = 1;
  addEventListener(type: string, listener: (event: any) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  send() {}
  close() {}
  receive(message: ServerMessage) {
    for (const listener of this.listeners.message ?? [])
      listener({ data: JSON.stringify(message) });
  }
}

type Answer = { status?: number; body: unknown };
type Route = (body: unknown) => Answer | Promise<Answer>;

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

const scenesStub: ScenesService = {
  docs: () => [],
  diagnostics: () => [],
  nodeTypes: () => [],
  selected: () => null,
  select: () => {},
  create: async () => [],
  remove: async () => [],
  update: async () => [],
  preview: async () => [],
  open: () => {},
  subscribe: () => () => {},
};

const built: Context[] = [];
afterEach(async () => {
  for (const ctx of built.splice(0)) await ctx.fiber.dispose();
});

async function harness(routes: Record<string, Route>) {
  const socket = new FakeSocket();
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`unexpected fetch: ${method} ${url}`);
    const answer = await route(body);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const ctx = new Context();
  built.push(ctx);
  await ctx.plugin(connection, { url: 'ws://x/ide', socketFactory: () => socket });
  await ctx.plugin(slots);
  await ctx.plugin(shell);
  ctx.provide('scenes', scenesStub);
  await ctx.plugin(flow, { url: 'ws://x/ide', fetchFn });
  return { ctx, socket, calls, fetchFn };
}

const boot =
  (body: unknown = { doc: DOC, diagnostics: [], kinds: [] }): Route =>
  () => ({ body });

function renderDocument(ctx: Context) {
  const entry = ctx.slots.list('shell.document').find((e) => e.key === 'flow');
  if (!entry) throw new Error('flow did not register a shell.document entry');
  render(<entry.component ctx={ctx} />);
}

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

  it('flow-trace entries append, cap at 500, and a newer run drops the older run\'s entries', async () => {
    const { ctx, socket } = await harness({ 'GET /api/flow': boot() });
    await vi.waitFor(() => expect(ctx.flow.doc()).toEqual(DOC));

    const entry = (run: number, node: string, at: number): FlowTraceEntry => ({
      run,
      node,
      out: null,
      at,
    });
    socket.receive({ type: 'flow-trace', entries: [entry(1, 'start', 0), entry(1, 'a', 1)] });
    expect(ctx.flow.trace()).toEqual([entry(1, 'start', 0), entry(1, 'a', 1)]);

    // A higher run number drops the older run's entries first.
    socket.receive({ type: 'flow-trace', entries: [entry(2, 'start', 2)] });
    expect(ctx.flow.trace()).toEqual([entry(2, 'start', 2)]);

    // A lower run number than the newest seen is stale and dropped.
    socket.receive({ type: 'flow-trace', entries: [entry(1, 'late', 3)] });
    expect(ctx.flow.trace()).toEqual([entry(2, 'start', 2)]);

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
