import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import type { Diagnostic, SceneDoc, ServerMessage } from '@energy8engine/contracts';
import type { WebSocketLike } from '../src/plugins/connection';
import * as connection from '../src/plugins/connection';
import * as slots from '../src/plugins/slots';
import * as shell from '../src/plugins/shell';
import * as scenes from '../src/plugins/scenes';

/**
 * `ScenesSidebar`, rendered through the plugin's OWN `shell.sidebar`
 * registration (Task 11) rather than imported directly — the same reason
 * `scenes-service.test.tsx` boots a real `Context`: a component imported
 * straight past `ctx.plugin` would never notice a missing `inject`.
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

const A: SceneDoc = { id: 'a', nodes: [] };
const B: SceneDoc = { id: 'b', nodes: [] };

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
  await ctx.plugin(scenes, { url: 'ws://x/ide', fetchFn });
  return { ctx, calls, fetchFn };
}

const boot =
  (body: unknown = { scenes: [A, B], diagnostics: [], nodeTypes: [] }): Route =>
  () => ({ body });

function renderSidebar(ctx: Context) {
  const entry = ctx.slots.list('shell.sidebar').find((e) => e.key === 'scenes');
  if (!entry) throw new Error('scenes did not register a shell.sidebar entry');
  render(<entry.component ctx={ctx} />);
}

describe('ScenesSidebar', () => {
  it('lists the scenes the service knows about', async () => {
    const { ctx } = await harness({ 'GET /api/scenes': boot() });
    renderSidebar(ctx);
    expect(await screen.findByTestId('scene-a')).toBeTruthy();
    expect(screen.getByTestId('scene-b')).toBeTruthy();
    expect(screen.queryByTestId('scenes-empty')).toBeNull();
  });

  it('an empty set says so', async () => {
    const { ctx } = await harness({ 'GET /api/scenes': boot({ scenes: [], diagnostics: [], nodeTypes: [] }) });
    renderSidebar(ctx);
    expect(await screen.findByTestId('scenes-empty')).toHaveTextContent(
      'no scenes yet — press + to add one',
    );
  });

  it('+ then Enter calls create(id); a refusal shows scene-add-error', async () => {
    const user = userEvent.setup();
    const refusal: Diagnostic = { severity: 'error', plugin: 'scenes', where: 'intro', message: 'taken' };
    const { ctx, calls } = await harness({
      'GET /api/scenes': boot({ scenes: [A], diagnostics: [], nodeTypes: [] }),
      'POST /api/scenes': (body) =>
        (body as { id: string }).id === 'intro'
          ? { status: 400, body: { diagnostics: [refusal] } }
          : { body: { scenes: [A, { id: 'x', nodes: [] }], diagnostics: [], nodeTypes: [] } },
    });
    renderSidebar(ctx);
    await screen.findByTestId('scene-a');

    await user.click(screen.getByTestId('scene-add'));
    const input = screen.getByTestId('scene-add-input');
    await user.type(input, 'intro{Enter}');

    await waitFor(() => expect(screen.getByTestId('scene-add-error')).toHaveTextContent('taken'));
    expect(calls).toEqual([
      { method: 'GET', url: '/api/scenes', body: undefined },
      { method: 'POST', url: '/api/scenes', body: { id: 'intro' } },
    ]);
    // the input stays up so the id can be fixed
    expect(screen.getByTestId('scene-add-input')).toBeTruthy();
  });

  it('an empty id on Enter is refused locally, without a request', async () => {
    const user = userEvent.setup();
    const { ctx, calls } = await harness({ 'GET /api/scenes': boot() });
    renderSidebar(ctx);
    await screen.findByTestId('scene-a');

    await user.click(screen.getByTestId('scene-add'));
    await user.type(screen.getByTestId('scene-add-input'), '{Enter}');

    expect(screen.getByTestId('scene-add-error')).toHaveTextContent('type a scene id');
    expect(calls).toEqual([{ method: 'GET', url: '/api/scenes', body: undefined }]);
    expect(screen.getByTestId('scene-add-input')).toBeTruthy();
  });

  it('clicking a row selects it and previews it', async () => {
    const user = userEvent.setup();
    const { ctx, calls } = await harness({
      'GET /api/scenes': boot(),
      'POST /api/scenes/select': () => ({ body: { diagnostics: [] } }),
      'POST /api/scenes/preview': () => ({ body: { diagnostics: [] } }),
    });
    renderSidebar(ctx);
    await user.click(await screen.findByTestId('scene-a'));

    expect(ctx.scenes.selected()).toEqual({ scene: 'a', node: null });
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/scenes/preview')).toBe(true),
    );
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/scenes/select',
      body: { scene: 'a', node: null },
    });
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/scenes/preview',
      body: { scene: 'a' },
    });
  });

  it('double-clicking a row opens it through the shell', async () => {
    const user = userEvent.setup();
    const { ctx } = await harness({ 'GET /api/scenes': boot() });
    const opener = vi.fn();
    ctx.shell.registerPathOpener(opener);
    renderSidebar(ctx);
    await user.dblClick(await screen.findByTestId('scene-a'));
    expect(opener).toHaveBeenCalledWith('scenes/a.scene.yml');
  });

  it('removing a scene asks first, then DELETEs on confirm', async () => {
    const user = userEvent.setup();
    const { ctx, calls } = await harness({
      'GET /api/scenes': boot(),
      'DELETE /api/scenes/a': () => ({ body: { scenes: [B], diagnostics: [], nodeTypes: [] } }),
    });
    renderSidebar(ctx);
    await screen.findByTestId('scene-a');

    await user.click(screen.getByTestId('scene-remove-a'));
    expect(screen.getByTestId('confirm-no')).toBeTruthy();

    await user.click(screen.getByTestId('confirm-yes'));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', url: '/api/scenes/a', body: undefined }),
    );
    await waitFor(() => expect(screen.queryByTestId('scene-a')).toBeNull());
  });

  it('confirm-no cancels the delete: the row stays, nothing is sent', async () => {
    const user = userEvent.setup();
    const { ctx, calls } = await harness({ 'GET /api/scenes': boot() });
    renderSidebar(ctx);
    await screen.findByTestId('scene-a');

    await user.click(screen.getByTestId('scene-remove-a'));
    await user.click(screen.getByTestId('confirm-no'));

    expect(screen.getByTestId('scene-a')).toBeTruthy();
    expect(calls).toEqual([{ method: 'GET', url: '/api/scenes', body: undefined }]);
  });

  it('a click on the confirm row itself does not select-and-preview the scene being deleted', async () => {
    const user = userEvent.setup();
    const { ctx, calls } = await harness({ 'GET /api/scenes': boot() });
    renderSidebar(ctx);
    await screen.findByTestId('scene-a');

    await user.click(screen.getByTestId('scene-remove-a'));
    await user.click(screen.getByText('delete scene "a"?'));

    expect(ctx.scenes.selected()).toBeNull();
    expect(calls).toEqual([{ method: 'GET', url: '/api/scenes', body: undefined }]);
    expect(screen.getByTestId('confirm-yes')).toBeTruthy();
  });
});
