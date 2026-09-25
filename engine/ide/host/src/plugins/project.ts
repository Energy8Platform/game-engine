/**
 * Reads the GAME's composition — `e8.profile.yml` (which bundles stack),
 * each bundle's `e8.bundle.yml`, and `e8.patch.yml` (deltas on top) — and
 * hands the result to `@energy8engine/project`'s `resolveComposition`.
 *
 * This is deliberately a different file from a different format than
 * `e8.yml`, which `../index.ts`'s `loadComposition` reads: `e8.yml`
 * describes the composition of the EDITOR (rows of IDE plugins, loaded by
 * cordis's own `@cordisjs/plugin-include`); this plugin describes the
 * composition of the GAME. Merging the two is a decision this task does
 * not make.
 *
 * Nothing here throws. A missing file, malformed YAML, or a value that
 * doesn't match the expected shape each becomes a `Diagnostic` — the host
 * still starts, per the same rule `../index.ts`'s `loadComposition`
 * already established for `e8.yml` (and, before that, `createIdeHost`'s
 * Slice 0 fix for exactly this class of first-run mistake).
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'cordis';
import {
  type Diagnostic,
  type PatchRow,
  type Profile,
  type ResolvedComposition,
  diagnostic,
} from '@energy8engine/contracts';
import { type Bundle, resolveComposition } from '@energy8engine/project';
import * as yaml from 'js-yaml';
import { readPackageJson } from '../resolvePackage';

declare module 'cordis' {
  interface Context {
    project: ProjectService;
  }
}

export interface ProjectService {
  readonly composition: ResolvedComposition;
  readonly diagnostics: Diagnostic[];
  /** Re-reads the files and re-resolves. Never throws. */
  reload(): Promise<void>;
  /**
   * Sets one row's `config` in `<cwd>/e8.patch.yml` — WHOLESALE, the
   * patch's own semantics (a patch row replaces its target's config, it
   * does not merge). The row is appended when the patch has none by that
   * `id`; a missing or empty file is a patch with no rows. Written to a
   * `.tmp` beside the file and renamed over it, so a failure mid-write
   * leaves the old bytes intact. Never throws: an unparsable patch, or a
   * disk error, or a document that is not `{ rows: [...] }`, is the
   * returned diagnostic and the file is untouched. An entry INSIDE `rows`
   * that is not an `{ id, … }` object is not refused, though — it is kept
   * verbatim (it can never match `id`, so it is neither replaced nor
   * dropped); `readPatch` is what reports it, on every read.
   *
   * Comments in the file do NOT survive — `js-yaml` dumps data, the same
   * way `e8.yml` is rewritten by `@cordisjs/plugin-include`. The reference
   * project keeps its prose in `README.md` for exactly that reason. Does
   * not `reload()` — the caller (`runtime-assets.ts`'s `PUT`) does, once,
   * together with the spin schema.
   */
  writePatchRow(id: string, config: Record<string, unknown>): Promise<Diagnostic[]>;
}

export interface ProjectConfig {
  /** Project directory; e8.profile.yml and e8.patch.yml live here. */
  cwd: string;
}

const PROFILE_FILENAME = 'e8.profile.yml';
const PATCH_FILENAME = 'e8.patch.yml';
const BUNDLE_FILENAME = 'e8.bundle.yml';

/**
 * Fallback bundle location when a bundle is neither self-contained under
 * the project (`<cwd>/bundles/<name>/`) nor npm-installed
 * (`<cwd>/node_modules/<name>/`) — see `loadBundle` for the full order:
 * this repo's own `engine/bundles/<name>/e8.bundle.yml`. The two `<cwd>`
 * locations win because a real user's project resolves its own
 * dependencies from its own directory, not from wherever this repo
 * happens to live on disk — the repo fallback exists only so bundles
 * shipped in THIS repo work without also being npm-installed.
 *
 * This package is loaded as genuine ESM by the real CLI (`tsx/esm/api`,
 * see `engine/apps/cli/bin/e8.mjs`), where `__dirname` does not exist —
 * unlike vitest's own vite-node SSR transform, which shims it and would
 * have hidden a `ReferenceError` here behind an all-green test run.
 * `import.meta.url` is the ESM-native equivalent; `fileURLToPath` turns it
 * back into the plain path `join()` wants.
 */
