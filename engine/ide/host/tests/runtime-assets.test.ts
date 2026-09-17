import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import * as yaml from 'js-yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from 'cordis';
import Server from '@cordisjs/plugin-server';
import Schema from 'schemastery';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import { WebSocket } from 'ws';
import { createIdeHost, type IdeHost } from '../src/index';
import { restartKeys } from '../src/plugins/runtime-assets';

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
    // `e8 dev`) — there is no vite to serve a row's TypeScript, so
    // `runtimeUrl` is `null` (the loader's "nothing to load"), NOT the
    // raw `/plugin-runtime/<id>` route a browser's native `import()`
    // would choke on. Both rows resolve to the real `@energy8engine/boot`/
    // `reels` packages and declare `e8.runtime`, so the `null` is the
    // missing preview alone — no diagnostic rides along.
    for (const id of ['boot1', 'reels1']) {
      expect(body.rows.find((r: { id: string }) => r.id === id).runtimeUrl).toBeNull();
    }
    expect(body.diagnostics).toEqual([]);

    // Once `devGameRoot` shows up (a stand-in here; the real plugin is
    // dev-game.test.ts's), the same rows get vite's `/@fs/` URL.
    await host.ctx.plugin({
      name: 'fake-dev-game-root',
      apply(ctx: Context) {
        ctx.provide('devGameRoot', {});
      },
    });
    const after = await (await fetch(`${host.url}/api/composition`)).json();
    for (const id of ['boot1', 'reels1']) {
      expect(after.rows.find((r: { id: string }) => r.id === id).runtimeUrl).toMatch(/^\/@fs\//);
    }
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
    expect(healthyRow.name).toBe('healthy-plugin');
    expect(healthyRow.runtimeUrl).toBeNull(); // no dev-game here — see the first test above
    expect(body.diagnostics.filter((d: { plugin: string }) => d.plugin === 'healthy1')).toEqual([]);
  });

  it("carries each row's config schema and hot flag, read off its package manifest", async () => {
    // The real `e8-base` (repo fallback — see the fixture's profile), so
    // the four rows `first-slot`'s patch edits carry a form the IDE can
    // draw, and a row whose package declares no `e8.runtime.schema`
    // (`spinlog1`) carries `null` with nothing said about it.
    host = await createIdeHost({ root: fixture('project-e8-base'), port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();
    const byId = (id: string) => body.rows.find((r: { id: string }) => r.id === id);

    for (const id of ['renderer1', 'stage1', 'reels1', 'mechanics1']) {
      expect(byId(id).schema, id).toBeTypeOf('object');
      expect(byId(id).schema, id).not.toBeNull();
    }
    expect(byId('spinlog1').schema).toBeNull();
    // The wire carries schemastery's own `toJSON()` graph; the form
    // rebuilds it and reads the restart meta off the field.
    const renderer = new Schema(byId('renderer1').schema) as Schema;
    expect(renderer.dict!.width.meta.extra?.applies).toBe('restart');
    const stage = new Schema(byId('stage1').schema) as Schema;
    expect(stage.dict!.design.dict!.width.meta.extra?.applies).toBe('restart');

    expect(byId('reels1').hot).toBe(true);
    expect(byId('mechanics1').hot).toBe(true);
    expect(byId('renderer1').hot).toBe(false);
    expect(byId('stage1').hot).toBe(true); // layers, scenes and transitions re-apply in place; `design` alone restarts
    expect(body.diagnostics.filter((d: { where: string }) => d.where === 'schema')).toEqual([]);
  });

  it('a schema path that does not import is schema: null plus a diagnostic on the row, not a 500', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ide-host-runtime-schema-'));
    const nodeModules = join(workspace, 'node_modules');
    mkdirSync(nodeModules);
    const pkg = (name: string, e8: unknown) => {
      const dir = join(nodeModules, name);
      mkdirSync(dir);
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name,
          version: '1.0.0',
          type: 'module',
          main: 'index.js',
          exports: { '.': './index.js', './package.json': './package.json' },
          e8,
        }),
      );
      writeFileSync(join(dir, 'index.js'), 'export function apply() {}\n');
      writeFileSync(join(dir, 'runtime.js'), 'export function apply() {}\n');
      return dir;
    };
    // Declares a schema module nobody wrote.
    pkg('noschema-pkg', { runtime: { entry: './runtime.js', schema: './schema.js' }, hot: true });
    // The module is there but exports no `Config` — also a broken promise.
    const noConfig = pkg('noconfig-pkg', {
      runtime: { entry: './runtime.js', schema: './schema.js' },
    });
    writeFileSync(join(noConfig, 'schema.js'), 'export const notConfig = 1;\n');
    // A perfectly good schema module that lives OUTSIDE the package, and
    // two ways of pointing at it — a `../` path, and a symlink sitting
    // inside the package. Importing a file is running it, so this is the
    // one place the containment check is a real boundary rather than a
    // packaging nicety: refused, with the same-shaped diagnostic.
    const outside = join(workspace, 'outside.js');
    writeFileSync(outside, "export const Config = { toJSON() { return { type: 'object' }; } };\n");
    pkg('dotdot-pkg', { runtime: { entry: './runtime.js', schema: '../../outside.js' } });
    const linked = pkg('symlink-pkg', {
      runtime: { entry: './runtime.js', schema: './schema.js' },
    });
    symlinkSync(outside, join(linked, 'schema.js'));

    writeFileSync(join(workspace, 'e8.yml'), '[]\n');
    writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-schema-fixture\n');
    const bundlesDir = join(workspace, 'bundles', 'e8-schema-fixture');
    mkdirSync(bundlesDir, { recursive: true });
    writeFileSync(
      join(bundlesDir, 'e8.bundle.yml'),
      [
        'name: e8-schema-fixture',
        'rows:',
        '  - id: noschema1',
        '    name: noschema-pkg',
        '  - id: noconfig1',
        '    name: noconfig-pkg',
        '  - id: dotdot1',
        '    name: dotdot-pkg',
        '  - id: symlink1',
        '    name: symlink-pkg',
        '',
      ].join('\n'),
    );

    host = await createIdeHost({ root: workspace, port: 0 });
    const res = await fetch(`${host.url}/api/composition`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = (id: string) => body.rows.find((r: { id: string }) => r.id === id);

    expect(byId('noschema1').schema).toBeNull();
    expect(byId('noschema1').hot).toBe(true);
    expect(byId('noconfig1').schema).toBeNull();
    expect(byId('dotdot1').schema).toBeNull();
    expect(byId('symlink1').schema).toBeNull();
    const schemaDiagnostics = body.diagnostics.filter(
      (d: { where: string }) => d.where === 'schema',
    );
    expect(
      schemaDiagnostics.map((d: { plugin: string; severity: string }) => [d.plugin, d.severity]),
    ).toEqual([
      ['noschema1', 'error'],
      ['noconfig1', 'error'],
      ['dotdot1', 'error'],
      ['symlink1', 'error'],
    ]);
    expect(schemaDiagnostics[0].message).toContain('./schema.js');
    expect(schemaDiagnostics[1].message).toContain('no schemastery `Config`');
    expect(schemaDiagnostics[2].message).toContain('schema path escapes the package');
    expect(schemaDiagnostics[3].message).toContain('schema path escapes the package');
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

  it("is on the game server only — the root answers ide-static's not-built page, and /api/composition is on both", async () => {
    const onRoot = await fetch(`${runtimeHost.url}/plugin-runtime/reels1`);
    expect(onRoot.status).toBe(503);
    expect(onRoot.headers.get('content-type')).not.toContain('javascript');
    expect(await onRoot.text()).not.toContain('export');
    expect((await fetch(`${runtimeHost.url}/api/composition`)).status).toBe(200);
    expect((await fetch(`${gameUrl}/api/composition`)).status).toBe(200);
  });

  it('the game server answers the same rows as the root, schema and hot included', async () => {
    // One `composition` handler registered on both servers — so what the
    // IDE reads and what the game composes from cannot drift apart.
    const root = await (await fetch(`${runtimeHost.url}/api/composition`)).json();
    const game = await (await fetch(`${gameUrl}/api/composition`)).json();
    expect(game.rows).toEqual(root.rows);
    for (const row of game.rows) {
      expect(row).toHaveProperty('schema');
      expect(typeof row.hot).toBe('boolean');
    }
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

/**
 * The IDE's one way of editing a GAME row (spec §2 "Правка"/"Запись"/"После
 * записи"): the config lands in `e8.patch.yml` through
 * `project.writePatchRow`, the project and the spin schema re-read, and
 * the host — not the client, not the game — decides whether the change is
 * hot (`reload: false`, the game re-applies the row) or needs the page
 * reloaded (`reload: true`: a cold row, or a `restart` field changed).
 */
describe('PUT /api/composition/rows/:id', () => {
  type Row = { id: string; config: Record<string, unknown> };
  /**
   * `project-e8-base` copied to a temp dir, with the repo's own
   * `node_modules/@energy8engine` linked in: a bare OS temp dir resolves
   * none of `e8-base`'s packages, and a row nothing resolves is `hot:
   * false` with no schema — every `reload` would come out `true` for the
   * wrong reason. (The GET tests above use the checked-in fixture in place;
   * these write to it, so they cannot.)
   */
  const e8BaseWorkspace = () => {
    const dir = copyFixtureToTemp('project-e8-base');
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(
      join(__dirname, '..', '..', '..', '..', 'node_modules', '@energy8engine'),
      join(dir, 'node_modules', '@energy8engine'),
      'dir',
    );
    return dir;
  };
  const put = (url: string, id: string, body: unknown) =>
    fetch(`${url}/api/composition/rows/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const patchOf = (dir: string) =>
    yaml.load(readFileSync(join(dir, 'e8.patch.yml'), 'utf8')) as { rows: Row[] };
  const rowOf = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

  it('writes the config to the patch, answers the fresh rows, and a cold row means reload', async () => {
    const dir = e8BaseWorkspace();
    host = await createIdeHost({ root: dir, port: 0 });
    const res = await put(host.url, 'renderer1', { config: { width: 640, height: 360 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(rowOf(body.rows, 'renderer1').config).toEqual({ width: 640, height: 360 });
    expect(rowOf(body.rows, 'renderer1')).toMatchObject({ hot: false });
    expect(rowOf(body.rows, 'reels1')).toMatchObject({ hot: true }); // the packages resolve
    expect(body.reload).toBe(true); // `renderer1` is `hot: false`
    expect(body.diagnostics.filter((d: { where: string }) => d.where === 'schema')).toEqual([]);
    expect(rowOf(patchOf(dir).rows, 'renderer1').config).toEqual({ width: 640, height: 360 });
    // A later GET agrees — the write went through the same reload path.
    const after = await (await fetch(`${host.url}/api/composition`)).json();
    expect(rowOf(after.rows, 'renderer1').config).toEqual({ width: 640, height: 360 });
  });

  it('a hot row with no restart field changed does not reload', async () => {
    const dir = e8BaseWorkspace();
    host = await createIdeHost({ root: dir, port: 0 });
    const res = await put(host.url, 'reels1', {
      config: { config: { grid: { cols: 6, rows: 3 } } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reload).toBe(false);
    expect(rowOf(body.rows, 'reels1').config).toEqual({ config: { grid: { cols: 6, rows: 3 } } });
  });

  /**
   * A package that is hot but has ONE field the game cannot re-apply in
   * place (`port`, `applies: 'restart'`) next to one it can (`speed`) —
   * the case neither `renderer1` (all restart, cold) nor `reels1` (hot,
   * no restart) covers. The schema module's `toJSON()` is a real
   * schemastery graph, inlined so the temp package needs no resolution of
   * `schemastery` from a bare OS temp dir. Patched to `{ port: 1, speed: 1 }`.
   */
  const hotRestartWorkspace = () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ide-host-runtime-hot-restart-'));
    const dir = join(workspace, 'node_modules', 'hot-pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'hot-pkg',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { runtime: { entry: './runtime.js', schema: './schema.js' }, hot: true },
      }),
    );
    writeFileSync(join(dir, 'index.js'), 'export function apply() {}\n');
    writeFileSync(join(dir, 'runtime.js'), 'export function apply() {}\n');
    const graph = Schema.object({
      port: Schema.natural().extra('extra', { applies: 'restart' }),
      speed: Schema.number(),
    }).toJSON();
    writeFileSync(
      join(dir, 'schema.js'),
      `export const Config = { toJSON: () => (${JSON.stringify(graph)}) };\n`,
    );
    writeFileSync(join(workspace, 'e8.yml'), '[]\n');
    writeFileSync(join(workspace, 'e8.profile.yml'), 'bundles:\n  - e8-hot\n');
    mkdirSync(join(workspace, 'bundles', 'e8-hot'), { recursive: true });
    writeFileSync(
      join(workspace, 'bundles', 'e8-hot', 'e8.bundle.yml'),
      'name: e8-hot\nrows:\n  - id: hot1\n    name: hot-pkg\n',
    );
    writeFileSync(
      join(workspace, 'e8.patch.yml'),
      'rows:\n  - id: hot1\n    config: { port: 1, speed: 1 }\n',
    );
    return workspace;
  };

  it('a hot row reloads exactly when a restart field changed', async () => {
    // A package that is hot but has ONE field the game cannot re-apply in
    // place — the case neither `renderer1` (all restart, cold) nor `reels1`
    // (hot, no restart) covers. The schema module's `toJSON()` is a real
    // schemastery graph, inlined so the temp package needs no resolution
    // of `schemastery` from a bare OS temp dir.
    const workspace = hotRestartWorkspace();
    host = await createIdeHost({ root: workspace, port: 0 });

    const speed = await (await put(host.url, 'hot1', { config: { port: 1, speed: 2 } })).json();
    expect(speed.reload).toBe(false);
    const port = await (await put(host.url, 'hot1', { config: { port: 2, speed: 2 } })).json();
    expect(port.reload).toBe(true);
    // Dropping a restart key is a change to it too.
    const dropped = await (await put(host.url, 'hot1', { config: { speed: 2 } })).json();
    expect(dropped.reload).toBe(true);
    expect(rowOf(patchOf(workspace).rows, 'hot1').config).toEqual({ speed: 2 });
  });

  it('PUT on a hot stage row: layers → reload false, design.width → reload true', async () => {
    // `stage1` is hot with ONE nested restart field (`design.width`) —
    // the case that made `restartKeys` walk below the top level.
    const dir = e8BaseWorkspace();
    host = await createIdeHost({ root: dir, port: 0 });
    const layers = await (
      await put(host.url, 'stage1', { config: { layers: [{ id: 'bg' }, { id: 'reels' }] } })
    ).json();
    expect(rowOf(layers.rows, 'stage1')).toMatchObject({ hot: true });
    expect(layers.reload).toBe(false);
    const design = await (
      await put(host.url, 'stage1', {
        config: { layers: [{ id: 'bg' }, { id: 'reels' }], design: { width: 1 } },
      })
    ).json();
    expect(design.reload).toBe(true);
  });

  it('400s an unknown row id and a body that is not { config: object }, touching nothing', async () => {
    const dir = copyFixtureToTemp('project-patched');
    host = await createIdeHost({ root: dir, port: 0 });
    const before = readFileSync(join(dir, 'e8.patch.yml'), 'utf8');
    expect((await put(host.url, 'nope1', { config: {} })).status).toBe(400);
    expect((await put(host.url, 'reels1', {})).status).toBe(400);
    expect((await put(host.url, 'reels1', { config: 5 })).status).toBe(400);
    expect((await put(host.url, 'reels1', { config: [1] })).status).toBe(400);
    expect((await put(host.url, 'reels1', 'not json')).status).toBe(400);
    expect(readFileSync(join(dir, 'e8.patch.yml'), 'utf8')).toBe(before);
  });

  it('400s a config the row’s own schema refuses, naming the field, and writes nothing', async () => {
    // Checked BEFORE the write: a value cordis would refuse at apply time
    // is not worth a disk write, a reload, and a game-composition frame
    // telling the game to re-apply something that cannot apply. The row's
    // real config shape is `{ config: { grid } }` (see `@energy8engine/reels`'s
    // `Config`); a stray key the schema does not know passes through, as
    // schemastery's objects are not strict — only a WRONG value is refused.
    const dir = e8BaseWorkspace();
    host = await createIdeHost({ root: dir, port: 0 });
    expect(existsSync(join(dir, 'e8.patch.yml'))).toBe(false); // the fixture has none: a write would create it

    const res = await put(host.url, 'reels1', { config: { config: { grid: { cols: 'x' } } } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.diagnostics).toHaveLength(1);
    expect(body.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'reels1',
      where: 'config',
    });
    expect(body.diagnostics[0].message).toContain('cols');
    expect(existsSync(join(dir, 'e8.patch.yml'))).toBe(false);
    // And a row with no schema at all is still written unchecked.
    expect((await put(host.url, 'spinlog1', { config: { anything: 'x' } })).status).toBe(200);
  });

  it.skipIf(process.getuid?.() === 0)(
    '500s with the diagnostic when the patch cannot be written',
    async () => {
      const dir = copyFixtureToTemp('project-patched');
      host = await createIdeHost({ root: dir, port: 0 });
      chmodSync(dir, 0o555);
      try {
        const res = await put(host.url, 'reels1', { config: { grid: 1 } });
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.diagnostics).toHaveLength(1);
        expect(body.diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'patch' });
      } finally {
        chmodSync(dir, 0o755);
      }
      expect(patchOf(dir).rows).toEqual([{ id: 'reels1', config: { grid: { cols: 5, rows: 3 } } }]);
    },
  );

  it('two writes fired together both land, in order — the second sees the first', async () => {
    const dir = e8BaseWorkspace();
    host = await createIdeHost({ root: dir, port: 0 });
    const [a, b] = await Promise.all([
      put(host.url, 'renderer1', { config: { width: 1 } }),
      put(host.url, 'stage1', { config: { design: { width: 2 } } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const second = await b.json();
    expect(rowOf(second.rows, 'renderer1').config).toEqual({ width: 1 });
    expect(patchOf(dir).rows).toEqual([
      { id: 'renderer1', config: { width: 1 } },
      { id: 'stage1', config: { design: { width: 2 } } },
    ]);
  });

  it('two writes on the same id fired together each diff against what the one before left', async () => {
    // Both are queued before either applies. The first changes the
    // restart key (`port` 1 → 2): reload. The second changes only `speed`
    // RELATIVE TO THE FIRST — but relative to the state both saw when
    // queued, `port` changed too. `prev` captured at request time would
    // say reload for both; captured inside the chain, only for the first.
    const workspace = hotRestartWorkspace();
    host = await createIdeHost({ root: workspace, port: 0 });
    const [a, b] = await Promise.all([
      put(host.url, 'hot1', { config: { port: 2, speed: 1 } }),
      put(host.url, 'hot1', { config: { port: 2, speed: 2 } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await a.json()).reload).toBe(true);
    expect((await b.json()).reload).toBe(false);
    expect(rowOf(patchOf(workspace).rows, 'hot1').config).toEqual({ port: 2, speed: 2 });
  });

  it('tells every /ide socket — root and preview — which row changed and whether to reload', async () => {
    const dir = e8BaseWorkspace();
    host = await createIdeHost({ root: dir, port: 0 });
    const fiber = host.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    host.ctx.ideRpc.attach(fiber.ctx.server, { accept: ['game-diagnostics'] });
    const listen = async (url: string) => {
      const socket = new WebSocket(url);
      const frames: ServerMessage[] = [];
      socket.on('message', (data) => frames.push(JSON.parse(String(data)) as ServerMessage));
      await new Promise((resolve) => socket.once('open', resolve));
      return { socket, frames };
    };
    const root = await listen(`${host.url.replace('http', 'ws')}/ide`);
    const preview = await listen(`ws://127.0.0.1:${fiber.ctx.server.port}/ide`);

    const body = await (
      await put(host.url, 'reels1', { config: { config: { grid: { cols: 4, rows: 3 } } } })
    ).json();
    const frameOf = async ({ frames }: { frames: ServerMessage[] }) => {
      for (let i = 0; i < 50 && !frames.some((m) => m.type === 'game-composition'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return frames.find((m) => m.type === 'game-composition');
    };
    const expected = {
      type: 'game-composition',
      rows: body.rows,
      reload: false,
      changed: ['reels1'],
    };
    expect(await frameOf(root)).toEqual(expected);
    expect(await frameOf(preview)).toEqual(expected);
    root.socket.close();
    preview.socket.close();
  });

  it('is on the root only — the game server does not take a write', async () => {
    // The game's origin may read its composition; rewriting the patch is
    // the IDE's reach alone (the same rule `ide-rpc`'s `accept` keeps for
    // the socket).
    const dir = copyFixtureToTemp('project-patched');
    host = await createIdeHost({ root: dir, port: 0 });
    const fiber = host.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    host.ctx.get('runtimeAssets')!.attachGameRoutes(fiber.ctx.server);
    const gameUrl = `http://127.0.0.1:${fiber.ctx.server.port}`;
    expect((await fetch(`${gameUrl}/api/composition`)).status).toBe(200);
    const res = await put(gameUrl, 'reels1', { config: { grid: 1 } });
    expect([404, 405]).toContain(res.status);
    expect(patchOf(dir).rows).toEqual([{ id: 'reels1', config: { grid: { cols: 5, rows: 3 } } }]);
  });
});

describe('restartKeys', () => {
  it('sees a restart field nested under a top-level object', () => {
    const schema = Schema.object({
      design: Schema.object({ width: Schema.natural().extra('extra', { applies: 'restart' }) }),
      layers: Schema.array(Schema.object({ id: Schema.string() })),
    }).toJSON();
    expect([...restartKeys(schema)]).toEqual(['design']);
  });
  it('sees one under an array item or a dict value too', () => {
    const schema = Schema.object({
      rows: Schema.array(
        Schema.object({ port: Schema.natural().extra('extra', { applies: 'restart' }) }),
      ),
      byId: Schema.dict(Schema.string().extra('extra', { applies: 'restart' })),
      plain: Schema.string(),
    }).toJSON();
    expect([...restartKeys(schema)]).toEqual(['rows', 'byId']);
  });
  it('sees one inside a union member', () => {
    const schema = Schema.object({
      size: Schema.union([
        Schema.natural().extra('extra', { applies: 'restart' }),
        Schema.const('auto'),
      ]),
    }).toJSON();
    expect([...restartKeys(schema)]).toEqual(['size']);
  });
});
