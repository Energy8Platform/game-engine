# Explorer Grows Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Explorer can create, rename, move (by drag), and delete files and folders, accept files dropped from the OS onto a folder, and open images, audio and video in native viewers — with every verb refused by the host as a diagnostic, never a lie in the tree.

**Architecture:** The host's `files` service grows `mkdir`, `create`, `move` and a recursive directory `remove`, behind `POST`/`PATCH` on the existing `/api/files/*` prefix, all guarded by the one `describeRefusal` (now protecting `.git`, `node_modules`, `.e8`). The client's `files` service wraps them. A new `viewers` contribution (`ctx.viewers.register({ id, match, component })`) decides which component opens a path; `viewers-media` registers image/audio/video. `Explorer.tsx` gains header buttons, inline inputs, a right-click menu, a confirm row for folders, and HTML5 drag-and-drop (internal move, OS drop = upload into folder).

**Tech Stack:** cordis 4.0.0-rc.8, `@cordisjs/plugin-server`, node:fs, React 18, vitest + @testing-library/react + user-event, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-16-explorer-grows-up-design.md`

## Global Constraints

- **A refusal is data.** Every host refusal is a `fileDiagnostic` with a `FileFailure` code; `not-found` → 404, everything else → 400; the tree is re-read only after a response with zero diagnostics ("show what the host confirmed").
- **`describeRefusal` is the one containment check** for every writing verb (`write`, `remove`, `mkdir`, `create`, `move` — both ends of a move). `PROTECTED_DIRS = {.git, node_modules, .e8}` (lower-cased match, as today). No verb ever overwrites: `move` onto an existing path and `mkdir`/`create` on an existing path are `exists`.
- **`move` is `renameSync`** — atomic, no copy; `into-self` is checked before it. After success: `ctx.emit('files/removed', { path: from })` then `ctx.emit('files/written', { path: to })`.
- **Viewers before the editor**: `openPath` asks `ctx.viewers.pick(path, entry)` first, then `EDITABLE_EXTENSIONS` → `EditorDocument`, else `ViewerDocument` (text/binary). The LAST registered matching viewer wins; same `id` replaces with a warning diagnostic (`plugin: 'viewers'`), as `slots` does.
- **Client-side name validation before any request**: an empty name, a name containing `/`, or `.`/`..` is refused with a `files`/`malformed-request` diagnostic in the action row.
- Copy is English throughout (`DESIGN.md`). Nothing outside `Monaco.tsx`'s `load()` evaluates Monaco. Do not stage anything under `packages/*`. `engine/examples/first-slot/concept.png` is untracked and not ours.
- Per task: `npm test --workspace @energy8engine/<pkg>` for each touched package (`contracts`, `ide-host`, `ide-client`), `npm run typecheck --workspace …` for `ide-host`/`ide-client`, `npx prettier --check <changed files>` from the repo root. Commit messages: imperative subject, trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Playwright (Task 7 only): run ALONE from `engine/apps/web`; `git branch --show-current` before and after; afterwards `pgrep -fl e8-server | grep -v pantheon` prints nothing of ours and `ls engine/examples` prints exactly `first-slot probe-plugin workspace`.

---

## File map

| File | Responsibility |
|---|---|
| `engine/core/contracts/src/files.ts` (modify) | `FileFailure += 'exists' \| 'into-self'`; request shapes `FileCreateRequest { kind }`, `FileMoveRequest { to }`. |
| `engine/ide/host/src/plugins/files.ts` (modify) | `mkdir`, `create`, `move`, recursive dir `remove`, protected dirs, mime, routes `POST`/`PATCH`, `files/removed` event. |
| `engine/ide/host/tests/files.test.ts` (modify) | Host tests for the above. |
| `engine/ide/client/src/plugins/files.ts` (modify) | `mkdir`, `create`, `move` wrappers. |
| `engine/ide/client/tests/files.test.ts` (modify) | Wrapper tests. |
| `engine/ide/client/src/plugins/viewers.ts` (new) | The `viewers` contribution. |
| `engine/ide/client/src/plugins/viewers-media.ts` (new) | `image`, `audio`, `video` viewers; owns `IMAGE_EXTENSIONS`. |
| `engine/ide/client/src/shell/ViewerDocument.tsx` (modify) | Loses image handling; text/binary only. |
| `engine/ide/client/src/shell/Explorer.tsx` (modify) | `openPath` via viewers; create/rename/delete-folder/menu; DnD. |
| `engine/ide/client/src/shell/ExplorerMenu.tsx` (new) | The right-click menu component. |
| `engine/ide/client/src/context.ts`, `src/index.ts` (modify) | Compose `viewers` (after `shell`), `viewersMedia` (last); exports. |
| `engine/ide/client/src/styles.css` (modify) | Menu, inline input, drop-target, header buttons. |
| `engine/ide/client/tests/{viewers,viewers-media,explorer,explorer-dnd}.test.tsx` | Client tests. |
| `engine/apps/web/tests/e2e/explorer.spec.ts` (new) | Browser proof. |

---

### Task 1: Host — protected dirs, mime, folder removal, `mkdir`, `create`, `POST`

**Files:**
- Modify: `engine/core/contracts/src/files.ts` (`FileFailure`, `FileCreateRequest`, `FileMoveRequest`)
- Modify: `engine/ide/host/src/plugins/files.ts`
- Test: `engine/ide/host/tests/files.test.ts`, `engine/core/contracts/tests/*` (only if a contracts test enumerates `FileFailure` — check with `grep -rn "malformed-request" engine/core/contracts/tests`)

**Interfaces:**
- Produces (host `FilesService`):
  ```ts
  mkdir(path: string): Promise<DiagnosticsResponse>;
  create(path: string): Promise<DiagnosticsResponse>;   // empty file, refuses an existing path
  remove(path: string): Promise<DiagnosticsResponse>;   // now removes a directory recursively
  ```
  `POST /api/files/*splat` with body `{ kind: 'dir' | 'file' }` → `mkdir`/`create`.
- Contracts:
  ```ts
  export type FileFailure = 'not-found' | 'outside-project' | 'protected-path' | 'is-symlink' | 'is-directory' | 'io-error' | 'malformed-request' | 'exists' | 'into-self';
  export interface FileCreateRequest { kind: 'dir' | 'file' }
  export interface FileMoveRequest { to: string }
  ```

- [ ] **Step 1: Contracts**

In `engine/core/contracts/src/files.ts`, extend the union and add, next to `FileWriteRequest`:

```ts
/** `POST /api/files/<path>` — make an empty directory or an empty file at a path nothing occupies yet. */
export interface FileCreateRequest {
  kind: 'dir' | 'file';
}

/** `PATCH /api/files/<path>` — move (rename) the entry at `<path>` to `to`, another project-relative path nothing occupies yet. */
export interface FileMoveRequest {
  to: string;
}
```

and add `| 'exists' | 'into-self'` to `FileFailure` with a one-line doc each: `exists` — "the destination (or the path to create) is already there; nothing here overwrites"; `into-self` — "a directory cannot move into its own subtree". Run `npm test --workspace @energy8engine/contracts` — if a test enumerates the union, extend it.

- [ ] **Step 2: Write the failing host tests**

Append to `engine/ide/host/tests/files.test.ts` (reuse `fixture`, `hostFor`, `startHost`, `bytes`; note the `plain` fixture holds `e8.yml`, `game/spec.json`, `game/script.spin`):

```ts
describe('files service — mkdir and create', () => {
  it('mkdir makes a directory the tree then lists', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.mkdir('assets');
    expect(diagnostics).toEqual([]);
    const { entries } = await ctx.files.tree();
    expect(entries).toContainEqual({ path: 'assets', kind: 'dir' });
  });

  it('mkdir refuses a path that is already there, file or directory', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.mkdir('game')).diagnostics[0]).toMatchObject({ code: 'exists' });
    expect((await ctx.files.mkdir('e8.yml')).diagnostics[0]).toMatchObject({ code: 'exists' });
  });

  it('mkdir does not create parents', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.mkdir('a/b/c');
    expect(diagnostics[0]).toMatchObject({ code: 'not-found' });
    expect((await ctx.files.tree()).entries.some((e) => e.path === 'a')).toBe(false);
  });

  it('create makes an empty file and refuses to make it twice', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.create('game/notes.txt')).diagnostics).toEqual([]);
    const { bytes: read } = await ctx.files.read('game/notes.txt');
    expect(read).toEqual(new Uint8Array());
    expect((await ctx.files.create('game/notes.txt')).diagnostics[0]).toMatchObject({ code: 'exists' });
  });

  it('create does not create parents either', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.create('nope/x.txt')).diagnostics[0]).toMatchObject({ code: 'not-found' });
  });

  it('both refuse to climb out, and both refuse the protected directories', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.mkdir('../out')).diagnostics[0]).toMatchObject({ code: 'outside-project' });
    for (const p of ['.git/x', 'node_modules/x', '.e8/x']) {
      expect((await ctx.files.mkdir(p)).diagnostics[0], p).toMatchObject({ code: 'protected-path' });
      expect((await ctx.files.create(p)).diagnostics[0], p).toMatchObject({ code: 'protected-path' });
    }
  });
});

