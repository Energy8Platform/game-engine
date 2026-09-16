/**
 * The host's own view onto the project's files — the gap the read side of
 * this closed first. Everything else the host has ever done with a project
 * is RESOLVE it (composition, schema, patches): parse a handful of named
 * config files and report what they mean. Three of the IDE's five screens
 * (spec, code editor is more general than that) need the actual tree and
 * actual file contents, not a resolved summary of them — this plugin is
 * that: list, read, write, make, and remove — one entry at a time.
 */
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { Context } from 'cordis';
import {
  type Diagnostic,
  type DiagnosticsResponse,
  type FileCreateRequest,
  type FileEntry,
  type FileFailure,
  type FileMoveRequest,
  type FileTreeResponse,
  type FileWriteRequest,
  fileDiagnostic,
} from '@energy8engine/contracts';

declare module 'cordis' {
  interface Context {
    files: FilesService;
  }
  interface Events {
    /**
     * Fired once a `write()` actually lands on disk — never for a write
     * `describeRefusal` turned away. `path` is exactly the string the
     * caller passed (project-relative, the same shape `tree()` lists), so
     * a listener can decide for itself whether the path matters — the way
     * `dev-game.ts` asks whether it is a `.spin` inside its own games
     * directory, against its own config rather than a name this file
     * would have to know.
     *
     * This service does not name a payload beyond the path, and does not
     * know or care who, if anyone, is listening — see this file's own doc
     * comment on why `schema.ts` staying unknown to this file is the point.
     *
     * Also fired by `move()` for the destination.
     */
    'files/written'(payload: { path: string }): void;
    /** Fired once an entry is gone from disk — by `remove()`, or as the first half of a `move()` (then `files/written` names where it went). */
    'files/removed'(payload: { path: string }): void;
  }
}

