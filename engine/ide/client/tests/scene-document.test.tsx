import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import * as assetNodeTypes from '../src/plugins/asset-node-types';
import * as files from '../src/plugins/files';
import * as history from '../src/plugins/history';
import {
  SAFE_BOTTOM,
  addNode,
  clearVariant,
  moveNode,
  nextId,
  patchVariant,
  removeNode,
  renameVariant,
  shiftNode,
} from '../src/shell/SceneDocument';

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
  {
    type: 'image',
    schema: Schema.object({ src: Schema.string().required() }).toJSON(),
    accept: { extensions: ['png', 'jpg', 'jpeg', 'webp'], prop: 'src' },
  },
  { type: 'reels', schema: Schema.object({ rows: Schema.number().default(3) }).toJSON() },
  { type: 'scene', schema: Schema.object({}).toJSON() },
  {
    type: 'spritesheet',
    schema: Schema.object({ sheet: Schema.string().required() }).toJSON(),
    accept: { extensions: ['json'], prop: 'sheet' },
  },
  {
    type: 'spine',
    schema: Schema.object({ skeleton: Schema.string().required() }).toJSON(),
    accept: { extensions: ['skel', 'json'], prop: 'skeleton', sibling: 'atlas' },
  },
];

const built: Context[] = [];
afterEach(async () => {
  for (const ctx of built.splice(0)) await ctx.fiber.dispose();
});

const PREVIEW_URL = 'http://127.0.0.1:5681';

async function harness(extra: Record<string, Route> = {}, previewUrl: string | null = PREVIEW_URL) {
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
    'GET /api/files': () => ({ body: { entries: [], diagnostics: [] } }),
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
  await ctx.plugin(assetNodeTypes);
  await ctx.plugin(files, { fetchFn });
  // The canvas reads two services the tab never did before: where the game
  // is served, and the design size the `scenes1` row declares. Minimal
  // fakes of each plugin's own shape, provided the way `viewers.test` does.
  const nothing = () => () => {};
  // One object, as the real service holds: `useSyncExternalStore` reads it on every render.
  const workspace = { projects: [], templates: [], active: 'first', previewUrl, diagnostics: [] };
  ctx.provide('workspace', {
    state: () => workspace,
    subscribe: nothing,
    open: async () => [],
    create: async () => [],
  });
  ctx.provide('gameComposition', {
    rows: [
      {
        id: 'scenes1',
        name: '@energy8engine/scenes',
        config: { design: { width: 640, height: 360 } },
        from: 'patch',
        runtimeUrl: null,
      },
    ],
    diagnostics: [],
    reloads: 0,
    transitions: [],
    subscribe: nothing,
    update: async () => ({ reload: false, diagnostics: [] }),
  });
  await ctx.plugin(history);
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

/**
 * The canvas iframe, with `contentWindow.postMessage` stubbed so requests
 * can be read back. The tab attaches the RPC from the iframe's ref
 * callback — by the time `render`/`renderTab` returns, it is already
 * attached, since jsdom hands out a `contentWindow` as soon as the iframe
 * is in the document (and never loads the `src` itself, so `load` never
 * fires on its own).
 */
function canvas() {
  const iframe = screen.getByTitle('scene canvas') as HTMLIFrameElement;
  const win = iframe.contentWindow as Window & { postMessage: ReturnType<typeof vi.fn> };
  win.postMessage = vi.fn();
  const posted = () => win.postMessage.mock.calls.map((c) => c[0]);
  const reqs = (method: string) =>
    posted()
      .filter((m) => m.type === 'e8:ide:req' && m.method === method)
      .map((m) => m.params);
  return { iframe, posted, reqs };
}

/** A frame FROM the iframe: the message event the browser would deliver to the tab's window. */
function frame(iframe: HTMLIFrameElement, event: string, payload: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'e8:ide:evt', event, payload },
      origin: PREVIEW_URL,
      source: iframe.contentWindow,
    }),
  );
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

  it('an override follows its node: removeNode drops it, moveNode under a parent drops it, a root moved before a root keeps it, renameVariant carries it', () => {
    const WITH: SceneDoc = {
      ...BASE,
      portrait: { nodes: { title: { x: 1 }, bg: { visible: false } } },
    };
    expect(removeNode(WITH, 'title').portrait).toEqual({ nodes: { bg: { visible: false } } });
    expect(removeNode(removeNode(WITH, 'title'), 'bg').portrait).toBeUndefined();
    expect(moveNode(WITH, 'title', { into: 'bg' }).portrait).toEqual({
      nodes: { bg: { visible: false } },
    });
    expect(moveNode(WITH, 'title', { before: 'logo' }).portrait).toEqual({
      nodes: { bg: { visible: false } },
    });
    expect(moveNode(WITH, 'title', { before: 'bg' }).portrait).toEqual(WITH.portrait);
    expect(renameVariant(WITH, 'title', 'headline').portrait).toEqual({
      nodes: { bg: { visible: false }, headline: { x: 1 } },
    });
    expect(renameVariant(WITH, 'reels-1', 'reels')).toBe(WITH);
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

  it('shiftNode swaps a node with its next or previous sibling; the ends and unknown ids are no-ops', () => {
    expect(shiftNode(BASE, 'reels-1', 1).nodes.map((n) => n.id)).toEqual([
      'bg',
      'title',
      'reels-1',
    ]);
    expect(shiftNode(BASE, 'reels-1', -1).nodes.map((n) => n.id)).toEqual([
      'reels-1',
      'bg',
      'title',
    ]);
    expect(shiftNode(BASE, 'title', 1)).toBe(BASE);
    expect(shiftNode(BASE, 'bg', -1)).toBe(BASE);
    expect(shiftNode(BASE, 'logo', 1)).toBe(BASE);
    expect(shiftNode(BASE, 'nope', 1)).toBe(BASE);
    const two: SceneDoc = {
      ...BASE,
      nodes: [{ ...BASE.nodes[0], children: [BASE.nodes[0].children![0], BASE.nodes[1]] }],
    };
    expect(shiftNode(two, 'logo', 1).nodes[0].children?.map((n) => n.id)).toEqual([
      'reels-1',
      'logo',
    ]);
    expect(BASE.nodes.map((n) => n.id)).toEqual(['bg', 'reels-1', 'title']);
  });
});

