import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from 'cordis';
import Server from '@cordisjs/plugin-server';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import { createIdeHost, type IdeHost } from '../src/index';
import * as devGame from '../src/plugins/dev-game';
import * as files from '../src/plugins/files';
import * as rpc from '../src/plugins/rpc';

/**
 * `dev-game`'s HTTP half — measured in Step 1 (see task-11-report.md for
 * the full spike transcript) against the REAL `vite` and `@cordisjs
 * /plugin-server` packages, not guessed from documentation:
 *
 *  - Vite's `appType: 'spa'` fallback swallows ANY unmatched request —
 *    including ones meant for our own API routes — if it gets first crack.
 *    So vite must be wired as a plain, LAST-registered route
 *    (`preview.all(/^.*$/, ...)`), never via `.use()` (which
 *    always prepends ahead of route dispatch, per plugin-server's own
 *    `use()` implementation), and only after every specific route this
 *    plugin (and its host) registers.
 *  - `@cordisjs/plugin-server`'s own WS-upgrade dispatcher unconditionally
 *    404s+destroys any upgrade whose path doesn't match a registered
 *    `ctx.server.ws()` route — it races Vite's own HMR websocket if left
 *    enabled on the same raw `http.Server`. `dev-game` disables Vite's HMR
 *    (`hmr: false`) rather than relying on that coexistence.
 *
 * Since Task 4 the game lives on a SECOND server `dev-game` boots for it
 * (spec §6) — every fetch of a game route below goes to `preview(ctx)`,
 * never to the root, and the "own origin" block at the end holds the
 * split itself.
 */
const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');
const WEB_ROOT = join(__dirname, 'fixtures', 'dev-game-web');
const WORKSPACE = join(__dirname, 'fixtures', 'workspace'); // e8.yml: `[]`

let host: IdeHost | undefined;
let ctx: Context | undefined;
/** Populated by `writableProject()` (the restart block, below) — cleaned up here rather than in a nested `afterEach`, so removal runs AFTER `ctx`'s e8-server has actually been stopped, not before. */
const restartTestDirs: string[] = [];

afterEach(async () => {
  await host?.stop();
  host = undefined;
  await ctx?.fiber.dispose();
  ctx = undefined;
  for (const dir of restartTestDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A bare root carrying exactly what `dev-game` injects: the IDE's own
 * server, `rpc` (`/ide`, `reportGameDiagnostics`) and a stand-in
 * `runtimeAssets` — the real one needs a project; what `dev-game` does
 * with it (`attachGameRoutes(preview)`) is held by project-scope.test.ts.
 */
async function bare(): Promise<Context> {
  ctx = new Context();
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
  await ctx.plugin(rpc);
  await ctx.plugin({
    name: 'runtime-assets-stub',
    apply(c: Context) {
      c.provide('runtimeAssets', { attachGameRoutes() {} });
    },
  });
  return ctx;
}

/** Where the GAME answers: the preview server `dev-game` booted for it (spec §6). */
const preview = (c: Context) => c.get('devGamePreview')!.url!;
/** The IDE's own server — the one `dev-game` was plugged under. */
const rootUrl = (c: Context) => `http://${c.server.host}:${c.server.port}`;

describe('dev-game — serving the bundle', () => {
  it('serves the game root through vite, transformed', async () => {
    await bare();
    await ctx!.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    const res = await fetch(`${preview(ctx!)}/`);
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
    await bare();
    await ctx!.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    const res = await fetch(`${preview(ctx!)}/%zz`);
    expect(res.status).toBe(405);
    expect(await res.text()).not.toContain('dev-game fixture root');
  });

  it('serves a JS module from the game root through vite’s on-demand transform', async () => {
    await bare();
    await ctx!.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    const res = await fetch(`${preview(ctx!)}/main.js`);
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
      [
        'name: e8-transitive-fixture',
        'rows:',
        '  - id: multi1',
        '    name: multi-file-pkg',
        '',
      ].join('\n'),
    );

    // `root: workspace` mirrors the real CLI (`engine/apps/cli/src/
    // index.ts` passes `root: cwd` to `dev-game` for `e8 dev`), and keeps
    // this row's package inside vite's default `fs.allow` search — the
    // same real-world configuration, not a fixture-only shortcut.
    host = await createIdeHost({ root: workspace, port: 0 });
    await host.ctx.plugin(devGame, {
      root: workspace,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body.diagnostics.filter((d: { plugin: string }) => d.plugin === 'multi1')).toEqual([]);
    const row = body.rows.find((r: { id: string }) => r.id === 'multi1');
    expect(row.runtimeUrl).toMatch(/^\/@fs\/.*runtime\.js$/);

    // Served by dev-game's vite — on the preview server, not the root.
    const entryRes = await fetch(`${preview(host.ctx)}${row.runtimeUrl}`);
    expect(entryRes.status).toBe(200);
    expect(await entryRes.text()).toContain('helper.js');

    // Not gated by runtime-assets.ts's own check at all — that only ever
    // looks at the DECLARED entry — so this confirms vite's own serving of
    // a plain sibling file is unaffected by the new check existing at all.
    const helperUrl = row.runtimeUrl.replace(/runtime\.js$/, 'helper.js');
    const helperRes = await fetch(`${preview(host.ctx)}${helperUrl}`);
    expect(helperRes.status).toBe(200);
    expect(await helperRes.text()).toContain('HELPER_LOADED');

    // `scenes.ts`'s set is on the preview too (`scenesHost.attachGameRoutes`).
    const scenes = await fetch(`${preview(host.ctx)}/api/scenes`);
    expect(scenes.status).toBe(200);
    expect(await scenes.json()).toMatchObject({ scenes: [], nodeTypes: [] });
  });
});

/**
 * A row that joins the composition after the dev server started.
 *
 * `dev-game` names the row entries it knows about to vite's dependency
 * optimizer at startup, so the browser only ever sees one optimizer
 * generation — that is what stops the two-`Container` fault the pixi
 * `TypeError` came from. A row added afterwards is outside that crawl, and
 * the reload vite would send to repair the resulting tear goes nowhere
 * because `dev-game` runs with `hmr: false`.
 *
 * That residual cannot be closed from here. What it can stop being is
 * SILENT: vite logs "optimized dependencies changed. reloading" to the
 * server console, and the person in the browser simply loses pointer
 * events on the board.
 */
describe('dev-game — a row added after the server started says so', () => {
  function bundle(rows: string[]): string {
    return ['name: e8-late-row-fixture', 'rows:', ...rows, ''].join('\n');
  }

  function pkg(dir: string, name: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './runtime.js' } },
      }),
    );
    writeFileSync(
      join(dir, 'index.js'),
      `export const name = '${name}';\nexport function apply() {}\n`,
    );
    writeFileSync(join(dir, 'runtime.js'), `export function apply() {}\n`);
  }

  it('warns about the late row, and only about it', async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'ide-host-late-row-')));
    writeFileSync(join(workspace, 'index.html'), '<!doctype html><title>fixture</title>\n');
    pkg(join(workspace, 'node_modules', 'early-pkg'), 'early-pkg');
    pkg(join(workspace, 'node_modules', 'late-pkg'), 'late-pkg');

    writeFileSync(join(workspace, 'e8.yml'), '[]\n');
    writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-late-row-fixture\n');
    const bundlesDir = join(workspace, 'bundles', 'e8-late-row-fixture');
    mkdirSync(bundlesDir, { recursive: true });
    const bundleFile = join(bundlesDir, 'e8.bundle.yml');
    writeFileSync(bundleFile, bundle(['  - id: early1', '    name: early-pkg']));

    host = await createIdeHost({ root: workspace, port: 0 });
    await host.ctx.plugin(devGame, {
      root: workspace,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    // Nothing to say yet: every row was in the crawl.
    const before = await (await fetch(`${host.url}/api/composition`)).json();
    expect(before.diagnostics.filter((d: { where: string }) => d.where === 'dev-server')).toEqual(
      [],
    );

    // Now a row arrives, with the server already up. `/api/composition`
    // re-reads the project from disk, which is the whole point of that
    // route — see its own comment.
    writeFileSync(
      bundleFile,
      bundle(['  - id: early1', '    name: early-pkg', '  - id: late1', '    name: late-pkg']),
    );

    const after = await (await fetch(`${host.url}/api/composition`)).json();
    expect(after.rows.map((r: { id: string }) => r.id)).toEqual(['early1', 'late1']);
    const late = after.diagnostics.filter((d: { where: string }) => d.where === 'dev-server');
    expect(late).toHaveLength(1);
    expect(late[0].plugin).toBe('late1');
    expect(late[0].severity).toBe('warning');
    expect(late[0].message).toContain('after the dev server started');
    // And the row that WAS in the crawl is not swept up with it.
    expect(late[0].message).not.toContain('early1');
  });
});

