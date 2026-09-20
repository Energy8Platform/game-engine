/**
 * `e8 build` on a copy of `first-slot` — spec §6/§9: a `dist/` with the
 * page, the frozen `api/*` documents (byte-identical to what a live host
 * answers on the same copy), the bundled rows keyed by id, and `assets/`.
 * Runs a real `vite build` twice (default and `--target platform`), so the
 * budgets are wide.
 *
 * The copy lands beside the example, not in tmp — the project resolves
 * its packages from its own directory and vite bundles them from the repo
 * (see engine/apps/web/tests/e2e/project-fixture.ts).
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameCompositionRow } from '@energy8engine/contracts';
import { createIdeHost } from '../src/index';
import { build, type BuildResult } from '../src/compute/build';

const FIRST_SLOT = resolve(__dirname, '../../../examples/first-slot');

let cwd: string;
let out: string;
let result: BuildResult;

beforeAll(async () => {
  cwd = mkdtempSync(join(resolve(FIRST_SLOT, '..'), 'e8-compose-build-'));
  cpSync(FIRST_SLOT, cwd, { recursive: true, filter: (src) => !src.endsWith('/node_modules') });
  out = join(cwd, 'dist');
  result = await build({ cwd, out });
}, 120_000);

afterAll(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

/** Every emitted `.js` under `dist/assets/`, concatenated. */
function emittedJs(dir: string): string {
  return readdirSync(join(dir, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(dir, 'assets', name), 'utf8'))
    .join('\n');
}

describe('build', () => {
  it('writes index.html, the four api/ documents and assets/ with no error diagnostics', () => {
    expect(result.out).toBe(out);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'assets', 'spin.wav'))).toBe(true);
    for (const rel of [
      'index.html',
      'api/composition',
      'api/flow',
      'api/scenes',
      'api/symbols',
      'assets/spin.wav',
      'assets/symbols/1.png',
    ]) {
      expect(result.files, rel).toContain(rel);
    }
    // Relative, posix, sorted — and nothing outside `out`.
    expect(result.files).toEqual([...result.files].sort());
    expect(result.files.every((f) => !f.startsWith('/') && !f.includes('..'))).toBe(true);
  });

  it('api/composition names the row id as each bundled row’s runtimeUrl, clientUrl null', () => {
    const composition = JSON.parse(readFileSync(join(out, 'api', 'composition'), 'utf8')) as {
      rows: (GameCompositionRow & { clientUrl: unknown })[];
      diagnostics: unknown[];
      schema: unknown;
    };
    const byId = new Map(composition.rows.map((row) => [row.id, row]));
    for (const id of ['boot1', 'flow1', 'sessionhost1', 'sessionsdk1', 'shell1', 'reelstep1']) {
      expect(byId.get(id)?.runtimeUrl, id).toBe(id);
    }
    for (const row of composition.rows) {
      expect(row.clientUrl, row.id).toBeNull();
      expect([row.id, null], row.id).toContain(row.runtimeUrl);
    }
    // The rest of the response rides untouched: the spin schema `createGame` reads.
    expect(composition.schema).not.toBeNull();
    // Every bundled row is a chunk vite emitted — the virtual map's import()
    // targets, one property per row id (minified: unquoted keys).
    const js = emittedJs(out);
    expect(js).toMatch(/boot1:\(\)=>/);
    expect(js).toMatch(/flow1:\(\)=>/);
    expect(js).toMatch(/reelstep1:\(\)=>/);
  });

  it('api/flow, api/scenes and api/symbols are byte-identical to a live host’s answers', async () => {
    const host = await createIdeHost({ root: cwd, port: 0, previewPort: 0 });
    try {
      for (const name of ['flow', 'scenes', 'symbols']) {
        const live = await (await fetch(`${host.url}/api/${name}`)).text();
        expect(readFileSync(join(out, 'api', name), 'utf8'), name).toBe(live);
      }
    } finally {
      await host.stop();
    }
  }, 30_000);

  it('a default build bakes no target and no ide-bridge; --target platform bakes "platform"', async () => {
    const js = emittedJs(out);
    expect(js).toContain('buildTarget:void 0');
    expect(js).not.toContain('buildTarget:"platform"');
    // The dev-only bridge is behind `import.meta.env.DEV` — dropped, dynamic
    // import and all. Its `name`/diagnostic strings are the only code-level
    // `ide-bridge` in the browser graph (every other mention is a comment).
    expect(js).not.toContain('ide-bridge');

    const platformOut = join(cwd, 'dist-platform');
    const platform = await build({ cwd, out: platformOut, target: 'platform' });
    expect(platform.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(existsSync(join(platformOut, 'index.html'))).toBe(true);
    expect(emittedJs(platformOut)).toContain('buildTarget:"platform"');
  }, 120_000);

  it('a folder that is not a project is one error diagnostic, no dist', async () => {
    const empty = mkdtempSync(join(resolve(FIRST_SLOT, '..'), 'e8-compose-build-empty-'));
    try {
      const r = await build({ cwd: empty });
      expect(r.files).toEqual([]);
      expect(r.diagnostics.at(-1)).toMatchObject({
        severity: 'error',
        plugin: 'build',
        message: expect.stringContaining('not a project'),
      });
      expect(existsSync(join(empty, 'dist'))).toBe(false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 30_000);
});
