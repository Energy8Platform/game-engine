import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';

/**
 * Read a plugin package's package.json from the project's perspective.
 * Packages that export "./package.json" resolve directly; the rest are found
 * by walking up from their entry point.
 *
 * Search order, and it is deliberate:
 *  1. `<cwd>/plugins/<name>` — the project's own plugins, edited by hand,
 *     no install step.
 *  2. ordinary Node resolution (`node_modules`, including workspace
 *     symlinks).
 *
 * The project wins over an installed package of the same name: someone who
 * put a plugin in `plugins/` did it to have THAT one used, not whatever
 * else happens to be sitting in `node_modules` under the same name — the
 * reverse order would make behaviour depend on what's installed alongside
 * rather than on what the project actually asked for.
 */
export function readPackageJson(cwd: string, name: string): { dir: string; json: unknown } | null {
  const projectPlugin = readProjectPlugin(cwd, name);
  if (projectPlugin) return projectPlugin;

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

/**
 * A project's own `plugins/<name>/package.json` — no `node_modules` entry,
 * no install step, just a directory a human placed by hand. `name` is
 * whatever a row's `e8.patch.yml`/`e8.bundle.yml` author wrote, and it
 * lands directly in the `resolve` below, so `../../../etc` must not walk
 * `plugins/` back out to the rest of the filesystem.
 *
 * Both sides of the containment check go through `realpathSync`, the same
 * shape `/plugin-runtime/:id` already uses (see `runtime-assets.ts`) — a
 * prefix check on the UNRESOLVED paths would cut the wrong way here: this
 * repo's own packages are npm-workspace symlinks, so comparing an
 * unresolved `plugins/` entry against an unresolved root would flag a
 * perfectly ordinary symlinked plugin as an escape. `realpathSync` throwing
 * — no `plugins/` directory, no entry by that name, no `package.json`
 * inside it — and the entry existing but resolving outside `plugins/` both
 * come back the same way: silence, so the caller falls through to ordinary
 * Node resolution instead.
 */
function readProjectPlugin(cwd: string, name: string): { dir: string; json: unknown } | null {
  const pluginsRoot = resolve(cwd, 'plugins');
  const candidateDir = resolve(pluginsRoot, name);
  const manifestPath = join(candidateDir, 'package.json');

  let realManifestPath: string;
  let realPluginsRoot: string;
  try {
    realManifestPath = realpathSync(manifestPath);
    realPluginsRoot = realpathSync(pluginsRoot);
  } catch {
    return null;
  }

  if (realManifestPath !== realPluginsRoot && !realManifestPath.startsWith(realPluginsRoot + sep)) {
    return null;
  }

  // The RETURNED dir is the unresolved, lexical join — not the realpath
  // used for the check above. Callers (and their tests) reason about a
  // plugin's location relative to the `cwd` they passed in; handing back a
  // realpath'd string here would silently substitute a different (if
  // equivalent) path whenever `cwd` itself sits behind a symlink.
  return { dir: candidateDir, json: JSON.parse(readFileSync(manifestPath, 'utf8')) };
}