export interface FilesService {
  /** Every entry in the project's tree, in traversal order. Never throws. */
  tree(): Promise<FileTreeResponse>;
  /** Contents of one file. `bytes` is absent when there is nothing to read. */
  read(path: string): Promise<{ bytes?: Uint8Array; diagnostics: Diagnostic[] }>;
  /** Creates or replaces a file. Missing directories are created. */
  write(path: string, bytes: Uint8Array): Promise<DiagnosticsResponse>;
  /** Makes an empty directory at a path nothing occupies yet. Does not create parents. */
  mkdir(path: string): Promise<DiagnosticsResponse>;
  /** Makes an empty file at a path nothing occupies yet. Does not create parents. */
  create(path: string): Promise<DiagnosticsResponse>;
  /**
   * Removes a file, or a directory with everything under it. Not a
   * symlink — that is a different intent with a different cost, and
   * `describeRefusal` says so in the diagnostic rather than doing
   * something surprising.
   */
  remove(path: string): Promise<DiagnosticsResponse>;
  /**
   * Renames or moves a file or directory. Never overwrites (`exists`); a
   * directory never moves into its own subtree (`into-self`); atomic — one
   * `rename(2)`.
   */
  move(from: string, to: string): Promise<DiagnosticsResponse>;
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

/**
 * Directory names no read, write, mkdir, create or remove may reach
 * through, wherever they occur. `.git` can hold a credential —
 * `.git/config` in a remote URL — and `.git/hooks/pre-commit` is a file
 * the browser could write that the developer's own shell would then run
 * at their next commit. `node_modules` is not the project, and this
 * editor never writes into it — reinstalling it is one `npm install`
 * away, but nothing here should be the reason a reinstall is needed.
 * `.e8` is the host's own scratch, not project source.
 */
const PROTECTED_DIRS = new Set(['.git', 'node_modules', '.e8']);

/**
 * Both sets are matched against a lowercased segment. This repo's own
 * platform (macOS, APFS) is case-insensitive by default, so `.GIT` and
 * `.git` are ONE directory on disk while being two different strings —
 * measured: `PUT /api/files/.GIT/hooks/pre-commit` answered 200 and put
 * the hook where git would run it, and `tree()` then listed `.GIT`
 * because the skip list did not recognise it either. On a
 * case-sensitive filesystem this costs at most a directory genuinely
 * named `NODE_MODULES` being hidden, which is not a real project.
 */
function matches(names: Set<string>, segment: string): boolean {
  return names.has(segment.toLowerCase());
}

export async function apply(ctx: Context, config: FilesConfig): Promise<void> {
  const service: FilesService = {
    tree: () => readTree(config.cwd),
    read: (path) => Promise.resolve(readOne(config.cwd, path)),
    write: (path, bytes) => {
      const result = writeOne(config.cwd, path, bytes);
      // Emitted here, at the service boundary, rather than in the PUT
      // route below — so `ctx.files.write()` called directly (a test, or
      // any future in-process caller) fires it exactly the same as the
      // browser's save button does. `diagnostics.length === 0` is
      // `writeOne`'s own success signal; nothing here re-derives it.
      if (result.diagnostics.length === 0) ctx.emit('files/written', { path });
      return Promise.resolve(result);
    },
    mkdir: (path) => Promise.resolve(mkdirOne(config.cwd, path)),
    create: (path) => Promise.resolve(createOne(config.cwd, path)),
    remove: (path) => {
      const result = removeOne(config.cwd, path);
      if (result.diagnostics.length === 0) ctx.emit('files/removed', { path });
      return Promise.resolve(result);
    },
    move: (from, to) => {
      const result = moveOne(config.cwd, from, to);
      if (result.diagnostics.length === 0) {
        ctx.emit('files/removed', { path: from });
        ctx.emit('files/written', { path: to });
      }
      return Promise.resolve(result);
    },
  };
  ctx.provide('files', service);

  // Six routes over `service` above — they carry ITS diagnostics outward,
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

    const raw = body as Partial<FileWriteRequest> | null | undefined;
    const decoded = typeof raw?.base64 === 'string' ? decodeBase64Strict(raw.base64) : undefined;
    if (!decoded) {
      res.status = 400;
      const refusal: DiagnosticsResponse = {
        diagnostics: [
          fileDiagnostic(
            'error',
            'malformed-request',
            path,
            `PUT ${req.path} needs a JSON body shaped {"base64": string}`,
          ),
        ],
      };
      res.json(refusal);
      return;
    }

    const { diagnostics } = await service.write(path, decoded);
    res.status = statusFor(diagnostics);
    res.json({ diagnostics });
  });

  ctx.server.post('/api/files/*splat', async (req, res) => {
    const path = req.params.splat;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
    const kind = (body as Partial<FileCreateRequest> | null | undefined)?.kind;
    if (kind !== 'dir' && kind !== 'file') {
      res.status = 400;
      res.json({
        diagnostics: [
          fileDiagnostic(
            'error',
            'malformed-request',
            path,
            `POST ${req.path} needs a JSON body shaped {"kind": "dir" | "file"}`,
          ),
        ],
      } satisfies DiagnosticsResponse);
      return;
    }
    const { diagnostics } = kind === 'dir' ? await service.mkdir(path) : await service.create(path);
    res.status = statusFor(diagnostics);
    res.json({ diagnostics });
  });

  ctx.server.delete('/api/files/*splat', async (req, res) => {
    const { diagnostics } = await service.remove(req.params.splat);
    res.status = statusFor(diagnostics);
    res.json({ diagnostics });
  });

  ctx.server.patch('/api/files/*splat', async (req, res) => {
    const path = req.params.splat;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
    const to = (body as Partial<FileMoveRequest> | null | undefined)?.to;
    if (typeof to !== 'string' || to === '') {
      res.status = 400;
      res.json({
        diagnostics: [
          fileDiagnostic(
            'error',
            'malformed-request',
            path,
            `PATCH ${req.path} needs a JSON body shaped {"to": string}`,
          ),
        ],
      } satisfies DiagnosticsResponse);
      return;
    }
    const { diagnostics } = await service.move(path, to);
    res.status = statusFor(diagnostics);
    res.json({ diagnostics });
  });
}

