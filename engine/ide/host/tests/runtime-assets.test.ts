import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    host = await createIdeHost({ cwd: fixture('project-simple'), port: 0 });
    const res = await fetch(`${host.url}/api/composition`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['boot1', 'reels1']);
  });

  it('carries the project diagnostics with the composition', async () => {
    // A profile listing a bundle that was never installed anywhere —
    // `resolveComposition` reports it, same shape as `project.test.ts`'s
    // "bundle that fails to parse" case, just for "not found" instead.
    const dir = mkdtempSync(join(tmpdir(), 'ide-host-runtime-missing-bundle-'));
    writeFileSync(join(dir, 'e8.yml'), '[]\n');
    writeFileSync(join(dir, 'e8.profile.yml'), 'bundles:\n  - does-not-exist\n');
    host = await createIdeHost({ cwd: dir, port: 0 });

    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body.diagnostics.length).toBeGreaterThan(0);
  });

  it('reloads from disk on every call, so an edit is reflected without restarting the host', async () => {
    // Same edit `project.test.ts`'s "reload() picks up an edited patch"
    // makes directly against `ctx.project.reload()` — this proves the HTTP
    // route makes that same call itself, not just that the service can.
    const dir = copyFixtureToTemp('project-patched');
    host = await createIdeHost({ cwd: dir, port: 0 });

    const before = await (await fetch(`${host.url}/api/composition`)).json();
    expect(
      before.rows.find((r: { id: string }) => r.id === 'reels1').config,
    ).toEqual({ grid: { cols: 5, rows: 3 } });

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
describe('GET /plugin-runtime/:id', () => {
  let runtimeHost: IdeHost;

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
      "export function apply(ctx) {\n  ctx.__runtimeApplied = true;\n}\n",
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

    runtimeHost = await createIdeHost({ cwd: workspace, port: 0 });
  });

  afterEach(async () => {
    await runtimeHost.stop();
    // No rmSync of the temp workspace — see `project.test.ts`'s comment on
    // why cleanup is deliberately skipped.
  });

  it('serves a row runtime half as javascript', async () => {
    const res = await fetch(`${runtimeHost.url}/plugin-runtime/reels1`);
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
    const res = await fetch(`${runtimeHost.url}/plugin-runtime/reels1?import`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('404s an unknown row id', async () => {
    expect((await fetch(`${runtimeHost.url}/plugin-runtime/nope`)).status).toBe(404);
  });

  it('404s a package with no runtime half, naming the package', async () => {
    const res = await fetch(`${runtimeHost.url}/plugin-runtime/clientonly1`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('no runtime half');
    expect(body.error).toContain('clientonly-pkg');
  });

  it('refuses to serve a path that escapes the package root, even via a symlink', async () => {
    const res = await fetch(`${runtimeHost.url}/plugin-runtime/escapee1`);
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
