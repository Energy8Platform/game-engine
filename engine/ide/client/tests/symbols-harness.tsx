import { render } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { NodeTypeInfo, SceneDoc, ServerMessage, SymbolsDoc } from '@energy8engine/contracts';
import type { WebSocketLike } from '../src/plugins/connection';
import * as connection from '../src/plugins/connection';
import * as slots from '../src/plugins/slots';
import * as shell from '../src/plugins/shell';
import * as flow from '../src/plugins/flow';
import * as files from '../src/plugins/files';
import * as assetNodeTypes from '../src/plugins/asset-node-types';
import * as symbols from '../src/plugins/symbols';
import type { SceneSelection, ScenesService } from '../src/plugins/scenes';

/**
 * The one symbols test harness, shared by the service, document and
 * Properties tests — `flow-harness.tsx`'s shape: the `symbols` service
 * booted on a real `Context` with the real `connection` (fake socket),
 * `slots`, `shell`, `files`, `assetNodeTypes` and `flow` (the mutual
 * deselect is tested against the real one; its boot GET answers empty
 * unless routed), plus a stub `scenes` holding a selection, a doc list
 * and the node types (what the deselect, the pickers, the drop and the
 * type select read). Every `accept`-ing type is registered as a
 * `derived:<type>` asset node type, the way the real `scenes` does.
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

const json = (schema: unknown) => JSON.parse(JSON.stringify(schema));
/** `image` (no loop), `spritesheet` (loop) and `container` (no accept — never a state type). */
export const TYPES: NodeTypeInfo[] = [
  {
    type: 'spritesheet',
    schema: json(
      Schema.object({
        sheet: Schema.string().required().extra('asset', ['json']).description('sheet file'),
        loop: Schema.boolean().default(true).description('loop'),
      }),
    ),
    accept: { extensions: ['json'], prop: 'sheet' },
  },
  {
    type: 'image',
    schema: json(
      Schema.object({
        src: Schema.string().required().extra('asset', ['png']).description('image file'),
      }),
    ),
    accept: { extensions: ['png'], prop: 'src' },
  },
  { type: 'container', schema: json(Schema.object({})) },
];

export const KNOWN = [
  { id: '1', name: 'cherry' },
  { id: '2', name: 'lemon' },
];

/** Where the game is served — same shape `scene-document.test.tsx` uses. */
export const PREVIEW_URL = 'http://127.0.0.1:5682';

export const TWO: SymbolsDoc = {
  version: 1,
  symbols: [
    {
      id: '1',
      name: 'cherry',
      static: { type: 'image', props: { src: 'assets/1.png' } },
      win: { type: 'spritesheet', props: { sheet: 'assets/coin.json', loop: false } },
    },
    { id: '2', name: 'lemon', fit: 'none', static: { type: 'image', props: { src: '' } } },
  ],
};

export const FILES = [
  { path: 'assets/1.png', kind: 'file', size: 1 },
  { path: 'assets/coin.json', kind: 'file', size: 1 },
  { path: 'assets/song.mp3', kind: 'file', size: 1 },
];

function scenesStub(docs: readonly SceneDoc[], types: readonly NodeTypeInfo[]): ScenesService {
  let selected: SceneSelection | null = null;
  const listeners = new Set<() => void>();
  return {
    docs: () => docs,
    diagnostics: () => [],
    nodeTypes: () => types,
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

export async function harness(
  routes: Record<string, Route>,
  opts: {
    scenes?: readonly SceneDoc[];
    types?: readonly NodeTypeInfo[];
    /** Defaults to `PREVIEW_URL`; pass `null` for the "no project open" case. */
    previewUrl?: string | null;
  } = {},
) {
  const socket = new FakeSocket();
  const calls: { method: string; url: string; body: unknown }[] = [];
  const defaults: Record<string, Route> = {
    'GET /api/files': () => ({ body: { entries: FILES, diagnostics: [] } }),
    'GET /api/flow': () => ({ body: { doc: null, diagnostics: [], kinds: [] } }),
  };
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const route = routes[`${method} ${url}`] ?? defaults[`${method} ${url}`];
    if (!route) throw new Error(`unexpected fetch: ${method} ${url}`);
    const answer = await route(body);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const types = opts.types ?? TYPES;
  const ctx = new Context();
  built.push(ctx);
  await ctx.plugin(connection, { url: 'ws://x/ide', socketFactory: () => socket });
  await ctx.plugin(slots);
  await ctx.plugin(shell);
  ctx.provide('scenes', scenesStub(opts.scenes ?? [], types));
  await ctx.plugin(files, { fetchFn });
  await ctx.plugin(assetNodeTypes);
  for (const { type, accept } of types)
    if (accept)
      ctx.assetNodeTypes.register(`derived:${type}`, {
        extensions: accept.extensions,
        sibling: accept.sibling,
        node: (path, { x, y }) => ({ type, props: { [accept.prop]: path, x, y, anchor: 0.5 } }),
      });
  await ctx.plugin(flow, { url: 'ws://x/ide', fetchFn });
  // The document's canvas reads two services it never did before this
  // task: where the game is served, and the design size the `scenes1`
  // composition row declares. Minimal fakes, `scene-document.test.tsx`'s shape.
  const nothing = () => () => {};
  const previewUrl = opts.previewUrl === undefined ? PREVIEW_URL : opts.previewUrl;
  const workspace = { projects: [], templates: [], active: 'first', previewUrl, diagnostics: [] };
  ctx.provide('workspace', {
    state: () => workspace,
    subscribe: nothing,
    open: async () => [],
    create: async () => [],
  });
  ctx.provide('gameComposition', {
    rows: [],
    diagnostics: [],
    reloads: 0,
    transitions: [],
    subscribe: nothing,
    update: async () => ({ reload: false, diagnostics: [] }),
  });
  await ctx.plugin(symbols, { url: 'ws://x/ide', fetchFn });
  const puts = () =>
    calls.filter((c) => c.method === 'PUT' && c.url === '/api/symbols').map((c) => c.body);
  return { ctx, socket, calls, fetchFn, puts };
}

export const boot =
  (body: unknown = { doc: TWO, known: KNOWN, diagnostics: [] }): Route =>
  () => ({ body });

/** The host's answer to an accepted PUT: the doc as sent, `known` as before. */
export const accept: Route = (body) => ({
  body: { doc: (body as { doc: SymbolsDoc }).doc, known: KNOWN, diagnostics: [] },
});

/** jsdom has no DataTransfer; what `fireEvent` attaches is a plain object with the members the document reads. */
export function transfer(path: string) {
  return {
    dataTransfer: {
      types: ['text/x-e8-path'],
      getData: (t: string) => (t === 'text/x-e8-path' ? path : ''),
      dropEffect: 'copy',
    },
  };
}

export function renderDocument(ctx: Context) {
  const entry = ctx.slots.list('shell.document').find((e) => e.key === 'symbols');
  if (!entry) throw new Error('symbols did not register a shell.document entry');
  return render(<entry.component ctx={ctx} />);
}

export function renderSide(ctx: Context) {
  const entry = ctx.slots.list('shell.sideRight').find((e) => e.key === 'symbols');
  if (!entry) throw new Error('no shell.sideRight registration for "symbols"');
  const C = entry.component as React.ComponentType<{ ctx: Context }>;
  return render(<C ctx={ctx} />);
}
