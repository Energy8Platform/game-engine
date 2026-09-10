/**
 * The host's own view onto the project's files — the gap the read side of
 * this closed first. Everything else the host has ever done with a project
 * is RESOLVE it (composition, schema, patches): parse a handful of named
 * config files and report what they mean. Three of the IDE's five screens
 * (spec, code editor is more general than that) need the actual tree and
 * actual file contents, not a resolved summary of them — this plugin is
 * that: list, read, and now write and remove one file at a time.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { Context } from 'cordis';
import { type Diagnostic, type FileEntry, diagnostic } from '@energy8engine/contracts';

declare module 'cordis' {
  interface Context {
    files: FilesService;
  }
}

export interface FilesService {
  /** Every entry in the project's tree, in traversal order. Never throws. */
  tree(): Promise<{ entries: FileEntry[]; diagnostics: Diagnostic[] }>;
  /** Contents of one file. `bytes` is absent when there is nothing to read. */
  read(path: string): Promise<{ bytes?: Uint8Array; diagnostics: Diagnostic[] }>;
  /** Creates or replaces a file. Missing directories are created. */
  write(path: string, bytes: Uint8Array): Promise<{ diagnostics: Diagnostic[] }>;
  /** Removes a file. Does not remove a directory — that is a separate intent. */
  remove(path: string): Promise<{ diagnostics: Diagnostic[] }>;
}

export interface FilesConfig {
  /** Project directory; every path this service takes is relative to it. */
  cwd: string;
}

export const name = 'files';

/**
 * Directory names a project tree never shows. Not tidiness — a tree that
 * is mostly other people's packages, or git's own bookkeeping, is not a
 * useful answer to "what does this project contain", so both are skipped
 * wherever they occur, not only at the root.
 */
const SKIPPED_DIRS = new Set(['node_modules', '.git']);

export async function apply(ctx: Context, config: FilesConfig): Promise<void> {
  const service: FilesService = {
    tree: () => Promise.resolve(readTree(config.cwd)),
    read: (path) => Promise.resolve(readOne(config.cwd, path)),
    write: (path, bytes) => Promise.resolve(writeOne(config.cwd, path, bytes)),
    remove: (path) => Promise.resolve(removeOne(config.cwd, path)),
  };
  ctx.provide('files', service);
}

function readTree(cwd: string): { entries: FileEntry[]; diagnostics: Diagnostic[] } {
  const entries: FileEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  function walk(absDir: string, relDir: string): void {
    let dirents;
    try {
      dirents = readdirSync(absDir, { withFileTypes: true });
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'warning',
          'files',
          relDir || '.',
          `cannot list "${relDir || '.'}": ${errorMessage(error)}`,
        ),
      );
      return;
    }

    // Sorted, so the tree is the same on every run regardless of what
    // order the filesystem happens to hand entries back in.
    for (const dirent of [...dirents].sort((a, b) => a.name.localeCompare(b.name))) {
      if (dirent.isDirectory() && SKIPPED_DIRS.has(dirent.name)) continue;

      const relPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      const absPath = join(absDir, dirent.name);

      if (dirent.isDirectory()) {
        entries.push({ path: relPath, kind: 'dir' });
        walk(absPath, relPath);
      } else if (dirent.isFile()) {
        // A symlink (or socket, fifo, …) is neither — left out of the tree
        // entirely rather than guessed at. Nothing in this task reads
        // through one, and `read()` below draws its own containment
        // boundary independently of what `tree()` chose to list.
        const size = statSync(absPath).size;
        entries.push({ path: relPath, kind: 'file', size });
      }
    }
  }

  walk(cwd, '');
  return { entries, diagnostics };
}

