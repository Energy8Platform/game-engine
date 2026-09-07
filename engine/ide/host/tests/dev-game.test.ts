import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  it('falls through to cordis’s own dispatch for a request vite genuinely does not handle', async () => {
    // Corrected from an earlier, INACCURATE version of this test (caught in
    // review): a `DELETE /` was claimed to exercise the catch-all route's
    // `return next()` branch, and mutating that line away was claimed to
    // fail no test until this one existed. Reproduced directly against the
    // real vite + plugin-server pair: DELETE does not reach `next()` at all
    // — vite's own middlewares answer it with a 404 THEY write and end
    // themselves (`res._res.writableEnded`/`headersSent` are already true
    // the moment the race in dev-game.ts resolves), so the code took the
    // `headersSent` branch, never the one being described.
    //
    // `GET /%zz` (malformed percent-encoding) is a real shape — found by
    // trying a battery of methods/paths against the real pair, confirmed
    // stable across repeated runs — where vite's middlewares genuinely
    // call `next()` without writing anything (vite can't decode the
    // malformed URI internally and skips past it). This DOES prove the
    // `if` condition itself is load-bearing: forcing it to always be `true`
    // fails this test (asserting the wrong status). It does NOT, on its
    // own, make the bare `return next();` STATEMENT mutation-detectable in
    // isolation, and that narrower claim is not made here — verified by
    // forcing the condition to always be `false` instead: nothing fails,
    // anywhere in this file, because `Response._end()` is a no-op once
    // `headersSent`, so cordis's own post-hoc 404/405 re-scan (independent
    // of whatever this callback returns) reaches the identical 405 either
    // way, for every case this suite can construct — this plugin's
    // catch-all is always the last route registered, so there is nothing
    // after it for `next()` to actually reach. That narrower gap is
    // recorded, not fixed, the same way the `writableEnded`/`headersSent`
    // OR-vs-AND gap two lines below already is.
    ctx = new Context();
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
    await ctx.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
    });

    const res = await fetch(`http://${ctx.server.host}:${ctx.server.port}/%zz`);
    expect(res.status).toBe(405);
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

/**
 * `runtime-assets.ts`'s new containment check (task-6-brief.md) is scoped
 * to a ROW'S PACKAGE directory, not to the single file `e8.runtime.entry`
 * names, and it leaves vite's own `server.fs.allow` untouched entirely.
 *
 * The brief's own named risk for the alternative it also sanctioned —
 * narrowing `fs.allow` down to the row packages' roots — was specifically
 * about a plugin's TRANSITIVE IMPORTS OUT OF `node_modules`: a real
 * third-party dependency, reachable from the row's package but not
 * necessarily living inside it. This test does NOT build that shape, and
 * no test run against the check actually chosen here could: since this
 * approach never touches `fs.allow` at all, that specific risk was
 * structurally avoided by the choice of approach, not validated against —
 * there is nothing for a test to catch. (The full Playwright suite, which
 * loads the real `first-slot` example and its real `node_modules`
 * dependencies through this same seam, is the closer evidence for that
 * particular claim — still not a controlled A/B against the rejected
 * approach, since neither this suite nor that one ever runs with `fs.allow`
 * narrowed.)
 *
 * What this test DOES build and confirm: a sibling file inside the SAME
 * package as the declared entry — the realistic shape of a plugin that is
 * more than one file — still round-trips through `/@fs/` unchanged with
 * the new per-row containment check in place. Confirmatory regression
 * evidence that the check costs a legitimate multi-file plugin nothing,
 * not a direct test of the brief's own named `node_modules` risk.
 */
describe('dev-game — /@fs/ containment does not cost legitimate multi-file plugins anything', () => {
  it("serves both a row's runtime entry and the sibling file it imports, through /@fs/", async () => {
    // Realpath'd, not the raw `mkdtempSync` result — measured directly:
    // macOS's `os.tmpdir()` answers through `/var`, itself a symlink to
    // `/private/var`. Vite's OWN `server.fs.allow` default is built from
    // `root` as given, unresolved; the `/@fs/<path>` this test fetches is
    // realpath'd (by `runtime-assets.ts`, same as `/plugin-runtime/:id`
    // always has been). Leaving `root` unresolved here made vite's own
    // allowlist compare `/private/var/...` against `/var/...` and 403 —
    // a mismatch in the TEST's fixture, not evidence of anything wrong in
    // the code under test. The exact class of accidental symlink failure
    // this whole task is otherwise about, this time in vite's own check.
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'ide-host-dev-game-fs-transitive-')));
    // `dev-game`'s vite instance needs SOME `index.html` at its root to
    // boot its SPA fallback — unused by this test, which never fetches
    // `/`, but present for the same reason `WEB_ROOT` carries one.
    writeFileSync(join(workspace, 'index.html'), '<!doctype html><title>fixture</title>\n');

    const pkgDir = join(workspace, 'node_modules', 'multi-file-pkg');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'multi-file-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './runtime.js' } },
      }),
    );
    writeFileSync(
      join(pkgDir, 'index.js'),
      "export const name = 'multi-file-pkg';\nexport function apply() {}\n",
    );
    // The sibling the entry imports — a different file than the one
    // `e8.runtime.entry` names, still inside the same package.
    writeFileSync(join(pkgDir, 'helper.js'), "export const helperMarker = 'HELPER_LOADED';\n");
    writeFileSync(
      join(pkgDir, 'runtime.js'),
      "import { helperMarker } from './helper.js';\nexport function apply(ctx) { ctx.__marker = helperMarker; }\n",
    );

    writeFileSync(join(workspace, 'e8.yml'), '[]\n');
    writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-transitive-fixture\n');
    const bundlesDir = join(workspace, 'bundles', 'e8-transitive-fixture');
    mkdirSync(bundlesDir, { recursive: true });
    writeFileSync(
      join(bundlesDir, 'e8.bundle.yml'),
      ['name: e8-transitive-fixture', 'rows:', '  - id: multi1', '    name: multi-file-pkg', ''].join(
        '\n',
      ),
    );

    // `root: workspace` mirrors the real CLI (`engine/apps/cli/src/
    // index.ts` passes `root: cwd` to `dev-game` for `e8 dev`), and keeps
    // this row's package inside vite's default `fs.allow` search — the
    // same real-world configuration, not a fixture-only shortcut.
    host = await createIdeHost({ cwd: workspace, port: 0 });
    await host.ctx.plugin(devGame, {
      root: workspace,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
    });

    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body.diagnostics.filter((d: { plugin: string }) => d.plugin === 'multi1')).toEqual([]);
    const row = body.rows.find((r: { id: string }) => r.id === 'multi1');
    expect(row.runtimeUrl).toMatch(/^\/@fs\/.*runtime\.js$/);

    const entryRes = await fetch(`${host.url}${row.runtimeUrl}`);
    expect(entryRes.status).toBe(200);
    expect(await entryRes.text()).toContain('helper.js');

    // Not gated by runtime-assets.ts's own check at all — that only ever
    // looks at the DECLARED entry — so this confirms vite's own serving of
    // a plain sibling file is unaffected by the new check existing at all.
    const helperUrl = row.runtimeUrl.replace(/runtime\.js$/, 'helper.js');
    const helperRes = await fetch(`${host.url}${helperUrl}`);
    expect(helperRes.status).toBe(200);
    expect(await helperRes.text()).toContain('HELPER_LOADED');
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
