/**
 * The engine does not depend on — or mention — the legacy game engine
 * package (slice 37). What it needed became `@energy8engine/*` packages; a
 * mention is how a dependency creeps back. The user's `paper-duel` tree is
 * theirs to move, and is skipped.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `ide-host` is ESM (no `__dirname`) — resolved from this file's own
// `import.meta.url`, the same way `template.test.ts` finds the repo root.
const ENGINE = fileURLToPath(new URL('../../../', import.meta.url));
// Built from parts, so this file does not match itself.
const NEEDLE = ['@energy8platform', 'game-engine'].join('/');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite', 'test-results', 'playwright-report']);
const SKIP_PATHS = [join(ENGINE, 'examples', 'paper-duel')];
// ts/tsx/js/jsx/mjs/cjs/mts/cts, plus json/md/yml/yaml/html/css — every
// extension that can hold an import or a mention.
const EXTENSIONS = /\.(c|m)?(t|j)sx?$|\.(json|md|ya?ml|html|css)$/;

// `readdirSync` and the per-entry `statSync`/`readFileSync` aren't atomic —
// a concurrent Playwright `e8-compose-*` copy can delete an entry in
// between. Skip a vanished entry (ENOENT); anything else is a real error.
function tryStat(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

function tryRead(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP_PATHS.includes(path)) continue;
    const stat = tryStat(path);
    if (!stat) continue;
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, out);
    } else if (EXTENSIONS.test(name)) {
      const content = tryRead(path);
      if (content?.includes(NEEDLE)) out.push(relative(ENGINE, path));
    }
  }
  return out;
}

describe('no legacy engine in the engine', () => {
  it('no file under engine/ names the legacy game engine package', () => {
    expect(walk(ENGINE, [])).toEqual([]);
  });

  it('an entry that vanishes between readdirSync and statSync (ENOENT) is skipped, not thrown', () => {
    // A dangling symlink reproduces the race without mocking fs: readdirSync
    // lists it, statSync (which follows it) throws ENOENT for real.
    const dir = mkdtempSync(join(tmpdir(), 'no-legacy-engine-'));
    try {
      symlinkSync(join(dir, 'does-not-exist.ts'), join(dir, 'dangling.ts'));
      expect(walk(dir, [])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