function readOne(
  cwd: string,
  requestedPath: string,
): { bytes?: Uint8Array; diagnostics: Diagnostic[] } {
  const target = resolve(cwd, requestedPath);

  // Both sides realpath'd, not just the requested path — see
  // `plugins/client-assets.ts:45-79`, which this copies. A symlink sitting
  // *inside* the project (legal, and exactly what the escape test below
  // builds) walks lexical containment straight through: `escape ->
  // /etc` resolves lexically under `cwd` while actually reading `/etc`.
  // Comparing realpaths instead compares against where the bytes actually
  // come from. The project root is realpath'd too, for the same reason
  // `client-assets.ts` gives: an ordinary file two levels under a
  // perfectly normal project would otherwise stop sharing a prefix with
  // an un-realpath'd root the moment any ancestor of `cwd` itself is a
  // symlink (true of any macOS temp dir, which is how this project's own
  // tests build their fixtures).
  let realTarget: string;
  let realRoot: string;
  try {
    realTarget = realpathSync(target);
    realRoot = realpathSync(cwd);
  } catch (error) {
    // Missing on disk (including a dangling symlink) is not an escape —
    // it is the ordinary "nothing to read" case, and must read as one:
    // conflating the two sends a reader to fix permissions for what is
    // actually a typo.
    return {
      diagnostics: [
        diagnostic(
          'error',
          'files',
          requestedPath,
          `"${requestedPath}" was not found: ${errorMessage(error)}`,
        ),
      ],
    };
  }

  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'files',
          requestedPath,
          `"${requestedPath}" resolves outside the project`,
        ),
      ],
    };
  }

  let stat;
  try {
    stat = statSync(realTarget);
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'files',
          requestedPath,
          `"${requestedPath}" was not found: ${errorMessage(error)}`,
        ),
      ],
    };
  }

  if (stat.isDirectory()) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'files',
          requestedPath,
          `"${requestedPath}" is a directory, not a file`,
        ),
      ],
    };
  }

  try {
    const buffer = readFileSync(realTarget);
    return { bytes: new Uint8Array(buffer), diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'files',
          requestedPath,
          `cannot read "${requestedPath}": ${errorMessage(error)}`,
        ),
      ],
    };
  }
}

function writeOne(
  cwd: string,
  requestedPath: string,
  bytes: Uint8Array,
): { diagnostics: Diagnostic[] } {
  const target = resolve(cwd, requestedPath);
  const outside = describeIfOutside(cwd, requestedPath, target);
  if (outside) return { diagnostics: [outside] };

  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return { diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'files',
          requestedPath,
          `cannot write "${requestedPath}": ${errorMessage(error)}`,
        ),
      ],
    };
  }
}

function removeOne(cwd: string, requestedPath: string): { diagnostics: Diagnostic[] } {
  const target = resolve(cwd, requestedPath);
  const outside = describeIfOutside(cwd, requestedPath, target);
  if (outside) return { diagnostics: [outside] };

  let stat;
  try {
    stat = statSync(target);
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'files',
          requestedPath,
          `"${requestedPath}" was not found: ${errorMessage(error)}`,
        ),
      ],
    };
  }

  if (stat.isDirectory()) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'files',
          requestedPath,
          `"${requestedPath}" is a directory, not a file — remove() does not remove directories`,
        ),
      ],
    };
  }

  try {
    rmSync(target);
    return { diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'files',
          requestedPath,
          `cannot remove "${requestedPath}": ${errorMessage(error)}`,
        ),
      ],
    };
  }
}

/**
 * The write-side containment check, and why it cannot be `readOne`'s.
 * `readOne` realpaths the target itself — safe there, because a read only
 * ever succeeds against a file that already exists. Write and remove both
 * have to answer the containment question BEFORE the target necessarily
 * exists (a new file has no realpath yet; `realpathSync` would just throw
 * "not found", collapsing "outside the project" into "nothing here" for
 * every ordinary new file), so this walks up to the nearest ANCESTOR that
 * does exist and realpaths that instead.
 *
 * This has to be more than "does `cwd` itself exist" — a symlink can sit
 * anywhere along the path, not only at its own end. `sub/out/escaped.txt`
 * with `sub/out` a symlink to outside the project is exactly that: the
 * final segment doesn't exist, but its parent does, and that parent's
 * *real* path is outside the root even though its lexical path reads as
 * an ordinary project-relative one. Checking only the leaf, or only
 * `cwd`, misses this; checking the nearest existing ancestor catches it,
 * because that ancestor is the highest point the walk can still ask the
 * filesystem "where does this actually lead".
 */
function describeIfOutside(
  cwd: string,
  requestedPath: string,
  target: string,
): Diagnostic | undefined {
  const ancestor = nearestExistingAncestor(target);

  let realAncestor: string;
  let realRoot: string;
  try {
    realAncestor = realpathSync(ancestor);
    realRoot = realpathSync(cwd);
  } catch (error) {
    return diagnostic(
      'error',
      'files',
      requestedPath,
      `cannot resolve "${requestedPath}": ${errorMessage(error)}`,
    );
  }

  if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + sep)) {
    return diagnostic(
      'error',
      'files',
      requestedPath,
      `"${requestedPath}" resolves outside the project`,
    );
  }

  return undefined;
}

/**
 * Walks `path` up through its own parents until it finds one that exists,
 * `cwd` at the latest (the host never boots against a `cwd` that doesn't).
 * The `dirname(candidate) === candidate` guard is the filesystem-root
 * stop condition (`dirname('/') === '/'`) — not expected to fire given the
 * `cwd` floor above it, kept only so this can't spin forever if it ever did.
 */
function nearestExistingAncestor(path: string): string {
  let candidate = path;
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return candidate;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
