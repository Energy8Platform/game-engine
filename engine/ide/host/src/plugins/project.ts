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
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
}

export interface ProjectConfig {
  /** Project directory; e8.profile.yml and e8.patch.yml live here. */
  cwd: string;
}

const PROFILE_FILENAME = 'e8.profile.yml';
const PATCH_FILENAME = 'e8.patch.yml';
const BUNDLE_FILENAME = 'e8.bundle.yml';

/**
 * Fallback bundle location when a bundle isn't installed next to the
 * project (`<cwd>/node_modules/<name>/e8.bundle.yml`, checked first — see
 * `loadBundle`): this repo's own `engine/bundles/<name>/e8.bundle.yml`.
 * `<cwd>` wins because a real user's project resolves its dependencies
 * from its own `node_modules`, not from wherever this repo happens to
 * live on disk — the repo fallback exists only so bundles shipped in THIS
 * repo work without also being npm-installed.
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
    if (bundleResult.bundle) bundles.set(bundleName, bundleResult.bundle);
  }

  const patchResult = await readPatch(cwd);
  diagnostics.push(...patchResult.diagnostics);

  const resolved = resolveComposition({
    profile,
    bundles,
    patches: [{ layer: 'patch', rows: patchResult.rows }],
  });

  return { composition: resolved.composition, diagnostics: [...diagnostics, ...resolved.diagnostics] };
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
 * Reads one bundle's `e8.bundle.yml`, checking next to the project first
 * (`<cwd>/node_modules/<name>/`), then this repo's own `engine/bundles/`.
 * A bundle absent from BOTH locations is not reported here — that is
 * exactly what `resolveComposition` already reports (it names the bundle,
 * see `@energy8engine/project`'s "the profile lists bundle ... but it was
 * not found"), and adding a second diagnostic for the same fact would just
 * say it twice.
 */
async function loadBundle(
  cwd: string,
  bundleName: string,
): Promise<{ bundle: Bundle | null; diagnostics: Diagnostic[] }> {
  const candidates = [
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

    return validateBundle(data, bundleName, filename);
  }

  return { bundle: null, diagnostics: [] };
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
