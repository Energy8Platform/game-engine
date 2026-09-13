import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIdeHost } from '../src/index';

function fixture(name: string): string {
  return join(__dirname, 'fixtures', name);
}

/**
 * Copies a checked-in fixture into a fresh temp directory and returns its
 * path. Any test that writes into a project's files must run against this,
 * never against the fixture itself — see the ownership rule on Task 4's
 * brief (and Slice 0 ruling 6/8): vitest runs test files in parallel, and
 * `@cordisjs/plugin-include`'s own config write is an untracked
 * `setTimeout(0)`, so a shared, mutated fixture races itself.
 */
function copyFixtureToTemp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ide-host-${name}-`));
  cpSync(fixture(name), dir, { recursive: true });
  return dir;
}

describe('project plugin', () => {
  it('resolves a profile that stacks one bundle', async () => {
    const host = await createIdeHost({ root: fixture('project-simple'), port: 0 });
    expect(host.ctx.project.composition.rows.map((r) => r.id)).toEqual(['boot1', 'reels1']);
    await host.stop();
  });

  it('applies e8.patch.yml on top of the bundles', async () => {
    const host = await createIdeHost({ root: fixture('project-patched'), port: 0 });
    const reels = host.ctx.project.composition.rows.find((r) => r.id === 'reels1')!;
    expect(reels.config).toEqual({ grid: { cols: 5, rows: 3 } });
    expect(reels.from).toBe('patch');
    await host.stop();
  });

  it('a missing e8.profile.yml is a diagnostic and the host still starts', async () => {
    const host = await createIdeHost({ root: fixture('project-none'), port: 0 });
    expect(host.ctx.project.composition.rows).toEqual([]);
    expect(host.ctx.project.diagnostics.some((d) => d.message.includes('e8.profile.yml'))).toBe(
      true,
    );
    expect(host.url).toBeTruthy(); // it started anyway
    await host.stop();
  });

  it('malformed YAML is a diagnostic naming the file, not a throw', async () => {
    const host = await createIdeHost({ root: fixture('project-broken-yaml'), port: 0 });
    expect(host.ctx.project.diagnostics.some((d) => d.where.includes('e8.profile.yml'))).toBe(
      true,
    );
    await host.stop();
  });

  it('a profile that is not an object with a bundles array is a diagnostic', async () => {
    const host = await createIdeHost({ root: fixture('project-wrong-shape'), port: 0 });
    expect(host.ctx.project.diagnostics.some((d) => d.message.includes('bundles'))).toBe(true);
    await host.stop();
  });

  it('reload() picks up an edited patch without restarting the host', async () => {
    const dir = copyFixtureToTemp('project-patched');
    const host = await createIdeHost({ root: dir, port: 0 });
    writeFileSync(join(dir, 'e8.patch.yml'), 'rows:\n  - id: reels1\n    config: { grid: 9 }\n');
    await host.ctx.project.reload();
    expect(host.ctx.project.composition.rows.find((r) => r.id === 'reels1')!.config).toEqual({
      grid: 9,
    });
    await host.stop();
  });

  // `<cwd>/bundles/<name>` (the two fixtures above) is the self-contained,
  // no-install-needed path; a real user's project resolves its OWN
  // dependencies from node_modules, so that branch needs its own coverage
  // — built at runtime rather than checked in, so this proves the branch
  // actually works instead of asserting it by construction.
  it('resolves a bundle installed under <cwd>/node_modules, not just <cwd>/bundles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ide-host-project-node-modules-'));
    writeFileSync(join(dir, 'e8.yml'), '[]\n');
    writeFileSync(join(dir, 'e8.profile.yml'), 'bundles:\n  - e8-nm\n');
    mkdirSync(join(dir, 'node_modules', 'e8-nm'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules', 'e8-nm', 'e8.bundle.yml'),
      "name: e8-nm\nrows:\n  - id: nm1\n    name: '@energy8engine/boot'\n",
    );

    const host = await createIdeHost({ root: dir, port: 0 });
    expect(host.ctx.project.composition.rows.map((r) => r.id)).toEqual(['nm1']);
    await host.stop();
  });

  it('a bundle that fails to parse reports only that, not a false "not found" too', async () => {
    const host = await createIdeHost({ root: fixture('project-broken-bundle'), port: 0 });
    const messages = host.ctx.project.diagnostics.map((d) => d.message);
    expect(messages.some((m) => m.includes('e8-broken') && m.includes('not valid YAML'))).toBe(
      true,
    );
    // The false positive this test exists to catch: resolveComposition
    // reporting "not found" for a bundle that WAS found, just broken.
    expect(messages.some((m) => m.includes('was not found'))).toBe(false);
    await host.stop();
  });
});