/**
 * The HTTP status that fits a files-service diagnostic — reading the
 * verdict the service already reached off the `code` it tagged, not
 * re-deciding containment or existence here. Everything except
 * `'not-found'` (outside the project, a directory where a file was
 * wanted, a disk error underneath) is still this request failing on its
 * own terms, so it stays a 400 with the diagnostic riding along — never
 * an empty 500.
 *
 * This used to switch on `/was not found/i` against the message the
 * service had written, with nothing at either end saying the prose was
 * load-bearing. This IDE translates user-facing strings; the first
 * translated message would have turned every 404 into a 400 silently.
 */
function statusFor(diagnostics: Diagnostic[]): number {
  if (diagnostics.length === 0) return 200;
  const code: FileFailure | undefined = diagnostics[0].code as FileFailure | undefined;
  return code === 'not-found' ? 404 : 400;
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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.m4a': 'audio/mp4',
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * `async` with a synchronous body on purpose: `FilesService.tree`'s own
 * doc promises it never throws, and while `tree: () => Promise.resolve(
 * readTree(cwd))` looked like that promise, it evaluated `readTree`
 * BEFORE the promise existed — so a throw in here was synchronous and a
 * caller's `ctx.files.tree().catch(…)` could not catch it. It survived
 * only because the route's handler happens to be `async`. Marking the
 * function `async` makes any future throw a rejection, which is the
 * shape the signature already claims. (The plan said `node:fs/promises`;
 * the sync `node:fs` below is what made a synchronous throw possible in
 * the first place, and the divergence is recorded rather than papered
 * over — nothing here awaits, so the promise is the whole fix.)
 */
async function readTree(cwd: string): Promise<FileTreeResponse> {
  const entries: FileEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  function walk(absDir: string, relDir: string): void {
    let dirents;
    try {
      dirents = readdirSync(absDir, { withFileTypes: true });
    } catch (error) {
      diagnostics.push(
        fileDiagnostic(
          'warning',
          'io-error',
          relDir || '.',
          `cannot list "${relDir || '.'}": ${errorMessage(error)}`,
        ),
      );
      return;
    }

    // Sorted, so the tree is the same on every run regardless of what
    // order the filesystem happens to hand entries back in.
    for (const dirent of [...dirents].sort((a, b) => a.name.localeCompare(b.name))) {
      if (dirent.isDirectory() && matches(SKIPPED_DIRS, dirent.name)) continue;

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
        //
        // Guarded the same way `readdirSync` above is, and for the same
        // reason: one entry this process cannot stat (a race with a
        // delete, a mode change under us) costs that one row and a
        // warning. Unguarded, it took the whole tree out — and took it
        // out through a signature that says it never throws.
        let size: number;
        try {
          size = statSync(absPath).size;
        } catch (error) {
          diagnostics.push(
            fileDiagnostic(
              'warning',
              'io-error',
              relPath,
              `cannot read "${relPath}": ${errorMessage(error)}`,
            ),
          );
          continue;
        }
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

  // The same refusal every write and remove goes through, rather than a
  // second containment story of its own. This used to realpath the target
  // and compare prefixes here — equivalent for a file that exists, which
  // is the only kind a read ever succeeds against, but it followed a
  // symlink at the leaf while `describeRefusal` refused one, so the file
  // read a name the tree does not even list and the rule stated below
  // `describeRefusal` was not true of all three callers.
  const refusal = describeRefusal(cwd, requestedPath, target);
  if (refusal) return { diagnostics: [refusal] };

  let stat;
  try {
    stat = statSync(target);
  } catch (error) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'not-found',
          requestedPath,
          `"${requestedPath}" was not found: ${errorMessage(error)}`,
        ),
      ],
    };
  }

  if (stat.isDirectory()) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'is-directory',
          requestedPath,
          `"${requestedPath}" is a directory, not a file`,
        ),
      ],
    };
  }

  try {
    const buffer = readFileSync(target);
    return { bytes: new Uint8Array(buffer), diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'io-error',
          requestedPath,
          `cannot read "${requestedPath}": ${errorMessage(error)}`,
        ),
      ],
    };
  }
}

