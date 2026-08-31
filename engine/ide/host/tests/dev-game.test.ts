import { join } from 'node:path';
import { Context } from 'cordis';
import Server from '@cordisjs/plugin-server';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';
import * as devGame from '../src/plugins/dev-game';

/**
 * `dev-game`'s HTTP half — measured in Step 1 (see task-11-report.md for
 * the full spike transcript) against the REAL `vite` and `@cordisjs
 * /plugin-server` packages, not guessed from documentation:
 *
 *  - Vite's `appType: 'spa'` fallback swallows ANY unmatched request —
 *    including ones meant for our own API routes — if it gets first crack.
 *    So vite must be wired as a plain, LAST-registered route
 *    (`ctx.server.all(/^.*$/, ...)`), never via `ctx.server.use()` (which
 *    always prepends ahead of route dispatch, per plugin-server's own
 *    `use()` implementation), and only after every specific route this
 *    plugin (and its host) registers.
 *  - `@cordisjs/plugin-server`'s own WS-upgrade dispatcher unconditionally
 *    404s+destroys any upgrade whose path doesn't match a registered
 *    `ctx.server.ws()` route — it races Vite's own HMR websocket if left
 *    enabled on the same raw `http.Server`. `dev-game` disables Vite's HMR
 *    (`hmr: false`) rather than relying on that coexistence.
 */
const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');
const WEB_ROOT = join(__dirname, 'fixtures', 'dev-game-web');
const WORKSPACE = join(__dirname, 'fixtures', 'workspace'); // e8.yml: `[]`

let host: IdeHost | undefined;
let ctx: Context | undefined;

afterEach(async () => {
  await host?.stop();
  host = undefined;
  await ctx?.fiber.dispose();
  ctx = undefined;
});

describe('dev-game — serving the bundle', () => {
  it('serves the game root through vite, transformed', async () => {
    ctx = new Context();
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
    await ctx.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
    });

    const res = await fetch(`http://${ctx.server.host}:${ctx.server.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('dev-game fixture root');
  });

  it('falls through to cordis’s own 404 for a request vite genuinely does not handle', async () => {
    // Measured: vite's middlewares call `next()` (don't end the response)
    // for a method it doesn't serve static content for, unlike a GET —
    // which `appType: 'spa'`'s fallback answers for virtually any path.
    // This is what actually exercises the catch-all route's `return
    // next()` branch — every other case in this file's tests is handled
    // by vite directly, so without this one, that branch is unreachable
    // by the suite (found by mutation-checking dev-game.ts itself: deleting
    // the `return next()` line did not fail any test until this one existed).
    ctx = new Context();
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
    await ctx.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
    });

    const res = await fetch(`http://${ctx.server.host}:${ctx.server.port}/`, {
      method: 'DELETE',
    });
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain('dev-game fixture root');
  });

  it('serves a JS module from the game root through vite’s on-demand transform', async () => {
    ctx = new Context();
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
    await ctx.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
    });

    const res = await fetch(`http://${ctx.server.host}:${ctx.server.port}/main.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const text = await res.text();
    expect(text).toContain('dev-game-fixture-module');
  });
});

describe('dev-game — the spin route', () => {
  it('carries a real spin through to ctx.session, shape unchanged', async () => {
    ctx = new Context();
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
    await ctx.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
    });

    const res = await fetch(`http://${ctx.server.host}:${ctx.server.port}/api/spin`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const result = await res.json();

    // The exact envelope Task 1 measured — see session-dev's SpinResult doc.
    expect(result).toMatchObject({
      stage: 'base_game',
      bet: 1,
      roundComplete: true,
    });
    expect(typeof result.win).toBe('number');
    expect(typeof result.totalWin).toBe('number');
    expect(Array.isArray(result.nextActions)).toBe(true);
    expect(result.data).toMatchObject({ stage: 'base_game' });
    expect(Array.isArray(result.data.grid)).toBe(true);
  });

  it('reports a spin against a session that never started as diagnostics, not a crash', async () => {
    ctx = new Context();
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
    await ctx.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      binPath: '/nonexistent/e8-server-binary',
    });

    const res = await fetch(`http://${ctx.server.host}:${ctx.server.port}/api/spin`, {
      method: 'POST',
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'session' });
  });
});

describe('dev-game — one server, two consumers', () => {
  it('leaves /api/health and the composition serving once dev-game is added', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    await host.ctx.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
    });

    const health = await fetch(`${host.url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const snapshot = await host.ctx.composition.snapshot();
    expect(snapshot).toEqual({ rows: [], diagnostics: [] });

    const root = await fetch(`${host.url}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('dev-game fixture root');
  });
});

describe('dev-game — teardown', () => {
  it('stops the spawned e8-server process on dispose, not just the http server', async () => {
    ctx = new Context();
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
    await ctx.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
    });

    const pid = ctx.session.pid;
    expect(pid).not.toBeNull();

    await ctx.fiber.dispose();
    ctx = undefined;

    // The OS pid is actually gone — not just "stop() was called" — same
    // check session-dev's own suite uses.
    await expect
      .poll(
        () => {
          try {
            process.kill(pid!, 0);
            return 'alive';
          } catch {
            return 'gone';
          }
        },
        { timeout: 5000 },
      )
      .toBe('gone');
  });
});