describe('files service — remove, now directories too', () => {
  it('removes a directory and everything under it', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.remove('game');
    expect(diagnostics).toEqual([]);
    const { entries } = await ctx.files.tree();
    expect(entries.some((e) => e.path.startsWith('game'))).toBe(false);
  });

  it('still refuses node_modules and .e8, like .git', async () => {
    const dir = fixture('plain');
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    mkdirSync(join(dir, '.e8'), { recursive: true });
    const ctx = await hostFor(dir);
    expect((await ctx.files.remove('node_modules/x')).diagnostics[0]).toMatchObject({ code: 'protected-path' });
    expect((await ctx.files.remove('.e8')).diagnostics[0]).toMatchObject({ code: 'protected-path' });
    expect((await ctx.files.write('node_modules/x/y.txt', bytes('a'))).diagnostics[0]).toMatchObject({ code: 'protected-path' });
  });
});

describe('files routes — POST', () => {
  it('POST {kind:"dir"} makes a directory, {kind:"file"} an empty file', async () => {
    const host = await startHost(fixture('plain'));
    const post = (path: string, body: unknown) =>
      fetch(`${host.url}/api/files/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post('assets', { kind: 'dir' })).status).toBe(200);
    expect((await post('assets/readme.txt', { kind: 'file' })).status).toBe(200);
    const tree = (await (await fetch(`${host.url}/api/files`)).json()) as { entries: { path: string; kind: string }[] };
    expect(tree.entries).toContainEqual({ path: 'assets', kind: 'dir' });
    expect(tree.entries).toContainEqual({ path: 'assets/readme.txt', kind: 'file', size: 0 });
  });

  it('POST without a usable body is a 400 malformed-request; an existing path is a 400 exists', async () => {
    const host = await startHost(fixture('plain'));
    const bad = await fetch(`${host.url}/api/files/x`, { method: 'POST', body: 'nope' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { diagnostics: { code: string }[] }).diagnostics[0].code).toBe('malformed-request');
    const dup = await fetch(`${host.url}/api/files/game`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'dir' }),
    });
    expect(dup.status).toBe(400);
  });

  it('serves video with a video mime', async () => {
    const dir = fixture('plain');
    writeFileSync(join(dir, 'clip.mp4'), bytes('not really'));
    const host = await startHost(dir);
    const res = await fetch(`${host.url}/api/files/clip.mp4`);
    expect(res.headers.get('content-type')).toBe('video/mp4');
  });
});
```

Add `mkdirSync`, `writeFileSync`, `join` to the test file's `node:fs`/`node:path` imports if missing.

- [ ] **Step 3: Run them to verify they fail**

Run: `cd engine/ide/host && npx vitest run tests/files.test.ts`
Expected: the new tests FAIL (`ctx.files.mkdir is not a function`, `is-directory` on directory remove, 404 on `POST`, `application/octet-stream` for `.mp4`).

- [ ] **Step 4: Implement**

In `engine/ide/host/src/plugins/files.ts`:

1. `PROTECTED_DIRS = new Set(['.git', 'node_modules', '.e8'])` — update its doc comment: `.git` can hold a credential, `node_modules` is not the project and this editor never writes into it, `.e8` is the host's own scratch.
2. `CONTENT_TYPES` += `'.mp4': 'video/mp4'`, `'.webm': 'video/webm'`, `'.ogv': 'video/ogg'`, `'.m4a': 'audio/mp4'`.
3. `FilesService` interface gains `mkdir(path)`, `create(path)`; `remove`'s doc changes to "Removes a file, or a directory with everything under it. Not a symlink."
4. New functions, next to `writeOne`:

```ts
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
    return fileDiagnostic('error', 'not-found', requestedPath, `the parent of "${requestedPath}" is not a directory`);
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
    return { diagnostics: [fileDiagnostic('error', 'io-error', requestedPath, `cannot create "${requestedPath}": ${errorMessage(error)}`)] };
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
    fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW);
    return { diagnostics: [] };
  } catch (error) {
    return { diagnostics: [fileDiagnostic('error', 'io-error', requestedPath, `cannot create "${requestedPath}": ${errorMessage(error)}`)] };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
```

5. `removeOne`: replace the `is-directory` refusal with recursive removal — the `try` becomes `rmSync(target, { recursive: stat.isDirectory() })`. Delete the "does not remove directories" wording; update the module doc's "one file at a time" phrase.
6. `service` gains `mkdir: (path) => Promise.resolve(mkdirOne(config.cwd, path))`, `create: (path) => Promise.resolve(createOne(config.cwd, path))`.
7. Route, after the `PUT`:

```ts
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
        diagnostics: [fileDiagnostic('error', 'malformed-request', path, `POST ${req.path} needs a JSON body shaped {"kind": "dir" | "file"}`)],
      } satisfies DiagnosticsResponse);
      return;
    }
    const { diagnostics } = kind === 'dir' ? await service.mkdir(path) : await service.create(path);
    res.status = statusFor(diagnostics);
    res.json({ diagnostics });
  });
```

Import `FileCreateRequest` from contracts. Update the "Four routes" comment to "Six routes" once Task 2 adds `PATCH` (say "five" now).

- [ ] **Step 5: Run, typecheck, prettier, commit**

Run: `cd engine/ide/host && npx vitest run tests/files.test.ts && npm test && npm run typecheck && cd ../../.. && npm test --workspace @energy8engine/contracts && npx prettier --check engine/ide/host/src/plugins/files.ts engine/ide/host/tests/files.test.ts engine/core/contracts/src/files.ts`
Expected: all PASS. Existing tests that asserted `is-directory` on `remove('game')` or a directory's "no delete" must be updated to the new behaviour (list them in the report).

```bash
git add engine/core/contracts/src/files.ts engine/ide/host/src/plugins/files.ts engine/ide/host/tests/files.test.ts
git commit -m "Let the host make directories and empty files, remove directories, and protect node_modules and .e8

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Host — `move`, the `files/removed` event, `PATCH`

**Files:**
- Modify: `engine/ide/host/src/plugins/files.ts`
- Test: `engine/ide/host/tests/files.test.ts`

**Interfaces:**
- Produces: `move(from: string, to: string): Promise<DiagnosticsResponse>`; `PATCH /api/files/*splat` body `{ to }`; event `'files/removed'(payload: { path: string })`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('files service — move', () => {
  it('moves a file, and the tree and the disk agree', async () => {
    const dir = fixture('plain');
    mkdirSync(join(dir, 'assets'));
    const ctx = await hostFor(dir);
    const { diagnostics } = await ctx.files.move('game/spec.json', 'assets/spec.json');
    expect(diagnostics).toEqual([]);
    expect(existsSync(join(dir, 'assets', 'spec.json'))).toBe(true);
    expect(existsSync(join(dir, 'game', 'spec.json'))).toBe(false);
  });

  it('renames within the same directory', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game/spec.json', 'game/spec2.json')).diagnostics).toEqual([]);
    const { entries } = await ctx.files.tree();
    expect(entries.map((e) => e.path)).toContain('game/spec2.json');
    expect(entries.map((e) => e.path)).not.toContain('game/spec.json');
  });

  it('moves a directory with its contents', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game', 'maths')).diagnostics).toEqual([]);
    const { entries } = await ctx.files.tree();
    expect(entries.map((e) => e.path)).toEqual(expect.arrayContaining(['maths', 'maths/spec.json', 'maths/script.spin']));
  });

  it('never overwrites: an occupied destination is exists', async () => {
    const ctx = await hostFor(fixture('plain'));
    const { diagnostics } = await ctx.files.move('game/spec.json', 'e8.yml');
    expect(diagnostics[0]).toMatchObject({ code: 'exists' });
    expect((await ctx.files.read('e8.yml')).bytes?.length).toBeGreaterThan(0);
  });

  it('a directory cannot move into itself', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game', 'game/inner')).diagnostics[0]).toMatchObject({ code: 'into-self' });
    expect((await ctx.files.move('game', 'game')).diagnostics[0]).toMatchObject({ code: 'into-self' });
  });

  it('a missing source is not-found; a missing destination directory is not-found', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game/nope.json', 'x.json')).diagnostics[0]).toMatchObject({ code: 'not-found' });
    expect((await ctx.files.move('game/spec.json', 'nowhere/spec.json')).diagnostics[0]).toMatchObject({ code: 'not-found' });
  });

  it('both ends are contained and protected', async () => {
    const ctx = await hostFor(fixture('plain'));
    expect((await ctx.files.move('game/spec.json', '../spec.json')).diagnostics[0]).toMatchObject({ code: 'outside-project' });
    expect((await ctx.files.move('game/spec.json', 'node_modules/spec.json')).diagnostics[0]).toMatchObject({ code: 'protected-path' });
    expect((await ctx.files.move('.git', 'git')).diagnostics[0]).toMatchObject({ code: 'protected-path' });
  });

  it('refuses a symlink at the source leaf', async () => {
    const dir = fixture('plain');
    symlinkSync(join(dir, 'e8.yml'), join(dir, 'alias.yml'));
    const ctx = await hostFor(dir);
    expect((await ctx.files.move('alias.yml', 'other.yml')).diagnostics[0]).toMatchObject({ code: 'is-symlink' });
  });

  it('emits files/removed for the old path and files/written for the new one, in that order', async () => {
    const ctx = await hostFor(fixture('plain'));
    const seen: string[] = [];
    ctx.on('files/removed', ({ path }) => seen.push(`removed:${path}`));
    ctx.on('files/written', ({ path }) => seen.push(`written:${path}`));
    await ctx.files.move('game/script.spin', 'game/main.spin');
    expect(seen).toEqual(['removed:game/script.spin', 'written:game/main.spin']);
  });

  it('remove emits files/removed too, and a refused move emits nothing', async () => {
    const ctx = await hostFor(fixture('plain'));
    const seen: string[] = [];
    ctx.on('files/removed', ({ path }) => seen.push(path));
    await ctx.files.remove('game/spec.json');
    await ctx.files.move('game/script.spin', 'e8.yml');
    expect(seen).toEqual(['game/spec.json']);
  });
});

describe('files routes — PATCH', () => {
  it('PATCH {to} moves; a body without to is malformed-request', async () => {
    const host = await startHost(fixture('plain'));
    const ok = await fetch(`${host.url}/api/files/game/spec.json`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'game/spec2.json' }),
    });
    expect(ok.status).toBe(200);
    const bad = await fetch(`${host.url}/api/files/game/spec2.json`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${host.url}/api/files/game/nope.json`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'x.json' }),
    });
    expect(missing.status).toBe(404);
  });
});
```

Add `existsSync`, `symlinkSync` to the imports as needed.

- [ ] **Step 2: Run to verify they fail**

Run: `cd engine/ide/host && npx vitest run tests/files.test.ts` — expected: `ctx.files.move is not a function`, `PATCH` 404.

- [ ] **Step 3: Implement**

In `files.ts`:

1. `Events` gains:
```ts
    /** Fired once an entry is gone from disk — by `remove()`, or as the first half of a `move()` (then `files/written` names where it went). */
    'files/removed'(payload: { path: string }): void;
```
2. `FilesService` gains `move(from: string, to: string): Promise<DiagnosticsResponse>` with doc: "Renames or moves a file or directory. Never overwrites (`exists`); a directory never moves into its own subtree (`into-self`); atomic — one `rename(2)`."
3. New function:

```ts
function moveOne(cwd: string, fromPath: string, toPath: string): DiagnosticsResponse {
  const source = resolve(cwd, fromPath);
  const target = resolve(cwd, toPath);
  const refusal = describeRefusal(cwd, fromPath, source) ?? describeRefusal(cwd, toPath, target);
  if (refusal) return { diagnostics: [refusal] };
  let stat;
  try {
    stat = lstatSync(source);
  } catch (error) {
    return { diagnostics: [fileDiagnostic('error', 'not-found', fromPath, `"${fromPath}" was not found: ${errorMessage(error)}`)] };
  }
  if (stat.isDirectory() && (target === source || target.startsWith(source + sep))) {
    return { diagnostics: [fileDiagnostic('error', 'into-self', fromPath, `"${fromPath}" cannot move into itself ("${toPath}")`)] };
  }
  const blocked = refuseExisting(toPath, target) ?? refuseMissingParent(toPath, target);
  if (blocked) return { diagnostics: [blocked] };
  try {
    renameSync(source, target);
    return { diagnostics: [] };
  } catch (error) {
    return { diagnostics: [fileDiagnostic('error', 'io-error', fromPath, `cannot move "${fromPath}" to "${toPath}": ${errorMessage(error)}`)] };
  }
}
```

Import `renameSync`. Note `target === source` is caught by `refuseExisting` for files too (moving a file onto itself is `exists`) — fine; the directory case must be `into-self` first, which the order above guarantees.

4. Service:
```ts
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
```
Update the `files/written` doc: "also fired by `move()` for the destination".

5. Route:
```ts
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
      res.json({ diagnostics: [fileDiagnostic('error', 'malformed-request', path, `PATCH ${req.path} needs a JSON body shaped {"to": string}`)] } satisfies DiagnosticsResponse);
      return;
    }
    const { diagnostics } = await service.move(path, to);
    res.status = statusFor(diagnostics);
    res.json({ diagnostics });
  });
```
If `ctx.server.patch` does not exist on `@cordisjs/plugin-server` (check `grep -n "patch" node_modules/@cordisjs/plugin-server/lib/*.d.ts`), use the generic `ctx.server.route('PATCH', …)`/`ctx.server.on(...)` form the package offers — report which.

- [ ] **Step 4: Run, typecheck, prettier, commit**

Run: `cd engine/ide/host && npm test && npm run typecheck && cd ../../.. && npx prettier --check engine/ide/host/src/plugins/files.ts engine/ide/host/tests/files.test.ts`

```bash
git add engine/ide/host/src/plugins/files.ts engine/ide/host/tests/files.test.ts
git commit -m "Move a file or a directory with one rename, and say what left and what arrived

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Client `files` wrappers

**Files:**
- Modify: `engine/ide/client/src/plugins/files.ts`
- Test: `engine/ide/client/tests/files.test.ts`

**Interfaces:**
- Produces on the client `FilesService`: `mkdir(path)`, `create(path)`, `move(from, to)` — each `Promise<DiagnosticsResponse>`.

- [ ] **Step 1: Failing tests** — read the existing tests in `tests/files.test.ts` for how `fetchFn` is faked (a recording function returning `Response`s), then add:

```ts
describe('files — mkdir, create, move', () => {
  it('mkdir POSTs {kind:"dir"} to the encoded path', async () => {
    const { ctx, calls } = await harness();
    const { diagnostics } = await ctx.files.mkdir('art/new dir');
    expect(diagnostics).toEqual([]);
    expect(calls[0]).toMatchObject({ url: '/api/files/art/new%20dir', method: 'POST', body: { kind: 'dir' } });
  });
  it('create POSTs {kind:"file"}', async () => {
    const { ctx, calls } = await harness();
    await ctx.files.create('art/a+b.txt');
    expect(calls[0]).toMatchObject({ url: '/api/files/art/a%2Bb.txt', method: 'POST', body: { kind: 'file' } });
  });
  it('move PATCHes {to} — the destination unencoded in the body, the source encoded in the URL', async () => {
    const { ctx, calls } = await harness();
    await ctx.files.move('game/spec.json', 'assets/spec 2.json');
    expect(calls[0]).toMatchObject({ url: '/api/files/game/spec.json', method: 'PATCH', body: { to: 'assets/spec 2.json' } });
  });
  it('a host refusal comes back as its diagnostics; a network failure as one of our own', async () => {
    const refused = await harness({ status: 400, diagnostics: [d('no')] });
    expect((await refused.ctx.files.move('a', 'b')).diagnostics[0].message).toBe('no');
    const down = await harness({ throws: true });
    expect((await down.ctx.files.mkdir('a')).diagnostics[0].plugin).toBe('files');
  });
});
```

Build `harness(answer?)` in that file the way its existing helper does (a `fetchFn` that records `{ url, method, body: JSON.parse(init.body) }` and answers `{ diagnostics }` with the given status, or throws when `throws`). If the file already has such a helper under another name, use it and adapt the assertions to its recording shape — the four behaviours above are the requirement.

- [ ] **Step 2: Verify RED** — `cd engine/ide/client && npx vitest run tests/files.test.ts`.

- [ ] **Step 3: Implement** — in `src/plugins/files.ts`, next to `write`/`remove`:

```ts
  async function post(path: string, body: FileCreateRequest): ReturnType<FilesService['write']> {
    let res: Response;
    try {
      res = await fetchFn(urlFor(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      return { diagnostics: [ownDiagnostic(path, describeError(error))] };
    }
    return { diagnostics: await diagnosticsFromBody(res, path) };
  }
  const mkdir = (path: string) => post(path, { kind: 'dir' });
  const create = (path: string) => post(path, { kind: 'file' });

  async function move(from: string, to: string): ReturnType<FilesService['write']> {
    let res: Response;
    try {
      res = await fetchFn(urlFor(from), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to } satisfies FileMoveRequest),
      });
    } catch (error) {
      return { diagnostics: [ownDiagnostic(from, describeError(error))] };
    }
    return { diagnostics: await diagnosticsFromBody(res, from) };
  }

  ctx.provide('files', { tree, read, write, remove, mkdir, create, move, urlFor });
```

Extend the client `FilesService` interface with the three methods (doc: one line each), import the two request types from contracts.

- [ ] **Step 4: GREEN, typecheck, prettier, commit**

`cd engine/ide/client && npm test && npm run typecheck`; prettier; then:

```bash
git add engine/ide/client/src/plugins/files.ts engine/ide/client/tests/files.test.ts
git commit -m "Give the client files service mkdir, create and move

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The `viewers` contribution, media viewers, `openPath` through it

**Files:**
- Create: `engine/ide/client/src/plugins/viewers.ts`, `engine/ide/client/src/plugins/viewers-media.tsx`
- Modify: `engine/ide/client/src/shell/ViewerDocument.tsx` (drop image handling), `engine/ide/client/src/shell/Explorer.tsx:39-73` (`openPath`), `engine/ide/client/src/context.ts`, `engine/ide/client/src/index.ts`
- Test: `engine/ide/client/tests/viewers.test.tsx` (new), `tests/explorer.test.tsx` (the `.png` test keeps passing; add `.mp3`/`.mp4`), `tests/viewer-document.test.tsx` (image cases move to viewers tests)

**Interfaces:**
```ts
// viewers.ts
export interface ViewerProps { ctx: Context; path: string; entry?: FileEntry }
export interface ViewerDef { id: string; match(path: string, entry?: FileEntry): boolean; component: ComponentType<ViewerProps> }
export interface ViewersService {
  register(def: ViewerDef): () => void;      // same id replaces + warning diagnostic plugin 'viewers'; return retracts
  pick(path: string, entry?: FileEntry): ViewerDef | undefined;   // LAST registered match wins
  list(): readonly ViewerDef[];
  subscribe(listener: () => void): () => void;
}
export const name = 'viewers'; export function apply(ctx: Context): void;
// viewers-media.tsx
export const IMAGE_EXTENSIONS: ReadonlySet<string>;  // '.svg .png .jpg .jpeg .gif .webp .ico'
export const AUDIO_EXTENSIONS: ReadonlySet<string>;  // '.mp3 .wav .ogg .m4a'
export const VIDEO_EXTENSIONS: ReadonlySet<string>;  // '.mp4 .webm .ogv'
export const name = 'viewers-media'; export const inject = ['viewers', 'files']; export function apply(ctx: Context): void;
```
`extensionOf(path)` stays exported from `ViewerDocument.tsx` (it is imported by `Explorer.tsx`); `viewers-media` imports it from there.

- [ ] **Step 1: Failing tests** — `tests/viewers.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import * as viewers from '../src/plugins/viewers';
import * as media from '../src/plugins/viewers-media';

function fakeConnection() {
  const reported: Diagnostic[] = [];
  return { reported, report: (d: Diagnostic) => { reported.push(d); return () => {}; } };
}

async function boot(withMedia = false) {
  const ctx = new Context();
  const connection = fakeConnection();
  ctx.provide('connection', connection);
  ctx.provide('files', { urlFor: (p: string) => `/api/files/${p}` });
  await ctx.plugin(viewers);
  if (withMedia) await ctx.plugin(media);
  return { ctx, connection };
}

const Nothing = () => null;

describe('viewers', () => {
  it('pick returns the last registered viewer whose match says yes', async () => {
    const { ctx } = await boot();
    ctx.viewers.register({ id: 'a', match: (p) => p.endsWith('.x'), component: Nothing });
    ctx.viewers.register({ id: 'b', match: (p) => p.endsWith('.x'), component: Nothing });
    expect(ctx.viewers.pick('f.x')?.id).toBe('b');
    expect(ctx.viewers.pick('f.y')).toBeUndefined();
  });
  it('the same id again replaces, with a warning; a retract removes', async () => {
    const { ctx, connection } = await boot();
    const off = ctx.viewers.register({ id: 'a', match: () => true, component: Nothing });
    ctx.viewers.register({ id: 'a', match: () => false, component: Nothing });
    expect(connection.reported[0]).toMatchObject({ severity: 'warning', plugin: 'viewers', where: 'a' });
    expect(ctx.viewers.pick('f')).toBeUndefined();
    off(); // stale
    expect(ctx.viewers.list()).toHaveLength(1);
  });
  it('match sees the entry', async () => {
    const { ctx } = await boot();
    ctx.viewers.register({ id: 'big', match: (_p, e) => (e?.size ?? 0) > 10, component: Nothing });
    expect(ctx.viewers.pick('f', { path: 'f', kind: 'file', size: 11 })?.id).toBe('big');
    expect(ctx.viewers.pick('f', { path: 'f', kind: 'file', size: 1 })).toBeUndefined();
  });
});

describe('viewers-media', () => {
  it('registers image, audio and video, matched by extension, case-insensitively', async () => {
    const { ctx } = await boot(true);
    expect(ctx.viewers.pick('a/logo.PNG')?.id).toBe('image');
    expect(ctx.viewers.pick('a/win.mp3')?.id).toBe('audio');
    expect(ctx.viewers.pick('a/intro.webm')?.id).toBe('video');
    expect(ctx.viewers.pick('a/script.spin')).toBeUndefined();
  });
  it('the three components render native elements pointed at files.urlFor', async () => {
    const { ctx } = await boot(true);
    for (const [path, role, tag] of [
      ['art/logo.png', 'img', 'IMG'],
      ['sfx/win.mp3', null, 'AUDIO'],
      ['clips/intro.mp4', null, 'VIDEO'],
    ] as const) {
      const Def = ctx.viewers.pick(path)!.component;
      const { container, unmount } = render(<Def ctx={ctx} path={path} />);
      const el = role ? screen.getByRole(role) : container.querySelector(tag)!;
      expect(el.tagName).toBe(tag);
      expect(el.getAttribute('src')).toBe(`/api/files/${path}`);
      if (tag !== 'IMG') expect(el.hasAttribute('controls')).toBe(true);
      unmount();
    }
  });
});
```

And in `tests/explorer.test.tsx`, add next to "a .spin opens in the editor and a .png in the viewer":

```tsx
  it('an .mp3 opens in an audio player and an .mp4 in a video player', async () => {
    const ctx = await harness(tree(['sfx/win.mp3', 'clips/intro.mp4']));
    const { container } = render(<><Explorer ctx={ctx} /><Shell ctx={ctx} /></>);
    await userEvent.click(await screen.findByTestId('explorer-sfx/win.mp3'));
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('/api/files/sfx/win.mp3');
    await userEvent.click(screen.getByTestId('explorer-clips/intro.mp4'));
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/files/clips/intro.mp4');
  });
```

- [ ] **Step 2: RED** — `cd engine/ide/client && npx vitest run tests/viewers.test.tsx tests/explorer.test.tsx`.

- [ ] **Step 3: Implement**

`src/plugins/viewers.ts` — the `slots`/`languages` pattern (`createRegistry({ policy: 'last-wins' })`, listeners, lenient `connection` via `ctx.reflect.get('connection', false)`, warning on same-id replace: `diagnostic('warning', 'viewers', def.id, \`a second viewer registered as "${def.id}", replacing the first\`, 'give it an id of its own')`); `pick` walks `list()` from the end and returns the first whose `match(path, entry)` is true; `register` on an existing id retracts the old entry first (as `languages.ts` does with `offs`) so the re-add lands last; `declare module 'cordis' { interface Context { viewers: ViewersService } }`.

`src/plugins/viewers-media.tsx`:

```tsx
import type { Context } from 'cordis';
import { extensionOf } from '../shell/ViewerDocument';
import type { ViewerProps } from './viewers';

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['.mp4', '.webm', '.ogv']);

const byExtension = (set: ReadonlySet<string>) => (path: string) => set.has(extensionOf(path));

/** The three native players. `urlFor` is what turns a project path into something a `src` can fetch — encoding included. */
function Image({ ctx, path }: ViewerProps) {
  return <img className="e8-viewer-image" src={ctx.files.urlFor(path)} alt={path} />;
}
function Audio({ ctx, path }: ViewerProps) {
  return <audio className="e8-viewer-audio" controls src={ctx.files.urlFor(path)} data-testid="viewer-audio" />;
}
function Video({ ctx, path }: ViewerProps) {
  return <video className="e8-viewer-video" controls src={ctx.files.urlFor(path)} data-testid="viewer-video" />;
}

export const name = 'viewers-media';
export const inject = ['viewers', 'files'];

export function apply(ctx: Context) {
  ctx.effect(() => ctx.viewers.register({ id: 'image', match: byExtension(IMAGE_EXTENSIONS), component: Image }));
  ctx.effect(() => ctx.viewers.register({ id: 'audio', match: byExtension(AUDIO_EXTENSIONS), component: Audio }));
  ctx.effect(() => ctx.viewers.register({ id: 'video', match: byExtension(VIDEO_EXTENSIONS), component: Video }));
}
```

`ViewerDocument.tsx`: delete `IMAGE_EXTENSIONS`, `isImage`, the `image` variable, the `<img>` return, and the "isn't a recognized image" clause of the binary message (now: `"{path}" doesn't look like text (it contains a NUL byte), so it isn't shown here.`); keep `extensionOf`, `looksBinary`, `TOO_BIG_BYTES`. Move any image test from `tests/viewer-document.test.tsx` into `viewers.test.tsx` (or delete it if the new tests cover the same assertion — list what moved).

`Explorer.tsx` `openPath`:

```tsx
export function openPath(ctx: Context, path: string, entry?: FileEntry): void {
  const viewer = ctx.viewers.pick(path, entry);
  const editable = EDITABLE_EXTENSIONS.has(extensionOf(path));
  const Viewer = viewer?.component;
  ctx.shell.open({
    key: `${FILE_KEY_PREFIX}${path}`,
    title: path.split('/').pop() ?? path,
    component: Viewer
      ? ({ ctx: c }) => <Viewer ctx={c} path={path} entry={entry} />
      : editable
        ? ({ ctx: c }) => <EditorDocument ctx={c} path={path} />
        : ({ ctx: c }) => <ViewerDocument ctx={c} path={path} entry={entry} />,
    closable: true,
  });
}
```

`context.ts`: `await ctx.plugin(viewers)` right after `shell` (comment: a contribution the Explorer reads, like `languages`); `await ctx.plugin(viewersMedia)` at the very end (after `languageSpin`). `index.ts`: export `type ViewerDef, type ViewerProps, type ViewersService` and `IMAGE_EXTENSIONS, AUDIO_EXTENSIONS, VIDEO_EXTENSIONS`.

Styles: in `styles.css` next to `.e8-viewer-image`, add `.e8-viewer-audio { width: 100%; max-width: 480px; margin: 16px; }` and `.e8-viewer-video { max-width: 100%; max-height: 100%; margin: 16px; background: #000; }`.

- [ ] **Step 4: GREEN, typecheck, prettier, commit**

`cd engine/ide/client && npm test && npm run typecheck`; prettier on all changed files.

```bash
git add engine/ide/client/src/plugins/viewers.ts engine/ide/client/src/plugins/viewers-media.tsx engine/ide/client/src/shell/ViewerDocument.tsx engine/ide/client/src/shell/Explorer.tsx engine/ide/client/src/context.ts engine/ide/client/src/index.ts engine/ide/client/src/styles.css engine/ide/client/tests/viewers.test.tsx engine/ide/client/tests/explorer.test.tsx engine/ide/client/tests/viewer-document.test.tsx
git commit -m "Make viewers a contribution, and play sound and video in the tab

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Explorer verbs — new file/folder, rename, delete folder, the menu

**Files:**
- Modify: `engine/ide/client/src/shell/Explorer.tsx`, `engine/ide/client/src/styles.css`
- Create: `engine/ide/client/src/shell/ExplorerMenu.tsx`
- Test: `engine/ide/client/tests/explorer.test.tsx`

**Interfaces:**
- Consumes: `ctx.files.mkdir/create/move/remove` (Tasks 1–3), `ctx.shell.close(key, { force })`, `ctx.shell.documents()`.
- Produces (DOM contract Task 6/7 rely on): header buttons `data-testid="explorer-new-file"`, `explorer-new-folder`; inline input `data-testid="explorer-input"`; menu `role="menu"` with `role="menuitem"` buttons named `New file`, `New folder`, `Upload here`, `Rename`, `Delete`; folder confirm text `delete folder "x" and N entries?`; a selected row carries class `e8-explorer-selected`.

**Behaviour (from spec §2):**
- Clicking a row selects it (`selected: string | null`) — a file click still opens it; a dir click still toggles fold. The target directory for creation = selected dir, or the selected file's directory, or `''` (root).
- "new file"/"new folder": show an inline `<input>` row inside the target directory (rendered right after the directory's row, or at the top for root), `autoFocus`; `Enter` → validate name → `ctx.files.create(join(dir, name))` / `mkdir`; `Escape` or blur → cancel. Validation: `name === '' || name.includes('/') || name === '.' || name === '..'` → action diagnostic `diagnostic('error', 'files', name, \`"${name}" is not a valid name — one segment, no "/"\`)` with `code: 'malformed-request'`; no request.
- Right-click on a row (`onContextMenu`, `preventDefault`) → `<ExplorerMenu>` positioned at the pointer (`position: fixed; left/top`), items per kind; `Escape`, a click outside (document `mousedown` listener), or choosing an item closes it. "Upload here" triggers the header's hidden file input with `uploadDir = entry.path` (so `handleUpload` writes `join(uploadDir, file.name)`); "Rename" → inline input pre-filled with the last segment, `Enter` → `move(path, join(dirname, newName))`; "Delete" → `askDelete(path)`.
- Delete on a dir: confirm text `delete folder "{path}" and {N} entries?` where `N = entries.filter(e => e.path.startsWith(path + '/')).length`; the row's `×` button now appears on dirs too.
- After a successful rename/move of `path` to `to`: if `ctx.shell.documents().some(d => d.key === f:path)` — `ctx.shell.close(f:path, { force: true })` then `openPath(ctx, to, entryFromTree)`; if a moved DIRECTORY has open documents under it, close them (force) and reopen each at its new path.
- Every verb: `setActionDiagnostics(diagnostics); report(diagnostics); if (diagnostics.length === 0) void refreshTree();`.

- [ ] **Step 1: Failing tests** (append to `tests/explorer.test.tsx`; extend `harnessWithCalls`'s `fetchFn` so `POST` records `{ path, kind }` into `created: [string, 'dir' | 'file'][]` answering `hostAnswers.createDiagnostics ?? []`, and `PATCH` records `[from, to]` into `moved` answering `hostAnswers.moveDiagnostics ?? []`; expose both on `TestFiles`):

```tsx
describe('Explorer — verbs', () => {
  it('new folder at the root: the header button, an inline input, Enter → mkdir, tree refreshed', async () => {
    const ctx = await harness(tree(['e8.yml']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-e8.yml');
    await userEvent.click(screen.getByTestId('explorer-new-folder'));
    const input = screen.getByTestId('explorer-input');
    ctx.files.nextTree(tree(['e8.yml', 'assets']));
    await userEvent.type(input, 'assets{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['assets', 'dir']]));
    await screen.findByTestId('explorer-assets');
    expect(screen.queryByTestId('explorer-input')).toBeNull();
  });

  it('new file inside the selected directory', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'notes.txt{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['game/notes.txt', 'file']]));
  });

  it('a selected file means its directory', async () => {
    const ctx = await harness(tree(['game/spec.json']), { 'game/spec.json': '{}' });
    render(<Explorer ctx={ctx} />);
    await userEvent.click(await screen.findByTestId('explorer-game/spec.json'));
    await userEvent.click(screen.getByTestId('explorer-new-folder'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'sub{Enter}');
    await waitFor(() => expect(ctx.files.created).toEqual([['game/sub', 'dir']]));
  });

  it('Escape cancels; an empty name, a slash, and dots are refused before any request', async () => {
    const ctx = await harness(tree(['e8.yml']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-e8.yml');
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('explorer-input')).toBeNull();
    for (const bad of ['a/b', '..', '.']) {
      await userEvent.click(screen.getByTestId('explorer-new-file'));
      await userEvent.type(screen.getByTestId('explorer-input'), `${bad}{Enter}`);
      expect(screen.getByText(/is not a valid name/)).toBeVisible();
    }
    await userEvent.click(screen.getByTestId('explorer-new-file'));
    await userEvent.keyboard('{Enter}');
    expect(ctx.files.created).toEqual([]);
  });

  it('right-click opens a menu whose items fit the row', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['New file', 'New folder', 'Upload here', 'Rename', 'Delete']);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(screen.getByTestId('explorer-game/spec.json'));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Rename', 'Delete']);
  });

  it('rename: the menu, an inline input with the old name, Enter → move, the open tab follows', async () => {
    const ctx = await harness(tree(['game/spec.json']), { 'game/spec.json': '{}' });
    render(<><Explorer ctx={ctx} /><Shell ctx={ctx} /></>);
    await userEvent.click(await screen.findByTestId('explorer-game/spec.json'));
    expect(ctx.shell.documents().map((d) => d.key)).toContain('f:game/spec.json');
    fireEvent.contextMenu(screen.getByTestId('explorer-game/spec.json'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByTestId('explorer-input') as HTMLInputElement;
    expect(input.value).toBe('spec.json');
    ctx.files.nextTree(tree(['game/spec2.json']));
    await userEvent.clear(input);
    await userEvent.type(input, 'spec2.json{Enter}');
    await waitFor(() => expect(ctx.files.moved).toEqual([['game/spec.json', 'game/spec2.json']]));
    await waitFor(() => expect(ctx.shell.documents().map((d) => d.key)).toEqual(['f:game/spec2.json']));
  });

  it('deleting a folder asks with the count of what is inside, then removes', async () => {
    const ctx = await harness(tree(['game/spec.json', 'game/script.spin', 'game/sub/x.txt']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText('delete folder "game" and 4 entries?')).toBeVisible();
    ctx.files.nextTree(tree([]));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(ctx.files.removed).toEqual(['game']));
  });

  it('a refused verb shows the host’s words and leaves the tree alone', async () => {
    const ctx = await harness(tree(['e8.yml']), {}, { createDiagnostics: [d('"x" is already there')] });
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-e8.yml');
    await userEvent.click(screen.getByTestId('explorer-new-folder'));
    await userEvent.type(screen.getByTestId('explorer-input'), 'x{Enter}');
    expect(await screen.findByText('"x" is already there')).toBeVisible();
    expect(screen.queryByTestId('explorer-x')).toBeNull();
  });

  it('Upload here writes into that directory', async () => {
    const ctx = await harness(tree(['game/spec.json']));
    render(<Explorer ctx={ctx} />);
    fireEvent.contextMenu(await screen.findByTestId('explorer-game'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Upload here' }));
    const file = new File([new Uint8Array(bytes('hi'))], 'notes.txt');
    await userEvent.upload(screen.getByTestId('explorer-upload'), file);
    await waitFor(() => expect(ctx.files.written).toEqual([['game/notes.txt', bytes('hi')]]));
  });
});
```

Import `fireEvent` from `@testing-library/react`. Update the existing test "a directory has no delete button, since the only answer it could get is no" — it is now false; replace it with "a directory has a delete button too" asserting `explorer-delete-game` exists.

- [ ] **Step 2: RED** — `npx vitest run tests/explorer.test.tsx`.

- [ ] **Step 3: Implement**

`src/shell/ExplorerMenu.tsx`:

```tsx
import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  onPick(): void;
}

/** A context menu at a fixed point. Closes on Escape, on a mousedown outside itself, and after any item. */
export function ExplorerMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" className="e8-menu" style={{ position: 'fixed', left: x, top: y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="e8-menu-item"
          onClick={() => {
            onClose();
            item.onPick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

`Explorer.tsx` — new state:

```ts
type Editing =
  | { kind: 'create'; what: 'dir' | 'file'; dir: string }
  | { kind: 'rename'; path: string };
const [selected, setSelected] = useState<string | null>(null);
const [editing, setEditing] = useState<Editing | null>(null);
const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
const [uploadDir, setUploadDir] = useState('');
const uploadInput = useRef<HTMLInputElement>(null);
```

Helpers (module level):

```ts
const joinPath = (dir: string, name: string) => (dir === '' ? name : `${dir}/${name}`);
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export function invalidName(name: string): string | undefined {
  if (name === '' || name.includes('/') || name === '.' || name === '..')
    return `"${name}" is not a valid name — one segment, no "/"`;
  return undefined;
}
```

`targetDir()` = `selected === null ? '' : entries.find(e => e.path === selected)?.kind === 'dir' ? selected : dirOf(selected)`.

`finish(diagnostics)` = the shared `setActionDiagnostics; report; if empty refreshTree` (refactor `upload`/`confirm` onto it).

`submitEditing(name)`:
```ts
const bad = invalidName(name);
if (bad) { const own = [{ ...diagnostic('error', 'files', name, bad), code: 'malformed-request' }]; setActionDiagnostics(own); report(own); return; }
const e = editing!; setEditing(null);
if (e.kind === 'create') {
  const path = joinPath(e.dir, name);
  void (e.what === 'dir' ? ctx.files.mkdir(path) : ctx.files.create(path)).then(({ diagnostics }) => finish(diagnostics));
} else {
  const to = joinPath(dirOf(e.path), name);
  if (to === e.path) return;
  void ctx.files.move(e.path, to).then(({ diagnostics }) => { finish(diagnostics); if (diagnostics.length === 0) followMove(e.path, to); });
}
```

`followMove(from, to)`: for each `doc` of `ctx.shell.documents()` whose key is `f:${from}` or starts with `f:${from}/`: `const newPath = to + doc.key.slice(FILE_KEY_PREFIX.length + from.length); ctx.shell.close(doc.key, { force: true }); openPath(ctx, newPath);` (entry unknown → `undefined`; `pick` still works by extension).

Rendering: the inline input row —

```tsx
function InlineInput({ initial, onSubmit, onCancel }: { initial: string; onSubmit(v: string): void; onCancel(): void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      data-testid="explorer-input"
      className="e8-explorer-input"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onSubmit(value.trim()); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onBlur={onCancel}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
```

For `create`, render an `<li className="e8-explorer-entry">` holding `<InlineInput initial="" …/>` right after the target dir's row (or as the first `<li>` when `dir === ''`), indented one level deeper than the dir. For `rename`, render the input in place of `.e8-explorer-name` on that row. Note `onBlur={onCancel}` fires when Enter's submit unmounts the input — guard with a `submitted` ref so a submit is not followed by a cancel (set `submitted.current = true` in the Enter handler; `onBlur` no-ops when set).

Row: `onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, entry }); }}`; `className` gains `e8-explorer-selected` when `selected === entry.path`; `select(entry)` also `setSelected(entry.path)`. Dir rows get the `×` button too (`askDelete`). Confirm text: `pending.kind === 'delete' && entry.kind === 'dir' ? \`delete folder "${entry.path}" and ${count} entries?\` : …` (count computed from `entries`).

Header: two buttons before the upload label —
```tsx
<button type="button" className="e8-explorer-action" data-testid="explorer-new-file" title="new file" aria-label="new file" onClick={() => setEditing({ kind: 'create', what: 'file', dir: targetDir() })}>＋</button>
<button type="button" className="e8-explorer-action" data-testid="explorer-new-folder" title="new folder" aria-label="new folder" onClick={() => setEditing({ kind: 'create', what: 'dir', dir: targetDir() })}>▣</button>
```
(use the same 16px inline SVG style as the upload icon if you prefer — a plus and a folder — the testids and labels are the contract). The upload `<input>` gets `ref={uploadInput}` and `handleUpload` writes `joinPath(uploadDir, file.name)` and checks existence against that full path; `uploadDir` resets to `''` after each upload; "Upload here" sets `uploadDir` then `uploadInput.current?.click()`.

Menu items: dir → `New file` (`setEditing({ kind: 'create', what: 'file', dir: entry.path })`), `New folder`, `Upload here`, `Rename` (`setEditing({ kind: 'rename', path })`), `Delete` (`askDelete`); file → `Rename`, `Delete`.

Styles (`styles.css`, after `.e8-explorer-diagnostic`):

```css
.e8-explorer-action { background: none; border: 0; color: var(--e8-fg-muted); cursor: pointer; padding: 2px 4px; border-radius: var(--e8-radius-sm); font-size: 13px; }
.e8-explorer-action:hover { background: var(--e8-hover); color: var(--e8-fg); }
.e8-explorer-selected { background: var(--e8-selected); }
.e8-explorer-input { flex: 1; min-width: 0; font: inherit; color: var(--e8-fg); background: var(--e8-editor-bg); border: 1px solid var(--e8-accent); border-radius: var(--e8-radius-sm); padding: 0 4px; outline: none; }
.e8-menu { background: var(--e8-surface); border: 1px solid var(--e8-border); border-radius: var(--e8-radius-lg); box-shadow: none; padding: 4px; min-width: 140px; z-index: 100; display: flex; flex-direction: column; }
.e8-menu-item { background: none; border: 0; color: var(--e8-fg); text-align: left; padding: 4px 10px; border-radius: var(--e8-radius-sm); cursor: pointer; font: inherit; }
.e8-menu-item:hover, .e8-menu-item:focus-visible { background: var(--e8-hover); outline: none; }
```

`tests/styles.test.ts` guards that every `box-shadow` is `none` (Modern UI: cards are flat, separated by gaps and borders) — the menu keeps `box-shadow: none` and relies on its border.

- [ ] **Step 4: GREEN, typecheck, prettier, commit**

`cd engine/ide/client && npm test && npm run typecheck`; prettier.

```bash
git add engine/ide/client/src/shell/Explorer.tsx engine/ide/client/src/shell/ExplorerMenu.tsx engine/ide/client/src/styles.css engine/ide/client/tests/explorer.test.tsx
git commit -m "Give the Explorer its verbs: new file and folder, rename, delete a folder, a menu on the row

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Drag and drop — rows into folders, files from the OS

**Files:**
- Modify: `engine/ide/client/src/shell/Explorer.tsx`, `engine/ide/client/src/styles.css`
- Test: `engine/ide/client/tests/explorer-dnd.test.tsx` (new; copy the `harnessWithCalls`/`tree`/`bytes` helpers from `explorer.test.tsx` into a shared `tests/explorer-harness.ts` and import from both — one definition)

**Interfaces:**
- Consumes: `ctx.files.move`, `upload(path, bytes)` (Task 5's `finish` path), `followMove`.
- DOM contract for Task 7: rows are `draggable`; a directory row and the tree root (`<ul className="e8-explorer-tree" data-testid="explorer-root">`) accept drops; the hovered target carries class `e8-drop-target`; internal drags carry `text/x-e8-path`.

- [ ] **Step 1: Failing tests** — `tests/explorer-dnd.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Explorer } from '../src/index';
import { harness, tree, bytes } from './explorer-harness';

/** jsdom has no DataTransfer; a plain object with the two members the Explorer reads is what `fireEvent` attaches. */
function transfer(init: { path?: string; files?: File[] }) {
  const data: Record<string, string> = init.path ? { 'text/x-e8-path': init.path } : {};
  return {
    dataTransfer: {
      types: Object.keys(data).concat(init.files?.length ? ['Files'] : []),
      files: init.files ?? [],
      getData: (t: string) => data[t] ?? '',
      setData: (t: string, v: string) => { data[t] = v; },
      dropEffect: 'move',
      effectAllowed: 'move',
    },
  };
}

describe('Explorer — drag and drop', () => {
  it('dropping a file row on a directory moves it there', async () => {
    const ctx = await harness(tree(['game/spec.json', 'assets']));
    render(<Explorer ctx={ctx} />);
    const row = await screen.findByTestId('explorer-game/spec.json');
    expect(row.getAttribute('draggable')).toBe('true');
    const t = transfer({});
    fireEvent.dragStart(row, t);
    expect(t.dataTransfer.getData('text/x-e8-path')).toBe('game/spec.json');
    const dir = screen.getByTestId('explorer-assets');
    fireEvent.dragOver(dir, t);
    expect(dir.classList.contains('e8-drop-target')).toBe(true);
    ctx.files.nextTree(tree(['assets/spec.json']));
    fireEvent.drop(dir, t);
    await waitFor(() => expect(ctx.files.moved).toEqual([['game/spec.json', 'assets/spec.json']]));
    expect(dir.classList.contains('e8-drop-target')).toBe(false);
  });

  it('dropping on the root moves to the root; a directory dropped into itself does nothing', async () => {
    const ctx = await harness(tree(['game/spec.json', 'game/sub/x.txt']));
    render(<Explorer ctx={ctx} />);
    await screen.findByTestId('explorer-game/spec.json');
    fireEvent.drop(screen.getByTestId('explorer-root'), transfer({ path: 'game/spec.json' }));
    await waitFor(() => expect(ctx.files.moved).toEqual([['game/spec.json', 'spec.json']]));
    fireEvent.drop(screen.getByTestId('explorer-game/sub'), transfer({ path: 'game' }));
    fireEvent.drop(screen.getByTestId('explorer-game'), transfer({ path: 'game' }));
    expect(ctx.files.moved).toHaveLength(1);
  });

  it('dropping on a file row targets that file’s directory', async () => {
    const ctx = await harness(tree(['game/spec.json', 'notes.txt']));
    render(<Explorer ctx={ctx} />);
    fireEvent.drop(await screen.findByTestId('explorer-game/spec.json'), transfer({ path: 'notes.txt' }));
    await waitFor(() => expect(ctx.files.moved).toEqual([['notes.txt', 'game/notes.txt']]));
  });

  it('a file from the OS dropped on a directory is uploaded into it', async () => {
    const ctx = await harness(tree(['assets']));
    render(<Explorer ctx={ctx} />);
    const file = new File([new Uint8Array(bytes('png?'))], 'logo.png');
    fireEvent.drop(await screen.findByTestId('explorer-assets'), transfer({ files: [file] }));
    await waitFor(() => expect(ctx.files.written).toEqual([['assets/logo.png', bytes('png?')]]));
  });

  it('an OS drop onto a name already there asks first', async () => {
    const ctx = await harness(tree(['assets/logo.png']));
    render(<Explorer ctx={ctx} />);
    const file = new File([new Uint8Array(bytes('new'))], 'logo.png');
    fireEvent.drop(await screen.findByTestId('explorer-assets'), transfer({ files: [file] }));
    expect(await screen.findByText(/replace "assets\/logo.png"\?/)).toBeVisible();
    expect(ctx.files.written).toEqual([]);
  });

  it('a refused move shows the host’s words and moves nothing in the tree', async () => {
    const ctx = await harness(tree(['a.txt', 'dir']), {}, { moveDiagnostics: [{ ...d('"dir/a.txt" is already there'), code: 'exists' }] });
    render(<Explorer ctx={ctx} />);
    fireEvent.drop(await screen.findByTestId('explorer-dir'), transfer({ path: 'a.txt' }));
    expect(await screen.findByText('"dir/a.txt" is already there')).toBeVisible();
    expect(screen.getByTestId('explorer-a.txt')).toBeVisible();
  });
});
```

(`d` from the harness module too.)

- [ ] **Step 2: RED** — `npx vitest run tests/explorer-dnd.test.tsx`.

- [ ] **Step 3: Implement**

In `Explorer.tsx`:

```ts
const DRAG_TYPE = 'text/x-e8-path';
const [dropTarget, setDropTarget] = useState<string | null>(null); // '' = root

/** Where a drop on `entry` lands: the directory itself, or a file's directory. */
const dropDirFor = (entry: FileEntry | null) => (entry === null ? '' : entry.kind === 'dir' ? entry.path : dirOf(entry.path));

function onDragStart(entry: FileEntry, e: DragEvent<HTMLElement>) {
  e.dataTransfer.setData(DRAG_TYPE, entry.path);
  e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(target: string, e: DragEvent<HTMLElement>) {
  // Only what this view knows how to take: its own rows, or files from outside.
  const types = Array.from(e.dataTransfer.types);
  if (!types.includes(DRAG_TYPE) && !types.includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = types.includes(DRAG_TYPE) ? 'move' : 'copy';
  if (dropTarget !== target) setDropTarget(target);
}
function onDragLeave(target: string) {
  if (dropTarget === target) setDropTarget(null);
}
function onDrop(target: string, e: DragEvent<HTMLElement>) {
  e.preventDefault();
  e.stopPropagation();
  setDropTarget(null);
  const from = e.dataTransfer.getData(DRAG_TYPE);
  if (from) {
    const to = joinPath(target, baseOf(from));
    // Dropping a directory on itself or into its own subtree: the host would answer into-self; nothing to ask.
    if (to === from || target === from || target.startsWith(`${from}/`)) return;
    void ctx.files.move(from, to).then(({ diagnostics }) => {
      finish(diagnostics);
      if (diagnostics.length === 0) followMove(from, to);
    });
    return;
  }
  const file = e.dataTransfer.files[0];
  if (file) readAndUpload(file, target);
}
```

`readAndUpload(file, dir)` is `handleUpload`'s body factored out (FileReader → existence check against `joinPath(dir, file.name)` → `setPending({ kind: 'overwrite', … })` or `upload(...)`); `handleUpload` calls it with `uploadDir`.

Rows: `draggable`, `onDragStart={(e) => onDragStart(entry, e)}`, `onDragOver={(e) => onDragOver(dropDirFor(entry), e)}`, `onDragLeave={() => onDragLeave(dropDirFor(entry))}`, `onDrop={(e) => onDrop(dropDirFor(entry), e)}`; class `e8-drop-target` when `dropTarget === dropDirFor(entry) && entry.kind === 'dir'` (a file row highlights its directory's row — simplest: highlight only dir rows and the root). The `<ul>` gets `data-testid="explorer-root"` and the same three handlers with target `''`, class `e8-drop-target` when `dropTarget === ''`. Import `DragEvent` type from react.

Styles: `.e8-drop-target { outline: 1px solid var(--e8-accent); outline-offset: -1px; background: var(--e8-hover); }`.

Move the shared harness into `tests/explorer-harness.ts` (exports `harness`, `harnessWithCalls`, `tree`, `bytes`, `d`, `TestFiles`) and make `explorer.test.tsx` import from it — same code, one place.

- [ ] **Step 4: GREEN, typecheck, prettier, commit**

`cd engine/ide/client && npm test && npm run typecheck`; prettier.

```bash
git add engine/ide/client/src/shell/Explorer.tsx engine/ide/client/src/styles.css engine/ide/client/tests/explorer-dnd.test.tsx engine/ide/client/tests/explorer-harness.ts engine/ide/client/tests/explorer.test.tsx
git commit -m "Drag a row into a folder, or a file from the desktop onto one

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The browser — `explorer.spec.ts`

**Files:**
- Create: `engine/apps/web/tests/e2e/explorer.spec.ts`

**Interfaces:** `projectCopy`, `startDevHost`, `PNG_BYTES` from `./project-fixture`; the DOM contracts of Tasks 5–6; `status-session` testid (`e8-server ●` when alive).

**Spec §5 correction (controller ruling):** `dev-game` restarts `e8-server` on `files/written` only for a `.spin` INSIDE the games directory (`game/`). Moving `game/script.spin` out of `game/` fires no restart. The e2e therefore moves it INTO a subfolder of `game/` (`game/old/`) — the session leaves `e8-server ●` (the script is gone from where the engine looks) — then back, and `e8-server ●` returns.

- [ ] **Step 1: Write the spec**

```ts
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PNG_BYTES, projectCopy, startDevHost, type DevHost } from './project-fixture';

/**
 * The Explorer's verbs against a real host and a real disk: what the tree
 * shows after each is what `fs` shows. Drops from the desktop cannot be
 * driven by Playwright's mouse — `dragTo` carries no `dataTransfer.files`
 * — so the OS drop is a `drop` event dispatched from inside the page with
 * a `DataTransfer` built there (measured: jsdom has none, Chromium does).
 */
const IDE_URL = 'http://127.0.0.1:5680/';

let dir: string;
let host: DevHost;

test.beforeEach(async ({ page }) => {
  dir = projectCopy();
  writeFileSync(join(dir, 'win.mp3'), Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]));
  host = await startDevHost(dir);
  await page.goto(IDE_URL);
  await expect(page.getByTestId('explorer-game/script.spin')).toBeVisible({ timeout: 20_000 });
});

test.afterEach(async () => {
  await host.stop();
  rmSync(dir, { recursive: true, force: true });
});

const row = (page: Page, path: string) => page.getByTestId(`explorer-${path}`);

test('new folder, new file in it, rename, delete the folder — the disk agrees at every step', async ({ page }) => {
  await page.getByTestId('explorer-new-folder').click();
  await page.getByTestId('explorer-input').fill('assets');
  await page.keyboard.press('Enter');
  await expect(row(page, 'assets')).toBeVisible();
  expect(existsSync(join(dir, 'assets'))).toBe(true);

  await row(page, 'assets').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New file' }).click();
  await page.getByTestId('explorer-input').fill('readme.txt');
  await page.keyboard.press('Enter');
  await expect(row(page, 'assets/readme.txt')).toBeVisible();
  expect(existsSync(join(dir, 'assets', 'readme.txt'))).toBe(true);

  await row(page, 'assets/readme.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByTestId('explorer-input').fill('notes.txt');
  await page.keyboard.press('Enter');
  await expect(row(page, 'assets/notes.txt')).toBeVisible();
  expect(existsSync(join(dir, 'assets', 'notes.txt'))).toBe(true);
  expect(existsSync(join(dir, 'assets', 'readme.txt'))).toBe(false);

  await row(page, 'assets').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('delete folder "assets" and 1 entries?')).toBeVisible();
  await page.getByTestId('confirm-yes').click();
  await expect(row(page, 'assets')).toHaveCount(0);
  expect(existsSync(join(dir, 'assets'))).toBe(false);
});

test('dragging a file onto a folder moves it on disk', async ({ page }) => {
  await page.getByTestId('explorer-new-folder').click();
  await page.getByTestId('explorer-input').fill('assets');
  await page.keyboard.press('Enter');
  await expect(row(page, 'assets')).toBeVisible();
  await row(page, 'game/spec.json').dragTo(row(page, 'assets'));
  await expect(row(page, 'assets/spec.json')).toBeVisible();
  expect(existsSync(join(dir, 'assets', 'spec.json'))).toBe(true);
  expect(existsSync(join(dir, 'game', 'spec.json'))).toBe(false);
});

test('a file dropped from the desktop onto a folder lands in it', async ({ page }) => {
  await page.getByTestId('explorer-new-folder').click();
  await page.getByTestId('explorer-input').fill('art');
  await page.keyboard.press('Enter');
  await expect(row(page, 'art')).toBeVisible();
  await row(page, 'art').evaluate((el, bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'logo.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, Array.from(PNG_BYTES));
  await expect(row(page, 'art/logo.png')).toBeVisible();
  expect(existsSync(join(dir, 'art', 'logo.png'))).toBe(true);
});

test('an .mp3 opens in an audio player', async ({ page }) => {
  await row(page, 'win.mp3').click();
  const audio = page.getByTestId('viewer-audio');
  await expect(audio).toBeVisible();
  await expect(audio).toHaveAttribute('src', '/api/files/win.mp3');
});

test('moving the maths within game/ restarts the engine; moving it back revives it', async ({ page }) => {
  const status = page.getByTestId('status-session');
  await expect(status).toHaveText('e8-server ●', { timeout: 20_000 });
  await row(page, 'game').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New folder' }).click();
  await page.getByTestId('explorer-input').fill('old');
  await page.keyboard.press('Enter');
  await expect(row(page, 'game/old')).toBeVisible();
  await row(page, 'game/script.spin').dragTo(row(page, 'game/old'));
  await expect(row(page, 'game/old/script.spin')).toBeVisible();
  await expect(status).not.toHaveText('e8-server ●', { timeout: 20_000 });
  await row(page, 'game/old/script.spin').dragTo(row(page, 'game'));
  await expect(row(page, 'game/script.spin')).toBeVisible();
  await expect(status).toHaveText('e8-server ●', { timeout: 20_000 });
});
```

If `dragTo` does not trigger React's `onDrop` (HTML5 DnD in Chromium needs `dragover` to be cancelled — Playwright's `dragTo` does dispatch the sequence; measured in Playwright ≥1.30 it works with `preventDefault` on dragover), fall back to dispatching `dragstart`/`dragover`/`drop` with a page-built `DataTransfer` via `evaluate`, and say so in the module doc.

- [ ] **Step 2: Run alone, then the whole suite**

`cd engine/apps/web && npx playwright test tests/e2e/explorer.spec.ts` — expected 5 passed. Then `git branch --show-current`, `npx playwright test` alone — expected 101 passed (96 + 5). After: `pgrep -fl e8-server | grep -v pantheon` empty, `ls engine/examples` exactly `first-slot probe-plugin workspace`.

- [ ] **Step 3: Prettier, commit**

```bash
npx prettier --check engine/apps/web/tests/e2e/explorer.spec.ts
git add engine/apps/web/tests/e2e/explorer.spec.ts
git commit -m "Prove the Explorer's verbs against a real disk

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** §2 host verbs, rules, protection, mime, codes → Tasks 1–2; `files/removed` → Task 2; client wrappers → Task 3; `viewers` contribution, media viewers, `openPath` order, `IMAGE_EXTENSIONS` moving out of `ViewerDocument` → Task 4; Explorer create/menu/rename/delete-folder/tab-follow/name validation → Task 5; DnD internal + OS → Task 6; Playwright → Task 7 (with the games-dir correction recorded). §4 refusals: `malformed-request` on bad bodies (Tasks 1–2), no overwrite (`refuseExisting`), `into-self` before `renameSync`, client validation (Task 5), `pick` miss is not a refusal (Task 4).
- **Placeholders.** None. Task 3's harness note names the four behaviours as the requirement where the existing helper's shape is unknown to the plan.
- **Type consistency.** `FileCreateRequest { kind }` / `FileMoveRequest { to }` (Task 1) used by Tasks 1–3. Host `mkdir/create/move/remove` signatures match client wrappers. `ViewerDef/ViewerProps/ViewersService` (Task 4) used by `viewers-media` and `openPath`. `TestFiles` gains `created`, `moved` (Task 5 harness) used by Task 6 via `explorer-harness.ts`. Testids: `explorer-new-file`, `explorer-new-folder`, `explorer-input`, `explorer-root`, `viewer-audio`, `viewer-video`, `confirm-yes` — consistent across Tasks 4–7. `joinPath/dirOf/baseOf/invalidName/finish/followMove` defined in Task 5, reused in Task 6.