function writeOne(cwd: string, requestedPath: string, bytes: Uint8Array): DiagnosticsResponse {
  const target = resolve(cwd, requestedPath);
  const refusal = describeRefusal(cwd, requestedPath, target);
  if (refusal) return { diagnostics: [refusal] };

  // `mkdirSync(…, { recursive: true })` answers with the FIRST directory
  // it had to create, or `undefined` when everything already existed —
  // which is exactly what is needed to undo it. A write that fails after
  // this used to leave its `mkdir -p` behind: a 400-character filename
  // answers ENAMETOOLONG correctly and `deep/` and `deep/dir/` are then
  // in the tree for good, since `remove()` refuses directories and the
  // browser therefore cannot clean up what the browser made.
  let created: string | undefined;
  let fd: number | undefined;
  try {
    created = mkdirSync(dirname(target), { recursive: true });
    // `O_NOFOLLOW`, and opened rather than written by name: `describeRefusal`
    // lstats the leaf and this then writes it, and between the two the leaf
    // could in principle become a symlink. Nothing in this process can lose
    // that race — the sequence is synchronous — but one open that refuses to
    // follow is smaller than a check plus a following write, and it puts the
    // rule at the syscall that enforces it. A raced link answers ELOOP,
    // reported like any other write failure; the ordinary case still gets
    // `describeRefusal`'s own plainer wording.
    fd = openSync(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    );
    writeFileSync(fd, bytes);
    return { diagnostics: [] };
  } catch (error) {
    if (created !== undefined) rmSync(created, { recursive: true, force: true });
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'io-error',
          requestedPath,
          `cannot write "${requestedPath}": ${errorMessage(error)}`,
        ),
      ],
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** `exists` when a leaf is already there (file, directory, anything); `undefined` when the path is free. */
function refuseExisting(requestedPath: string, target: string): Diagnostic | undefined {
  if (!existsSync(target)) return undefined;
  return fileDiagnostic(
    'error',
    'exists',
    requestedPath,
    `"${requestedPath}" is already there — nothing here overwrites`,
    'pick another name, or remove it first',
  );
}

/** `not-found` when the parent directory is missing: these verbs make exactly one entry, never a chain of parents. */
function refuseMissingParent(requestedPath: string, target: string): Diagnostic | undefined {
  const parent = dirname(target);
  let stat;
  try {
    stat = statSync(parent);
  } catch {
    return fileDiagnostic(
      'error',
      'not-found',
      requestedPath,
      `the directory for "${requestedPath}" does not exist`,
      'create the directory first',
    );
  }
  if (!stat.isDirectory())
    return fileDiagnostic(
      'error',
      'not-found',
      requestedPath,
      `the parent of "${requestedPath}" is not a directory`,
    );
  return undefined;
}

function mkdirOne(cwd: string, requestedPath: string): DiagnosticsResponse {
  const target = resolve(cwd, requestedPath);
  const refusal =
    describeRefusal(cwd, requestedPath, target) ??
    refuseExisting(requestedPath, target) ??
    refuseMissingParent(requestedPath, target);
  if (refusal) return { diagnostics: [refusal] };
  try {
    mkdirSync(target);
    return { diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'io-error',
          requestedPath,
          `cannot create "${requestedPath}": ${errorMessage(error)}`,
        ),
      ],
    };
  }
}