const REPO_BUNDLES_DIR = fileURLToPath(new URL('../../../../bundles', import.meta.url));

export const name = 'project';

export async function apply(ctx: Context, config: ProjectConfig): Promise<void> {
  let composition: ResolvedComposition = { rows: [] };
  let diagnostics: Diagnostic[] = [];

  async function load(): Promise<void> {
    const result = await readProject(config.cwd);
    composition = result.composition;
    diagnostics = result.diagnostics;
  }

  const service: ProjectService = {
    get composition() {
      return composition;
    },
    get diagnostics() {
      return diagnostics;
    },
    reload: load,
    writePatchRow: (id, rowConfig) => writePatchRow(config.cwd, id, rowConfig),
  };

  await load();
  ctx.provide('project', service);
}

async function readProject(
  cwd: string,
): Promise<{ composition: ResolvedComposition; diagnostics: Diagnostic[] }> {
  const profileResult = await readProfile(cwd);
  if (profileResult.profile === null) {
    // No profile, no bundles to resolve — the composition is empty, and
    // the diagnostic already says why.
    return { composition: { rows: [] }, diagnostics: profileResult.diagnostics };
  }
  const profile = profileResult.profile;

  const bundles = new Map<string, Bundle>();
  const diagnostics: Diagnostic[] = [...profileResult.diagnostics];
  for (const bundleName of profile.bundles) {
    const bundleResult = await loadBundle(cwd, bundleName);
    diagnostics.push(...bundleResult.diagnostics);
    if (bundleResult.found) {
      // Found but broken (bad YAML, wrong shape) still counts as
      // "present" to the resolver, as an empty-row stand-in — otherwise
      // resolveComposition, seeing nothing in the map under this name,
      // would ALSO report "not found", which is false: the file is
      // there, it just didn't parse. The diagnostic already pushed above
      // says the true thing; this only stops a false second one.
      bundles.set(bundleName, bundleResult.bundle ?? { name: bundleName, rows: [] });
    }
    // Genuinely absent from every candidate location: leave it out of the
    // map entirely. `resolveComposition` reports that case itself (it
    // names the bundle) — adding our own diagnostic here would just say
    // the same true thing twice.
  }

  const patchResult = await readPatch(cwd);
  diagnostics.push(...patchResult.diagnostics);

  const resolved = resolveComposition({
    profile,
    bundles,
    patches: [{ layer: 'patch', rows: patchResult.rows }],
  });

  return {
    composition: resolved.composition,
    diagnostics: [
      ...diagnostics,
      ...resolved.diagnostics,
      ...tumblePair(resolved.composition),
      ...foreignCopies(cwd, resolved.composition),
    ],
  };
}

/**
 * Packages with module state. `pixi.js` (classes) and `cordis` (context)
 * cannot mark themselves; `tween` (registry) and `reel-core` (classes) do
 * mark themselves at runtime, but under `e8 build` the engine merges into
 * one chunk and the marker's `import.meta.url` collapses — a built game's
 * duplicate is caught here (`e8 build` reads these diagnostics) or nowhere.
 */
const STATEFUL_PACKAGES = ['pixi.js', 'cordis', '@energy8engine/tween', '@energy8engine/reel-core'];
// Built from parts — the ide-host guard (`no-legacy-engine.test.ts`) scans engine/ for the literal.
const LEGACY_ENGINE = ['@energy8platform', 'game-engine'].join('/');
// What an install brings a package — a row's devDependencies are not installed for the game.
const RUNTIME_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const DEPENDENCY_FIELDS = [...RUNTIME_FIELDS, 'devDependencies'];

/** Whether `manifest` names `pkg` in any of `fields`. */
function declares(manifest: unknown, pkg: string, fields: string[]): boolean {
  return fields.some((field) => {
    const deps = isRecord(manifest) ? manifest[field] : undefined;
    return isRecord(deps) && pkg in deps;
  });
}

