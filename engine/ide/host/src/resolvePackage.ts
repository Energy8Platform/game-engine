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
 * `plugins/` back out to the rest of the filesystem. `resolve()` already
 * normalizes `..` segments away lexically, so a plain string-prefix check
 * on the UNRESOLVED paths would already stop that particular escape on
 * its own — realpath is not what's carrying that part.
 *
 * What realpath-ing BOTH sides is for, same shape `/plugin-runtime/:id`
 * already uses (see `runtime-assets.ts`): a `plugins/<name>` entry that is
 * ITSELF a symlink, lexically inside `plugins/` (no `..` in `name` at
 * all) but pointing somewhere its target is not. Left unresolved, that
 * would read as "inside" on the strength of the path string alone while
 * the bytes actually come from wherever the symlink points — so a
 * project-local drop-in could silently pull in code from outside the
 * project. That is deliberately rejected here (a `plugins/<name>` that is
 * a symlink to somewhere else does not resolve — see task-5-6-report.md
 * for whether that should ever be allowed), not merely tolerated.
 *
 * Resolving `pluginsRoot` too, not only the candidate manifest, matters
 * for the opposite reason: if the PROJECT root itself sits behind a
 * symlink (plausible — a developer's own project directory, symlinked in
 * from elsewhere), comparing a realpath'd manifest against an unresolved
 * `pluginsRoot` string would falsely reject an entirely ordinary,
 * non-symlinked plugin, since the two strings would disagree about the
 * project root's own path despite pointing at the same place. Resolving
 * both keeps the comparison meaningful either way.
 *
 * `realpathSync` throwing — no `plugins/` directory, no entry by that
 * name, no `package.json` inside it — and the entry existing but
 * resolving outside `plugins/` both come back the same way: silence, so
 * the caller falls through to ordinary Node resolution instead.
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

  // Wrapped for the same reason the two `require.resolve`-based branches
  // above are: a `plugins/<name>/package.json` a human hand-edited into a
  // syntax error (the single most ordinary mistake this workflow invites),
  // or one that happens to be a directory, must come back as an ordinary
  // "could not resolve" `null` — not a `SyntaxError`/`EISDIR` thrown out of
  // this function and up through every caller's own per-row loop, taking a
  // healthy sibling row down with it.
  try {
    // The RETURNED dir is the unresolved, lexical join — not the realpath
    // used for the check above. Callers (and their tests) reason about a
    // plugin's location relative to the `cwd` they passed in; handing back
    // a realpath'd string here would silently substitute a different (if
    // equivalent) path whenever `cwd` itself sits behind a symlink.
    return { dir: candidateDir, json: JSON.parse(readFileSync(manifestPath, 'utf8')) };
  } catch {
    return null;
  }
}