function createOne(cwd: string, requestedPath: string): DiagnosticsResponse {
  const target = resolve(cwd, requestedPath);
  const refusal =
    describeRefusal(cwd, requestedPath, target) ??
    refuseExisting(requestedPath, target) ??
    refuseMissingParent(requestedPath, target);
  if (refusal) return { diagnostics: [refusal] };
  let fd: number | undefined;
  try {
    // `O_EXCL` says "only if absent" at the syscall, the same way `writeOne`'s `O_NOFOLLOW` puts its rule at the syscall.
    fd = openSync(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    );
    return { diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'io-error',
          requestedPath,
          `cannot create "${requestedPath}": ${errorMessage(error)}`,
        ),
      ],
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function removeOne(cwd: string, requestedPath: string): DiagnosticsResponse {
  const target = resolve(cwd, requestedPath);
  const refusal = describeRefusal(cwd, requestedPath, target);
  if (refusal) return { diagnostics: [refusal] };

  // The leaf is never a symlink by the time we get here — `describeRefusal`
  // refused those — so this and `statSync` agree; spelled as the one that
  // cannot follow, since that is the rule this whole file keeps.
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'not-found',
          requestedPath,
          `"${requestedPath}" was not found: ${errorMessage(error)}`,
        ),
      ],
    };
  }

  try {
    rmSync(target, { recursive: stat.isDirectory() });
    return { diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'io-error',
          requestedPath,
          `cannot remove "${requestedPath}": ${errorMessage(error)}`,
        ),
      ],
    };
  }
}

/**
 * `describeRefusal` at both ends — the source has to exist and be
 * contained/unprotected/not-a-symlink, and the destination has to be
 * contained/unprotected too, even though it is about to be checked again
 * for `exists`/parent-missing below. `target === source` for a plain file
 * lands in `refuseExisting` as `exists` (moving a file onto itself), which
 * is fine; a directory has to be caught as `into-self` FIRST, before that
 * same check would otherwise call it `exists` too — the `stat.isDirectory()`
 * check below runs before `refuseExisting` for exactly that reason.
 */
function moveOne(cwd: string, fromPath: string, toPath: string): DiagnosticsResponse {
  const source = resolve(cwd, fromPath);
  const target = resolve(cwd, toPath);
  const refusal = describeRefusal(cwd, fromPath, source) ?? describeRefusal(cwd, toPath, target);
  if (refusal) return { diagnostics: [refusal] };
  let stat;
  try {
    stat = lstatSync(source);
  } catch (error) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'not-found',
          fromPath,
          `"${fromPath}" was not found: ${errorMessage(error)}`,
        ),
      ],
    };
  }
  if (stat.isDirectory() && (target === source || target.startsWith(source + sep))) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'into-self',
          fromPath,
          `"${fromPath}" cannot move into itself ("${toPath}")`,
        ),
      ],
    };
  }
  const blocked = refuseExisting(toPath, target) ?? refuseMissingParent(toPath, target);
  if (blocked) return { diagnostics: [blocked] };
  try {
    renameSync(source, target);
    return { diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        fileDiagnostic(
          'error',
          'io-error',
          fromPath,
          `cannot move "${fromPath}" to "${toPath}": ${errorMessage(error)}`,
        ),
      ],
    };
  }
}

/**
 * Everything write and remove refuse before they touch the disk, and why
 * it cannot be `readOne`'s check. `readOne` realpaths the target itself —
 * safe there, because a read only ever succeeds against a file that
 * already exists. Write and remove both have to answer the containment
 * question BEFORE the target necessarily exists (a new file has no
 * realpath yet; `realpathSync` would just throw "not found", collapsing
 * "outside the project" into "nothing here" for every ordinary new file),
 * so this walks up to the nearest ANCESTOR that does exist and realpaths
 * that instead.
 *
 * That walk has to be more than "does `cwd` itself exist" — a symlink can
 * sit anywhere along the path, not only at its own end. `sub/out/escaped
 * .txt` with `sub/out` a symlink to outside the project is exactly that:
 * the final segment doesn't exist, but its parent does, and that parent's
 * *real* path is outside the root even though its lexical path reads as
 * an ordinary project-relative one.
 *
 * And it has to be more than the walk, which is what the leaf check below
 * exists for. `existsSync` FOLLOWS symlinks, so a link inside the project
 * pointing at a target that does not exist is invisible to the walk: it
 * steps straight past the leaf to the parent, the parent is inside, and
 * `writeFileSync` then follows the link and creates the file wherever it
 * pointed. Measured, before this existed: `write('link.txt', 'OWNED')`
 * with `link.txt -> ../outside/pwned.txt` reported no diagnostics at all
 * and wrote `OWNED` outside the project. Every OTHER shape was already
 * covered — a live symlink out, an ancestor symlink out, a symlink to a
 * missing DIRECTORY — and `readOne` survives this one only by accident,
 * because it realpaths the target and a dangling link fails that first.
 *
 * So the rule here is the blunt one: this service does not follow a
 * symlink at the leaf, in any of its three directions — `readOne` comes
 * through here too. Writing through one would change a file the
 * project's own tree does not even list (`readTree` lists neither
 * symlinks nor what they point at), reading through one would hand back
 * a file under a name nothing on screen shows, and removing through one
 * would delete something the person never named.
 *
 * What no check here can see: a HARDLINK. A second name for a file
 * outside the project is, to `lstat`, an ordinary regular file, and its
 * realpath is inside — so a pre-placed one is written straight through.
 * Nothing lstat-based will ever catch that, and this API cannot create
 * one, so it takes someone who already has write access to the project
 * directory. Recorded rather than guarded: the leaf check is not the
 * whole story, and a later reader should not think it is.
 */