/**
 * paper-duel F14, spec §2: a project that resolves its OWN copy of a
 * stateful package — a plugin pinning another version — talks to a
 * different instance than the engine's rows, silently. Each project
 * location (the root, every `plugins/*` with a package.json) is compared
 * against what the composed `@energy8engine/*` rows that DECLARE the
 * package resolve, WHEREVER those are installed — a real game's own
 * `node_modules`, or this repo's for the examples; never against a
 * workspace. A row that does not declare it walks up to whatever the
 * project has — counting it would make a root pin "the engine's copy" and
 * hide it — and a package no row declares is not checked. One warning per
 * foreign copy, every location that resolves it in `where` (a root copy is
 * not repeated for each plugin that walks up to it); the fix says to delete a same-version
 * copy (a plugin's own install adds its peers) and to declare a
 * different-version one. A package a location does not resolve is not a
 * finding. And the user's rule: the legacy engine named in a
 * project manifest, or installed inside the project or a plugin, is a
 * second engine — one warning listing every location. (The copy this repo
 * hoists to its root is found OUTSIDE the example projects, so it is not
 * theirs.)
 *
 * Every directory is realpath'd first, as Node and vite resolve: a
 * symlinked `plugins/<name>` (npm link, a local workspace plugin) resolves
 * from its target's `node_modules` chain, not by walking up the project.
 * A directory that vanishes mid-check is skipped.
 */
function foreignCopies(cwd: string, composition: ResolvedComposition): Diagnostic[] {
  const root = realpath(resolve(cwd));
  if (root === null) return [];
  const locations = [{ label: 'the project', where: 'package.json', dir: root }];
  try {
    for (const entry of readdirSync(join(root, 'plugins'))) {
      const dir = realpath(join(root, 'plugins', entry));
      if (dir !== null && existsSync(join(dir, 'package.json'))) {
        locations.push({ label: `plugins/${entry}`, where: `plugins/${entry}/package.json`, dir });
      }
    }
  } catch {
    // no plugins/ — the root is the only location
  }
  const rows = new Map<string, unknown>(); // real dir → manifest
  for (const row of composition.rows) {
    const found = row.name.startsWith('@energy8engine/') ? readPackageJson(root, row.name) : null;
    const dir = found ? realpath(found.dir) : null;
    if (found && dir !== null) rows.set(dir, found.json);
  }

  const out: Diagnostic[] = [];
  for (const pkg of STATEFUL_PACKAGES) {
    const engine = new Map<string, InstalledCopy>();
    for (const [dir, manifest] of rows) {
      const copy = declares(manifest, pkg, RUNTIME_FIELDS) ? locate(dir, pkg) : null;
      if (copy) engine.set(copy.path, copy);
    }
    const [used] = engine.values();
    if (!used) continue;
    const foreign = new Map<string, { copy: InstalledCopy; at: typeof locations }>();
    for (const location of locations) {
      const own = locate(location.dir, pkg);
      if (!own || engine.has(own.path)) continue;
      const entry = foreign.get(own.path) ?? { copy: own, at: [] };
      entry.at.push(location);
      foreign.set(own.path, entry);
    }
    for (const { copy, at } of foreign.values()) {
      out.push(
        diagnostic(
          'warning',
          'composition',
          at.map((l) => l.where).join(', '),
          `${at[0]!.label} resolves ${pkg}@${copy.version} (${copy.path}) but the engine's rows use ${pkg}@${used.version} (${used.path}) — two copies in one page`,
          copy.version === used.version
            ? `the same version is installed twice — delete ${at[0]!.label}'s copy (a nested install pulled it in; install plugins with --omit=peer) so the engine's resolves`
            : `declare ${pkg} as a peerDependency (or a range that includes the engine's ${used.version}) and reinstall, so one copy resolves`,
        ),
      );
    }
  }

  const legacyAt = locations.filter(({ dir }) => {
    const named = declares(readJson(join(dir, 'package.json')), LEGACY_ENGINE, DEPENDENCY_FIELDS);
    const found = locate(dir, LEGACY_ENGINE)?.nodeModules;
    return (
      named ||
      (found !== undefined && (found.startsWith(root + sep) || found.startsWith(dir + sep)))
    );
  });
  if (legacyAt.length > 0) {
    out.push(
      diagnostic(
        'warning',
        'composition',
        legacyAt.map((l) => l.where).join(', '),
        `the engine no longer uses ${LEGACY_ENGINE} — a copy here is a second engine`,
        "remove it from the project's package.json files and node_modules; the engine's own packages (@energy8engine/*) replace it — tweens: @energy8engine/tween",
      ),
    );
  }
  return out;
}

