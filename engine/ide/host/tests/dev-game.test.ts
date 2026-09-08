import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
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

    host = await createIdeHost({ cwd: workspace, port: 0 });
    await host.ctx.plugin(devGame, {
      root: workspace,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
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

    ctx = new Context();
    await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
    await ctx.plugin(devGame, {
      root: workspace,
      gamesDir: GAME,
      gameId: 'first-slot',
      betLevel: 1.0,
      port: 0,
    });
    return {
      base: `http://${ctx.server.host}:${ctx.server.port}`,
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
