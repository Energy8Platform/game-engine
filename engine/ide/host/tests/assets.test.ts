import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

// `fixtures/composition` (Task 4) is the fixture whose e8.yml actually
// registers `probe-plugin` — `fixtures/workspace` has an empty composition.
const WORKSPACE = join(__dirname, 'fixtures', 'composition');

let host: IdeHost;
beforeEach(async () => {
  host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
});
afterEach(async () => {
  await host.stop();
});

describe('plugin client assets', () => {
  it('serves the client half as a javascript module', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;
    const res = await fetch(`${host.url}${row.clientUrl}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('__probeClientApplied');
  });

  it('404s for an entry that has no client half', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const include = snapshot.rows.find((r) => r.name === '@cordisjs/plugin-include')!;
    const res = await fetch(`${host.url}/plugin-client/${include.id}`);
    expect(res.status).toBe(404);
  });

  it('404s for an id that has no matching entry at all', async () => {
    const res = await fetch(`${host.url}/plugin-client/not-a-real-id`);
    expect(res.status).toBe(404);
  });
});

/**
 * Failure modes that need a plugin package deliberately built to trigger
 * them — not something the checked-in, read-only `fixtures/composition`
 * fixture can express. Same pattern `update.test.ts` and `rpc.test.ts`
 * settled on: a fresh `mkdtempSync` directory per test, written to directly
 * (nothing checked in is touched), and never `rmSync`'d back out — see
 * `update.test.ts`'s comment block on `TEMPLATE_FILE` for why cleanup is
 * deliberately skipped (it races `@cordisjs/plugin-include`'s unowned,
 * uncancellable `setTimeout(0)` write).
 *
 * Both plugin packages here are synthesized on disk (not symlinked from a
 * repo devDependency like `probe-plugin`), since their whole point is to
 * declare an `e8.client.entry` the happy-path fixture doesn't have a
 * reason to.
 */
describe('plugin client assets — failure modes needing a hostile-ish manifest', () => {
  let securityHost: IdeHost;

  beforeEach(async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ide-host-assets-'));
    const nodeModules = join(workspace, 'node_modules');
    mkdirSync(nodeModules);

    // A plugin that declares a client half whose file was never written —
    // e.g. a build step failed, or the manifest just lies.
    const missingDir = join(nodeModules, 'missing-entry-plugin');
    mkdirSync(missingDir);
    writeFileSync(
      join(missingDir, 'package.json'),
      JSON.stringify({
        name: 'missing-entry-plugin',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { client: { entry: './client.js' } },
      }),
    );
    writeFileSync(
      join(missingDir, 'index.js'),
      "export const name = 'missing-entry-plugin';\nexport function apply() {}\n",
    );

    // A plugin whose declared entry walks out of its own package directory
    // into a *sibling* directory that merely shares its name as a prefix
    // (`traversal-plugin-evil` vs. `traversal-plugin`) — the case a bare
    // `path.startsWith(packageRoot)` check would wrongly allow through,
    // per the fix in client-assets.ts.
    const evilDir = join(nodeModules, 'traversal-plugin-evil');
    mkdirSync(evilDir);
    writeFileSync(join(evilDir, 'secret.js'), "export const secret = 'leaked';\n");

    const traversalDir = join(nodeModules, 'traversal-plugin');
    mkdirSync(traversalDir);
    writeFileSync(
      join(traversalDir, 'package.json'),
      JSON.stringify({
        name: 'traversal-plugin',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { client: { entry: '../traversal-plugin-evil/secret.js' } },
      }),
    );
    writeFileSync(
      join(traversalDir, 'index.js'),
      "export const name = 'traversal-plugin';\nexport function apply() {}\n",
    );

    // A plugin whose declared entry is a symlink *inside* its own package
    // directory that points at a file outside it — the vector the lexical
    // `path.resolve` containment check misses entirely, since `resolve()`
    // never touches the filesystem: the symlink's path string is fully
    // inside `pkg.dir`, only its *target* escapes. Any npm tarball may
    // legally contain symlinks, so this is the shape a real hostile package
    // would ship (e.g. pointing at `/etc/passwd` or a `.env`), not just a
    // test contrivance.
    const outsideSecret = join(workspace, 'symlink-secret.js');
    writeFileSync(outsideSecret, "export const secret = 'SYMLINK_LEAKED';\n");

    const symlinkDir = join(nodeModules, 'symlink-plugin');
    mkdirSync(symlinkDir);
    writeFileSync(
      join(symlinkDir, 'package.json'),
      JSON.stringify({
        name: 'symlink-plugin',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        e8: { client: { entry: './link.js' } },
      }),
    );
    writeFileSync(
      join(symlinkDir, 'index.js'),
      "export const name = 'symlink-plugin';\nexport function apply() {}\n",
    );
    symlinkSync(outsideSecret, join(symlinkDir, 'link.js'));

    writeFileSync(
      join(workspace, 'e8.yml'),
      '- id: missing1\n  name: missing-entry-plugin\n- id: traversal1\n  name: traversal-plugin\n- id: symlink1\n  name: symlink-plugin\n',
    );

    securityHost = await createIdeHost({ cwd: workspace, port: 0 });
  });

  afterEach(async () => {
    await securityHost.stop();
    // No rmSync of the temp workspace — see the describe-block comment above.
  });

  it('404s, as readable data, when the declared entry is missing on disk', async () => {
    const snapshot = await securityHost.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'missing-entry-plugin')!;
    const res = await fetch(`${securityHost.url}/plugin-client/${row.id}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('missing-entry-plugin');
    expect(body.error).toContain('missing on disk');
  });

  it('404s instead of reading outside the package directory', async () => {
    const snapshot = await securityHost.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'traversal-plugin')!;
    const res = await fetch(`${securityHost.url}/plugin-client/${row.id}`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('leaked');
  });

  it('404s instead of following a symlink out of the package directory', async () => {
    const snapshot = await securityHost.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'symlink-plugin')!;
    const res = await fetch(`${securityHost.url}/plugin-client/${row.id}`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('SYMLINK_LEAKED');
  });
});