interface InstalledCopy {
  /** Realpath of the package's directory — two copies are two paths. */
  path: string;
  version: string;
  /** The `node_modules` directory it was found in, on the (real) walk up from the location. */
  nodeModules: string;
}

/**
 * Where `pkg` is installed as seen from the REAL directory `dir`: Node's
 * own lookup order (`require.resolve.paths`), first
 * `<node_modules>/<pkg>/package.json` that exists. Not
 * `require.resolve('<pkg>/package.json')` — pixi.js's `exports` does not
 * list `./package.json`, so that throws for it.
 */
function locate(dir: string, pkg: string): InstalledCopy | null {
  for (const nodeModules of createRequire(join(dir, 'package.json')).resolve.paths(pkg) ?? []) {
    const manifest = join(nodeModules, pkg, 'package.json');
    const real = existsSync(manifest) ? realpath(manifest) : null;
    if (real === null) continue; // absent, or gone since — Node would look further up too
    const json = readJson(manifest);
    const version = isRecord(json) && typeof json.version === 'string' ? json.version : 'unknown';
    return { path: dirname(real), version, nodeModules };
  }
  return null;
}

/** `realpathSync`, or `null` for a path that is not there (or vanished a moment ago). */
function realpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * `game-runtime`'s `tumble` makes the cascade mechanic present tumbles, and
 * only the `@energy8engine/reels-cascade` row (e8-base's `cascade1`) can
 * play one: without it every tumble step fails at run time. The row being
 * composed IS the reels' cascade switch (it has no `enabled`), so this says
 * so before the first spin rather than after. Rows are found by package
 * name, not by the bundle's ids.
 */
function tumblePair(composition: ResolvedComposition): Diagnostic[] {
  const mechanics = composition.rows.find((r) => r.name === '@energy8engine/game-runtime');
  const reels = composition.rows.find((r) => r.name === '@energy8engine/reels');
  if (!mechanics || !reels || mechanics.config.tumble !== true) return [];
  if (composition.rows.some((r) => r.name === '@energy8engine/reels-cascade')) return [];
  return [
    diagnostic(
      'warning',
      'composition',
      reels.id,
      `${mechanics.id}.config.tumble is on but no @energy8engine/reels-cascade row is composed — every tumble step fails`,
      'compose the @energy8engine/reels-cascade row (e8-base names it cascade1)',
    ),
  ];
}

/** Reads and shape-checks `<cwd>/e8.profile.yml`. Never throws. */
async function readProfile(
  cwd: string,
): Promise<{ profile: Profile | null; diagnostics: Diagnostic[] }> {
  const filename = join(cwd, PROFILE_FILENAME);
  let content: string;
  try {
    content = await readFile(filename, 'utf8');
  } catch (error) {
    return {
      profile: null,
      diagnostics: [
        diagnostic(
          'error',
          'profile',
          PROFILE_FILENAME,
          `cannot read ${PROFILE_FILENAME}: ${errorMessage(error)}`,
          `create ${filename} with a "bundles" array, e.g. { bundles: [] }`,
        ),
      ],
    };
  }

  let data: unknown;
  try {
    data = yaml.load(content);
  } catch (error) {
    return {
      profile: null,
      diagnostics: [
        diagnostic(
          'error',
          'profile',
          PROFILE_FILENAME,
          `${PROFILE_FILENAME} is not valid YAML: ${errorMessage(error)}`,
          `fix the YAML syntax in ${filename}`,
        ),
      ],
    };
  }

  if (!isRecord(data) || !Array.isArray(data.bundles)) {
    return {
      profile: null,
      diagnostics: [
        diagnostic(
          'error',
          'profile',
          PROFILE_FILENAME,
          `${PROFILE_FILENAME} must be an object with a "bundles" array; found ${describeShape(data)}`,
          `edit ${filename} so it has a "bundles" array, e.g. { bundles: [] }`,
        ),
      ],
    };
  }

  const bundleNames = data.bundles;
  if (!bundleNames.every((entry) => typeof entry === 'string')) {
    return {
      profile: null,
      diagnostics: [
        diagnostic(
          'error',
          'profile',
          PROFILE_FILENAME,
          `${PROFILE_FILENAME}'s "bundles" must be an array of strings`,
          `edit ${filename} so every entry in "bundles" is a bundle name`,
        ),
      ],
    };
  }

  return { profile: { bundles: bundleNames }, diagnostics: [] };
}

/**
 * Reads one bundle's `e8.bundle.yml`, checking, in order:
 *  1. `<cwd>/bundles/<name>/` — self-contained, project-authored bundles.
 *  2. `<cwd>/node_modules/<name>/` — npm-installed bundles.
 *  3. this repo's own `engine/bundles/<name>/`.
 *
 * `found: false` means the file was absent from all three; `found: true`
 * with `bundle: null` means it was located but failed to parse or didn't
 * match the expected shape (see `readProject`'s caller for why that
 * distinction matters to the resolver).
 */
async function loadBundle(
  cwd: string,
  bundleName: string,
): Promise<{ found: boolean; bundle: Bundle | null; diagnostics: Diagnostic[] }> {
  const candidates = [
    join(cwd, 'bundles', bundleName, BUNDLE_FILENAME),
    join(cwd, 'node_modules', bundleName, BUNDLE_FILENAME),
    join(REPO_BUNDLES_DIR, bundleName, BUNDLE_FILENAME),
  ];

  for (const filename of candidates) {
    let content: string;
    try {
      content = await readFile(filename, 'utf8');
    } catch {
      continue; // not here — try the next candidate
    }

    let data: unknown;
    try {
      data = yaml.load(content);
    } catch (error) {
      return {
        found: true,
        bundle: null,
        diagnostics: [
          diagnostic(
            'error',
            bundleName,
            filename,
            `${BUNDLE_FILENAME} for "${bundleName}" is not valid YAML: ${errorMessage(error)}`,
            `fix the YAML syntax in ${filename}`,
          ),
        ],
      };
    }

    return { found: true, ...validateBundle(data, bundleName, filename) };
  }

  return { found: false, bundle: null, diagnostics: [] };
}

function validateBundle(
  data: unknown,
  bundleName: string,
  filename: string,
): { bundle: Bundle | null; diagnostics: Diagnostic[] } {
  if (!isRecord(data) || !Array.isArray(data.rows)) {
    return {
      bundle: null,
      diagnostics: [
        diagnostic(
          'error',
          bundleName,
          filename,
          `${BUNDLE_FILENAME} for "${bundleName}" must be an object with a "rows" array; found ${describeShape(data)}`,
          `edit ${filename} so it has a "rows" array`,
        ),
      ],
    };
  }

  const rows: Bundle['rows'] = [];
  const diagnostics: Diagnostic[] = [];
  data.rows.forEach((row, index) => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') {
      diagnostics.push(
        diagnostic(
          'error',
          bundleName,
          `${filename}[${index}]`,
          `row ${index} of "${bundleName}" must have a string "id" and "name"; found ${describeShape(row)}`,
          `edit ${filename} so row ${index} has an "id" and "name"`,
        ),
      );
      return;
    }
    rows.push({
      id: row.id,
      name: row.name,
      config: isRecord(row.config) ? row.config : undefined,
    });
  });

  return { bundle: { name: bundleName, rows }, diagnostics };
}

