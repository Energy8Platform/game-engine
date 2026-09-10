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
import { dirname, extname, join, resolve, sep } from 'node:path';
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
// Routes below need `ctx.server`, which the host registers after this
// plugin (see index.ts) — `inject` is what makes that ordering fine: cordis
// defers `apply()` until every injected service exists, independent of
// which one was `ctx.plugin()`-ed first.
export const inject = ['server'];

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

  // Four routes over `service` above — they carry ITS diagnostics outward,
  // never invent their own containment story. `*splat` (path-to-regexp's
  // wildcard) is what makes `/api/files/*splat` match a multi-segment path
  // at all; `@cordisjs/plugin-server` decodes it exactly once — percent
  // escapes and all — before handing it to the callback as one `/`-joined
  // string, so decoding it AGAIN here would be redundant at best (nothing
  // left to decode) and wrong at worst (see the "reads a name with a
  // space, a plus, and a percent sign" test in files.test.ts).
  //
  // `req.params.splat` is not unconditionally "the path the editor meant",
  // though: the router's decode is `decodeURIComponent(capture.replace(
  // /\+/g, ' '))` — the query-string reading of `+`, applied here to a
  // path segment too. A CORRECTLY encoded `+` (`%2B`) survives it, but a
  // literal, unencoded `+` in the URL silently becomes a space first — a
  // file named `a+b.txt` requested as `/api/files/a+b.txt` looks up
  // `a b.txt` and 404s (see "a literal, unencoded plus in the URL reads as
  // a space" below). `tree()` returns raw filesystem names with `+`
  // intact, so a client building a URL from one MUST encode it — string
  // concatenation is not enough. That's Task 4's `urlFor` to get right;
  // nothing here can rescue an unencoded `+` after the router has already
  // rewritten it.

  ctx.server.get('/api/files', async (_req, res) => {
    res.json(await service.tree());
  });

  ctx.server.get('/api/files/*splat', async (req, res) => {
    const path = req.params.splat;
    const { bytes, diagnostics } = await service.read(path);
    if (!bytes) {
      res.status = statusFor(diagnostics);
      res.json({ diagnostics });
      return;
    }
    res.headers.set('content-type', contentTypeFor(path));
    res.bytes(bytes);
  });

  ctx.server.put('/api/files/*splat', async (req, res) => {
    const path = req.params.splat;

    // ponytail: base64-in-JSON, not multipart/form-data — there is no
    // multipart parser in this host and this task does not add one.
    // Fine while an edit fits in memory as a JSON string; multipart is
    // the upgrade path once uploads get big enough for that to matter.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      // Absent or unparseable body — a diagnostic below, never a throw.
      // Same shape as `POST /api/spin`'s body parsing in dev-game.ts.
      body = undefined;
    }

    const raw = body as { base64?: unknown } | null | undefined;
    const decoded = typeof raw?.base64 === 'string' ? decodeBase64Strict(raw.base64) : undefined;
    if (!decoded) {
      res.status = 400;
      res.json({
        diagnostics: [
          diagnostic(
            'error',
            'files',
            path,
            `PUT ${req.path} needs a JSON body shaped {"base64": string}`,
          ),
        ],
      });
      return;
    }

    const { diagnostics } = await service.write(path, decoded);
    res.status = statusFor(diagnostics);
    res.json({ diagnostics });
  });

  ctx.server.delete('/api/files/*splat', async (req, res) => {
    const { diagnostics } = await service.remove(req.params.splat);
    res.status = statusFor(diagnostics);
    res.json({ diagnostics });
  });
}

/**
 * The HTTP status that fits a files-service diagnostic — reading the
 * verdict the service already reached off the message it wrote, not
 * re-deciding containment or existence here. "was not found" is exactly
 * that (404); everything else the service reports (outside the project, a
 * directory where a file was wanted, a disk error underneath) is still
 * this request failing on its own terms, so it stays a 400 with the
 * diagnostic riding along — never an empty 500.
 */
function statusFor(diagnostics: Diagnostic[]): number {
  if (diagnostics.length === 0) return 200;
  return /was not found/i.test(diagnostics[0].message) ? 404 : 400;
}

/**
 * `Buffer.from(str, 'base64')` never throws — it silently decodes whatever
 * characters happen to be valid base64 and drops the rest, so a junk
 * string "succeeds" with garbage bytes instead of surfacing as a
 * diagnostic (measured directly: `Buffer.from('not really base64!!!',
 * 'base64')` returns 11 bytes of noise). Checked against the alphabet and
 * padding first, so a bad upload is refused instead of written as noise.
 */
function decodeBase64Strict(value: string): Uint8Array | undefined {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined;
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/**
 * Content-type by extension, for the handful of kinds this editor's own
 * screens actually render — a code/text view or an `<img>`. Everything
 * else answers `application/octet-stream` rather than guessing; that is a
 * true, if unhelpful, answer, unlike claiming a PNG is `text/plain`.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.spin': 'text/plain; charset=utf-8',
  '.lua': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
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