describe('SceneDocument variant helpers', () => {
  const WITH: SceneDoc = {
    ...BASE,
    portrait: { nodes: { title: { x: 1 }, bg: { visible: false } } },
  };

  it('patchVariant merges into portrait.nodes[id], creating the block; a nested or unknown id is left alone', () => {
    expect(patchVariant(BASE, 'title', { x: 5 })).toEqual({
      ...BASE,
      portrait: { nodes: { title: { x: 5 } } },
    });
    expect(patchVariant(WITH, 'title', { y: 2 }).portrait).toEqual({
      nodes: { title: { x: 1, y: 2 }, bg: { visible: false } },
    });
    expect(patchVariant(WITH, 'logo', { x: 5 })).toBe(WITH);
    expect(patchVariant(BASE, 'nope', { x: 5 })).toBe(BASE);
    expect(BASE.portrait).toBeUndefined();
  });

  it('clearVariant drops the entry, and the block once empty; nothing to clear is the same doc', () => {
    expect(clearVariant(WITH, 'title').portrait).toEqual({ nodes: { bg: { visible: false } } });
    expect(clearVariant(clearVariant(WITH, 'title'), 'bg')).toEqual(BASE);
    expect(clearVariant(WITH, 'logo')).toBe(WITH);
    expect(clearVariant(BASE, 'title')).toBe(BASE);
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
    expect([...select.options].map((o) => o.value)).toEqual(TYPES.map((t) => t.type));
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

  it('draws the canvas iframe at the design size, addressed to the editor page', async () => {
    const { ctx } = await harness();
    renderTab(ctx);
    expect(screen.getByTestId('canvas-toolbar')).toBeTruthy();
    expect(screen.getByTestId('canvas-tree')).toContainElement(screen.getByTestId('node-bg'));
    const iframe = screen.getByTitle('scene canvas') as HTMLIFrameElement;
    expect(screen.getByTestId('canvas-stage')).toContainElement(iframe);
    expect(iframe.getAttribute('src')).toBe(
      `${PREVIEW_URL}/editor.html?scene=base_game&safeBottom=0`,
    );
    expect(iframe.getAttribute('width')).toBe('640');
    expect(iframe.getAttribute('height')).toBe('360');
    expect(iframe.style.transform).toBe('scale(1)');
    expect(screen.getByTestId('canvas-zoom')).toHaveTextContent('100%');
    expect(screen.queryByTestId('canvas-unavailable')).toBeNull();
  });

  it("a viewport preset sizes the iframe and tells the editor page the shell's bar band for that layout; design has none", async () => {
    const { ctx } = await harness();
    renderTab(ctx);
    const select = screen.getByTestId('canvas-viewport') as HTMLSelectElement;
    const iframe = screen.getByTitle('scene canvas') as HTMLIFrameElement;
    await userEvent.selectOptions(select, 'phone-portrait');
    expect(iframe.getAttribute('width')).toBe('390');
    expect(iframe.getAttribute('height')).toBe('844');
    expect(iframe.getAttribute('src')).toBe(
      `${PREVIEW_URL}/editor.html?scene=base_game&safeBottom=131`,
    );
    const frame = iframe.parentElement as HTMLElement;
    expect(frame.style.width).toBe('390px');
    expect(frame.style.height).toBe('844px');
    await userEvent.selectOptions(select, 'landscape');
    expect(iframe.getAttribute('width')).toBe('1280');
    expect(iframe.getAttribute('height')).toBe('720');
    expect(iframe.getAttribute('src')).toBe(
      `${PREVIEW_URL}/editor.html?scene=base_game&safeBottom=${SAFE_BOTTOM.wide}`,
    );
    // The same iframe throughout: a preset is a resize, not a remount.
    expect(screen.getByTitle('scene canvas')).toBe(iframe);
    await userEvent.selectOptions(select, 'design');
    expect(iframe.getAttribute('width')).toBe('640');
    expect(iframe.getAttribute('src')).toBe(
      `${PREVIEW_URL}/editor.html?scene=base_game&safeBottom=0`,
    );
    // `wide` is what the bar's constants add up to (BottomBar.ts:42); `mobile`
    // is the MEASURED bar on the example at 390×844, not the nominal 142 (:55) — the mobile bar scales.
    expect(SAFE_BOTTOM).toEqual({ wide: 92, mobile: 131 });
  });

  it("the page says which orientation it edits: ready and orientation events set the scene's variant, never the preset; two tabs keep their own; unmount deletes", async () => {
    const { ctx } = await harness({
      'PUT /api/scenes/bonus': (body) => ({
        body: { scenes: [BASE, body as SceneDoc], diagnostics: [], nodeTypes: TYPES },
      }),
    });
    const a = renderTab(ctx);
    const b = renderTab(ctx, 'scenes/bonus.scene.yml');
    const [ia, ib] = screen.getAllByTitle('scene canvas') as HTMLIFrameElement[];
    // A portrait preset alone says nothing: the page has not spoken.
    await userEvent.selectOptions(
      within(a.container).getByTestId('canvas-viewport'),
      'phone-portrait',
    );
    expect(ctx.scenes.variant('base_game')).toBeNull();
    frame(ia, 'ready', { scene: 'base_game', orientation: 'portrait' });
    expect(ctx.scenes.variant('base_game')).toBe('portrait');
    expect(ctx.scenes.variant('bonus')).toBeNull();
    frame(ib, 'ready', { scene: 'bonus', orientation: 'landscape' });
    expect(ctx.scenes.variant('bonus')).toBeNull();
    expect(ctx.scenes.variant('base_game')).toBe('portrait');
    // A flip on B does not touch A; back again clears B's.
    frame(ib, 'orientation', { orientation: 'portrait' });
    expect(ctx.scenes.variant('bonus')).toBe('portrait');
    expect(ctx.scenes.variant('base_game')).toBe('portrait');
    frame(ib, 'orientation', { orientation: 'landscape' });
    expect(ctx.scenes.variant('bonus')).toBeNull();
    // An unmount deletes its own entry only.
    frame(ib, 'orientation', { orientation: 'portrait' });
    b.unmount();
    expect(ctx.scenes.variant('bonus')).toBeNull();
    expect(ctx.scenes.variant('base_game')).toBe('portrait');
    a.unmount();
    expect(ctx.scenes.variant('base_game')).toBeNull();
  });

  it("a preset change that alters safeBottom forgets the OLD page's variant until the next ready", async () => {
    const { ctx } = await harness();
    renderTab(ctx);
    const select = screen.getByTestId('canvas-viewport') as HTMLSelectElement;
    const iframe = screen.getByTitle('scene canvas') as HTMLIFrameElement;
    await userEvent.selectOptions(select, 'phone-portrait');
    frame(iframe, 'ready', { scene: 'base_game', orientation: 'portrait' });
    expect(ctx.scenes.variant('base_game')).toBe('portrait');
    // landscape's safeBottom (wide) differs from phone-portrait's (mobile):
    // the src changes, the page reloads, and the variant it announced
    // belongs to the page that is going away.
    await userEvent.selectOptions(select, 'landscape');
    expect(ctx.scenes.variant('base_game')).toBeNull();
    frame(iframe, 'ready', { scene: 'base_game', orientation: 'landscape' });
    expect(ctx.scenes.variant('base_game')).toBeNull();
  });

  it('with no preview to point at, says so instead of an iframe', async () => {
    const { ctx } = await harness({}, null);
    renderTab(ctx);
    expect(screen.getByTestId('canvas-unavailable')).toBeTruthy();
    expect(screen.queryByTitle('scene canvas')).toBeNull();
    expect(screen.getByTestId('node-bg')).toBeTruthy();
  });

  it('no longer previews the scene on activation', async () => {
    const { ctx, calls } = await harness();
    ctx.shell.open({ key: KEY, title: 'base_game', component: () => null, closable: true });
    renderTab(ctx);
    expect(calls.filter((c) => c.url === '/api/scenes/preview')).toEqual([]);
  });

  it('zoom −/+ scale the frame; Fit goes back to the fit; the tree pane collapses', async () => {
    const { ctx } = await harness();
    renderTab(ctx);
    const iframe = screen.getByTitle('scene canvas') as HTMLIFrameElement;
    await userEvent.click(screen.getByTestId('canvas-zoom-out'));
    expect(screen.getByTestId('canvas-zoom')).toHaveTextContent('80%');
    expect(iframe.style.transform).toBe('scale(0.8)');
    await userEvent.click(screen.getByTestId('canvas-fit'));
    expect(screen.getByTestId('canvas-zoom')).toHaveTextContent('100%');

    const root = screen.getByTestId('scene-doc-base_game');
    expect(root.classList.contains('e8-canvas-tree-collapsed')).toBe(false);
    await userEvent.click(screen.getByTestId('canvas-tree-toggle'));
    expect(root.classList.contains('e8-canvas-tree-collapsed')).toBe(true);
  });

  it('a pick in the canvas selects the node once; the same pick again is not re-told', async () => {
    const { ctx, calls } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    const selects = () => calls.filter((c) => c.url === '/api/scenes/select');
    frame(iframe, 'selected', { node: 'logo' });
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: 'logo' });
    expect(selects()).toHaveLength(1);
    frame(iframe, 'selected', { node: 'logo' });
    expect(selects()).toHaveLength(1);
    frame(iframe, 'selected', { node: null });
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: null });
    expect(selects()).toHaveLength(2);
  });

  it('an edit from the canvas merges the props into the node', async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'edit', { node: 'logo', props: { x: 12, y: 34 } });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[0].children?.[0]).toEqual({
      id: 'logo',
      type: 'image',
      props: { src: 'logo.png', x: 12, y: 34 },
    });
    expect(puts()[0].nodes.map((n) => n.id)).toEqual(['bg', 'reels-1', 'title']);
  });

  it("an edit with variant: 'portrait' lands in portrait.nodes (rounded), leaves nodes[] untouched, and the block survives the round trip; the tree marks the node and its ◐ clears it", async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'edit', { node: 'title', props: { x: 12.4, y: 34 }, variant: 'portrait' });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes).toEqual(BASE.nodes);
    expect(puts()[0].portrait).toEqual({ nodes: { title: { x: 12, y: 34 } } });
    // Through JSON both ways (the PUT and its answer) the block is the same fact.
    await waitFor(() =>
      expect(ctx.scenes.docs()[0]).toEqual({
        ...BASE,
        portrait: { nodes: { title: { x: 12, y: 34 } } },
      }),
    );
    expect(JSON.parse(JSON.stringify(ctx.scenes.docs()[0]))).toEqual(ctx.scenes.docs()[0]);
    // A second one merges into the entry; a `null` variant goes to the node.
    frame(iframe, 'edit', { node: 'title', props: { pin: 'bottom' }, variant: 'portrait' });
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].portrait).toEqual({ nodes: { title: { x: 12, y: 34, pin: 'bottom' } } });
    frame(iframe, 'edit', { node: 'title', props: { x: 1 }, variant: null });
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect(puts()[2].nodes[2].props).toEqual({ src: 'title.png', x: 1 });
    expect(puts()[2].portrait).toEqual({ nodes: { title: { x: 12, y: 34, pin: 'bottom' } } });
    // The mark, on the overridden node only; clicking it drops the entry (and the empty block).
    await waitFor(() => expect(screen.getByTestId('scene-node-title-variant')).toBeTruthy());
    expect(screen.queryByTestId('scene-node-bg-variant')).toBeNull();
    await userEvent.click(screen.getByTestId('scene-node-title-variant'));
    await waitFor(() => expect(puts()).toHaveLength(4));
    expect(puts()[3].portrait).toBeUndefined();
    expect(puts()[3].nodes[2].props).toEqual({ src: 'title.png', x: 1 });
    await waitFor(() => expect(screen.queryByTestId('scene-node-title-variant')).toBeNull());
  });

  it('what the canvas measures is rounded before it is written: x/y/width/height to whole pixels, scale to 2 decimals, rotation to 4', async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'edit', {
      node: 'logo',
      // `width`/`height` are design px like `x`/`y`: a gizmo resize must not
      // persist the `149.98` pixi's bounding box measured.
      props: {
        x: 279.6,
        y: 40.4,
        width: 149.98,
        height: 60.001,
        scale: 1.4999,
        rotation: 0.78539816,
      },
    });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes[0].children?.[0].props).toEqual({
      src: 'logo.png',
      x: 280,
      y: 40,
      width: 150,
      height: 60,
      scale: 1.5,
      rotation: 0.7854,
    });
  });

  it('a refused edit tells the canvas the set as it stands, so it snaps back', async () => {
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
    const { iframe, reqs } = canvas();
    const before = reqs('replace').length;
    frame(iframe, 'edit', { node: 'logo', props: { x: 12, y: 34 } });
    expect(await screen.findByTestId('scene-doc-error')).toHaveTextContent('nope');
    await waitFor(() => expect(reqs('replace')).toHaveLength(before + 1));
    expect(reqs('replace').at(-1)).toEqual({ docs: [BASE, BONUS] });
  });

  it('a remove from the canvas clears the selection first and drops the node', async () => {
    const { ctx, calls, puts } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    ctx.scenes.select({ scene: 'base_game', node: 'logo' });
    frame(iframe, 'remove', { node: 'bg' });
    expect(ctx.scenes.selected()).toEqual({ scene: 'base_game', node: null });
    expect(calls.filter((c) => c.url === '/api/scenes/select').at(-1)?.body).toEqual({
      scene: 'base_game',
      node: null,
    });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.map((n) => n.id)).toEqual(['reels-1', 'title']);
  });

  it('a zorder from the canvas swaps the node with its sibling', async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'zorder', { node: 'reels-1', delta: 1 });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.map((n) => n.id)).toEqual(['bg', 'title', 'reels-1']);
    frame(iframe, 'zorder', { node: 'bg', delta: -1 });
    expect(puts()).toHaveLength(1);
  });

  it('an error from the canvas shows inline', async () => {
    const { ctx } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'error', { message: 'scene "nope" is not registered' });
    expect(await screen.findByTestId('scene-doc-error')).toHaveTextContent('not registered');
  });

  it('the selection is mirrored into the canvas; ready re-sends it with the grid', async () => {
    const { ctx } = await harness();
    renderTab(ctx);
    const { iframe, reqs } = canvas();
    await userEvent.click(screen.getByTestId('node-logo'));
    await waitFor(() => expect(reqs('select').at(-1)).toEqual({ node: 'logo' }));

    ctx.scenes.select({ scene: 'bonus', node: null });
    await waitFor(() => expect(reqs('select').at(-1)).toEqual({ node: null }));

    ctx.scenes.select({ scene: 'base_game', node: 'title' });
    await waitFor(() => expect(reqs('select').at(-1)).toEqual({ node: 'title' }));
    const before = reqs('select').length;
    const replaces = reqs('replace').length;
    frame(iframe, 'ready', { scene: 'base_game' });
    expect(reqs('select')).toHaveLength(before + 1);
    expect(reqs('select').at(-1)).toEqual({ node: 'title' });
    expect(reqs('grid').at(-1)).toEqual({ on: false, step: 16 });
    // And the set: a `replace` posted before the canvas listened is lost.
    expect(reqs('replace')).toHaveLength(replaces + 1);
    expect(reqs('replace').at(-1)).toEqual({ docs: [BASE, BONUS] });
  });

  it('every change to the document set is told to the canvas as replace', async () => {
    const { ctx, socket } = await harness();
    renderTab(ctx);
    const { iframe, reqs } = canvas();
    // This tab's own edit, answered by the host: the set with the new order.
    frame(iframe, 'zorder', { node: 'reels-1', delta: 1 });
    await waitFor(() =>
      expect(
        (reqs('replace').at(-1) as { docs: SceneDoc[] }).docs[0].nodes.map((n) => n.id),
      ).toEqual(['bg', 'title', 'reels-1']),
    );
    // Another writer's, over the host's frame.
    socket.receive({
      type: 'scenes',
      scenes: [BASE, BONUS, { id: 'intro', nodes: [] }],
      diagnostics: [],
    });
    await waitFor(() =>
      expect((reqs('replace').at(-1) as { docs: SceneDoc[] }).docs.map((d) => d.id)).toEqual([
        'base_game',
        'bonus',
        'intro',
      ]),
    );
  });

  it('grid controls are told to the canvas', async () => {
    const { ctx } = await harness();
    renderTab(ctx);
    const { reqs } = canvas();
    await userEvent.click(screen.getByTestId('canvas-grid'));
    await waitFor(() => expect(reqs('grid').at(-1)).toEqual({ on: true, step: 16 }));
    await userEvent.selectOptions(screen.getByTestId('canvas-grid-step'), '8');
    await waitFor(() => expect(reqs('grid').at(-1)).toEqual({ on: true, step: 8 }));
  });

  it("a canvas undo/redo event runs the history with this tab's own keys — Mod+Z typed inside the iframe never reaches this page's own listener", async () => {
    const { ctx } = await harness();
    ctx.shell.open({ key: KEY, title: 'base_game', component: () => null, closable: true });
    renderTab(ctx);
    const { iframe } = canvas();
    const undo = vi.spyOn(ctx.history, 'undo');
    const redo = vi.spyOn(ctx.history, 'redo');
    frame(iframe, 'undo', undefined);
    expect(undo).toHaveBeenCalledWith(['scene:base_game']);
    frame(iframe, 'redo', undefined);
    expect(redo).toHaveBeenCalledWith(['scene:base_game']);
  });

  it('arrow-key nudges are written once, 300 ms after the last — one step for a held arrow', async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    const logo = (doc: SceneDoc) => doc.nodes[0].children?.[0].props;
    vi.useFakeTimers();
    try {
      for (const x of [1, 2, 3]) {
        frame(iframe, 'edit', { node: 'logo', props: { x, y: 0 }, variant: null, nudge: true });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });
      }
      expect(puts()).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(puts()).toHaveLength(1);
      expect(logo(puts()[0])).toEqual({ src: 'logo.png', x: 3, y: 0 });
    } finally {
      vi.useRealTimers();
    }
    // One step: one undo puts the node back where it was before the first nudge.
    expect(await ctx.history.undo(['scene:base_game'])).toEqual({
      kind: 'undo',
      ok: true,
      label: 'scene base_game',
    });
    expect(logo(puts().at(-1)!)).toEqual({ src: 'logo.png' });
  });

  it('a held nudge is written before anything else the canvas sends — a drag, or an undo, which then undoes it', async () => {
    const { ctx, puts } = await harness();
    ctx.shell.open({ key: KEY, title: 'base_game', component: () => null, closable: true });
    renderTab(ctx);
    const { iframe } = canvas();
    const logo = (doc: SceneDoc) => doc.nodes[0].children?.[0].props;

    frame(iframe, 'edit', { node: 'logo', props: { x: 5, y: 0 }, variant: null, nudge: true });
    frame(iframe, 'edit', { node: 'title', props: { x: 7, y: 8 }, variant: null });
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(logo(puts()[0])).toEqual({ src: 'logo.png', x: 5, y: 0 });
    expect(puts()[1].nodes[2].props).toEqual({ src: 'title.png', x: 7, y: 8 });

    frame(iframe, 'edit', { node: 'logo', props: { x: 6, y: 0 }, variant: null, nudge: true });
    frame(iframe, 'undo', undefined);
    await waitFor(() => expect(puts()).toHaveLength(4));
    expect(logo(puts()[2])).toEqual({ src: 'logo.png', x: 6, y: 0 });
    expect(logo(puts()[3])).toEqual({ src: 'logo.png', x: 5, y: 0 });
  });

  it('a frame from somewhere else is ignored', async () => {
    const { ctx, calls } = await harness();
    renderTab(ctx);
    canvas();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'e8:ide:evt', event: 'selected', payload: { node: 'logo' } },
        origin: 'http://evil.example',
        source: window,
      }),
    );
    expect(ctx.scenes.selected()).toBeNull();
    expect(calls.filter((c) => c.url === '/api/scenes/select')).toEqual([]);
  });

  it('a drop of an asset with a registered node type adds a node where it landed, and selects it', async () => {
    const { ctx, calls, puts } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'drop', { path: 'assets/logo.png', x: 10, y: 20 });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.at(-1)).toEqual({
      id: 'image-1',
      type: 'image',
      props: { src: 'assets/logo.png', x: 10, y: 20, anchor: 0.5 },
    });
    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/scenes/select').at(-1)?.body).toEqual({
        scene: 'base_game',
        node: 'image-1',
      }),
    );
  });

  it('a drop of a .json with no .atlas beside it is a spritesheet node, at the drop point rounded to whole pixels', async () => {
    const { ctx, puts } = await harness({
      'GET /api/files': () => ({
        body: { entries: [{ path: 'assets/coin.json', kind: 'file', size: 3 }], diagnostics: [] },
      }),
    });
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'drop', { path: 'assets/coin.json', x: 10.4, y: 19.6 });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.at(-1)).toEqual({
      id: 'spritesheet-1',
      type: 'spritesheet',
      props: { sheet: 'assets/coin.json', x: 10, y: 20, anchor: 0.5 },
    });
  });

  it('a drop of a .json with its .atlas beside it is a spine node', async () => {
    const { ctx, puts } = await harness({
      'GET /api/files': () => ({
        body: {
          entries: [
            { path: 'assets/coin.json', kind: 'file', size: 3 },
            { path: 'assets/coin.atlas', kind: 'file', size: 3 },
          ],
          diagnostics: [],
        },
      }),
    });
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'drop', { path: 'assets/coin.json', x: 1, y: 2 });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.at(-1)).toEqual({
      id: 'spine-1',
      type: 'spine',
      props: { skeleton: 'assets/coin.json', x: 1, y: 2, anchor: 0.5 },
    });
  });

  it('a tree that could not be read is reported and the drop still lands, by extension alone', async () => {
    const unread = { severity: 'error', plugin: 'files', where: '/api/files', message: 'no tree' };
    const { ctx, puts } = await harness({
      'GET /api/files': () => ({ status: 500, body: { entries: [], diagnostics: [unread] } }),
    });
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'drop', { path: 'assets/logo.png', x: 1, y: 2 });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].nodes.at(-1)?.type).toBe('image');
    expect(ctx.connection.diagnostics.some((d) => d.message === 'no tree')).toBe(true);
  });

  it('a drop of an asset with no registered node type warns instead of adding a node', async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'drop', { path: 'a.mp4', x: 0, y: 0 });
    expect(await screen.findByTestId('scene-doc-error')).toHaveTextContent('no node type for .mp4');
    expect(ctx.connection.diagnostics.some((d) => d.message === 'no node type for .mp4')).toBe(
      true,
    );
    expect(puts()).toHaveLength(0);
  });

  it('a drop of a path with no extension warns by the whole path, not a bogus ".<path>"', async () => {
    const { ctx, puts } = await harness();
    renderTab(ctx);
    const { iframe } = canvas();
    frame(iframe, 'drop', { path: 'assets/README', x: 0, y: 0 });
    expect(await screen.findByTestId('scene-doc-error')).toHaveTextContent(
      'no node type for "assets/README"',
    );
    expect(
      ctx.connection.diagnostics.some((d) => d.message === 'no node type for "assets/README"'),
    ).toBe(true);
    expect(puts()).toHaveLength(0);
  });

  it('a dropped File is written into assets/ before it becomes a node', async () => {
    const { ctx, calls } = await harness({
      'PUT /api/files/assets/pic.png': () => ({ body: { diagnostics: [] } }),
    });
    renderTab(ctx);
    const { iframe } = canvas();
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    frame(iframe, 'drop', { file, x: 5, y: 6 });
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/files/assets/pic.png')).toBe(
        true,
      ),
    );
    const scenePuts = () =>
      calls
        .filter((c) => c.method === 'PUT' && c.url === '/api/scenes/base_game')
        .map((c) => c.body as SceneDoc);
    await waitFor(() => expect(scenePuts()).toHaveLength(1));
    expect(scenePuts()[0].nodes.at(-1)).toEqual({
      id: 'image-1',
      type: 'image',
      props: { src: 'assets/pic.png', x: 5, y: 6, anchor: 0.5 },
    });
    // The file's bytes landed before the doc write.
    const fileWriteIndex = calls.findIndex((c) => c.url === '/api/files/assets/pic.png');
    const docPutIndex = calls.findIndex((c) => c.url === '/api/scenes/base_game');
    expect(fileWriteIndex).toBeGreaterThanOrEqual(0);
    expect(docPutIndex).toBeGreaterThan(fileWriteIndex);
  });

  it('a dropped File whose name already exists in assets/ is refused before any write', async () => {
    const { ctx, calls, puts } = await harness({
      'GET /api/files': () => ({
        body: { entries: [{ path: 'assets/pic.png', kind: 'file', size: 3 }], diagnostics: [] },
      }),
    });
    renderTab(ctx);
    const { iframe } = canvas();
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    frame(iframe, 'drop', { file, x: 0, y: 0 });
    expect(await screen.findByTestId('scene-doc-error')).toHaveTextContent(
      'assets/pic.png exists — rename the file',
    );
    expect(calls.some((c) => c.method === 'PUT' && c.url.startsWith('/api/files'))).toBe(false);
    expect(puts()).toHaveLength(0);
  });
});