/**
 * The containment gap on the path the browser actually loads through.
 *
 * `runtime-assets.ts` realpaths both sides before it hands out a
 * `runtimeUrl`, and `/plugin-runtime/:id` re-checks at request time — but
 * `/@fs/<path>` is vite's own route, reachable by any same-origin script
 * that builds the URL itself. What guards it there is `server.fs.allow`,
 * which compares LEXICALLY, so a symlink INSIDE an allowed root serves
 * whatever it points at.
 *
 * Both halves are measured here rather than asserted about one path only:
 * the escape must be refused, and the identical file must still be refused
 * when asked for directly (which proves the fixture is a real escape and
 * not a file that was out of bounds anyway), and a legitimate file inside
 * the root must still be served (which proves the guard is not just
 * refusing everything).
 *
 * **The target of the symlink EXISTS**, deliberately. A symlink pointing
 * at nothing dies on `realpathSync`'s ENOENT before any containment
 * comparison runs — the request would still fail, and the test would still
 * be green, while measuring nothing about the check it names. That exact
 * mistake has cost this branch a round before; `runtime-assets.test.ts`'s
 * escapee fixtures carry the same note.
 */
describe('dev-game — /@fs/ cannot be walked out of the served roots', () => {
  async function escapeFixture(): Promise<{ base: string; link: string; secret: string }> {
    // Realpath'd for the reason the multi-file test above spells out:
    // macOS `/var` is itself a symlink, and an unresolved root makes
    // vite's own allow list disagree with the path this test asks for.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'ide-host-fs-outside-')));
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'ide-host-fs-root-')));
    writeFileSync(join(workspace, 'index.html'), '<!doctype html><title>fixture</title>\n');
    writeFileSync(join(workspace, 'inside.js'), "export const marker = 'INSIDE_THE_ROOT';\n");

    const secret = join(outside, 'secret.js');
    writeFileSync(secret, "export const secret = 'FS_WALKED_OUT';\n");
    const link = join(workspace, 'link.js');
    symlinkSync(secret, link);

    await bare();
    await ctx!.plugin(devGame, {
      root: workspace,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });
    return {
      base: preview(ctx!),
      link,
      secret: join(workspace, 'inside.js'),
    };
  }

  it('refuses a symlink inside the served root whose target is outside it', async () => {
    const { base, link } = await escapeFixture();
    const res = await fetch(`${base}/@fs/${link}`);
    expect(res.status).toBe(403);
    // The bytes themselves must not ride along in any shape — this served
    // 200 with the secret's contents before the guard existed.
    expect(await res.text()).not.toContain('FS_WALKED_OUT');
  });

  it('still refuses the same file asked for directly — so the case above is a real escape', async () => {
    const { base, link } = await escapeFixture();
    const target = realpathSync(link);
    const res = await fetch(`${base}/@fs/${target}`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('FS_WALKED_OUT');
  });

  it('still serves an ordinary file inside the root', async () => {
    const { base, secret: inside } = await escapeFixture();
    const res = await fetch(`${base}/@fs/${inside}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('INSIDE_THE_ROOT');
  });

  it('does not turn a path that is simply absent into an access refusal', async () => {
    // An absent file is not this guard's to answer. Getting that backwards
    // is what makes an escape test pass for the wrong reason, so it is
    // held here explicitly — the assertion is that the answer is NOT a
    // 403, not that any particular answer arrives.
    //
    // What actually arrives, measured rather than assumed: 200, with the
    // vite root's own `index.html`. Vite's `appType: 'spa'` fallback owns
    // every unmatched request under `dev-game`'s catch-all, so there is no
    // 404 on this server to expect. The property this test names holds;
    // the mechanism it used to claim ("vite's 404") did not exist.
    const { base } = await escapeFixture();
    const res = await fetch(`${base}/@fs/${join(tmpdir(), 'ide-host-fs-nothing-here.js')}`);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>fixture</title>');
  });
});

describe('dev-game — the spin route', () => {
  it('carries a real spin through to ctx.session, shape unchanged', async () => {
    await bare();
    await ctx!.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    const res = await fetch(`${preview(ctx!)}/api/spin`, {
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
    await bare();
    await ctx!.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
      binPath: '/nonexistent/e8-server-binary',
    });

    const res = await fetch(`${preview(ctx!)}/api/spin`, {
      method: 'POST',
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'session' });
  });

  /**
   * The gap task-2-3-report.md named and task-4-6-report.md closes: this
   * route runs in the HOST process, not the browser, so nothing on the
   * game's own side can write its failures into `ctx.diagnostics` the way
   * an in-page seam does — only a page reading the HTTP response could
   * relay them (`first-slot/src/main.ts` does), and a different game's
   * page that does not wire the same relay would show nothing for the
   * same failure. So the host speaks `game-diagnostics` itself, over the
   * SAME `/ide` socket `rpc.ts` (Task 6) just learned the type for —
   * unconditionally, not depending on any page being open at all.
   *
   * Uses `createIdeHost` (composes `rpc`, hence `ctx.ideRpc`) rather than
   * the bare `Context` + `Server` the test above uses — `dev-game` and
   * `rpc` are SIBLING plugin scopes under the SAME host `ctx` in this
   * shape, which is the real one `e8 dev` boots (see `apps/cli/src/
   * index.ts`), and the one `ctx.reflect.get('ideRpc', false)` inside
   * `dev-game.ts` has to actually work against.
   */
  it('also reaches the IDE panel directly, as game-diagnostics on the /ide socket — not only via a page relay', async () => {
    host = await createIdeHost({ root: WORKSPACE, port: 0 });
    await host.ctx.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
      binPath: '/nonexistent/e8-server-binary',
    });

    const socket = new WebSocket(`${host.url.replace('http', 'ws')}/ide`);
    const received: ServerMessage[] = [];
    socket.on('message', (data) => received.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve) => socket.once('open', resolve));

    // Before any spin: the boot failure is the `session` speaker's row,
    // retained for a client connecting after it (final review F1 — it
    // used to reach the panel only as a spin's own row).
    const frames = () => received.filter((m) => m.type === 'game-diagnostics');
    await expect.poll(() => frames()).toHaveLength(1);
    expect(frames()[0]).toMatchObject({
      type: 'game-diagnostics',
      diagnostics: [{ severity: 'error', plugin: 'session' }],
    });

    const res = await fetch(`${preview(host.ctx)}/api/spin`, { method: 'POST' });
    expect(res.status).toBe(502); // the HTTP response still carries it too — unchanged

    // The spin's frame: `spin`'s group is empty (the row is the session's
    // own object), so the same one row, not two.
    await expect.poll(() => frames()).toHaveLength(2);
    expect(frames()[1]).toMatchObject({
      type: 'game-diagnostics',
      diagnostics: [{ severity: 'error', plugin: 'session' }],
    });

    socket.close();
  });
});

/**
 * Spec §6: the game is served from its OWN origin, on purpose — a second
 * `@cordisjs/plugin-server` instance `dev-game` boots in its scope. This
 * used to be "one server, two consumers", and the separation held only
 * because `apps/web`'s vite happened to be a different process. Now the
 * root is the IDE's and the preview is the game's, and the split is what
 * this block asserts — not merely that both keep answering.
 */
describe('dev-game — the game on its own origin', () => {
  const game = { root: WEB_ROOT, gamesDir: GAME, gameId: 'first-slot', betLevel: 1.0, port: 0 };

  it('the game html answers on the preview and NOT on the root; the root keeps its own routes', async () => {
    // `ideDist` pinned to nothing so the root's `/` is the IDE's own
    // "not built" page on every machine, never the game — deterministic
    // whether or not `apps/web/dist` exists here.
    host = await createIdeHost({
      root: WORKSPACE,
      port: 0,
      ideDist: join(WORKSPACE, 'no-ide-dist'),
    });
    await host.ctx.plugin(devGame, { ...game, previewPort: 0 });

    const url = preview(host.ctx);
    expect(url).not.toBe(host.url);
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('dev-game fixture root');

    // The root's catch-all is `ide-static`'s (spec §7), not the game's.
    const root = await fetch(`${host.url}/`);
    expect(root.status).toBe(503);
    expect(await root.text()).not.toContain('dev-game fixture root');

    const health = await fetch(`${host.url}/api/health`);
    expect(await health.json()).toEqual({ ok: true });
    expect(await host.ctx.composition.snapshot()).toEqual({ rows: [], diagnostics: [] });
  });

  it('/api/spin is on the preview only', async () => {
    await bare();
    await ctx!.plugin(devGame, { ...game, previewPort: 0 });
    expect((await fetch(`${preview(ctx!)}/api/spin`, { method: 'POST' })).status).toBe(200);
    expect((await fetch(`${rootUrl(ctx!)}/api/spin`, { method: 'POST' })).status).toBe(404);
  });

  it("/ide upgrades on both — the game's ide-bridge opens ws://<its own host>/ide", async () => {
    await bare();
    await ctx!.plugin(devGame, { ...game, previewPort: 0 });
    for (const base of [rootUrl(ctx!), preview(ctx!)]) {
      const socket = new WebSocket(`${base.replace('http', 'ws')}/ide`);
      const first = await new Promise<ServerMessage>((resolve, reject) => {
        socket.once('message', (data) => resolve(JSON.parse(String(data)) as ServerMessage));
        socket.once('error', reject);
      });
      expect(first.type).toBe('workspace');
      socket.close();
    }
  });

  it('a busy previewPort is a dev-game diagnostic naming the port; the scope stays up without a preview', async () => {
    const busy = createNetServer().listen(0, '127.0.0.1');
    await new Promise((resolve) => busy.once('listening', resolve));
    const previewPort = (busy.address() as { port: number }).port;
    try {
      await bare();
      const socket = new WebSocket(`${rootUrl(ctx!).replace('http', 'ws')}/ide`);
      const frames: ServerMessage[] = [];
      socket.on('message', (data) => frames.push(JSON.parse(String(data)) as ServerMessage));
      await new Promise((resolve) => socket.once('open', resolve));

      const fiber = ctx!.plugin(devGame, { ...game, previewPort });
      await fiber;
      expect(ctx!.get('devGamePreview')).toEqual({ url: null });
      expect(fiber.ctx.get('devGamePreview')).toEqual({ url: null });
      await expect.poll(() => frames.filter((m) => m.type === 'game-diagnostics')).toHaveLength(1);
      expect(frames.find((m) => m.type === 'game-diagnostics')).toMatchObject({
        source: 'host',
        diagnostics: [
          {
            severity: 'error',
            plugin: 'dev-game',
            where: `preview port ${previewPort}`,
            fix: 'free the port, or set PREVIEW_PORT',
          },
        ],
      });
      // The root still listens (cordis's own 404, no game html), and no
      // e8-server was spawned for a game nothing can reach.
      expect((await fetch(`${rootUrl(ctx!)}/`)).status).toBe(404);
      expect(ctx!.get('session')).toBeUndefined();
      socket.close();
    } finally {
      await new Promise((resolve) => busy.close(resolve));
    }
  });

  it('disposing the scope closes the preview port and leaves the root answering', async () => {
    await bare();
    const fiber = ctx!.plugin(devGame, { ...game, previewPort: 0 });
    await fiber;
    const url = preview(ctx!);
    expect((await fetch(`${url}/`)).status).toBe(200);

    await fiber.dispose();
    await expect(fetch(`${url}/`)).rejects.toThrow();
    expect((await fetch(`${rootUrl(ctx!)}/`)).status).toBe(404);
  });
});

describe('dev-game — teardown', () => {
  it('stops the spawned e8-server process on dispose, not just the http server', async () => {
    await bare();
    await ctx!.plugin(devGame, {
      root: WEB_ROOT,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    const pid = ctx!.session.pid;
    expect(pid).not.toBeNull();

    await ctx!.fiber.dispose();
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

/**
 * The link task 6's live-host measurement found missing: everything
 * upstream of the actual math (`ctx.spinSchema`, `GET /api/composition`)
 * was already fresh on the next request, but `e8-server` — spawned once
 * by `session.apply` and never told to reload — kept answering with the
 * PRE-edit script until the whole host restarted, measured directly by a
 * `scriptSha256` that did not change across a real `PUT` (see
 * task-6-report.md). This block turns that measurement into an assertion.
 *
 * **What the first version of this test actually proved, corrected in
 * review.** It edited `script.spin` by adding a field to `record Vars`
 * without also updating the `vars: Vars { max_win_reached: false }`
 * literal `execute()` returns — legal-looking SpinML that `e8-server`
 * actually refuses (`vars literal is missing 'measured_marker' — cover
 * every field or spread with ..v`), so the respawn died and `/api/spin`
 * answered `scriptSha256: undefined` from that point on. The assertion
 * (`.not.toBe(before)`) is satisfied by `undefined !== <a real hash>`, so
 * the test passed for the wrong reason — a `restart()` that killed the
 * process and never called `boot()` again would have passed it too.
 * `edited` below is `original` plus a trailing comment line — verified by
 * hand, through this exact route, that it loads and the hash moves (see
 * task-6-report.md's round-3 addendum) — and the poll now requires an
 * actual string, not merely "not equal to the one before".
 *
 * `files` is composed here alongside `devGame`, sibling plugin scopes on
 * one bare `Context` — the same shape the "one server, two consumers"
 * block above already sets up for `composition`, and the shape `e8 dev`
 * itself boots (`apps/cli/src/index.ts` composes `files` inside
 * `createIdeHost`, `devGame` after, both with the SAME `cwd`/`root`). That
 * equality is load-bearing here, not incidental: `dev-game.ts`'s trigger
 * resolves a written path against `config.root` and checks containment
 * against `config.gamesDir`, so `root` has to be the project directory
 * `files` writes into — unlike the file's other `devGame` tests above,
 * which use `WEB_ROOT` (an unrelated fixture) because they never write
 * through `files` at all. `dev-game.ts` listens for `files/written` on its
 * OWN scope; cordis events are dispatched against the whole context tree a
 * `ctx.plugin()` call descends from, not scoped to the plugin that happens
 * to emit — the same fact `composition.ts` already relies on for
 * `internal/status`.
 */
describe('dev-game — restart on a script.spin write', () => {
  /**
   * A private, writable copy of `GAME` — never the checked-in fixture,
   * which every other test in this file only reads. Registered into the
   * module-level `restartTestDirs` (removed by the file's own top-level
   * `afterEach`, AFTER `ctx`'s e8-server is stopped) rather than a
   * `describe`-scoped `afterEach` here — vitest runs a nested `afterEach`
   * BEFORE the outer one, which would have deleted a running process's
   * `--games-dir` out from under it.
   */
  function writableProject(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ide-host-dev-game-restart-')));
    cpSync(GAME, join(dir, 'game'), { recursive: true });
    restartTestDirs.push(dir);
    return dir;
  }

  /** `writableProject()` plus everything else `first-slot` has — `e8.yml` included, which `createIdeHost` reads. */
  function writableProjectWithManifest(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ide-host-dev-game-restart-')));
    cpSync(join(GAME, '..'), dir, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.endsWith('tsconfig.json'),
    });
    // `first-slot`'s own `scenes/base_game.scene.yml` already has the board
    // in it, so the copy above carries it and the host's `scenes` speaker
    // has nothing to say about this copy — every host frame below is the
    // session's alone.
    restartTestDirs.push(dir);
    return dir;
  }

  /** The real binary, where platform-core's postinstall puts it — for a wrapper script that decides per spawn whether to exec it. */
  function realBinary(): string {
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    return join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'packages',
      'platform-core',
      'bin',
      `e8-server-${process.platform}-${arch}`,
    );
  }

  async function spinScriptSha256(base: string): Promise<string | undefined> {
    const res = await fetch(`${base}/api/spin`, { method: 'POST' });
    const body = await res.json();
    return body.scriptSha256;
  }

  it('a write to game/script.spin through the real route restarts the session, and the next spin reflects the new script', async () => {
    // Two real e8-server spawns (initial boot + the restart under test)
    // plus the poll below — comfortably over vitest's 5s default.
    const projectDir = writableProject();
    await bare();
    await ctx!.plugin(files, { cwd: projectDir });
    await ctx!.plugin(devGame, {
      root: projectDir,
      gamesDir: join(projectDir, 'game'),
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    const before = await spinScriptSha256(preview(ctx!));
    expect(before).toBeTruthy();

    // Verified by hand against the real binary, through this exact route,
    // before trusting it here (see task-6-report.md): loads cleanly, and
    // the hash moves. A trailing comment is the smallest edit that is
    // unambiguously still legal SpinML — it cannot possibly desync a
    // literal elsewhere in the file the way adding a field can.
    const original = readFileSync(join(projectDir, 'game', 'script.spin'), 'utf8');
    const edited = `${original}\n-- edited by mouse\n`;

    const put = await fetch(`${rootUrl(ctx!)}/api/files/game/script.spin`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base64: Buffer.from(edited, 'utf8').toString('base64') }),
    });
    expect(put.status).toBe(200);

    // The restart runs fire-and-forget off the write (see dev-game.ts's
    // own comment on why) — so this polls for the effect (a changed hash)
    // rather than assuming a fixed delay is enough. `typeof sha ===
    // 'string'` is the half the first version of this test skipped: a
    // respawn that died would answer `undefined` forever, which also
    // is not `before` — this must observe an ACTUAL hash, not merely a
    // different answer.
    await expect
      .poll(() => spinScriptSha256(preview(ctx!)), { timeout: 15_000 })
      .toSatisfy((sha) => typeof sha === 'string' && sha !== before);
  }, 20_000);

  /**
   * `writableProject()` again, but the copy is the host's `cwd` as well —
   * `createIdeHost` composes `files` (the PUT route) and `rpc` (the `/ide`
   * socket the panel reads), the real `e8 dev` shape. The bare-`Context`
   * tests above compose no `rpc`, which is exactly the socket these two
   * are about.
   */
  /**
   * `first-slot`'s `flow.yml` (copied in by `writableProjectWithManifest`)
   * has a `click` node of kind `sound` — `fx1`'s row (`@energy8engine/
   * flow-fx`), not one of `flow.ts`'s built-ins. None of these tests runs
   * a live game, so `flow.ts`'s own boot-time check (`validateFlow`
   * against `BUILTIN_KIND_INFO` — see that plugin's module doc) never
   * hears otherwise, and reports this node once, for good, the moment the
   * project boots: exactly the shape `graph.ts`'s `unknown kind` check
   * produces. It rides in `ideRpc`'s single 'host' frame alongside
   * whatever `session` says (see `rpc.ts`'s `groups`/`lastHostDiagnostics`
   * — one merged frame per speaker, `flow`'s never retracted here), so it
   * is every test below's constant companion, not something to filter out.
   */
  const FLOW_UNKNOWN_SOUND = {
    severity: 'error' as const,
    plugin: 'flow',
    where: 'click',
    message: "unknown kind 'sound'",
  };

  async function hostOverProject(projectDir: string, binPath?: string) {
    // `createIdeHost` needs an e8.yml; `first-slot`'s own is copied with
    // the rest of the project, not only `game/`. Its `game/spec.json` is
    // NOT kept: the project scope boots its own `dev-game` off that file,
    // and this test needs the one it composes by hand below — with a
    // `binPath` the spec cannot carry — to be the only session.
    rmSync(join(projectDir, 'game', 'spec.json'));
    host = await createIdeHost({ root: projectDir, port: 0 });
    await host.ctx.plugin(devGame, {
      root: projectDir,
      gamesDir: join(projectDir, 'game'),
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
      binPath,
    });
    const socket = new WebSocket(`${host.url.replace('http', 'ws')}/ide`);
    const frames: ServerMessage[] = [];
    socket.on('message', (data) => frames.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve) => socket.once('open', resolve));
    const hostFrames = () =>
      frames.filter(
        (m): m is Extract<ServerMessage, { type: 'game-diagnostics' }> =>
          m.type === 'game-diagnostics' && m.source === 'host',
      );
    // `flow.ts` reports `FLOW_UNKNOWN_SOUND` synchronously during
    // `createIdeHost`, well before this socket connects — the connecting
    // client is greeted with it (`rpc.ts`'s `retainedFrames('host')`) as
    // its very first 'host' frame. Waited out HERE, once, so every
    // caller's own baseline (`hostFrames().length` right after this
    // returns) is the stable "just the greeting", not a race against its
    // arrival.
    await expect.poll(() => hostFrames().length, { timeout: 10_000 }).toBeGreaterThan(0);
    return { socket, hostFrames };
  }

  async function putScript(projectDir: string, text: string): Promise<number> {
    const res = await fetch(`${host!.url}/api/files/game/script.spin`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base64: Buffer.from(text, 'utf8').toString('base64') }),
    });
    return res.status;
  }

  it("a save that breaks the math reaches the IDE panel with the compiler's own location, without any spin", async () => {
    // `void ctx.session.restart()` discarded the one result that carries
    // `script.spin:LINE:COL` from the compiler — the only "where" there is
    // for a mistake inside `execute`, which the parser never reads. It
    // reached the panel only when a spin happened to 502 afterwards.
    const projectDir = writableProjectWithManifest();
    const { socket, hostFrames } = await hostOverProject(projectDir);
    try {
      const original = readFileSync(join(projectDir, 'game', 'script.spin'), 'utf8');
      expect(await putScript(projectDir, `${original}\nrecord {\n`)).toBe(200);

      // `hostOverProject` already waited out the boot greeting (one
      // frame, `FLOW_UNKNOWN_SOUND` alone) — the break adds at least one
      // more, `session`'s, merged alongside it.
      await expect.poll(() => hostFrames().length, { timeout: 15_000 }).toBeGreaterThan(1);
      const frame = hostFrames().at(-1)!;
      expect(frame.diagnostics).toEqual([
        FLOW_UNKNOWN_SOUND,
        expect.objectContaining({
          severity: 'error',
          plugin: 'session',
          message: expect.stringMatching(/failed to restart[\s\S]*script\.spin:\d+:\d+/),
        }),
      ]);
    } finally {
      socket.close();
    }
  }, 20_000);

  it('a spin that lands mid-restart is answered "restarting" but never reported to the panel', async () => {
    // The wrapper boots the real binary once, then takes three seconds to
    // fail — long enough for a spin to land inside the restart window, and
    // a failure after it so the test can wait for something that DOES
    // reach the panel rather than for an absence.
    const projectDir = writableProjectWithManifest();
    const flag = join(projectDir, 'fail-slowly-from-now-on');
    const wrapper = join(projectDir, 'e8-server-slow-fail.sh');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ -e ${JSON.stringify(flag)} ]; then sleep 3; exit 1; fi\nexec ${JSON.stringify(realBinary())} "$@"\n`,
      { mode: 0o755 },
    );
    const { socket, hostFrames } = await hostOverProject(projectDir, wrapper);
    try {
      writeFileSync(flag, '');
      const original = readFileSync(join(projectDir, 'game', 'script.spin'), 'utf8');
      expect(await putScript(projectDir, `${original}\n-- edited by mouse\n`)).toBe(200);

      // Inside the window: the caller gets the wait as data.
      const res = await fetch(`${preview(host!.ctx)}/api/spin`, { method: 'POST' });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { diagnostics: { message: string }[] };
      expect(body.diagnostics[0].message).toMatch(/restarting/);

      // After the window: the failure reaches the panel, the wait never did.
      // (The mid-restart spin itself reports an EMPTY `spin` group — its
      // retract, see the route — so "a frame arrived" is not "the failure
      // arrived"; wait for the row.)
      await expect
        .poll(() => hostFrames().flatMap((f) => f.diagnostics.map((d) => d.message)), {
          timeout: 15_000,
        })
        .toContainEqual(expect.stringMatching(/failed to restart/));
      for (const frame of hostFrames()) {
        expect(frame.diagnostics.map((d) => d.message)).not.toContainEqual(
          expect.stringMatching(/restarting/),
        );
      }
    } finally {
      socket.close();
    }
  }, 20_000);

  /**
   * Debt slice B1: the host's list has speakers, and a speaker's next report
   * REPLACES its last. `session` reports every restart's result — an empty
   * list on a clean one, which is the retract: "failed to restart" leaves
   * the panel with the save that cured it. Measured before this on the
   * original `dev-game.ts`: a clean restart reported nothing at all (its
   * own comment said so — "a limit of the primitive"), and the row stayed.
   */
  it('a save that fixes the math takes the "failed to restart" row back', async () => {
    const projectDir = writableProjectWithManifest();
    const { socket, hostFrames } = await hostOverProject(projectDir);
    try {
      const original = readFileSync(join(projectDir, 'game', 'script.spin'), 'utf8');
      expect(await putScript(projectDir, `${original}\nrecord {\n`)).toBe(200);
      await expect
        .poll(
          () =>
            hostFrames()
              .at(-1)
              ?.diagnostics.map((d) => d.message),
          { timeout: 15_000 },
        )
        .toEqual(["unknown kind 'sound'", expect.stringMatching(/failed to restart/)]);

      // `session`'s row is taken back; `flow`'s (this fixture's `click`
      // node) never was — nothing here fixes `flow.yml`.
      expect(await putScript(projectDir, original)).toBe(200);
      await expect
        .poll(() => hostFrames().at(-1)?.diagnostics, { timeout: 15_000 })
        .toEqual([FLOW_UNKNOWN_SOUND]);
    } finally {
      socket.close();
    }
  }, 25_000);

  /**
   * The `spin` speaker against a session that cannot play: the row it is
   * answered with IS `ctx.session.startupDiagnostic` — the object the
   * `session` group already holds — so the route reports it as nobody's
   * second row (`spin`'s group is EMPTY), and the save that cures the
   * session takes the whole host list back. Measured before this (final
   * review, F1): the same "failed to restart" stood twice, and `spin`'s
   * copy outlived the fixing save until someone spun again.
   *
   * Counts, not only contents: every `reportGameDiagnostics` call is one
   * frame, so "the fixing save sends `session`'s retract AND `spin`'s" is
   * "two frames more", and the empty `spin` group after the 502 is "one
   * frame more, still one row".
   */
  it('a spin answered with the session’s own row does not double it, and the fixing save empties the host list', async () => {
    const projectDir = writableProjectWithManifest();
    const { socket, hostFrames } = await hostOverProject(projectDir);
    const spin = () => fetch(`${preview(host!.ctx)}/api/spin`, { method: 'POST' });
    try {
      const original = readFileSync(join(projectDir, 'game', 'script.spin'), 'utf8');
      const before = hostFrames().length;
      expect(await putScript(projectDir, `${original}\nrecord {\n`)).toBe(200);
      // The breaking save sends TWO frames from one synchronous block —
      // `session`'s failure, then `spin`'s empty retract — so the count is
      // what is waited for; polling the last frame's content alone could
      // land between the two and put every count below off by one.
      await expect.poll(() => hostFrames().length, { timeout: 15_000 }).toBe(before + 2);
      expect(
        hostFrames()
          .at(-1)!
          .diagnostics.map((d) => d.message),
      ).toEqual(["unknown kind 'sound'", expect.stringMatching(/failed to restart/)]);
      const afterBreak = hostFrames().length;

      // The spin fails with the session's own startup diagnostic. One
      // frame (the `spin` speaker's empty group), still one row.
      expect((await spin()).status).toBe(502);
      await expect.poll(() => hostFrames().length).toBe(afterBreak + 1);
      expect(
        hostFrames()
          .at(-1)!
          .diagnostics.map((d) => d.message),
      ).toEqual(["unknown kind 'sound'", expect.stringMatching(/failed to restart/)]);

      // The fix: `session`'s retract, then `spin`'s — two frames, and the
      // host list is back down to just `flow`'s row — a spin never says
      // otherwise, and nothing here fixes `flow.yml`.
      expect(await putScript(projectDir, original)).toBe(200);
      await expect.poll(() => hostFrames().length, { timeout: 15_000 }).toBe(afterBreak + 3);
      expect(hostFrames().at(-1)?.diagnostics).toEqual([FLOW_UNKNOWN_SOUND]);
    } finally {
      socket.close();
    }
  }, 25_000);

  it('a spin against a dead engine reports an empty spin group — the exited row is the session’s — and the next save empties the list', async () => {
    // The `exited` row is not `RESTARTING`-coded, so this is the case
    // only the identity filter covers: without it the spin would stand
    // the same "exited" object twice.
    const projectDir = writableProjectWithManifest();
    const { socket, hostFrames } = await hostOverProject(projectDir);
    try {
      process.kill(host!.ctx.session.pid!, 'SIGKILL');
      // `hostOverProject`'s own wait already accounts for the greeting
      // (length 1); `> 1` here waits for the kill's own frame rather than
      // resolving at once on the greeting alone. `flow`'s row has no
      // `code` — `undefined` in the same slot.
      await expect.poll(() => hostFrames().length, { timeout: 10_000 }).toBeGreaterThan(1);
      expect(
        hostFrames()
          .at(-1)!
          .diagnostics.map((d) => d.code),
      ).toEqual([undefined, 'exited']);
      const afterDeath = hostFrames().length;

      const res = await fetch(`${preview(host!.ctx)}/api/spin`, { method: 'POST' });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { diagnostics: { code?: string }[] };
      expect(body.diagnostics.map((d) => d.code)).toEqual(['exited']);
      await expect.poll(() => hostFrames().length).toBe(afterDeath + 1);
      expect(
        hostFrames()
          .at(-1)!
          .diagnostics.map((d) => d.code),
      ).toEqual([undefined, 'exited']);

      const original = readFileSync(join(projectDir, 'game', 'script.spin'), 'utf8');
      expect(await putScript(projectDir, `${original}\n-- edited by mouse\n`)).toBe(200);
      await expect.poll(() => hostFrames().length, { timeout: 15_000 }).toBe(afterDeath + 3);
      expect(hostFrames().at(-1)?.diagnostics).toEqual([FLOW_UNKNOWN_SOUND]);
    } finally {
      socket.close();
    }
  }, 25_000);

  it('a restart still in flight when the scope is disposed reports nothing — not "gone" under the next project', async () => {
    // Final review F3/F5: the restart is not awaited, `ctx.ideRpc` is the
    // root's and outlives this scope, so a project switch mid-restart used
    // to land the old project's "gone" answer in the new project's panel.
    // The wrapper takes two seconds to exec the real binary once the flag
    // exists — long enough to dispose while the respawn is in flight.
    const projectDir = writableProject();
    const flag = join(projectDir, 'start-slowly-from-now-on');
    const wrapper = join(projectDir, 'e8-server-slow-start.sh');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ -e ${JSON.stringify(flag)} ]; then sleep 2; fi\nexec ${JSON.stringify(realBinary())} "$@"\n`,
      { mode: 0o755 },
    );
    // `bare()` composes the real `rpc`; this one wants a stub in its place
    // so the calls themselves are the assertion, not a socket's frames.
    const reportGameDiagnostics = vi.fn();
    ctx = new Context();
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
    await ctx.plugin({
      name: 'stubs',
      apply(c: Context) {
        c.provide('runtimeAssets', { attachGameRoutes() {} });
        c.provide('ideRpc', { reportGameDiagnostics, attach() {} });
      },
    });
    const fiber = ctx!.plugin(devGame, {
      root: projectDir,
      gamesDir: join(projectDir, 'game'),
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
      binPath: wrapper,
    });
    await fiber;

    writeFileSync(flag, '');
    ctx!.emit('files/written', { path: 'game/script.spin' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    reportGameDiagnostics.mockClear();
    // Awaits the in-flight restart (session-dev's disposer chains on it),
    // so by the time this resolves the restart HAS answered — "gone".
    await fiber.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reportGameDiagnostics).not.toHaveBeenCalled();
  }, 25_000);

  /**
   * Debt slice A1: the math engine dying is a fact of the HOST, and the
   * host says so on the wire without waiting for a spin to find the
   * corpse — `session-dev` emits `session/exited`, this plugin relays it
   * as the `session` speaker's row. The next save's clean restart is the
   * retract, the same way it already takes "failed to restart" back.
   */
  it('the math engine dying reaches the panel as the session speaker, and the next clean save takes it back', async () => {
    const projectDir = writableProjectWithManifest();
    const { socket, hostFrames } = await hostOverProject(projectDir);
    try {
      process.kill(host!.ctx.session.pid!, 'SIGKILL');
      // `> 1`, not `> 0` — `hostOverProject` already leaves `hostFrames()`
      // at length 1 (the boot greeting alone); this waits for the kill's
      // own frame on top of it.
      await expect.poll(() => hostFrames().length, { timeout: 10_000 }).toBeGreaterThan(1);
      expect(hostFrames().at(-1)!.diagnostics).toEqual([
        FLOW_UNKNOWN_SOUND,
        expect.objectContaining({
          severity: 'error',
          plugin: 'session',
          code: 'exited',
          message: expect.stringMatching(/the math engine exited/),
        }),
      ]);

      const original = readFileSync(join(projectDir, 'game', 'script.spin'), 'utf8');
      expect(await putScript(projectDir, `${original}\n-- edited by mouse\n`)).toBe(200);
      await expect
        .poll(() => hostFrames().at(-1)?.diagnostics, { timeout: 15_000 })
        .toEqual([FLOW_UNKNOWN_SOUND]);
      expect(host!.ctx.session.pid).not.toBeNull();
    } finally {
      socket.close();
    }
  }, 25_000);

  it('a write to a .spin file OUTSIDE gamesDir does not restart the session — the containment axis, not just the extension one', async () => {
    // `notes.txt` (the first version of this test) fails BOTH conjuncts at
    // once — it is neither inside `gamesDir` nor named `*.spin` — so it
    // could not tell the two checks apart: removing `isInside` entirely
    // left this test green. `plugins/x.spin` ends in `.spin` and needs no
    // e8-server validation of anything (the file lands outside `gamesDir`,
    // so nothing ever asks the real binary to load it), so it isolates the
    // containment check on its own.
    const projectDir = writableProject();
    await bare();
    await ctx!.plugin(files, { cwd: projectDir });
    await ctx!.plugin(devGame, {
      root: projectDir,
      gamesDir: join(projectDir, 'game'),
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    const pidBefore = ctx!.session.pid;

    const put = await fetch(`${rootUrl(ctx!)}/api/files/plugins/x.spin`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base64: Buffer.from('not a game script', 'utf8').toString('base64') }),
    });
    expect(put.status).toBe(200);

    // Proving a negative: give a wrongly-triggered restart a real chance
    // to happen (a restart's own spawn+ready poll runs well under this)
    // before asserting the pid never moved.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(ctx!.session.pid).toBe(pidBefore);
  });

  it('a .spin removed from gamesDir, or gamesDir itself going away, restarts the session too — a moved or removed game/ must not leave e8-server on stale math', async () => {
    // Emitted directly, the way the in-flight test above does, and the
    // restart counted on a spy rather than through a pid: three events
    // in one test would mean three real respawns and three readiness
    // polls, for a predicate that is one string comparison.
    const projectDir = writableProject();
    await bare();
    await ctx!.plugin(devGame, {
      root: projectDir,
      gamesDir: join(projectDir, 'game'),
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });
    const restart = vi.spyOn(ctx!.session, 'restart').mockResolvedValue({ diagnostics: [] });

    ctx!.emit('files/removed', { path: 'game/script.spin' });
    expect(restart).toHaveBeenCalledTimes(1);

    ctx!.emit('files/removed', { path: 'assets/x.png' });
    expect(restart).toHaveBeenCalledTimes(1);

    // `game` renamed to `game2`: `files/removed` for the old name is what
    // restarts (the new name is outside gamesDir and says nothing).
    ctx!.emit('files/removed', { path: 'game' });
    ctx!.emit('files/written', { path: 'game2' });
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it('a write to a NON-.spin file inside gamesDir does not restart the session', async () => {
    const projectDir = writableProject();
    await bare();
    await ctx!.plugin(files, { cwd: projectDir });
    await ctx!.plugin(devGame, {
      root: projectDir,
      gamesDir: join(projectDir, 'game'),
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
      previewPort: 0,
    });

    const pidBefore = ctx!.session.pid;

    // `spec.json` lives inside `gamesDir` too — `.spin` is what makes this
    // NOT a restart trigger, not being outside the directory.
    const put = await fetch(`${rootUrl(ctx!)}/api/files/game/spec.json`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        base64: Buffer.from(
          readFileSync(join(projectDir, 'game', 'spec.json'), 'utf8'),
          'utf8',
        ).toString('base64'),
      }),
    });
    expect(put.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(ctx!.session.pid).toBe(pidBefore);
  });
});
