import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { addNode, moveNode, nextId, removeNode } from '../src/shell/SceneDocument';

/**
 * The scene tab, rendered through the plugin's OWN viewer registration
 * (`ctx.viewers.pick('scenes/<id>.scene.yml')`) on a real `Context` —
 * the same reason `scenes-sidebar.test.tsx` boots the plugins. Every edit
 * is asserted as the PUT body that went out; the tree re-renders from the
 * answer.
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

const PATH = 'scenes/base_game.scene.yml';
const KEY = `f:${PATH}`;

const BASE: SceneDoc = {
  id: 'base_game',
  nodes: [
    {
      id: 'bg',
      type: 'container',
      props: {},
      children: [{ id: 'logo', type: 'image', props: { src: 'logo.png' } }],
    },
    { id: 'reels-1', type: 'reels', props: {} },
    { id: 'title', type: 'image', props: { src: 'title.png' } },
  ],
};
const BONUS: SceneDoc = { id: 'bonus', nodes: [] };
const TYPES = [
  { type: 'container', schema: Schema.object({}).toJSON() },
  { type: 'image', schema: Schema.object({ src: Schema.string().required() }).toJSON() },
  { type: 'reels', schema: Schema.object({ rows: Schema.number().default(3) }).toJSON() },
  { type: 'scene', schema: Schema.object({}).toJSON() },
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
    // The write's answer is the set with the sent document in place.
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
  await ctx.plugin(scenes, { url: 'ws://x/ide', fetchFn });
  await vi.waitFor(() => expect(ctx.scenes.docs()).toEqual([BASE, BONUS]));
  const puts = () => calls.filter((c) => c.method === 'PUT').map((c) => c.body as SceneDoc);
  return { ctx, socket, calls, puts };
}

function renderTab(ctx: Context, path = PATH) {
  const def = ctx.viewers.pick(path);
  if (!def) throw new Error(`no viewer for ${path}`);
  return render(<def.component ctx={ctx} path={path} />);
}

function transfer() {
  const data: Record<string, string> = {};
  return {
    dataTransfer: {
      get types() {
        return Object.keys(data);
      },
      getData: (t: string) => data[t] ?? '',
      setData: (t: string, v: string) => {
        data[t] = v;
      },
      dropEffect: 'move',
      effectAllowed: 'move',
    },
  };
}

describe('SceneDocument helpers', () => {
  it('nextId takes the smallest free n', () => {
    expect(nextId(BASE, 'container')).toBe('container-1');
    expect(nextId(BASE, 'reels')).toBe('reels-2');
    const gap: SceneDoc = {
      id: 'x',
      nodes: [
        { id: 'image-1', type: 'image', props: {} },
        { id: 'image-3', type: 'image', props: {} },
      ],
    };
    expect(nextId(gap, 'image')).toBe('image-2');
  });

  it('addNode appends to the root or to the named node; removeNode takes the subtree', () => {
    const root = addNode(BASE, 'container', {}, null);
    expect(root.nodes.map((n) => n.id)).toEqual(['bg', 'reels-1', 'title', 'container-1']);
    const nested = addNode(BASE, 'image', { src: '' }, 'bg');
    expect(nested.nodes[0].children?.map((n) => n.id)).toEqual(['logo', 'image-1']);
    expect(nested.nodes[0].children?.[1]).toEqual({
      id: 'image-1',
      type: 'image',
      props: { src: '' },
    });
    expect(BASE.nodes[0].children).toHaveLength(1);

    expect(removeNode(BASE, 'bg').nodes.map((n) => n.id)).toEqual(['reels-1', 'title']);
    expect(removeNode(BASE, 'logo').nodes[0].children).toEqual([]);
  });

  it('moveNode reorders, nests, and refuses into itself or its own descendant', () => {
    expect(moveNode(BASE, 'title', { before: 'reels-1' }).nodes.map((n) => n.id)).toEqual([
      'bg',
      'title',
      'reels-1',
    ]);
    const into = moveNode(BASE, 'reels-1', { into: 'bg' });
    expect(into.nodes.map((n) => n.id)).toEqual(['bg', 'title']);
    expect(into.nodes[0].children?.map((n) => n.id)).toEqual(['logo', 'reels-1']);
    const out = moveNode(BASE, 'logo', { before: 'bg' });
    expect(out.nodes.map((n) => n.id)).toEqual(['logo', 'bg', 'reels-1', 'title']);

    expect(moveNode(BASE, 'bg', { into: 'bg' })).toBe(BASE);
    expect(moveNode(BASE, 'bg', { before: 'logo' })).toBe(BASE);
    expect(moveNode(BASE, 'bg', { before: 'bg' })).toBe(BASE);
    expect(moveNode(BASE, 'nope', { before: 'bg' })).toBe(BASE);
  });
});

describe('SceneDocument', () => {
  it('renders the tree as nested rows with levels; an unknown id says so', async () => {
    const { ctx } = await harness();
    renderTab(ctx);
    expect(screen.getByTestId('scene-doc-base_game')).toBeTruthy();
    const bg = screen.getByTestId('node-bg');
    expect(bg.getAttribute('role')).toBe('treeitem');
    expect(bg.getAttribute('aria-level')).toBe('1');
    expect(bg).toHaveTextContent('container bg');
    expect(screen.getByTestId('node-logo').getAttribute('aria-level')).toBe('2');
    expect(screen.getByTestId('node-reels-1').getAttribute('aria-level')).toBe('1');
    expect(bg.getAttribute('draggable')).toBe('true');

    renderTab(ctx, 'scenes/gone.scene.yml');
    expect(screen.getByTestId('scene-doc-gone')).toBeTruthy();
  });

  it('clicking a row selects it', async () => {
    const { ctx, calls } = await harness();
    renderTab(ctx);
    await userEvent.click(screen.getByTestId('node-logo'));
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: 'logo' });
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: '/api/scenes/select',
      body: { scene: 'base_game', node: 'logo' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('node-logo').getAttribute('aria-selected')).toBe('true'),
    );
    expect(screen.getByTestId('node-bg').getAttribute('aria-selected')).toBe('false');
  });

  it('add appends to the root, or under the selected container, with the schema defaults', async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);

    await userEvent.click(screen.getByTestId('node-add'));
    const select = screen.getByTestId('node-add-type') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      'container',
      'image',
      'reels',
      'scene',
    ]);
    await userEvent.selectOptions(select, 'container');
    await userEvent.click(screen.getByTestId('node-add-ok'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.at(-1)).toEqual({ id: 'container-1', type: 'container', props: {} });
    expect(await screen.findByTestId('node-container-1')).toBeTruthy();

    ctx.scenes.select({ scene: 'base_game', node: 'container-1' });
    await userEvent.click(screen.getByTestId('node-add'));
    await userEvent.selectOptions(screen.getByTestId('node-add-type'), 'container');
    await userEvent.click(screen.getByTestId('node-add-ok'));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].nodes.at(-1)).toEqual({
      id: 'container-1',
      type: 'container',
      props: {},
      children: [{ id: 'container-2', type: 'container', props: {} }],
    });
    expect((await screen.findByTestId('node-container-2')).getAttribute('aria-level')).toBe('2');

    // A selected non-container: the new node goes to the root. Defaults come
    // off the schema: a required string is '', a defaulted number its default.
    ctx.scenes.select({ scene: 'base_game', node: 'logo' });
    await userEvent.click(screen.getByTestId('node-add'));
    await userEvent.selectOptions(screen.getByTestId('node-add-type'), 'image');
    await userEvent.click(screen.getByTestId('node-add-ok'));
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect(puts()[2].nodes.at(-1)).toEqual({ id: 'image-1', type: 'image', props: { src: '' } });

    await userEvent.click(screen.getByTestId('node-add'));
    await userEvent.selectOptions(screen.getByTestId('node-add-type'), 'reels');
    await userEvent.click(screen.getByTestId('node-add-ok'));
    await waitFor(() => expect(puts()).toHaveLength(4));
    expect(puts()[3].nodes.at(-1)).toEqual({ id: 'reels-2', type: 'reels', props: { rows: 3 } });
  });

  it('remove drops the node with its children', async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);
    await userEvent.click(screen.getByTestId('node-remove-bg'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.map((n) => n.id)).toEqual(['reels-1', 'title']);
    await waitFor(() => expect(screen.queryByTestId('node-logo')).toBeNull());
  });

  it('removing the selected node, or its container, clears the selection first', async () => {
    const { ctx, calls, puts } = await harness();
    renderTab(ctx);
    const selects = () => calls.filter((c) => c.url === '/api/scenes/select').map((c) => c.body);

    ctx.scenes.select({ scene: 'base_game', node: 'title' });
    await userEvent.click(screen.getByTestId('node-remove-title'));
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: null });
    expect(selects().at(-1)).toEqual({ scene: 'base_game', node: null });
    await waitFor(() => expect(puts()).toHaveLength(1));

    // A descendant of the removed node is gone with it.
    ctx.scenes.select({ scene: 'base_game', node: 'logo' });
    await userEvent.click(screen.getByTestId('node-remove-bg'));
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: null });
    expect(selects().at(-1)).toEqual({ scene: 'base_game', node: null });
    await waitFor(() => expect(puts()).toHaveLength(2));

    // A selection elsewhere is left alone.
    ctx.scenes.select({ scene: 'base_game', node: 'reels-1' });
    const before = selects().length;
    await userEvent.click(screen.getByTestId('node-remove-reels-1'));
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: null });
    expect(selects()).toHaveLength(before + 1);
  });

  it('a chosen type the game no longer offers falls back to the first remaining one', async () => {
    const { ctx, socket, puts } = await harness();
    renderTab(ctx);
    await userEvent.click(screen.getByTestId('node-add'));
    await userEvent.selectOptions(screen.getByTestId('node-add-type'), 'container');
    socket.receive({ type: 'node-types', types: TYPES.filter((t) => t.type !== 'container') });
    await waitFor(() =>
      expect((screen.getByTestId('node-add-type') as HTMLSelectElement).value).toBe('image'),
    );
    await userEvent.click(screen.getByTestId('node-add-ok'));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.at(-1)).toEqual({ id: 'image-1', type: 'image', props: { src: '' } });
  });

  it('a drop before a sibling reorders; a drop onto a container nests', async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);

    const t = transfer();
    fireEvent.dragStart(screen.getByTestId('node-title'), t);
    expect(t.dataTransfer.getData('text/e8-node')).toBe('title');
    const over = fireEvent.dragOver(screen.getByTestId('node-reels-1'), t);
    expect(over).toBe(false); // preventDefault: the row takes the drop
    fireEvent.drop(screen.getByTestId('node-reels-1'), t);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.map((n) => n.id)).toEqual(['bg', 'title', 'reels-1']);

    const t2 = transfer();
    fireEvent.dragStart(screen.getByTestId('node-reels-1'), t2);
    fireEvent.dragOver(screen.getByTestId('node-bg'), t2);
    fireEvent.drop(screen.getByTestId('node-bg'), t2);
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].nodes.map((n) => n.id)).toEqual(['bg', 'title']);
    expect(puts()[1].nodes[0].children?.map((n) => n.id)).toEqual(['logo', 'reels-1']);

    // Into itself: nothing goes out.
    const t3 = transfer();
    fireEvent.dragStart(screen.getByTestId('node-bg'), t3);
    fireEvent.dragOver(screen.getByTestId('node-bg'), t3);
    fireEvent.drop(screen.getByTestId('node-bg'), t3);
    expect(puts()).toHaveLength(2);
  });

  it('a refused update shows inline', async () => {
    const { ctx } = await harness({
      'PUT /api/scenes/base_game': () => ({
        status: 400,
        body: {
          diagnostics: [
            { severity: 'error', plugin: 'scenes', where: 'base_game', message: 'nope' },
          ],
        },
      }),
    });
    renderTab(ctx);
    await userEvent.click(screen.getByTestId('node-remove-title'));
    expect(await screen.findByTestId('scene-doc-error')).toHaveTextContent('nope');
    expect(screen.getByTestId('node-title')).toBeTruthy();
  });

  it('previews the scene when its tab becomes the active one — once per activation', async () => {
    const { ctx, calls } = await harness();
    const previews = () => calls.filter((c) => c.url === '/api/scenes/preview');
    ctx.shell.open({ key: 'f:other.txt', title: 'other', component: () => null, closable: true });
    ctx.shell.open({ key: KEY, title: 'base_game', component: () => null, closable: true });
    expect(ctx.shell.active()?.key).toBe(KEY);
    renderTab(ctx);
    // Already active on mount: one preview.
    expect(previews()).toEqual([
      { method: 'POST', url: '/api/scenes/preview', body: { scene: 'base_game' } },
    ]);

    ctx.shell.activate('f:other.txt');
    ctx.shell.markDirty('f:other.txt', true); // a shell notify that is not an activation
    expect(previews()).toHaveLength(1);
    ctx.shell.activate(KEY);
    expect(previews()).toHaveLength(2);
    ctx.shell.markDirty(KEY, true);
    expect(previews()).toHaveLength(2);
  });
});
