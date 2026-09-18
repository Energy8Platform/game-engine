import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import type { Diagnostic, SceneDoc, ServerMessage } from '@energy8engine/contracts';
import * as connection from '../src/plugins/connection';
import type { WebSocketLike } from '../src/plugins/connection';
import * as slots from '../src/plugins/slots';
import * as shell from '../src/plugins/shell';
import * as viewers from '../src/plugins/viewers';
import * as scenes from '../src/plugins/scenes';
import * as assetNodeTypes from '../src/plugins/asset-node-types';
import * as files from '../src/plugins/files';

/**
 * The `scenes` service booted on a real `Context` with the real
 * `connection` (fake socket), `slots`, `shell` and `viewers` — the plugins it
 * injects — and a `fetchFn` that routes on method + URL and records every
 * call, so each test asserts the path, method and body that went out.
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

type Route = (body: unknown) => { status?: number; body: unknown } | Promise<never>;

const A: SceneDoc = { id: 'a', nodes: [{ id: 'n', type: 'sprite', props: {} }] };
const B: SceneDoc = { id: 'b', nodes: [] };
const TYPES = [{ type: 'sprite', schema: { type: 'object' } }];
const refusal: Diagnostic = { severity: 'error', plugin: 'scenes', where: 'a', message: 'exists' };

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
  await ctx.plugin(viewers);
  // The canvas (`SceneDocument`, not rendered here) is why `scenes` injects these four.
  ctx.provide('workspace', { state: () => null, subscribe: () => () => {} });
  ctx.provide('gameComposition', { rows: null, reloads: 0, subscribe: () => () => {} });
  await ctx.plugin(assetNodeTypes);
  await ctx.plugin(files, { fetchFn });
  await ctx.plugin(scenes, { url: 'ws://x/ide', fetchFn });
  return { ctx, socket, calls, fetchFn };
}

const boot =
  (body: unknown = { scenes: [A], diagnostics: [], nodeTypes: [] }): Route =>
  () => ({ body });

describe('scenes service', () => {
  it('boots from GET /api/scenes, updates on `scenes` and `node-types` frames', async () => {
    const { ctx, socket, calls } = await harness({ 'GET /api/scenes': boot() });
    await vi.waitFor(() => expect(ctx.scenes.docs()).toEqual([A]));
    expect(calls).toEqual([{ method: 'GET', url: '/api/scenes', body: undefined }]);
    expect(ctx.scenes.nodeTypes()).toEqual([]);

    const listener = vi.fn();
    ctx.scenes.subscribe(listener);
    socket.receive({ type: 'scenes', scenes: [A, B], diagnostics: [refusal] });
    expect(ctx.scenes.docs()).toEqual([A, B]);
    expect(ctx.scenes.diagnostics()).toEqual([refusal]);
    socket.receive({ type: 'node-types', types: TYPES });
    expect(ctx.scenes.nodeTypes()).toEqual(TYPES);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('registers the activity that opens the sidebar', async () => {
    const { ctx } = await harness({ 'GET /api/scenes': boot() });
    expect(ctx.slots.list('shell.activity')).toEqual([
      expect.objectContaining({ key: 'scenes', icon: 'layers', order: 35, opens: 'sidebar' }),
    ]);
  });

  it('create POSTs and returns the refusal as diagnostics on 400', async () => {
    const { ctx, calls } = await harness({
      'GET /api/scenes': boot(),
      'POST /api/scenes': (body) =>
        (body as { id: string }).id === 'a'
          ? { status: 400, body: { diagnostics: [refusal] } }
          : { body: { scenes: [A, B], diagnostics: [], nodeTypes: [] } },
    });
    await vi.waitFor(() => expect(ctx.scenes.docs()).toEqual([A]));

    expect(await ctx.scenes.create('a')).toEqual([refusal]);
    expect(calls[1]).toEqual({ method: 'POST', url: '/api/scenes', body: { id: 'a' } });
    expect(ctx.scenes.docs()).toEqual([A]);
    // A host refusal is the host's to say; it is not re-reported as this plugin's.
    expect(ctx.connection.diagnostics).toEqual([]);

    expect(await ctx.scenes.create('b')).toEqual([]);
    expect(ctx.scenes.docs()).toEqual([A, B]);
  });

  it('update PUTs the document and applies the answer; remove DELETEs', async () => {
    const changed: SceneDoc = { id: 'a', nodes: [] };
    const { ctx, calls } = await harness({
      'GET /api/scenes': boot(),
      'PUT /api/scenes/a': () => ({
        body: { scenes: [changed], diagnostics: [], nodeTypes: TYPES },
      }),
      'DELETE /api/scenes/a': () => ({ body: { scenes: [], diagnostics: [], nodeTypes: TYPES } }),
    });
    await vi.waitFor(() => expect(ctx.scenes.docs()).toEqual([A]));

    expect(await ctx.scenes.update(changed)).toEqual([]);
    expect(calls[1]).toEqual({ method: 'PUT', url: '/api/scenes/a', body: changed });
    expect(ctx.scenes.docs()).toEqual([changed]);
    expect(ctx.scenes.nodeTypes()).toEqual(TYPES);

    expect(await ctx.scenes.remove('a')).toEqual([]);
    expect(calls[2]).toEqual({ method: 'DELETE', url: '/api/scenes/a', body: undefined });
    expect(ctx.scenes.docs()).toEqual([]);
  });

  it('a transport failure is one diagnostic of its own, returned and reported', async () => {
    const { ctx } = await harness({
      'GET /api/scenes': boot(),
      'POST /api/scenes/preview': () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await vi.waitFor(() => expect(ctx.scenes.docs()).toEqual([A]));
    const answer = await ctx.scenes.preview('a');
    expect(answer).toEqual([
      expect.objectContaining({
        plugin: 'scenes',
        where: '/api/scenes/preview',
        severity: 'error',
      }),
    ]);
    expect(answer[0].message).toContain('ECONNREFUSED');
    expect(ctx.connection.diagnostics).toEqual(answer);
  });

  it('select POSTs /api/scenes/select and notifies; selecting null POSTs node: null', async () => {
    const { ctx, calls } = await harness({
      'GET /api/scenes': boot(),
      'POST /api/scenes/select': () => ({ body: { diagnostics: [] } }),
    });
    await vi.waitFor(() => expect(ctx.scenes.docs()).toEqual([A]));
    const listener = vi.fn();
    ctx.scenes.subscribe(listener);

    // Nothing selected yet: clearing has nothing to tell the host.
    ctx.scenes.select(null);
    expect(calls).toHaveLength(1);

    ctx.scenes.select({ scene: 'a', node: 'n' });
    expect(ctx.scenes.selected()).toEqual({ scene: 'a', node: 'n' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(calls[1]).toEqual({
      method: 'POST',
      url: '/api/scenes/select',
      body: { scene: 'a', node: 'n' },
    });

    ctx.scenes.select(null);
    expect(ctx.scenes.selected()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(calls[2]).toEqual({
      method: 'POST',
      url: '/api/scenes/select',
      body: { scene: 'a', node: null },
    });
  });

  it('open opens the file path through the shell; closing that tab clears a selection in that scene', async () => {
    const { ctx, calls } = await harness({
      'GET /api/scenes': boot(),
      'POST /api/scenes/select': () => ({ body: { diagnostics: [] } }),
    });
    await vi.waitFor(() => expect(ctx.scenes.docs()).toEqual([A]));
    const opener = vi.fn();
    ctx.shell.registerPathOpener(opener);

    ctx.scenes.open('a');
    expect(opener).toHaveBeenCalledWith('scenes/a.scene.yml');

    // A selection made with no tab open is the sidebar's; a shell change
    // that is not this scene's tab closing leaves it alone.
    ctx.scenes.select({ scene: 'a', node: 'n' });
    ctx.shell.open({ key: 'f:other.txt', title: 'other', component: () => null, closable: true });
    ctx.shell.close('f:other.txt');
    expect(ctx.scenes.selected()).toEqual({ scene: 'a', node: 'n' });

    const key = 'f:scenes/a.scene.yml';
    ctx.shell.open({ key, title: 'a.scene.yml', component: () => null, closable: true });
    ctx.shell.close(key);
    expect(ctx.scenes.selected()).toBeNull();
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: '/api/scenes/select',
      body: { scene: 'a', node: null },
    });
  });

  it('derives an asset node type per reported type with `accept`; the next report replaces them', async () => {
    const image = { type: 'image', schema: {}, accept: { extensions: ['png'], prop: 'src' } };
    const spine = {
      type: 'spine',
      schema: {},
      accept: { extensions: ['skel', 'json'], prop: 'skeleton', sibling: 'atlas' },
    };
    const { ctx, socket } = await harness({
      'GET /api/scenes': boot({ scenes: [A], diagnostics: [], nodeTypes: [image] }),
    });
    await vi.waitFor(() =>
      expect(ctx.assetNodeTypes.list().map((r) => r.id)).toEqual(['derived:image']),
    );
    expect(ctx.assetNodeTypes.pick('a.png')?.node('a.png', { x: 1, y: 2 })).toEqual({
      type: 'image',
      props: { src: 'a.png', x: 1, y: 2, anchor: 0.5 },
    });

    socket.receive({
      type: 'node-types',
      types: [{ type: 'container', schema: {} }, image, spine],
    });
    expect(ctx.assetNodeTypes.list().map((r) => r.id)).toEqual(['derived:image', 'derived:spine']);
    const picked = ctx.assetNodeTypes.pick('a.json', [{ path: 'a.atlas', kind: 'file' }]);
    expect(picked?.sibling).toBe('atlas');
    expect(picked?.node('a.json', { x: 0, y: 0 })).toEqual({
      type: 'spine',
      props: { skeleton: 'a.json', x: 0, y: 0, anchor: 0.5 },
    });

    socket.receive({
      type: 'node-types',
      types: [{ type: 'video', schema: {}, accept: { extensions: ['mp4'], prop: 'src' } }],
    });
    expect(ctx.assetNodeTypes.list().map((r) => r.id)).toEqual(['derived:video']);
    expect(ctx.assetNodeTypes.pick('a.png')).toBeUndefined();

    // A project's own registration outranks the derived one — made after the report...
    ctx.assetNodeTypes.register('mine', {
      extensions: ['mp4'],
      node: (src, at) => ({ type: 'clip', props: { src, ...at } }),
    });
    expect(ctx.assetNodeTypes.pick('a.mp4')?.node('a.mp4', { x: 0, y: 0 }).type).toBe('clip');
    // ...or before it, and it survives the next report re-deriving the same type.
    ctx.assetNodeTypes.register('early', {
      extensions: ['gif'],
      node: (src, at) => ({ type: 'still', props: { src, ...at } }),
    });
    socket.receive({
      type: 'node-types',
      types: [{ type: 'gif', schema: {}, accept: { extensions: ['gif'], prop: 'src' } }],
    });
    expect(ctx.assetNodeTypes.list().map((r) => r.id)).toEqual(['mine', 'early', 'derived:gif']);
    expect(ctx.assetNodeTypes.pick('a.gif')?.node('a.gif', { x: 0, y: 0 }).type).toBe('still');
  });
});