function describeRefusal(
  cwd: string,
  requestedPath: string,
  target: string,
): Diagnostic | undefined {
  // The project directory itself is inside itself and inside no protected
  // directory, so every check below passes it — and `remove('.')` then
  // `rmSync`-ed the whole project (measured: `DELETE /api/files/.`,
  // `/game/..` and `/%2E` all answered 200). Checked on the spelled path
  // before any realpath work, since `resolve` has already collapsed the
  // `.` and `..` spellings into the one string this compares against.
  if (target === resolve(cwd)) {
    return fileDiagnostic(
      'error',
      'protected-path',
      requestedPath,
      'the project directory itself is not an entry this editor changes',
    );
  }

  const ancestor = nearestExistingAncestor(target);

  let realAncestor: string;
  let realRoot: string;
  try {
    realAncestor = realpathSync(ancestor);
    realRoot = realpathSync(cwd);
  } catch (error) {
    return fileDiagnostic(
      'error',
      'io-error',
      requestedPath,
      `cannot resolve "${requestedPath}": ${errorMessage(error)}`,
    );
  }

  if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + sep)) {
    return fileDiagnostic(
      'error',
      'outside-project',
      requestedPath,
      `"${requestedPath}" resolves outside the project`,
    );
  }

  // Two paths, because either alone has a hole. The SPELLED path
  // (`resolve` has already collapsed its `..`) catches `.git/hooks/x`
  // before any of it exists — which is when a plant would happen. The
  // LANDED path — where the nearest existing ancestor really is, after
  // realpath — catches the form the spelled one cannot see at all: a
  // symlink `hooksdir -> <project>/.git/hooks`, whose every spelled
  // segment is innocent and whose realpath is not. That one was measured
  // going through with no diagnostics at all, and the leaf-symlink check
  // below does not reach it, because the symlink is the ancestor and not
  // the leaf.
  const protectedSegment = [
    ...relative(cwd, target).split(sep),
    ...relative(realRoot, realAncestor).split(sep),
  ].find((segment) => matches(PROTECTED_DIRS, segment));
  if (protectedSegment !== undefined) {
    return fileDiagnostic(
      'error',
      'protected-path',
      requestedPath,
      `"${requestedPath}" is inside "${protectedSegment}", which this editor does not change`,
    );
  }

  // `lstatSync`, so this sees the link and not what it points at. A leaf
  // that isn't there yet is the ordinary new-file case and throws here —
  // nothing to refuse.
  let leaf;
  try {
    leaf = lstatSync(target);
  } catch {
    return undefined;
  }
  if (leaf.isSymbolicLink()) {
    return fileDiagnostic(
      'error',
      'is-symlink',
      requestedPath,
      `"${requestedPath}" is a symlink, and this editor changes only files it lists`,
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
