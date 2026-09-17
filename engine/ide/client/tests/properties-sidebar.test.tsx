import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { SceneDoc, ServerMessage } from '@energy8engine/contracts';
import type { WebSocketLike } from '../src/plugins/connection';
import * as connection from '../src/plugins/connection';
import * as slots from '../src/plugins/slots';
import * as shell from '../src/plugins/shell';
import * as viewers from '../src/plugins/viewers';
import * as scenes from '../src/plugins/scenes';
import * as assetNodeTypes from '../src/plugins/asset-node-types';
import * as files from '../src/plugins/files';

/**
 * The Properties sidebar, rendered through the plugin's OWN
 * `shell.sideRight` registration on a real `Context` — booted the way
 * `scene-document.test.tsx` boots. Every edit is asserted as the PUT body
 * that went out; a rename is also the `select` POST under the new id.
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

type Route = (body: unknown) => { status?: number; body: unknown };

const BASE: SceneDoc = {
  id: 'base_game',
  nodes: [
    {
      id: 'bg',
      type: 'container',
      props: {},
      children: [{ id: 'logo', type: 'image', props: { src: 'logo.png', x: 10 } }],
    },
    { id: 'title', type: 'image', props: { src: 'title.png' } },
    { id: 'nested', type: 'scene', props: { scene: 'bonus' } },
  ],
};
// `bonus` nests `base_game` back: the asset walk must not loop.
const BONUS: SceneDoc = {
  id: 'bonus',
  nodes: [
    { id: 'b', type: 'image', props: { src: 'bonus.png' } },
    { id: 'again', type: 'image', props: { src: 'logo.png' } },
    { id: 'back', type: 'scene', props: { scene: 'base_game' } },
  ],
};
const TYPES = [
  { type: 'container', schema: Schema.object({}).toJSON() },
  { type: 'image', schema: Schema.object({ src: Schema.string().required() }).toJSON() },
  {
    type: 'scene',
    schema: Schema.object({ scene: Schema.string().required().description('scene id') }).toJSON(),
  },
];

const built: Context[] = [];
afterEach(async () => {
  for (const ctx of built.splice(0)) await ctx.fiber.dispose();
});

async function harness(extra: Record<string, Route> = {}) {
  const socket = new FakeSocket();
  const calls: { method: string; url: string; body: any }[] = [];
  const routes: Record<string, Route> = {
    'GET /api/scenes': () => ({
      body: { scenes: [BASE, BONUS], diagnostics: [], nodeTypes: TYPES },
    }),
    'PUT /api/scenes/base_game': (body) => ({
      body: { scenes: [body as SceneDoc, BONUS], diagnostics: [], nodeTypes: TYPES },
    }),
    'POST /api/scenes/select': () => ({ body: { diagnostics: [] } }),
    'POST /api/scenes/preview': () => ({ body: { diagnostics: [] } }),
    ...extra,
  };
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`unexpected fetch: ${method} ${url}`);
    const answer = route(body);
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
  await ctx.plugin(viewers);
  // The canvas (`SceneDocument`, not rendered here) is why `scenes` injects these four.
  ctx.provide('workspace', { state: () => null, subscribe: () => () => {} });
  ctx.provide('gameComposition', { rows: null, reloads: 0, subscribe: () => () => {} });
  await ctx.plugin(assetNodeTypes);
  await ctx.plugin(files, { fetchFn });
  await ctx.plugin(scenes, { url: 'ws://x/ide', fetchFn });
  await vi.waitFor(() => expect(ctx.scenes.docs()).toEqual([BASE, BONUS]));
  const puts = () => calls.filter((c) => c.method === 'PUT').map((c) => c.body as SceneDoc);
  const selects = () =>
    calls.filter((c) => c.url === '/api/scenes/select').map((c) => c.body as unknown);
  return { ctx, calls, puts, selects };
}

function renderSide(ctx: Context) {
  const entry = ctx.slots.list('shell.sideRight').find((e) => e.key === 'scenes');
  if (!entry) throw new Error('no shell.sideRight registration for "scenes"');
  const C = entry.component as React.ComponentType<{ ctx: Context }>;
  return render(<C ctx={ctx} />);
}

describe('PropertiesSidebar', () => {
  it('shows on select and hides on select(null)', async () => {
    const { ctx } = await harness();
    expect(ctx.shell.sideRight()).toBeUndefined();
    ctx.scenes.select({ scene: 'base_game', node: null });
    expect(ctx.shell.sideRight()).toBe('scenes');
    ctx.scenes.select({ scene: 'base_game', node: 'logo' });
    expect(ctx.shell.sideRight()).toBe('scenes');
    ctx.scenes.select(null);
    expect(ctx.shell.sideRight()).toBeUndefined();
  });

  it("a node: id, type, the common fields merged with the type's own; a change PUTs", async () => {
    const { ctx, puts } = await harness();
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'logo' }));
    renderSide(ctx);
    expect((screen.getByTestId('prop-id') as HTMLInputElement).value).toBe('logo');
    expect(screen.getByTestId('prop-type')).toHaveTextContent('image');
    expect((screen.getByLabelText('x, design px') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('src') as HTMLInputElement).value).toBe('logo.png');

    // A PUT re-reads and revalidates the whole project: typing is a draft,
    // blur (or Enter) is the one write.
    const x = screen.getByLabelText('x, design px');
    fireEvent.change(x, { target: { value: '2' } });
    fireEvent.change(x, { target: { value: '25' } });
    expect(puts()).toHaveLength(0);
    fireEvent.blur(x);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[0].children?.[0]).toEqual({
      id: 'logo',
      type: 'image',
      props: { src: 'logo.png', x: 25 },
    });
    // The rest of the document is untouched.
    expect(puts()[0].nodes.slice(1)).toEqual(BASE.nodes.slice(1));
  });

  it('rename: a duplicate or empty id is refused inline, no write', async () => {
    const { ctx, puts } = await harness();
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'logo' }));
    renderSide(ctx);
    const input = screen.getByTestId('prop-id') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('prop-id-error')).toHaveTextContent('title');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('prop-id-error')).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  it('rename: PUTs the renamed node and re-selects it under the new id', async () => {
    const { ctx, puts, selects } = await harness();
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'logo' }));
    renderSide(ctx);
    const input = screen.getByTestId('prop-id') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hero' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[0].children?.[0]).toEqual({
      id: 'hero',
      type: 'image',
      props: { src: 'logo.png', x: 10 },
    });
    await waitFor(() => expect(selects().at(-1)).toEqual({ scene: 'base_game', node: 'hero' }));
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: 'hero' });
    await waitFor(() =>
      expect((screen.getByTestId('prop-id') as HTMLInputElement).value).toBe('hero'),
    );
  });

  it("rename: the host's refusal shows inline and the selection stays", async () => {
    const { ctx, puts, selects } = await harness({
      'PUT /api/scenes/base_game': () => ({
        status: 400,
        body: { diagnostics: [{ severity: 'error', where: 'scenes', message: 'bad id "hero"' }] },
      }),
    });
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'logo' }));
    renderSide(ctx);
    const before = selects().length;
    const input = screen.getByTestId('prop-id') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hero' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(puts()).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId('prop-id-error')).toHaveTextContent('bad id "hero"'),
    );
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: 'logo' });
    expect(selects()).toHaveLength(before);
  });

  it('a scene: id, the node count (nested included), assets through nested scenes, deduped, cycle-safe', async () => {
    const { ctx } = await harness();
    act(() => ctx.scenes.select({ scene: 'base_game', node: null }));
    renderSide(ctx);
    expect(screen.getByTestId('prop-scene-id')).toHaveTextContent('base_game');
    expect(screen.getByTestId('prop-node-count')).toHaveTextContent('4');
    const items = Array.from(screen.getByTestId('prop-assets').querySelectorAll('li')).map(
      (li) => li.textContent,
    );
    expect(items).toEqual(['logo.png', 'title.png', 'bonus.png']);
    expect(screen.queryByTestId('prop-id')).toBeNull();
  });

  it('a selected node that is no longer in the document renders nothing but keeps the root', async () => {
    const { ctx } = await harness();
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'gone' }));
    renderSide(ctx);
    expect(screen.getByTestId('properties')).toBeTruthy();
    expect(screen.queryByTestId('prop-id')).toBeNull();
    expect(screen.queryByTestId('prop-scene-id')).toBeNull();
  });
});
