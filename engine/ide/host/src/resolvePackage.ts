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
  if (projectPlugin.kind === 'found') return { dir: projectPlugin.dir, json: projectPlugin.json };

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
 * Why `readPackageJson` came back `null`, when there is more to say than
 * "nothing by that name" — otherwise `undefined`.
 *
 * `readPackageJson` returns one `null` for two different situations, and a
 * person needs them apart. Its callers turn that `null` into "row X names
 * the package Y, which could not be resolved … check for a typo in
 * e8.patch.yml, or install it" — exactly right when nothing by that name
 * exists anywhere, and actively misleading when the package is sitting in
 * the project's own `plugins/` directory and its manifest simply does not
 * parse. The earlier fix correctly stopped that case from throwing a
 * `SyntaxError` through every caller's per-row loop; what it did not do
 * was carry the reason forward, so the row fell through to node
 * resolution and reported a typo in a name that is correct.
 *
 * Only the project-plugin path can produce a reason. A package under
 * `node_modules` whose manifest is broken fails inside `require.resolve`,
 * which has already tried several strategies by then and cannot say which
 * one was "the" failure — and an installed package is not a file the
 * project author hand-edited a moment ago, which is what makes the
 * `plugins/` case worth a sentence of its own.
 *
 * `undefined` for a name that resolved fine, for a name that is genuinely
 * absent, and for one that RESOLVED OUTSIDE `plugins/` (the containment
 * refusal): the first two are not failures this can improve on, and the
 * third is a deliberate refusal rather than damage — reporting "your
 * manifest is broken" about a file the host declined to read would be a
 * new wrong answer in place of the old one.
 *
 * Calling this re-runs `readProjectPlugin`, so the work is done twice on
 * the failure path. That path is one broken row per composition, on a
 * request that is already producing a diagnostic; the alternative — a
 * wider return type through `readPackageJson` and its four call sites,
 * three of which have nothing to say about the reason — costs more than
 * it buys.
 */
export function unresolvedReason(cwd: string, name: string): string | undefined {
  const result = readProjectPlugin(cwd, name);
  return result.kind === 'unreadable' ? result.reason : undefined;
}

/**
 * What a project's `plugins/<name>` lookup found. Three outcomes, not two:
 * `absent` (nothing there, or something there the host refuses to read
 * outside `plugins/`) and `unreadable` (it IS there and cannot be parsed)
 * used to collapse into one `null`, which is what let a broken manifest be
 * reported as a missing package. See `unresolvedReason`.
 */
type ProjectPluginResult =
  | { kind: 'found'; dir: string; json: unknown }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'absent' };

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
 * resolving outside `plugins/` both come back the same way: `absent`, so
 * the caller falls through to ordinary Node resolution instead.
 */
function readProjectPlugin(cwd: string, name: string): ProjectPluginResult {
  const pluginsRoot = resolve(cwd, 'plugins');
  const candidateDir = resolve(pluginsRoot, name);
  const manifestPath = join(candidateDir, 'package.json');

  let realManifestPath: string;
  let realPluginsRoot: string;
  try {
    realManifestPath = realpathSync(manifestPath);
    realPluginsRoot = realpathSync(pluginsRoot);
  } catch {
    return { kind: 'absent' };
  }

  if (realManifestPath !== realPluginsRoot && !realManifestPath.startsWith(realPluginsRoot + sep)) {
    return { kind: 'absent' };
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
    return {
      kind: 'found',
      dir: candidateDir,
      json: JSON.parse(readFileSync(manifestPath, 'utf8')),
    };
  } catch (error) {
    // Still not a throw, and still `readPackageJson`-null to every caller
    // that only asked whether the package resolved — but the reason is
    // kept now instead of dropped, for `unresolvedReason` above. The path
    // is the UNRESOLVED one, for the same reason `dir` is: it is the path
    // the author would recognize.
    return {
      kind: 'unreadable',
      reason: `${manifestPath} could not be read as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
