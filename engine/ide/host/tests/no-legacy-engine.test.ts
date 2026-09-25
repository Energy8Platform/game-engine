/**
 * The engine does not depend on — or mention — the legacy game engine
 * package (slice 37). What it needed became `@energy8engine/*` packages; a
 * mention is how a dependency creeps back. The user's `paper-duel` tree is
 * theirs to move, and is skipped.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
const EXTENSIONS = /\.(ts|tsx|js|mjs|json|md|yml|yaml|html)$/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP_PATHS.includes(path)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, out);
    } else if (EXTENSIONS.test(name) && readFileSync(path, 'utf8').includes(NEEDLE)) {
      out.push(relative(ENGINE, path));
    }
  }
  return out;
}

describe('no legacy engine in the engine', () => {
  it('no file under engine/ names the legacy game engine package', () => {
    expect(walk(ENGINE, [])).toEqual([]);
  });
});
