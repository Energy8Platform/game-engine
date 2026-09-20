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
import { mergedSchema } from '../src/shell/PropertiesSidebar';

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
    'GET /api/files': () => ({ body: { entries: [], diagnostics: [] } }),
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

  it('the common form carries every prop the runtime applies; a new one PUTs', async () => {
    const { ctx, puts } = await harness();
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'logo' }));
    renderSide(ctx);
    for (const label of [
      'width, design px',
      'height, design px',
      '#rrggbb, where the view has a tint',
      'overrides anchor on x',
      'overrides anchor on y',
      'masks the parent with this node',
    ])
      expect(screen.getByLabelText(label)).toBeTruthy();

    const width = screen.getByLabelText('width, design px');
    fireEvent.change(width, { target: { value: '64' } });
    fireEvent.blur(width);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[0].children?.[0]).toEqual({
      id: 'logo',
      type: 'image',
      props: { src: 'logo.png', x: 10, width: 64 },
    });
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

  it("an `asset` field is a select of the project's files with those extensions, refetched when the scene set changes", async () => {
    let entries = [
      { path: 'assets/a.png', kind: 'file', size: 1 },
      { path: 'assets/b.jpg', kind: 'file', size: 1 },
      { path: 'assets/c.mp4', kind: 'file', size: 1 },
      { path: 'assets', kind: 'dir' },
    ];
    const withAsset = TYPES.map((t) =>
      t.type === 'image'
        ? {
            ...t,
            schema: Schema.object({
              src: Schema.string().required().extra('asset', ['png', 'jpg']).description('image'),
            }).toJSON(),
          }
        : t,
    );
    const { ctx, puts, calls } = await harness({
      'GET /api/scenes': () => ({
        body: { scenes: [BASE, BONUS], diagnostics: [], nodeTypes: withAsset },
      }),
      'PUT /api/scenes/base_game': (body) => ({
        body: { scenes: [body as SceneDoc, BONUS], diagnostics: [], nodeTypes: withAsset },
      }),
      'GET /api/files': () => ({ body: { entries, diagnostics: [] } }),
    });
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'logo' }));
    renderSide(ctx);
    const src = screen.getByLabelText('image') as HTMLSelectElement;
    expect(src.tagName).toBe('SELECT');
    await waitFor(() =>
      expect([...src.options].map((o) => o.value)).toEqual([
        '',
        'assets/a.png',
        'assets/b.jpg',
        'logo.png',
      ]),
    );
    const treeReads = () => calls.filter((c) => c.url === '/api/files').length;
    const before = treeReads();
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'logo' }));
    expect(treeReads()).toBe(before); // a selection is not a change to the set

    // The write answers a new set: the tree is read again (a dropped File lands as a write first).
    entries = [...entries, { path: 'assets/new.png', kind: 'file', size: 1 }];
    fireEvent.change(src, { target: { value: 'assets/b.jpg' } });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[0].children?.[0]).toEqual({
      id: 'logo',
      type: 'image',
      props: { src: 'assets/b.jpg', x: 10 },
    });
    await waitFor(() => expect([...src.options].map((o) => o.value)).toContain('assets/new.png'));
  });

  it("a `pick: 'node'` field is a select of every scene's nodes as <scene>/<node>, nested included", async () => {
    const withNode = TYPES.map((t) =>
      t.type === 'image'
        ? {
            ...t,
            schema: Schema.object({
              src: Schema.string().required(),
              follow: Schema.string().extra('pick', 'node').description('node to follow'),
            }).toJSON(),
          }
        : t,
    );
    const { ctx, puts } = await harness({
      'GET /api/scenes': () => ({
        body: { scenes: [BASE, BONUS], diagnostics: [], nodeTypes: withNode },
      }),
      'PUT /api/scenes/base_game': (body) => ({
        body: { scenes: [body as SceneDoc, BONUS], diagnostics: [], nodeTypes: withNode },
      }),
    });
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'title' }));
    renderSide(ctx);
    const follow = screen.getByLabelText('node to follow') as HTMLSelectElement;
    expect(follow.tagName).toBe('SELECT');
    expect([...follow.options].map((o) => o.value)).toEqual([
      '',
      'base_game/bg',
      'base_game/logo',
      'base_game/title',
      'base_game/nested',
      'bonus/b',
      'bonus/again',
      'bonus/back',
    ]);
    fireEvent.change(follow, { target: { value: 'bonus/b' } });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[1]).toEqual({
      id: 'title',
      type: 'image',
      props: { src: 'title.png', follow: 'bonus/b' },
    });
  });

  it("under variant: 'portrait' a root's edit writes the override only — the changed key into portrait.nodes[id], the node untouched — and the form shows the override merged over the node", async () => {
    const { ctx, puts } = await harness();
    act(() => ctx.scenes.setVariant('portrait'));
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'title' }));
    renderSide(ctx);
    expect(screen.getByTestId('prop-variant')).toHaveTextContent('portrait');
    const x = screen.getByLabelText('x, design px');
    fireEvent.change(x, { target: { value: '25' } });
    fireEvent.blur(x);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes).toEqual(BASE.nodes);
    expect(puts()[0].portrait).toEqual({ nodes: { title: { x: 25 } } });
    // The answer shows through: the form's x is the override's, its src still the node's.
    await waitFor(() =>
      expect((screen.getByLabelText('x, design px') as HTMLInputElement).value).toBe('25'),
    );
    expect((screen.getByLabelText('src') as HTMLInputElement).value).toBe('title.png');
    // A second edit merges into the same entry.
    const alpha = screen.getByLabelText('alpha');
    fireEvent.change(alpha, { target: { value: '0.5' } });
    fireEvent.blur(alpha);
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].portrait).toEqual({ nodes: { title: { x: 25, alpha: 0.5 } } });
    expect(puts()[1].nodes[1].props).toEqual({ src: 'title.png' });
  });

  it("under variant: 'portrait' a NESTED node still edits itself (no override for it), and no badge shows", async () => {
    const { ctx, puts } = await harness();
    act(() => ctx.scenes.setVariant('portrait'));
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'logo' }));
    renderSide(ctx);
    expect(screen.queryByTestId('prop-variant')).toBeNull();
    const x = screen.getByLabelText('x, design px');
    fireEvent.change(x, { target: { value: '25' } });
    fireEvent.blur(x);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].portrait).toBeUndefined();
    expect(puts()[0].nodes[0].children?.[0].props).toEqual({ src: 'logo.png', x: 25 });
  });

  it("pin is a select of the nine points (and ''); with a pin set, x/y are labelled as offsets — the override's pin counts", async () => {
    const { ctx, puts } = await harness();
    act(() => ctx.scenes.select({ scene: 'base_game', node: 'title' }));
    renderSide(ctx);
    const pin = screen.getByLabelText(/anchors x\/y to this point/) as HTMLSelectElement;
    expect(pin.tagName).toBe('SELECT');
    expect([...pin.options].map((o) => o.value)).toEqual([
      '',
      'top-left',
      'top',
      'top-right',
      'left',
      'center',
      'right',
      'bottom-left',
      'bottom',
      'bottom-right',
    ]);
    expect(screen.getByLabelText('x, design px')).toBeTruthy();
    expect(screen.queryByLabelText('offset x, design px')).toBeNull();
    fireEvent.change(pin, { target: { value: 'bottom-right' } });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[1].props).toEqual({ src: 'title.png', pin: 'bottom-right' });
    await waitFor(() => expect(screen.getByLabelText('offset x, design px')).toBeTruthy());
    expect(screen.getByLabelText('offset y, design px')).toBeTruthy();
    expect(screen.queryByLabelText('x, design px')).toBeNull();
    // Back to absolute, then a portrait override pinning it: the merged value decides.
    fireEvent.change(screen.getByLabelText(/anchors x\/y to this point/), {
      target: { value: '' },
    });
    await waitFor(() => expect(puts()).toHaveLength(2));
    await waitFor(() => expect(screen.getByLabelText('x, design px')).toBeTruthy());
    act(() => ctx.scenes.setVariant('portrait'));
    fireEvent.change(screen.getByLabelText(/anchors x\/y to this point/), {
      target: { value: 'top' },
    });
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect(puts()[2].portrait).toEqual({ nodes: { title: { pin: 'top' } } });
    expect(puts()[2].nodes[1].props).toEqual({ src: 'title.png', pin: '' });
    await waitFor(() => expect(screen.getByLabelText('offset x, design px')).toBeTruthy());
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

describe('mergedSchema', () => {
  it("a type declaring `width` itself owns the form's one `width` field", () => {
    // One dict key, so one field — and it is the TYPE's, not COMMON's: a
    // `shape`'s `width` is the rectangle it draws, and its description (and
    // default) is what the form must show.
    const merged = mergedSchema({
      type: 'shape',
      schema: Schema.object({
        width: Schema.number().default(100).description('design px (rect/roundRect/ellipse)'),
      }).toJSON(),
    });
    const dict = (new Schema(merged as never) as unknown as { dict: Record<string, Schema> }).dict;
    expect(dict.width.meta).toMatchObject({
      default: 100,
      description: 'design px (rect/roundRect/ellipse)',
    });
    // The common props a type does NOT declare are untouched.
    expect(dict.x.meta.description).toBe('x, design px');
  });

  it('pinned re-describes x/y as offsets and nothing else', () => {
    const dict = (
      new Schema(mergedSchema(undefined, true) as never) as unknown as {
        dict: Record<string, Schema>;
      }
    ).dict;
    expect(dict.x.meta).toMatchObject({ default: 0, description: 'offset x, design px' });
    expect(dict.y.meta).toMatchObject({ default: 0, description: 'offset y, design px' });
    expect(dict.scale.meta.default).toBe(1);
    expect(Object.keys(dict)).toEqual(
      Object.keys(
        (new Schema(mergedSchema(undefined) as never) as unknown as { dict: object }).dict,
      ),
    );
  });
});
