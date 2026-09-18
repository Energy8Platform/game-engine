import { render } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { Context } from 'cordis';
import type { FlowDoc, FlowKindInfo, ServerMessage } from '@energy8engine/contracts';
import type { WebSocketLike } from '../src/plugins/connection';
import * as connection from '../src/plugins/connection';
import * as slots from '../src/plugins/slots';
import * as shell from '../src/plugins/shell';
import * as flow from '../src/plugins/flow';
import type { SceneSelection, ScenesService } from '../src/plugins/scenes';

/**
 * The one flow test harness, shared by `flow-service.test.tsx` and
 * `flow-document.test.tsx`: the `flow` service booted on a real `Context`
 * with the real `connection` (fake socket), `slots` and `shell` — the
 * plugins it injects — plus a stub `scenes` that holds a selection and
 * a doc list (what the mutual deselect and the `scene` picker read;
 * composing the real plugin here would drag in its own
 * `workspace`/`gameComposition`/`assetNodeTypes`/`files` chain for
 * nothing else this plugin reads).
 */
export class FakeSocket implements WebSocketLike {
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

export type Answer = { status?: number; body: unknown };
export type Route = (body: unknown) => Answer | Promise<Answer>;

/** Spec §3's example: the five-node loop. */
export const FIVE: FlowDoc = {
  version: 1,
  nodes: [
    { id: 'start', kind: 'boot', ui: { x: 40, y: 80 } },
    { id: 'base', kind: 'show', props: { scene: 'base_game' }, ui: { x: 220, y: 80 } },
    { id: 'idle', kind: 'on', props: { event: 'ui.spin' }, ui: { x: 400, y: 80 } },
    { id: 'spin', kind: 'spin', ui: { x: 580, y: 80 } },
    { id: 'draw', kind: 'present', ui: { x: 760, y: 80 } },
  ],
  edges: [
    { from: 'start', to: 'base' },
    { from: 'base', to: 'idle' },
    { from: 'idle', to: 'spin' },
    { from: 'spin', to: 'draw' },
    { from: 'draw', to: 'idle' },
  ],
};

const kind = (
  kind: string,
  outs: string[],
  trigger = false,
  schema: unknown = {},
): FlowKindInfo => ({
  kind,
  outs,
  trigger,
  schema,
});
export const FIVE_KINDS: FlowKindInfo[] = [
  kind('boot', ['next'], true),
  kind('show', ['next']),
  kind('on', ['next'], true),
  kind('spin', ['result', 'failed']),
  kind('present', ['next', 'failed']),
  kind('wait', ['next']),
];

function scenesStub(ids: readonly string[]): ScenesService {
  let selected: SceneSelection | null = null;
  const listeners = new Set<() => void>();
  return {
    docs: () => ids.map((id) => ({ id, nodes: [] })),
    diagnostics: () => [],
    nodeTypes: () => [],
    selected: () => selected,
    select(sel) {
      selected = sel;
      for (const fn of listeners) fn();
    },
    create: async () => [],
    remove: async () => [],
    update: async () => [],
    preview: async () => [],
    open: () => {},
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const built: Context[] = [];
afterEach(async () => {
  for (const ctx of built.splice(0)) await ctx.fiber.dispose();
});

export async function harness(routes: Record<string, Route>, sceneIds: readonly string[] = []) {
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
  ctx.provide('scenes', scenesStub(sceneIds));
  await ctx.plugin(flow, { url: 'ws://x/ide', fetchFn });
  return { ctx, socket, calls, fetchFn };
}

export const boot =
  (body: unknown): Route =>
  () => ({ body });

export function renderDocument(ctx: Context) {
  const entry = ctx.slots.list('shell.document').find((e) => e.key === 'flow');
  if (!entry) throw new Error('flow did not register a shell.document entry');
  render(<entry.component ctx={ctx} />);
}
