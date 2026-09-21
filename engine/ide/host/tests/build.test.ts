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
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameCompositionRow } from '@energy8engine/contracts';
import { createIdeHost } from '../src/index';
import { build, type BuildResult } from '../src/compute/build';

const FIRST_SLOT = resolve(__dirname, '../../../examples/first-slot');

let cwd: string;
let out: string;
let result: BuildResult;

/** A private copy of `first-slot`, beside it (see the module doc). Every one is removed in `afterAll`. */
const copies: string[] = [];
function copyOfFirstSlot(): string {
  const dir = mkdtempSync(join(resolve(FIRST_SLOT, '..'), 'e8-compose-build-'));
  cpSync(FIRST_SLOT, dir, { recursive: true, filter: (src) => !src.endsWith('/node_modules') });
  copies.push(dir);
  return dir;
}

beforeAll(async () => {
  cwd = copyOfFirstSlot();
  out = join(cwd, 'dist');
  result = await build({ cwd, out });
}, 120_000);

afterAll(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

/** Every emitted `.js` under `dist/assets/`, concatenated. */
function emittedJs(dir: string): string {
  return readdirSync(join(dir, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(dir, 'assets', name), 'utf8'))
    .join('\n');
}

describe('build', () => {
  it('writes index.html, the five api/ documents and assets/ with no error diagnostics', () => {
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
      'api/spec',
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

  it('api/flow, api/scenes, api/symbols and api/spec are byte-identical to a live host’s answers', async () => {
    const host = await createIdeHost({ root: cwd, port: 0, previewPort: 0 });
    try {
      for (const name of ['flow', 'scenes', 'symbols', 'spec']) {
        const live = await (await fetch(`${host.url}/api/${name}`)).text();
        expect(readFileSync(join(out, 'api', name), 'utf8'), name).toBe(live);
      }
    } finally {
      await host.stop();
    }
  }, 30_000);

  it('the page is its own chunk and everything else the game chunk — the layout the TLA needs', () => {
    // The entry is the page (`src/main.ts`); the rows map and its targets
    // are in the other chunk, imported from the entry, never the reverse —
    // see `build.ts`'s `manualChunks` for the cycle this rules out.
    const names = readdirSync(join(out, 'assets')).filter((name) => name.endsWith('.js'));
    expect(names.map((name) => name.replace(/-[^.]+\.js$/, '')).sort()).toEqual(['game', 'index']);
    const game = readFileSync(join(out, 'assets', names.find((n) => n.startsWith('game-'))!), 'utf8');
    expect(game).not.toMatch(/from"\.\/index-/);
  });

  it('a default build bakes no target and no ide-bridge; --target platform (and --base) bake in, base warns', async () => {
    const js = emittedJs(out);
    expect(js).toContain('buildTarget:void 0');
    expect(js).not.toContain('buildTarget:"platform"');
    // The dev-only bridge is behind `import.meta.env.DEV` — dropped, dynamic
    // import and all. Its `name`/diagnostic strings are the only code-level
    // `ide-bridge` in the browser graph (every other mention is a comment).
    expect(js).not.toContain('ide-bridge');
    expect(result.diagnostics.filter((d) => d.where === '--base')).toEqual([]);
    // No `--target`: the default build has nothing to answer a spin with —
    // said once, as an `info` diagnostic, never as an `error` (an `e8
    // build` with no target is a normal, supported thing to do).
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        where: '--target',
        message: expect.stringContaining('the default target has no session'),
      }),
    );

    const platformOut = join(cwd, 'dist-platform');
    const platform = await build({ cwd, out: platformOut, target: 'platform', base: '/game/' });
    expect(platform.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    // `--target platform` bakes its own session seam in — the info line is
    // specifically about a build with none, so it does not apply here.
    expect(platform.diagnostics.filter((d) => d.where === '--target')).toEqual([]);
    // `--base` moves the page's assets; the rows' `/api/*` stay at the root — said as a warning.
    expect(platform.diagnostics.filter((d) => d.where === '--base')).toMatchObject([
      { severity: 'warning', plugin: 'build', message: expect.stringContaining('/api/*') },
    ]);
    expect(existsSync(join(platformOut, 'index.html'))).toBe(true);
    expect(readFileSync(join(platformOut, 'index.html'), 'utf8')).toContain('src="/game/assets/');
    expect(emittedJs(platformOut)).toContain('buildTarget:"platform"');
  }, 120_000);

  /**
   * `emptyOutDir` empties `--out` once the bundle succeeds, so an `--out`
   * that is the project, or contains it, is refused before the host even
   * boots — measured before this check: `--out .` left the copy with
   * `api assets index.html` and nothing else.
   */
  it('--out that is the project, or contains it, is refused before anything runs', async () => {
    for (const bad of ['.', '..']) {
      const r = await build({ cwd, out: bad });
      expect(r.files, bad).toEqual([]);
      expect(r.diagnostics, bad).toMatchObject([
        {
          severity: 'error',
          plugin: 'build',
          where: resolve(cwd, bad),
          message: expect.stringContaining('contains the project'),
        },
      ]);
      expect(existsSync(join(cwd, 'e8.yml')), bad).toBe(true);
      expect(existsSync(join(cwd, 'src', 'main.ts')), bad).toBe(true);
    }
    expect(existsSync(FIRST_SLOT)).toBe(true);
  });

  /**
   * The same guard through a symlink: `out` is real-pathed before the
   * check, so a link AT the project is the project (refused), and a
   * `dist/` that does not exist yet under that link resolves through the
   * link to the physical `<cwd>/…` (allowed, and written there).
   */
  it('--out through a symlink to the project is refused; --out inside it through the link is allowed and lands in the project', async () => {
    const link = join(resolve(FIRST_SLOT, '..'), `e8-compose-link-${basename(cwd)}`);
    symlinkSync(cwd, link);
    try {
      const refused = await build({ cwd, out: link });
      expect(refused.files).toEqual([]);
      expect(refused.diagnostics).toMatchObject([
        { severity: 'error', plugin: 'build', where: cwd, message: expect.stringContaining('contains the project') },
      ]);
      expect(existsSync(join(cwd, 'e8.yml'))).toBe(true);
      expect(existsSync(join(cwd, 'src', 'main.ts'))).toBe(true);

      const inside = await build({ cwd, out: join(link, 'dist-link') });
      expect(inside.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(inside.out).toBe(join(cwd, 'dist-link'));
      expect(existsSync(join(cwd, 'dist-link', 'index.html'))).toBe(true);
      expect(existsSync(join(cwd, 'e8.yml'))).toBe(true);
    } finally {
      unlinkSync(link);
    }
  }, 120_000);

  it('a bundle that fails leaves no half-built dist: the vite diagnostic, no api/, no index.html', async () => {
    const broken = copyOfFirstSlot();
    const html = join(broken, 'index.html');
    writeFileSync(html, readFileSync(html, 'utf8').replace('/src/main.ts', '/src/missing.ts'));
    const r = await build({ cwd: broken });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toMatchObject([
      { plugin: 'build', where: 'vite' },
    ]);
    expect(existsSync(join(broken, 'dist', 'api'))).toBe(false);
    expect(existsSync(join(broken, 'dist', 'index.html'))).toBe(false);
    expect(r.files).toEqual([]);
  }, 60_000);

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
