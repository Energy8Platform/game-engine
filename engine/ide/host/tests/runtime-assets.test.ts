import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from 'cordis';
import Server from '@cordisjs/plugin-server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

function fixture(name: string): string {
  return join(__dirname, 'fixtures', name);
}

/** See `project.test.ts`'s identical helper for why: never mutate a checked-in fixture in place. */
function copyFixtureToTemp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ide-host-runtime-${name}-`));
  cpSync(fixture(name), dir, { recursive: true });
  return dir;
}

let host: IdeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
});

describe('GET /api/composition', () => {
  it('serves the resolved composition', async () => {
    host = await createIdeHost({ root: fixture('project-simple'), port: 0 });
    const res = await fetch(`${host.url}/api/composition`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['boot1', 'reels1']);
    // No `dev-game` composed in this test (`e8 ide`-shaped host, not
    // `e8 dev`) — `runtimeUrl` falls back to the raw route. Both rows
    // resolve to the real `@energy8engine/boot`/`reels` packages (this
    // fixture references them by their real names — see
    // `fixtures/project-simple/bundles/e8-base/e8.bundle.yml`), and both
    // now declare `e8.runtime`, so neither comes back `null`.
    expect(body.rows.find((r: { id: string }) => r.id === 'boot1').runtimeUrl).toBe(
      '/plugin-runtime/boot1',
    );
    expect(body.rows.find((r: { id: string }) => r.id === 'reels1').runtimeUrl).toBe(
      '/plugin-runtime/reels1',
    );
  });

  it('carries the project diagnostics with the composition', async () => {
    // A profile listing a bundle that was never installed anywhere —
    // `resolveComposition` reports it, same shape as `project.test.ts`'s
    // "bundle that fails to parse" case, just for "not found" instead.
    const dir = mkdtempSync(join(tmpdir(), 'ide-host-runtime-missing-bundle-'));
    writeFileSync(join(dir, 'e8.yml'), '[]\n');
    writeFileSync(join(dir, 'e8.profile.yml'), 'bundles:\n  - does-not-exist\n');
    host = await createIdeHost({ root: dir, port: 0 });

    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body.diagnostics.length).toBeGreaterThan(0);
  });

  it("carries a row's seam declaration, so the browser can tell candidates apart before applying any", async () => {
    // Only the host can read a package manifest, so `e8.seam` reaches the
    // game the same way `runtimeUrl` does — attached per row. Without it
    // the browser has no way to know two rows are competing to provide
    // the same capability, and picking one silently is the failure the
    // seam exists to prevent.
    const workspace = mkdtempSync(join(tmpdir(), 'ide-host-runtime-seam-'));
    const nodeModules = join(workspace, 'node_modules');
    mkdirSync(nodeModules);

    const seamDir = join(nodeModules, 'seam-pkg');
    mkdirSync(seamDir);
    writeFileSync(
      join(seamDir, 'package.json'),
      JSON.stringify({
        name: 'seam-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: {
          runtime: { entry: './runtime.js' },
          seam: { name: 'renderer', matcher: { default: true } },
        },
      }),
    );
    writeFileSync(join(seamDir, 'index.js'), 'export function apply() {}\n');
    writeFileSync(join(seamDir, 'runtime.js'), 'export function apply() {}\n');

    // The same package shape with no `e8.seam` at all — a row that is not
    // a candidate for anything, which is what most rows are.
    const plainDir = join(nodeModules, 'plain-pkg');
    mkdirSync(plainDir);
    writeFileSync(
      join(plainDir, 'package.json'),
      JSON.stringify({
        name: 'plain-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './runtime.js' } },
      }),
    );
    writeFileSync(join(plainDir, 'index.js'), 'export function apply() {}\n');
    writeFileSync(join(plainDir, 'runtime.js'), 'export function apply() {}\n');

    writeFileSync(join(workspace, 'e8.yml'), '[]\n');
    writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-seam-fixture\n');
    const bundlesDir = join(workspace, 'bundles', 'e8-seam-fixture');
    mkdirSync(bundlesDir, { recursive: true });
    writeFileSync(
      join(bundlesDir, 'e8.bundle.yml'),
      [
        'name: e8-seam-fixture',
        'rows:',
        '  - id: renderer1',
        '    name: seam-pkg',
        '  - id: reels1',
        '    name: plain-pkg',
        '',
      ].join('\n'),
    );

    host = await createIdeHost({ root: workspace, port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();

    expect(body.rows.find((r: { id: string }) => r.id === 'renderer1').seam).toEqual({
      name: 'renderer',
      matcher: { default: true },
    });
    expect(body.rows.find((r: { id: string }) => r.id === 'reels1').seam).toBeUndefined();
  });

  /**
   * `requires` is `@energy8engine/game-runtime`'s to enforce, but only the
   * host can read a package manifest — so this is the one place that
   * matters: without this row-by-row forwarding, `createGame`'s check
   * would be enforcing a field the browser never actually receives, and
   * every project's `e8.runtime.requires` would be silently inert. Same
   * fixture shape as the `seam` test just above it, for the same reason:
   * one row that declares the field, one that does not, so the response
   * distinguishes "absent" from "present and forwarded" rather than
   * proving only that SOME row on the response has SOME `requires` key.
   */
  it("carries a row's requires declaration, so the browser can enforce it after composing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ide-host-runtime-requires-'));
    const nodeModules = join(workspace, 'node_modules');
    mkdirSync(nodeModules);

    const requiresDir = join(nodeModules, 'requires-pkg');
    mkdirSync(requiresDir);
    writeFileSync(
      join(requiresDir, 'package.json'),
      JSON.stringify({
        name: 'requires-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './runtime.js', requires: ['board'] } },
      }),
    );
    writeFileSync(join(requiresDir, 'index.js'), 'export function apply() {}\n');
    writeFileSync(join(requiresDir, 'runtime.js'), 'export function apply() {}\n');

    // The same package shape with no `e8.runtime.requires` at all — a row
    // that needs nothing declared, which is what most rows are.
    const plainDir = join(nodeModules, 'plain-requires-pkg');
    mkdirSync(plainDir);
    writeFileSync(
      join(plainDir, 'package.json'),
      JSON.stringify({
        name: 'plain-requires-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './runtime.js' } },
      }),
    );
    writeFileSync(join(plainDir, 'index.js'), 'export function apply() {}\n');
    writeFileSync(join(plainDir, 'runtime.js'), 'export function apply() {}\n');

    writeFileSync(join(workspace, 'e8.yml'), '[]\n');
    writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-requires-fixture\n');
    const bundlesDir = join(workspace, 'bundles', 'e8-requires-fixture');
    mkdirSync(bundlesDir, { recursive: true });
    writeFileSync(
      join(bundlesDir, 'e8.bundle.yml'),
      [
        'name: e8-requires-fixture',
        'rows:',
        '  - id: playloop1',
        '    name: requires-pkg',
        '  - id: reels1',
        '    name: plain-requires-pkg',
        '',
      ].join('\n'),
    );

    host = await createIdeHost({ root: workspace, port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();

    expect(body.rows.find((r: { id: string }) => r.id === 'playloop1').requires).toEqual(['board']);
    expect(body.rows.find((r: { id: string }) => r.id === 'reels1').requires).toBeUndefined();
  });

  /**
   * The three ways a row can end up with `runtimeUrl: null`, which used to
   * be indistinguishable from the outside. Only ONE of them is legitimate,
   * and the other two are the most likely first-run mistakes there are —
   * so each case below asserts the DIAGNOSTIC, not just the null.
   *
   * A single workspace serves all three: three rows, three situations, one
   * `/api/composition` call, so the assertions also prove the three do not
   * bleed into each other (a per-row diagnostic naming the wrong row, or a
   * blanket one covering all of them, fails here).
   */
  describe('a row whose runtime half cannot be loaded', () => {
    let brokenHost: IdeHost;

    beforeEach(async () => {
      const workspace = mkdtempSync(join(tmpdir(), 'ide-host-runtime-broken-'));
      const nodeModules = join(workspace, 'node_modules');
      mkdirSync(nodeModules);

      // Legal and silent: a package with a CLIENT half and no game half.
      const halfless = join(nodeModules, 'nohalf-pkg');
      mkdirSync(halfless);
      writeFileSync(
        join(halfless, 'package.json'),
        JSON.stringify({
          name: 'nohalf-pkg',
          version: '1.0.0',
          type: 'module',
          main: 'index.js',
          exports: { '.': './index.js', './package.json': './package.json' },
          e8: { client: { entry: './client.js' } },
        }),
      );
      writeFileSync(join(halfless, 'index.js'), 'export function apply() {}\n');
      writeFileSync(join(halfless, 'client.js'), 'export function apply() {}\n');

      // An author mistake: `e8.runtime.entry` names a file nobody built.
      const badEntry = join(nodeModules, 'badentry-pkg');
      mkdirSync(badEntry);
      writeFileSync(
        join(badEntry, 'package.json'),
        JSON.stringify({
          name: 'badentry-pkg',
          version: '1.0.0',
          type: 'module',
          main: 'index.js',
          exports: { '.': './index.js', './package.json': './package.json' },
          e8: { runtime: { entry: './dist/runtime.js' } },
        }),
      );
      writeFileSync(join(badEntry, 'index.js'), 'export function apply() {}\n');

      writeFileSync(join(workspace, 'e8.yml'), '[]\n');
      writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-broken-fixture\n');
      const bundlesDir = join(workspace, 'bundles', 'e8-broken-fixture');
      mkdirSync(bundlesDir, { recursive: true });
      writeFileSync(
        join(bundlesDir, 'e8.bundle.yml'),
        [
          'name: e8-broken-fixture',
          'rows:',
          // The typo case: nothing is installed under this name at all.
          '  - id: typo1',
          '    name: reeels-pkg',
          '  - id: nohalf1',
          '    name: nohalf-pkg',
          '  - id: badentry1',
          '    name: badentry-pkg',
          '',
        ].join('\n'),
      );

      brokenHost = await createIdeHost({ root: workspace, port: 0 });
    });

    afterEach(async () => {
      await brokenHost.stop();
    });

    async function composition(): Promise<{
      rows: { id: string; runtimeUrl: string | null }[];
      diagnostics: { plugin: string; where: string; message: string; fix?: string }[];
    }> {
      return (await fetch(`${brokenHost.url}/api/composition`)).json();
    }

    it('a misspelled package name is a diagnostic naming the row and the package', async () => {
      const body = await composition();
      expect(body.rows.find((r) => r.id === 'typo1')!.runtimeUrl).toBeNull();

      const found = body.diagnostics.filter((d) => d.plugin === 'typo1');
      expect(found).toHaveLength(1);
      // Both halves of the address a person needs: WHICH row, and which
      // name on it did not resolve.
      expect(found[0].message).toContain('typo1');
      expect(found[0].message).toContain('reeels-pkg');
      expect(found[0].fix).toContain('reeels-pkg');
    });

    it('a package that declares no runtime half stays silent — that is legal', async () => {
      const body = await composition();
      expect(body.rows.find((r) => r.id === 'nohalf1')!.runtimeUrl).toBeNull();
      expect(body.diagnostics.filter((d) => d.plugin === 'nohalf1')).toEqual([]);
    });

    it('an entry that is not on disk is a diagnostic naming the row and the entry', async () => {
      const body = await composition();
      expect(body.rows.find((r) => r.id === 'badentry1')!.runtimeUrl).toBeNull();

      const found = body.diagnostics.filter((d) => d.plugin === 'badentry1');
      expect(found).toHaveLength(1);
      expect(found[0].where).toBe('e8.runtime.entry');
      expect(found[0].message).toContain('./dist/runtime.js');
      expect(found[0].message).toContain('badentry-pkg');
    });
  });

  /**
   * `/plugin-runtime/:id`'s own "escapee1" fixture below (see
   * `describe('GET /plugin-runtime/:id')`) already proves a symlinked
   * `e8.runtime.entry` can't escape ITS route's containment check. This
   * proves the OTHER url shape `resolveRuntimeUrl` can hand out —
   * `/@fs/<realpath>`, produced once `dev-game` is composed — gets the
   * same protection, even though nothing here ever reaches `dev-game`'s
   * own vite instance: `/@fs/` is served by vite's middleware, gated only
   * by `server.fs.allow` (a workspace-wide allowlist, not a per-row
   * boundary), so the containment check has to happen before the URL is
   * ever handed out, not at the point something fetches it.
   *
   * A fake `devGameRoot` provider (not the real `dev-game` plugin) is
   * enough: `resolveRuntimeUrl`'s url-shape branch reacts to that
   * service's mere presence (see runtime-assets.ts's module doc), and the
   * real plugin's vite/session-dev machinery is already exercised by
   * dev-game.test.ts and the Playwright suite — irrelevant to what this
   * test checks.
   */
  it("refuses an e8.runtime.entry that escapes its package, even under dev-game's /@fs/ URL", async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ide-host-runtime-fs-escape-'));
    const nodeModules = join(workspace, 'node_modules');
    mkdirSync(nodeModules);

    // The escape target must actually EXIST — see the sibling
    // `/plugin-runtime/:id` fixture's own comment: a target that's merely
    // absent dies on `realpathSync`'s ENOENT before the containment
    // comparison ever runs, which proves nothing about the check itself.
    const secretOutsideThePackage = join(workspace, 'fs-escapee-secret.js');
    writeFileSync(secretOutsideThePackage, "export const secret = 'FS_ESCAPED_SECRET';\n");

    const escapeeDir = join(nodeModules, 'fs-escapee-pkg');
    mkdirSync(escapeeDir);
    writeFileSync(
      join(escapeeDir, 'package.json'),
      JSON.stringify({
        name: 'fs-escapee-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './link.js' } },
      }),
    );
    writeFileSync(
      join(escapeeDir, 'index.js'),
      "export const name = 'fs-escapee-pkg';\nexport function apply() {}\n",
    );
    symlinkSync(secretOutsideThePackage, join(escapeeDir, 'link.js'));

    writeFileSync(join(workspace, 'e8.yml'), '[]\n');
    writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-fs-escape-fixture\n');
    const bundlesDir = join(workspace, 'bundles', 'e8-fs-escape-fixture');
    mkdirSync(bundlesDir, { recursive: true });
    writeFileSync(
      join(bundlesDir, 'e8.bundle.yml'),
      [
        'name: e8-fs-escape-fixture',
        'rows:',
        '  - id: fsescapee1',
        '    name: fs-escapee-pkg',
        '',
      ].join('\n'),
    );

    host = await createIdeHost({ root: workspace, port: 0 });
    await host.ctx.plugin({
      name: 'fake-dev-game-root',
      apply(ctx: Context) {
        ctx.provide('devGameRoot', {});
      },
    });

    const body = await (await fetch(`${host.url}/api/composition`)).json();
    const row = body.rows.find((r: { id: string }) => r.id === 'fsescapee1');
    expect(row.runtimeUrl).toBeNull();
    // Belt-and-suspenders, same shape as the /plugin-runtime/:id escapee
    // test: the secret's own marker must not ride along anywhere in the
    // response — not just "some other field happens to be right".
    expect(JSON.stringify(body)).not.toContain('FS_ESCAPED_SECRET');

    const found = body.diagnostics.filter((d: { plugin: string }) => d.plugin === 'fsescapee1');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('fsescapee1');
    expect(found[0].message).toContain('escapes');
  });

  /**
   * The bug review caught: `readProjectPlugin`'s own `JSON.parse` sat
   * outside any try/catch — the only one in `resolvePackage.ts` not
   * wrapped. A malformed `plugins/<name>/package.json` — the single most
   * ordinary mistake the hand-edited `plugins/` workflow invites — threw a
   * `SyntaxError` straight out of `readPackageJson`, up through this
   * route's own `.map()` over every row, turning one typo into a 500 for
   * the WHOLE composition, not just the row that named it.
   *
   * The healthy sibling assertion at the end is the one that actually pins
   * the fix: a version that only stopped the 500 by swallowing the error
   * — but still let the thrown row abort the `.map()` before reaching
   * later rows — would still fail it. `broken1` is listed BEFORE
   * `healthy1` in the fixture bundle specifically so a still-broken
   * `.map()` would have to skip over it to fail this the interesting way.
   */
  it('a malformed plugins/ manifest is a diagnostic on its own row, not a 500 for the whole composition', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ide-host-runtime-broken-manifest-'));
    mkdirSync(join(workspace, 'plugins', 'broken-plugin'), { recursive: true });
    writeFileSync(
      join(workspace, 'plugins', 'broken-plugin', 'package.json'),
      '{ this is not valid JSON',
    );

    const healthyDir = join(workspace, 'plugins', 'healthy-plugin');
    mkdirSync(healthyDir, { recursive: true });
    writeFileSync(
      join(healthyDir, 'package.json'),
      JSON.stringify({
        name: 'healthy-plugin',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './runtime.js' } },
      }),
    );
    writeFileSync(
      join(healthyDir, 'index.js'),
      "export const name = 'healthy-plugin';\nexport function apply() {}\n",
    );
    writeFileSync(join(healthyDir, 'runtime.js'), 'export function apply() {}\n');

    writeFileSync(join(workspace, 'e8.yml'), '[]\n');
    writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-broken-manifest-fixture\n');
    const bundlesDir = join(workspace, 'bundles', 'e8-broken-manifest-fixture');
    mkdirSync(bundlesDir, { recursive: true });
    writeFileSync(
      join(bundlesDir, 'e8.bundle.yml'),
      [
        'name: e8-broken-manifest-fixture',
        'rows:',
        '  - id: broken1',
        '    name: broken-plugin',
        '  - id: healthy1',
        '    name: healthy-plugin',
        '',
      ].join('\n'),
    );

    host = await createIdeHost({ root: workspace, port: 0 });
    const res = await fetch(`${host.url}/api/composition`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const brokenRow = body.rows.find((r: { id: string }) => r.id === 'broken1');
    expect(brokenRow.runtimeUrl).toBeNull();
    const brokenDiagnostics = body.diagnostics.filter(
      (d: { plugin: string }) => d.plugin === 'broken1',
    );
    expect(brokenDiagnostics).toHaveLength(1);
    expect(brokenDiagnostics[0].message).toContain('broken1');
    expect(brokenDiagnostics[0].message).toContain('broken-plugin');

    // ...and it says what ACTUALLY happened. Stopping the 500 left the
    // row falling through to ordinary node resolution, which reports
    // "could not be resolved … check for a typo, or install it" — about a
    // package sitting right there in `plugins/`, whose only problem is
    // that its JSON does not parse. A person following that fix looks for
    // a typo in a NAME that is correct, or installs a package they
    // already have.
    expect(brokenDiagnostics[0].message).toContain('package.json');
    expect(brokenDiagnostics[0].message.toLowerCase()).toContain('json');
    expect(brokenDiagnostics[0].fix).not.toContain('install it');

    // The blast radius: a completely healthy sibling row in the SAME
    // composition still comes back with its own real data intact — not
    // dropped, not corrupted by the broken row ahead of it in the same
    // `.map()`.
    const healthyRow = body.rows.find((r: { id: string }) => r.id === 'healthy1');
    expect(healthyRow.runtimeUrl).toBe('/plugin-runtime/healthy1');
    expect(body.diagnostics.filter((d: { plugin: string }) => d.plugin === 'healthy1')).toEqual([]);
  });

  it('reloads from disk on every call, so an edit is reflected without restarting the host', async () => {
    // Same edit `project.test.ts`'s "reload() picks up an edited patch"
    // makes directly against `ctx.project.reload()` — this proves the HTTP
    // route makes that same call itself, not just that the service can.
    const dir = copyFixtureToTemp('project-patched');
    host = await createIdeHost({ root: dir, port: 0 });

    const before = await (await fetch(`${host.url}/api/composition`)).json();
    expect(before.rows.find((r: { id: string }) => r.id === 'reels1').config).toEqual({
      grid: { cols: 5, rows: 3 },
    });

    writeFileSync(join(dir, 'e8.patch.yml'), 'rows:\n  - id: reels1\n    config: { grid: 9 }\n');

    const after = await (await fetch(`${host.url}/api/composition`)).json();
    expect(after.rows.find((r: { id: string }) => r.id === 'reels1').config).toEqual({ grid: 9 });
  });
});

/**
 * Synthesized packages, same pattern as `assets.test.ts`'s "failure modes
 * needing a hostile-ish manifest": a fresh `mkdtempSync` workspace with
 * npm-installed-looking packages built to trigger the specific shapes a
 * checked-in fixture has no reason to declare — a runtime half, a
 * client-only package with none, and a package whose declared entry walks
 * out of its own directory.
 */
/**
 * Since Task 4 (spec §6) the two routes are registered through
 * `ctx.runtimeAssets.attachGameRoutes(server)` on the GAME's own server —
 * `dev-game` calls it on the preview it boots. Here a second server stands
 * in for that preview, so this block measures the service without a vite
 * or an e8-server; that `dev-game` actually calls it is
 * project-scope.test.ts's to hold.
 */
describe('GET /plugin-runtime/:id', () => {
  let runtimeHost: IdeHost;
  /** The stand-in game server `attachGameRoutes` was given. */
  let gameUrl: string;

  beforeEach(async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ide-host-runtime-assets-'));
    const nodeModules = join(workspace, 'node_modules');
    mkdirSync(nodeModules);

    // A plugin with a real runtime half.
    const runtimeDir = join(nodeModules, 'runtime-pkg');
    mkdirSync(runtimeDir);
    writeFileSync(
      join(runtimeDir, 'package.json'),
      JSON.stringify({
        name: 'runtime-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './runtime.js' } },
      }),
    );
    writeFileSync(
      join(runtimeDir, 'index.js'),
      "export const name = 'runtime-pkg';\nexport function apply() {}\n",
    );
    writeFileSync(
      join(runtimeDir, 'runtime.js'),
      'export function apply(ctx) {\n  ctx.__runtimeApplied = true;\n}\n',
    );

    // A plugin that only declares a CLIENT half — no runtime.
    const clientOnlyDir = join(nodeModules, 'clientonly-pkg');
    mkdirSync(clientOnlyDir);
    writeFileSync(
      join(clientOnlyDir, 'package.json'),
      JSON.stringify({
        name: 'clientonly-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { client: { entry: './client.js' } },
      }),
    );
    writeFileSync(
      join(clientOnlyDir, 'index.js'),
      "export const name = 'clientonly-pkg';\nexport function apply() {}\n",
    );
    writeFileSync(join(clientOnlyDir, 'client.js'), 'export function apply() {}\n');

    // A plugin whose declared runtime entry is a SYMLINK, sitting inside
    // its own package directory, whose TARGET escapes it — the vector a
    // lexical `path.resolve` containment check misses entirely (the path
    // string never leaves `pkg.dir`; only what it points at does). This is
    // the same shape `assets.test.ts` builds for `/plugin-client`'s
    // "symlink-plugin" case, not a fresh invention — a naive relative
    // string like `../../../etc/passwd` is a WEAKER test than this one:
    // from a `mkdtempSync` workspace nested several directories under the
    // OS temp dir, three `..` segments land on a path that doesn't exist,
    // so `realpathSync` throws ENOENT and the request 404s through the
    // "missing on disk" branch — never actually reaching the containment
    // comparison at all. Measured directly: with the containment check
    // deleted outright, that version of this test still passed unchanged.
    // A symlink whose target is a file that genuinely EXISTS outside the
    // package root forces the request through `readFileSync` successfully
    // unless the containment check itself stops it — so this test fails
    // when the check is missing and passes when it is not, which is the
    // property that actually matters here.
    const secretOutsideThePackage = join(workspace, 'escapee-secret.js');
    writeFileSync(secretOutsideThePackage, "export const secret = 'ESCAPED_SECRET';\n");

    const escapeeDir = join(nodeModules, 'escapee-pkg');
    mkdirSync(escapeeDir);
    writeFileSync(
      join(escapeeDir, 'package.json'),
      JSON.stringify({
        name: 'escapee-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './link.js' } },
      }),
    );
    writeFileSync(
      join(escapeeDir, 'index.js'),
      "export const name = 'escapee-pkg';\nexport function apply() {}\n",
    );
    symlinkSync(secretOutsideThePackage, join(escapeeDir, 'link.js'));

    writeFileSync(join(workspace, 'e8.yml'), '[]\n');
    writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-runtime-fixture\n');
    const bundlesDir = join(workspace, 'bundles', 'e8-runtime-fixture');
    mkdirSync(bundlesDir, { recursive: true });
    writeFileSync(
      join(bundlesDir, 'e8.bundle.yml'),
      [
        'name: e8-runtime-fixture',
        'rows:',
        '  - id: reels1',
        '    name: runtime-pkg',
        '  - id: clientonly1',
        '    name: clientonly-pkg',
        '  - id: escapee1',
        '    name: escapee-pkg',
        '',
      ].join('\n'),
    );

    // `ideDist` pinned to nothing: the root's catch-all is `ide-static`
    // (spec §7), and this way its answer is the same on every machine.
    runtimeHost = await createIdeHost({
      root: workspace,
      port: 0,
      ideDist: join(workspace, 'no-ide-dist'),
    });
    const fiber = runtimeHost.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    runtimeHost.ctx.get('runtimeAssets')!.attachGameRoutes(fiber.ctx.server);
    gameUrl = `http://127.0.0.1:${fiber.ctx.server.port}`;
  });

  afterEach(async () => {
    await runtimeHost.stop();
    // No rmSync of the temp workspace — see `project.test.ts`'s comment on
    // why cleanup is deliberately skipped.
  });

  it("is on the game server only — the root answers ide-static's SPA fallback, and /api/composition is on both", async () => {
    const onRoot = await fetch(`${runtimeHost.url}/plugin-runtime/reels1`);
    expect(onRoot.status).toBe(503);
    expect(onRoot.headers.get('content-type')).not.toContain('javascript');
    expect(await onRoot.text()).not.toContain('export');
    expect((await fetch(`${runtimeHost.url}/api/composition`)).status).toBe(200);
    expect((await fetch(`${gameUrl}/api/composition`)).status).toBe(200);
  });

  it('serves a row runtime half as javascript', async () => {
    const res = await fetch(`${gameUrl}/plugin-runtime/reels1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('export');
  });

  it('serves the same half when vite appends its ?import query', async () => {
    // Measured in the task 1 spike: `/* @vite-ignore */` does not prevent
    // vite from rewriting a root-relative dynamic-import specifier into
    // `__vite__injectQuery(spec, 'import')`, which appends `?import`. A
    // route that matched the full request string including the query
    // would 404 in a real browser while this exact `fetch` still passed.
    const res = await fetch(`${gameUrl}/plugin-runtime/reels1?import`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('404s an unknown row id', async () => {
    expect((await fetch(`${gameUrl}/plugin-runtime/nope`)).status).toBe(404);
  });

  it('404s a package with no runtime half, naming the package', async () => {
    const res = await fetch(`${gameUrl}/plugin-runtime/clientonly1`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('no runtime half');
    expect(body.error).toContain('clientonly-pkg');
  });

  it('refuses to serve a path that escapes the package root, even via a symlink', async () => {
    const res = await fetch(`${gameUrl}/plugin-runtime/escapee1`);
    expect(res.status).toBe(404);
    const body = await res.text();
    // The file at the symlink's target genuinely exists and genuinely
    // contains this string — a version of the route missing the
    // containment check would serve it with a 200. Asserting the marker's
    // absence (not just the status code) is what makes this test fail when
    // the check is removed instead of passing by accident through some
    // other 404 branch.
    expect(body).not.toContain('ESCAPED_SECRET');
  });
});
