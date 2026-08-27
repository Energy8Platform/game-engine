import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Read a plugin package's package.json from the project's perspective.
 * Packages that export "./package.json" resolve directly; the rest are found
 * by walking up from their entry point.
 */
export function readPackageJson(cwd: string, name: string): { dir: string; json: unknown } | null {
  const require = createRequire(join(cwd, 'noop.js'));
  try {
    const file = require.resolve(`${name}/package.json`);
    return { dir: dirname(file), json: JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    // fall through to walking up from the entry point
  }
  try {
    let dir = dirname(require.resolve(name));
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        return { dir, json: JSON.parse(readFileSync(candidate, 'utf8')) };
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // unresolvable package — the caller turns this into a diagnostic
  }
  return null;
}
