import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
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
    const host = await createIdeHost({ cwd: fixture('project-simple'), port: 0 });
    expect(host.ctx.project.composition.rows.map((r) => r.id)).toEqual(['boot1', 'reels1']);
    await host.stop();
  });

  it('applies e8.patch.yml on top of the bundles', async () => {
    const host = await createIdeHost({ cwd: fixture('project-patched'), port: 0 });
    const reels = host.ctx.project.composition.rows.find((r) => r.id === 'reels1')!;
    expect(reels.config).toEqual({ grid: { cols: 5, rows: 3 } });
    expect(reels.from).toBe('patch');
    await host.stop();
  });

  it('a missing e8.profile.yml is a diagnostic and the host still starts', async () => {
    const host = await createIdeHost({ cwd: fixture('project-none'), port: 0 });
    expect(host.ctx.project.composition.rows).toEqual([]);
    expect(host.ctx.project.diagnostics.some((d) => d.message.includes('e8.profile.yml'))).toBe(
      true,
    );
    expect(host.url).toBeTruthy(); // it started anyway
    await host.stop();
  });

  it('malformed YAML is a diagnostic naming the file, not a throw', async () => {
    const host = await createIdeHost({ cwd: fixture('project-broken-yaml'), port: 0 });
    expect(host.ctx.project.diagnostics.some((d) => d.where.includes('e8.profile.yml'))).toBe(
      true,
    );
    await host.stop();
  });

  it('a profile that is not an object with a bundles array is a diagnostic', async () => {
    const host = await createIdeHost({ cwd: fixture('project-wrong-shape'), port: 0 });
    expect(host.ctx.project.diagnostics.some((d) => d.message.includes('bundles'))).toBe(true);
    await host.stop();
  });

  it('reload() picks up an edited patch without restarting the host', async () => {
    const dir = copyFixtureToTemp('project-patched');
    const host = await createIdeHost({ cwd: dir, port: 0 });
    writeFileSync(join(dir, 'e8.patch.yml'), 'rows:\n  - id: reels1\n    config: { grid: 9 }\n');
    await host.ctx.project.reload();
    expect(host.ctx.project.composition.rows.find((r) => r.id === 'reels1')!.config).toEqual({
      grid: 9,
    });
    await host.stop();
  });
});