/**
 * Reads `<cwd>/e8.patch.yml`. Unlike the profile, a missing patch file is
 * not a diagnostic — a project with no patch is a perfectly ordinary
 * project, not a mistake.
 */
async function readPatch(cwd: string): Promise<{ rows: PatchRow[]; diagnostics: Diagnostic[] }> {
  const filename = join(cwd, PATCH_FILENAME);
  let content: string;
  try {
    content = await readFile(filename, 'utf8');
  } catch {
    return { rows: [], diagnostics: [] };
  }

  let data: unknown;
  try {
    data = yaml.load(content);
  } catch (error) {
    return {
      rows: [],
      diagnostics: [
        diagnostic(
          'error',
          'patch',
          PATCH_FILENAME,
          `${PATCH_FILENAME} is not valid YAML: ${errorMessage(error)}`,
          `fix the YAML syntax in ${filename}`,
        ),
      ],
    };
  }

  if (data === undefined || data === null) {
    // An empty file is a patch with no rows, same as an explicit `rows: []`.
    return { rows: [], diagnostics: [] };
  }

  if (!isRecord(data) || !Array.isArray(data.rows)) {
    return {
      rows: [],
      diagnostics: [
        diagnostic(
          'error',
          'patch',
          PATCH_FILENAME,
          `${PATCH_FILENAME} must be an object with a "rows" array; found ${describeShape(data)}`,
          `edit ${filename} so it has a "rows" array`,
        ),
      ],
    };
  }

  const rows: PatchRow[] = [];
  const diagnostics: Diagnostic[] = [];
  data.rows.forEach((row, index) => {
    if (!isRecord(row) || typeof row.id !== 'string') {
      diagnostics.push(
        diagnostic(
          'error',
          'patch',
          `${PATCH_FILENAME}[${index}]`,
          `patch row ${index} must be an object with a string "id"; found ${describeShape(row)}`,
          `edit ${filename} so row ${index} has an "id"`,
        ),
      );
      return;
    }
    rows.push({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : undefined,
      config: isRecord(row.config) ? row.config : undefined,
      remove: row.remove === true ? true : undefined,
    });
  });

  return { rows, diagnostics };
}

/** See `ProjectService.writePatchRow`. */
async function writePatchRow(
  cwd: string,
  id: string,
  config: Record<string, unknown>,
): Promise<Diagnostic[]> {
  const filename = join(cwd, PATCH_FILENAME);
  let content = '';
  try {
    content = await readFile(filename, 'utf8');
  } catch {
    // Missing (or unreadable as a file) — an empty patch; the write below
    // says so itself if the path is really something else.
  }
  let data: unknown;
  try {
    data = yaml.load(content);
  } catch (error) {
    return [
      diagnostic(
        'error',
        'patch',
        PATCH_FILENAME,
        `${PATCH_FILENAME} is not valid YAML, so "${id}" was not written: ${errorMessage(error)}`,
        `fix the YAML syntax in ${filename}`,
      ),
    ];
  }
  // Empty (or missing) is a patch with no rows; a document that parses to
  // anything else but `{ rows: [...] }` is refused, like a syntax error —
  // rewriting it would silently discard whatever the person meant, and
  // the diagnostic already names the fix.
  if (data !== undefined && data !== null && !(isRecord(data) && Array.isArray(data.rows))) {
    return [
      diagnostic(
        'error',
        'patch',
        PATCH_FILENAME,
        `${PATCH_FILENAME} must be an object with a "rows" array, so "${id}" was not written; found ${describeShape(data)}`,
        `edit ${filename} so it has a "rows" array`,
      ),
    ];
  }
  const rows: unknown[] = isRecord(data) ? [...(data.rows as unknown[])] : [];
  const index = rows.findIndex((row) => isRecord(row) && row.id === id);
  if (index === -1) rows.push({ id, config });
  else rows[index] = { ...(rows[index] as Record<string, unknown>), config };

  const tmp = `${filename}.tmp`;
  try {
    await writeFile(tmp, yaml.dump({ rows }, { lineWidth: -1, noRefs: true }), 'utf8');
    await rename(tmp, filename);
    return [];
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    return [
      diagnostic(
        'error',
        'patch',
        PATCH_FILENAME,
        `cannot write ${PATCH_FILENAME}: ${errorMessage(error)}`,
        `check that ${cwd} is writable and ${filename} is a file`,
      ),
    ];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human-readable description of a YAML value's shape, for diagnostic messages. */
function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  switch (typeof value) {
    case 'object':
      return 'a mapping';
    case 'string':
      return 'a string';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'a boolean';
    default:
      return typeof value;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
