# One Process, N Projects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `e8` process serves the IDE, lists the projects of its folder, boots the chosen project's game inside itself on its own port, and switches projects without a restart.

**Architecture:** The host root keeps only what outlives a project (`Loader`, `Server` 5679, `ide-rpc`, `workspace`, `ide-static`); everything that read `cwd` moves into one `project-scope` plugin that `workspace.open()` plugs and `close()` disposes. `dev-game` runs the game on a second `@cordisjs/plugin-server` (5681) in an isolated child context so the preview origin is separate on purpose. The client gains a `workspace` plugin (state over `GET /api/workspace` + a `workspace` ws frame), a first activity button with a "Проекты" sidebar, and the status bar shows the project's name.

**Tech Stack:** cordis 4.0.0-rc.8 (`ctx.isolate`, `ctx.effect`, `ctx.inject` reactive), `@cordisjs/plugin-server` (two instances), `@cordisjs/plugin-loader` + `plugin-include` (absolute `file://` path, explicit `loader.remove`), vite middleware, React 18, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-one-process-n-projects-design.md`

## Global Constraints

- Project id = directory name; a path never crosses the wire (`Project { id, name }`, spec §4).
- One active project; `open`/`close` serialized on one promise chain; `open` of the active id is a no-op (spec §4, §10).
- If `root` itself contains `e8.yml`, it is the single project and is opened at boot; otherwise children with `e8.yml` are the projects and none is opened (spec §3).
- Ports: 5679 API + `/ide` + `/plugin-client` + IDE static; 5681 preview; `PORT`/`PREVIEW_PORT` override, `0` = free (spec §3).
- Everything the GAME requests is same-origin on the preview server: vite catch-all, `/api/spin`, `/@fs/`, `/plugin-runtime/:id`, `/api/composition`, ws `/ide` (spec §6, amended by Ruling A below).
- The preview server is `ctx.isolate('server')` + `ctx.plugin(Server, …)` in `dev-game`'s scope, read through the fiber's own ctx (`fiber.ctx.server`) — measured in the pre-plan spike; a second `Server` on the same ctx name is NOT attempted.
- `project-scope` declares `inject: ['loader']`, creates the include entry with `path: pathToFileURL(join(cwd, 'e8.yml')).href`, and removes it in `ctx.effect(() => () => ctx.loader.remove(id))` — the spike showed entries survive scope dispose otherwise.
- Failure is data: no throw out of `workspace`, `project-scope`, `ide-static`; every refusal is a `Diagnostic` (spec §10).
- Every existing test keeps passing at every task boundary: host unit tests, ide-client unit tests, the 70 Playwright tests (`e8 dev` semantics preserved by the fixture: `cwd` = project → auto-open).
- Every assertion has a named mutation that must fail it, confirmed LANDED by a before/after count on the ORIGINAL file.
- Playwright runs ALONE of every root-level npm command; `pgrep -fl e8-server` before/after; ports 5679/5680/5681; `ls -d engine/examples/e8-compose-*` must be empty after.
- UI copy: Russian headings (`Проекты`), English inline labels; testids only in tests.
- Shell is zsh: no trailing `#` comments on command lines.

**Ruling A (spec §6 amendment, from measurement):** the game calls `/api/composition` (`@energy8engine/loader`), `/plugin-runtime/:id`, `/api/spin`, and opens `ws://${location.host}/ide` (`ide-bridge` default). With the game on 5681 all four must be served there. `ide-rpc` therefore exposes `attach(server)` — registers its `/ide` ws route on any server — and `runtime-assets` exposes its two handlers so `dev-game` can register them on the preview server. One client set, one broadcast, two listening sockets.

---

## File map

| File | Task | Change |
|---|---|---|
| `engine/core/contracts/src/protocol.ts` | 1 | `Project`, `WorkspaceState`, `ServerMessage` += `workspace` |
| `engine/ide/host/src/plugins/workspace.ts` | 1 | new: scan, name, open/close/rescan/state, event; scope factory injected |
| `engine/ide/host/tests/workspace.test.ts` | 1 | new |
| `engine/ide/host/src/plugins/project-scope.ts` | 2 | new: composes the cwd-bound plugins + include entry |
| `engine/ide/host/src/index.ts` | 2 | root = Loader, Server, rpc, workspace, routes; `root` option; auto-open |
| `engine/ide/host/src/plugins/rpc.ts` | 2 | `inject: ['server']`; composition read reactively; `attach(server)` |
| `engine/apps/cli/src/index.ts` | 2 | `e8` / `e8 ide` / `e8 dev` per spec §3 |
| `engine/ide/host/tests/host.test.ts`, `rpc.test.ts`, `cli-smoke.test.ts` | 2 | adapt to `root`; new cases |
| `engine/apps/web/tests/e2e/project-fixture.ts` | 2 | `startDevHost` → `createIdeHost({ root: dir })` (auto-open) |
| `engine/ide/client/src/plugins/workspace.ts` | 3 | new client plugin |
| `engine/ide/client/src/shell/StatusItems.tsx` | 3 | `ProjectStatus` shows `name` |
| `engine/ide/client/src/screens/PreviewWall.tsx` | 3 | `previewUrl` from workspace |
| `engine/ide/client/tests/workspace.test.ts`, `status-items.test.tsx`, `preview.test.tsx` | 3 | |
| `engine/ide/host/src/plugins/dev-game.ts` | 4 | preview server via isolate; game routes there; `previewUrl` |
| `engine/ide/host/src/plugins/runtime-assets.ts` | 4 | handlers exported for the preview server |
| `engine/ide/host/tests/dev-game.test.ts`, `runtime-assets.test.ts` | 4 | |
| `engine/apps/web/tests/e2e/project-fixture.ts` | 4 | `gameUrl` = `previewUrl` |
| `engine/ide/host/src/plugins/ide-static.ts` | 5 | new: serve `dist`, SPA fallback, no-dist page |
| `engine/ide/host/tests/ide-static.test.ts` | 5 | |
| `engine/apps/web/src/App.tsx` | 6 | activity `workspace` + sidebar `Projects` |
| `engine/ide/client/src/shell/Projects.tsx` | 6 | new sidebar view |
| `engine/ide/client/src/plugins/workspace.ts` | 6 | switch semantics: close `f:` docs, dirty confirm |
| `engine/ide/client/tests/projects.test.tsx` | 6 | |
| `engine/apps/web/tests/e2e/workspace.spec.ts` | 7 | new: spec §12 items 1–4, 6–7 |
| `docs/superpowers/notes/…-slice-9-carried-forward.md` | close | |

---

### Task 1: The `workspace` service, with a scope it does not own

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts`
- Create: `engine/ide/host/src/plugins/workspace.ts`
- Test: `engine/ide/host/tests/workspace.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // contracts/protocol.ts
  export interface Project { id: string; name: string }
  export interface WorkspaceState {
    projects: Project[];
    active: string | null;
    previewUrl: string | null;
    diagnostics: Diagnostic[];
  }
  export type ServerMessage = … | { type: 'workspace'; workspace: WorkspaceState };
  ```
  ```ts
  // host/plugins/workspace.ts
  export interface WorkspaceService {
    state(): WorkspaceState;
    open(id: string): Promise<Diagnostic[]>;
    close(): Promise<void>;
    rescan(): Promise<void>;
  }
  export interface ProjectScopeHandle { previewUrl: string | null; dispose(): Promise<void> }
  export interface WorkspaceConfig {
    root: string;
    /** Boots one project's scope. Resolves once it is usable; rejects → diagnostic, active stays null. */
    scope(ctx: Context, cwd: string): Promise<ProjectScopeHandle>;
  }
  export const name = 'workspace';
  declare module 'cordis' { interface Context { workspace: WorkspaceService } interface Events { 'workspace/changed'(state: WorkspaceState): void } }
  ```
  Task 2 supplies the real `scope`; tests supply a fake.

- [ ] **Step 1: Contracts**

Append to `engine/core/contracts/src/protocol.ts`, next to `GameGoneMessage`:

```ts
/** One project of the workspace. `id` is the directory name; a path never crosses the wire. */
export interface Project {
  id: string;
  /** `game/spec.json`'s `name` when it is a string; otherwise `id`. */
  name: string;
}

export interface WorkspaceState {
  projects: Project[];
  /** The open project's id, or `null` when none is. */
  active: string | null;
  /** Where the active project's game is served, or `null` (no project, or its preview failed to bind). */
  previewUrl: string | null;
  /** Scan failures and the last `open()`'s refusals — replaced, never appended, on every change. */
  diagnostics: Diagnostic[];
}
```

and extend `ServerMessage` with `| { type: 'workspace'; workspace: WorkspaceState }`. Export both types from `index.ts` if that file re-exports by name (check; add to the list if so).

- [ ] **Step 2: Failing tests**

`engine/ide/host/tests/workspace.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from 'cordis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as workspace from '../src/plugins/workspace';
import type { ProjectScopeHandle } from '../src/plugins/workspace';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'e8-ws-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function project(id: string, spec?: unknown) {
  mkdirSync(join(root, id, 'game'), { recursive: true });
  writeFileSync(join(root, id, 'e8.yml'), '[]\n');
  if (spec !== undefined) writeFileSync(join(root, id, 'game', 'spec.json'), JSON.stringify(spec));
}

/** A scope that records its life; `fail` makes boot reject. */
function fakeScope(log: string[], opts: { fail?: boolean; previewUrl?: string | null } = {}) {
  return async (_ctx: Context, cwd: string): Promise<ProjectScopeHandle> => {
    log.push(`open ${cwd}`);
    if (opts.fail) throw new Error('boot failed');
    return {
      previewUrl: opts.previewUrl ?? 'http://127.0.0.1:5681',
      dispose: async () => {
        log.push(`close ${cwd}`);
      },
    };
  };
}

async function boot(log: string[] = [], opts?: Parameters<typeof fakeScope>[1]) {
  const ctx = new Context();
  await ctx.plugin(workspace, { root, scope: fakeScope(log, opts) });
  return ctx;
}

describe('workspace: what is a project', () => {
  it('lists directories with e8.yml, by id, sorted; nothing else', async () => {
    project('b-slot');
    project('a-slot');
    mkdirSync(join(root, 'not-a-project'));
    writeFileSync(join(root, 'e8.yml.txt'), '');
    mkdirSync(join(root, 'file-named-e8'));
    writeFileSync(join(root, 'file-named-e8', 'e8.yml'), '[]');
    mkdirSync(join(root, 'dir-e8yml', 'e8.yml'), { recursive: true }); // e8.yml is a DIRECTORY here
    const ctx = await boot();
    expect(ctx.workspace.state().projects.map((p) => p.id)).toEqual(['a-slot', 'b-slot', 'file-named-e8']);
  });

  it('does not follow a symlinked directory', async () => {
    project('real');
    symlinkSync(join(root, 'real'), join(root, 'link'));
    const ctx = await boot();
    expect(ctx.workspace.state().projects.map((p) => p.id)).toEqual(['real']);
  });

  it('names a project from game/spec.json, and by id without one', async () => {
    project('named', { id: 'x', name: 'First Slot' });
    project('unnamed');
    project('bad-name', { name: 42 });
    project('bad-json');
    writeFileSync(join(root, 'bad-json', 'game', 'spec.json'), '{');
    const ctx = await boot();
    const byId = Object.fromEntries(ctx.workspace.state().projects.map((p) => [p.id, p.name]));
    expect(byId).toEqual({ named: 'First Slot', unnamed: 'unnamed', 'bad-name': 'bad-name', 'bad-json': 'bad-json' });
    expect(ctx.workspace.state().diagnostics).toEqual([]);
  });

  it('a root that is itself a project is the one project, opened at boot', async () => {
    writeFileSync(join(root, 'e8.yml'), '[]');
    mkdirSync(join(root, 'game'));
    writeFileSync(join(root, 'game', 'spec.json'), JSON.stringify({ name: 'Solo' }));
    project('child-ignored');
    const log: string[] = [];
    const ctx = await boot(log);
    const state = ctx.workspace.state();
    expect(state.projects.map((p) => [p.id, p.name])).toEqual([[require('node:path').basename(root), 'Solo']]);
    expect(state.active).toBe(state.projects[0].id);
    expect(log).toEqual([`open ${root}`]);
  });

  it('an unreadable root is a diagnostic, not a throw', async () => {
    rmSync(root, { recursive: true, force: true });
    const ctx = await boot();
    expect(ctx.workspace.state().projects).toEqual([]);
    expect(ctx.workspace.state().diagnostics).toHaveLength(1);
    expect(ctx.workspace.state().diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'workspace' });
  });
});

describe('workspace: open, close, switch', () => {
  it('open boots the scope with the project path and publishes previewUrl', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    const changes: string[] = [];
    ctx.on('workspace/changed', (s) => changes.push(String(s.active)));
    expect(await ctx.workspace.open('one')).toEqual([]);
    expect(ctx.workspace.state()).toMatchObject({ active: 'one', previewUrl: 'http://127.0.0.1:5681' });
    expect(log).toEqual([`open ${join(root, 'one')}`]);
    expect(changes).toEqual(['one']);
  });

  it('open of an unknown id refuses with a diagnostic and changes nothing', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    const refusal = await ctx.workspace.open('nope');
    expect(refusal).toHaveLength(1);
    expect(refusal[0]).toMatchObject({ severity: 'error', plugin: 'workspace' });
    expect(refusal[0].message).toContain('nope');
    expect(ctx.workspace.state().active).toBeNull();
    expect(log).toEqual([]);
  });

  it('open of the active id is a no-op: no second boot, no event', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    await ctx.workspace.open('one');
    let events = 0;
    ctx.on('workspace/changed', () => events++);
    expect(await ctx.workspace.open('one')).toEqual([]);
    expect(log).toHaveLength(1);
    expect(events).toBe(0);
  });

  it('switching disposes the first scope BEFORE booting the second', async () => {
    project('one');
    project('two');
    const log: string[] = [];
    const ctx = await boot(log);
    await ctx.workspace.open('one');
    await ctx.workspace.open('two');
    expect(log).toEqual([`open ${join(root, 'one')}`, `close ${join(root, 'one')}`, `open ${join(root, 'two')}`]);
    expect(ctx.workspace.state().active).toBe('two');
  });

  it('two opens in flight run one after the other, not interleaved', async () => {
    project('one');
    project('two');
    const log: string[] = [];
    const ctx = await boot(log);
    await Promise.all([ctx.workspace.open('one'), ctx.workspace.open('two')]);
    expect(log).toEqual([`open ${join(root, 'one')}`, `close ${join(root, 'one')}`, `open ${join(root, 'two')}`]);
  });

  it('a scope that fails to boot leaves active null, previewUrl null, and says why', async () => {
    project('one');
    const ctx = await boot([], { fail: true });
    const refusal = await ctx.workspace.open('one');
    expect(refusal).toHaveLength(1);
    expect(refusal[0].message).toContain('boot failed');
    expect(ctx.workspace.state()).toMatchObject({ active: null, previewUrl: null });
    expect(ctx.workspace.state().diagnostics).toEqual(refusal);
  });

  it('close disposes and clears; close with nothing open is a no-op', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    await ctx.workspace.close();
    await ctx.workspace.open('one');
    await ctx.workspace.close();
    expect(log).toEqual([`open ${join(root, 'one')}`, `close ${join(root, 'one')}`]);
    expect(ctx.workspace.state()).toMatchObject({ active: null, previewUrl: null });
  });

  it('disposing the host disposes the open scope', async () => {
    project('one');
    const log: string[] = [];
    const ctx = await boot(log);
    await ctx.workspace.open('one');
    await ctx.fiber.dispose();
    expect(log.at(-1)).toBe(`close ${join(root, 'one')}`);
  });

  it('rescan picks up a project created after boot and drops a removed one, keeping active', async () => {
    project('one');
    const ctx = await boot();
    await ctx.workspace.open('one');
    project('two');
    await ctx.workspace.rescan();
    expect(ctx.workspace.state().projects.map((p) => p.id)).toEqual(['one', 'two']);
    expect(ctx.workspace.state().active).toBe('one');
  });
});
```

(Replace the `require('node:path').basename` with an imported `basename`.)

- [ ] **Step 3: Run, see red**

`npm test --workspace @energy8engine/ide-host -- tests/workspace.test.ts` — fails: module not found.

- [ ] **Step 4: Implement**

`engine/ide/host/src/plugins/workspace.ts`:

```ts
/**
 * The workspace: which projects exist under `root`, which one is open,
 * and where its game is served. Spec §4.
 *
 * A project is a DIRECTORY (not a symlink — the same rule `files`
 * applies to its tree) directly under `root` that contains a FILE named
 * `e8.yml`. Its id is its directory name; its name is `game/spec.json`'s
 * `name` when that is a string, else the id. A path never leaves this
 * module: the cloud provider of this same interface has none to give.
 *
 * If `root` itself contains `e8.yml`, `root` is the single project and is
 * opened at boot — this is what `e8 dev` in a project folder means, and
 * what every existing e2e fixture relies on.
 *
 * `open`/`close`/`rescan` are serialized on one promise chain: two clicks
 * in a row are two operations in order, never one scope booting while
 * another is still tearing down. Nothing here throws; every refusal is a
 * `Diagnostic` in the returned list and in `state().diagnostics`.
 */
import { readFile, readdir, lstat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type Project, type WorkspaceState } from '@energy8engine/contracts';

declare module 'cordis' {
  interface Context {
    workspace: WorkspaceService;
  }
  interface Events {
    'workspace/changed'(state: WorkspaceState): void;
  }
}

export interface WorkspaceService {
  state(): WorkspaceState;
  /** `[]` — open (or already open); otherwise why not. */
  open(id: string): Promise<Diagnostic[]>;
  close(): Promise<void>;
  rescan(): Promise<void>;
}

export interface ProjectScopeHandle {
  previewUrl: string | null;
  dispose(): Promise<void>;
}

export interface WorkspaceConfig {
  root: string;
  /** Boots one project's scope under `ctx`. Rejects → a diagnostic; `active` stays `null`. */
  scope(ctx: Context, cwd: string): Promise<ProjectScopeHandle>;
}

export const name = 'workspace';

const COMPOSITION_FILENAME = 'e8.yml';

export async function apply(ctx: Context, config: WorkspaceConfig): Promise<void> {
  let projects: Project[] = [];
  let scanDiagnostics: Diagnostic[] = [];
  let openDiagnostics: Diagnostic[] = [];
  let active: { id: string; handle: ProjectScopeHandle } | null = null;
  let disposed = false;
  // The serialization chain. Every public operation appends to it.
  let chain: Promise<unknown> = Promise.resolve();

  const state = (): WorkspaceState => ({
    projects,
    active: active?.id ?? null,
    previewUrl: active?.handle.previewUrl ?? null,
    diagnostics: [...scanDiagnostics, ...openDiagnostics],
  });
  const changed = () => ctx.emit('workspace/changed', state());

  /** `root` is a project iff it holds a FILE named e8.yml. */
  const rootIsProject = await isProjectDir(config.root);

  async function scan(): Promise<void> {
    if (rootIsProject) {
      projects = [{ id: basename(config.root), name: await projectName(config.root) }];
      scanDiagnostics = [];
      return;
    }
    let entries: string[];
    try {
      entries = await readdir(config.root);
    } catch (error) {
      projects = [];
      scanDiagnostics = [
        diagnostic('error', 'workspace', config.root, `cannot list ${config.root}: ${message(error)}`, 'run e8 in a folder that exists and can be read'),
      ];
      return;
    }
    const found: Project[] = [];
    for (const id of entries.sort()) {
      const dir = join(config.root, id);
      if (await isProjectDir(dir)) found.push({ id, name: await projectName(dir) });
    }
    projects = found;
    scanDiagnostics = [];
  }

  function pathOf(id: string): string | null {
    if (!projects.some((p) => p.id === id)) return null;
    return rootIsProject ? config.root : join(config.root, id);
  }

  async function doClose(): Promise<void> {
    if (!active) return;
    const current = active;
    active = null;
    await current.handle.dispose();
  }

  async function doOpen(id: string): Promise<Diagnostic[]> {
    if (active?.id === id) return [];
    const cwd = pathOf(id);
    if (cwd === null) {
      openDiagnostics = [diagnostic('error', 'workspace', id, `no project "${id}" in ${config.root}`, 'pick one of the listed projects')];
      changed();
      return openDiagnostics;
    }
    await doClose();
    if (disposed) return [];
    try {
      const handle = await config.scope(ctx, cwd);
      active = { id, handle };
      openDiagnostics = [];
    } catch (error) {
      openDiagnostics = [diagnostic('error', 'workspace', id, `project "${id}" did not start: ${message(error)}`, 'fix the project and open it again')];
    }
    changed();
    return openDiagnostics;
  }

  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };

  const service: WorkspaceService = {
    state,
    open: (id) => enqueue(() => doOpen(id)),
    close: () =>
      enqueue(async () => {
        if (!active) return;
        await doClose();
        changed();
      }),
    rescan: () =>
      enqueue(async () => {
        await scan();
        changed();
      }),
  };

  await scan();
  ctx.provide('workspace', service);
  ctx.effect(() => () => {
    disposed = true;
    void enqueue(doClose);
  }, 'workspace:close-on-dispose');

  if (rootIsProject) await service.open(projects[0].id);
}

async function isProjectDir(dir: string): Promise<boolean> {
  try {
    if (!(await lstat(dir)).isDirectory()) return false;
    return (await lstat(join(dir, COMPOSITION_FILENAME))).isFile();
  } catch {
    return false;
  }
}

async function projectName(dir: string): Promise<string> {
  const id = basename(dir);
  try {
    const spec: unknown = JSON.parse(await readFile(join(dir, 'game', 'spec.json'), 'utf8'));
    const name = (spec as { name?: unknown } | null)?.name;
    return typeof name === 'string' && name.length > 0 ? name : id;
  } catch {
    return id;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

Note on the "disposing the host disposes the open scope" test: `ctx.fiber.dispose()` runs the effect's disposer synchronously-ish; the test awaits `ctx.fiber.dispose()` and then reads `log.at(-1)`. If cordis does not await the returned promise of an effect disposer, the `close` may land after the assertion — then the test awaits `await new Promise((r) => setTimeout(r, 0))` before asserting, and the report says so (measured, not assumed).

- [ ] **Step 5: Green; mutations**

Run the file. Then mutations (count on `src/plugins/workspace.ts`):

| Test | Mutation | grep pattern before → after |
|---|---|---|
| sorted / not a symlink | drop `.sort()` / replace `lstat` with `stat` in `isProjectDir` | `'entries.sort()'` 1→0 / `'lstat'` 2→0 |
| names | `return id;` unconditionally in `projectName` | `'typeof name === '` 1→0 |
| root is project | `rootIsProject` forced `false` | `'await isProjectDir(config.root)'` 1→0 |
| unknown id | skip the `cwd === null` branch | `'no project "'` 1→0 |
| no-op on same id | drop `if (active?.id === id) return [];` | that line 1→0 |
| close before open | swap `await doClose()` after `config.scope` | order line count |
| serialized | `enqueue` returns `task()` directly | `'chain.then(task, task)'` 1→0 |
| boot failure | `active = { id, handle: … }` inside `catch` | `'did not start'` 1→0 |
| dispose | drop the `ctx.effect` | `'close-on-dispose'` 1→0 |
| rescan keeps active | `active = null` inside rescan | `'await scan();'` count |

- [ ] **Step 6: Commit** — `git add engine/core/contracts/src/protocol.ts engine/ide/host/src/plugins/workspace.ts engine/ide/host/tests/workspace.test.ts && git commit -m "Give the host a workspace: projects by id, one open at a time"`

---

### Task 2: One project is a scope; the host root outlives it

**Files:**
- Create: `engine/ide/host/src/plugins/project-scope.ts`
- Modify: `engine/ide/host/src/index.ts`, `engine/ide/host/src/plugins/rpc.ts`, `engine/apps/cli/src/index.ts`, `engine/apps/web/tests/e2e/project-fixture.ts`
- Test: `engine/ide/host/tests/host.test.ts`, `rpc.test.ts`, `cli-smoke.test.ts`, new `project-scope.test.ts`

**Interfaces:**
- Consumes: `workspace` (Task 1); every cwd-bound plugin as it exists today.
- Produces:
  ```ts
  // index.ts
  export interface IdeHostOptions { root: string; port?: number; host?: string; previewPort?: number }
  export interface IdeHost { ctx: Context; url: string; stop(): Promise<void> }   // `diagnostics` removed: they live in ctx.workspace.state().diagnostics and the active scope's composition
  // project-scope.ts
  export interface ProjectScopeConfig { cwd: string; previewPort: number }
  export const name = 'project-scope'; export const inject = ['loader', 'server', 'ideRpc'];
  export function bootProjectScope(ctx: Context, cwd: string, previewPort: number): Promise<ProjectScopeHandle>  // the `scope` factory the root hands to `workspace`
  // rpc.ts
  export interface IdeRpcService { …; attach(server: Server): void }   // Task 4 uses it
  ```

- [ ] **Step 1: `project-scope.ts`**

```ts
/**
 * Everything that used to be bound to `createIdeHost`'s `cwd`, as one
 * plugin the workspace plugs when a project opens and disposes when it
 * closes (spec §5). The order and the `inject`s inside are exactly what
 * `index.ts` had; only the owner of the scope changed.
 *
 * Two facts from the pre-plan spike, both load-bearing:
 *  - `plugin-include` resolves `config.path` with `new URL(path, ctx.baseUrl)`,
 *    so an absolute `file://` URL works with no `baseUrl` on the root.
 *  - A loader entry created from inside a scope OUTLIVES the scope's
 *    dispose (it belongs to the root tree). `ctx.loader.remove(id)` in an
 *    effect disposer is what actually takes the project's IDE plugins
 *    down with the project.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Context } from 'cordis';
import * as clientAssets from './client-assets';
import * as composition from './composition';
import * as devGame from './dev-game';
import * as files from './files';
import * as project from './project';
import * as runtimeAssets from './runtime-assets';
import * as schema from './schema';
import { loadComposition } from '../composition-file';
import type { ProjectScopeHandle } from './workspace';

export interface ProjectScopeConfig {
  cwd: string;
  previewPort: number;
}

export const name = 'project-scope';
export const inject = ['loader', 'server', 'ideRpc'];

export async function apply(ctx: Context, config: ProjectScopeConfig): Promise<void> {
  const { cwd } = config;
  // e8.yml (the project's IDE plugins): validated by us first (see
  // composition-file.ts, moved out of index.ts unchanged), then handed to
  // plugin-include by absolute path, and REMOVED with this scope.
  const bootDiagnostics = await loadComposition(ctx, cwd, (options) => ctx.loader.create(options));
  await ctx.plugin(composition, { cwd, bootDiagnostics });
  await ctx.plugin(project, { cwd });
  await ctx.plugin(schema, { cwd });
  await ctx.plugin(files, { cwd });
  await ctx.plugin(clientAssets, { cwd });
  await ctx.plugin(runtimeAssets, { cwd });
  await ctx.loader.await();
  // dev-game: what `e8 dev` used to add after the host. Its own config is
  // read from the project the way the CLI read it (game/spec.json).
  const game = await readGameConfig(cwd);
  if (game.diagnostics.length) {
    // Recorded on the composition's list so the panel shows it; the
    // project is open without a game rather than not open at all.
    for (const d of game.diagnostics) ctx.ideRpc.reportGameDiagnostics([d]);
  } else {
    await ctx.plugin(devGame, { ...game.config!, port: 0, previewPort: config.previewPort });
  }
}
```

`loadComposition` moves from `index.ts` into `engine/ide/host/src/composition-file.ts` with one change: it takes the create function and RETURNS the entry id alongside diagnostics, and `project-scope` does `ctx.effect(() => () => ctx.loader.remove(id), 'project-scope:include')` when an id came back. Concretely, inside `loadComposition`, replace `config: { path: COMPOSITION_FILE }` with `config: { path: pathToFileURL(join(cwd, COMPOSITION_FILENAME)).href }` and return `{ diagnostics, entryId }`. `readGameConfig(cwd)` is the CLI's current `spec.json` reading (`engine/apps/cli/src/index.ts` lines 25–47), moved here verbatim in shape, returning `{ config?: { root, gamesDir, gameId, betLevel }, diagnostics }` instead of `process.exit`.

`bootProjectScope` (exported from the same file):

```ts
export function bootProjectScope(root: Context, cwd: string, previewPort: number): Promise<ProjectScopeHandle> {
  const fiber = root.plugin({ name, inject, apply }, { cwd, previewPort });
  return fiber.then(() => ({
    // Task 4 fills this in from dev-game's preview server; until then the
    // game is on the root server, so its URL is the root's.
    previewUrl: `http://${root.server.host}:${root.server.port}`,
    dispose: () => fiber.dispose(),
  }));
}
```

(`fiber.then` — check cordis rc.8's `Fiber` is thenable; the host already `await`s `ctx.plugin(...)` everywhere, so it is. If a boot error inside `apply` rejects the fiber, the promise rejects and `workspace` records the diagnostic.)

- [ ] **Step 2: `rpc.ts` on the root**

Change `export const inject = ['composition', 'server']` → `['server']`. Every `ctx.composition.snapshot()` / `.update()` goes through a local:

```ts
/** The active project's composition, or `null` between projects. Read at call time — the root has none. */
const compositionOf = () => ctx.get('composition') ?? null;
const emptySnapshot = (): Snapshot => ({ rows: [], diagnostics: [] });
```

`broadcast()` sends `compositionOf()?.snapshot() ?? emptySnapshot()`; the `update` message with no composition answers `{ type: 'diagnostics', diagnostics: [diagnostic('error','ide-rpc',message.id,'no project is open','open a project first')] }`. Add `ctx.on('workspace/changed', () => void broadcast())` so a switch pushes the new (or empty) snapshot. Add to the service:

```ts
attach(server: Server) {
  server.ws('/ide', handler);   // the same handler the root registration uses; extract it to a const
}
```

and the root registration becomes `service.attach(ctx.server)`. `Server` type from `@cordisjs/plugin-server`.

- [ ] **Step 3: `index.ts` root**

`createIdeHost({ root, port, host, previewPort })`: `Loader`; `Server`; the error boundary `ctx.server.use(...)` as is; `rpc`; `workspace` with `scope: (c, cwd) => bootProjectScope(c, cwd, previewPort ?? 5681)`; routes:

```ts
ctx.server.get('/api/workspace', async (_req, res) => res.json(ctx.workspace.state()));
ctx.server.post('/api/workspace/open', async (req, res) => {
  let body: { id?: unknown } = {};
  try { body = (await req.json()) as { id?: unknown }; } catch { /* no body: refused below */ }
  if (typeof body.id !== 'string') {
    res.status = 400;
    return res.json({ diagnostics: [diagnostic('error', 'workspace', '/api/workspace/open', 'body must be { id: string }')] });
  }
  const refused = await ctx.workspace.open(body.id);
  if (refused.length) {
    res.status = ctx.workspace.state().projects.some((p) => p.id === body.id) ? 500 : 400;
    return res.json({ diagnostics: refused });
  }
  res.json(ctx.workspace.state());
});
ctx.server.post('/api/workspace/close', async (_req, res) => { await ctx.workspace.close(); res.json(ctx.workspace.state()); });
ctx.server.get('/api/health', …)   // as is
```

`ctx.on('workspace/changed', (state) => ctx.ideRpc.broadcastWorkspace(state))` — add `broadcastWorkspace(state)` to `IdeRpcService` (sends `{ type: 'workspace', workspace }` to every client; also sent as the FIRST frame on connect, before the snapshot). Remove `ctx.baseUrl = …` (nothing on the root resolves against it after this task — verify with `grep -rn baseUrl engine/ide/host/src`). Remove `IdeHost.diagnostics`.

- [ ] **Step 4: CLI**

```ts
const [command = 'ide'] = process.argv.slice(2);
if (!['ide', 'dev'].includes(command)) { console.error('usage: e8 [ide|dev]'); process.exit(1); }
const host = await createIdeHost({
  root: process.cwd(),
  port: process.env.PORT ? Number(process.env.PORT) : undefined,
  previewPort: process.env.PREVIEW_PORT ? Number(process.env.PREVIEW_PORT) : undefined,
});
const state = host.ctx.workspace.state();
if (command === 'dev' && state.active === null) {
  console.error(`e8 dev: ${process.cwd()} is not a project (no e8.yml) — listing ${state.projects.length} project(s) instead`);
}
console.log(`e8 ${command} listening on ${host.url}`);
for (const diag of state.diagnostics) { … as today … }
```

`e8 dev` in a project folder behaves as before (auto-open); in a workspace folder it degrades to `e8` with one line of stderr, not an exit.

- [ ] **Step 5: Tests**

- `host.test.ts`: `createIdeHost({ cwd })` → `({ root })`; the two `host.diagnostics` assertions become `host.ctx.workspace.state().diagnostics` for scan errors, and — for a broken `e8.yml` in a root-is-project boot — the composition's `snapshot().diagnostics` (the boot diagnostics travel with the scope). Add: boot in a two-project folder → `active === null`, `GET /api/workspace` lists both; `POST /api/workspace/open {id}` → 200 with `active`, `/api/files` now answers (route registered by the scope), `POST open` of the other id → the first scope's `files` route is gone… (test by identity: `ctx.loader.entries()` for the include entry before/after switch — the spike's exact check), `open` unknown → 400 with diagnostics.
- `rpc.test.ts`: a client connecting with no project gets `workspace` then an empty `snapshot`; `update` with no project → diagnostics frame.
- `project-scope.test.ts`: boots on a fixture project; the include entry id is in `ctx.loader.entries()`; after `fiber.dispose()` it is not; `bootProjectScope` rejects → workspace diagnostic (through `workspace` with the real factory on a folder whose `e8.yml` is a directory… pick the cheapest real failure: `game/spec.json` valid but `dev-game`'s `binPath` pointing at nothing → today that is a `startupDiagnostic`, not a throw; so use a missing `cwd` directory instead: `files` throws on an absent root? Measure; pick whichever really rejects and say so).
- `cli-smoke.test.ts`: `e8` with no argument in a project folder; `e8 dev` in a non-project folder prints the one stderr line and still listens.
- `project-fixture.ts`: `startDevHost(dir)` → `createIdeHost({ root: dir, port: 5679, previewPort: 0 })`; `gameUrl: host.ctx.workspace.state().previewUrl!` (Task 2: still the root URL). The `spec.json` read moves into `project-scope`, so the fixture stops reading it.

Run: host unit suite; ide-client unit suite (untouched); then Playwright alone — 70/70 expected.

- [ ] **Step 6: Mutations** (the ones the unit tests can see): remove the `loader.remove` effect → entry survives dispose; `inject` back to `['composition','server']` in rpc → rpc pending on a root without project (host test times out — turn that into an explicit `expect(...).resolves` with a 2s cap); drop `workspace/changed` broadcast → switch test sees stale snapshot.

- [ ] **Step 7: Commit** — "Make a project a scope the host can open and close"

---

### Task 3: The client knows the workspace

**Files:**
- Create: `engine/ide/client/src/plugins/workspace.ts`
- Modify: `engine/ide/client/src/context.ts` (compose it after `connection`), `engine/ide/client/src/shell/StatusItems.tsx`, `engine/ide/client/src/screens/PreviewWall.tsx`
- Test: `engine/ide/client/tests/workspace.test.ts`, `status-items.test.tsx`, `preview.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface WorkspaceClientService {
    state(): WorkspaceState | null;          // null before the first answer
    open(id: string): Promise<Diagnostic[]>; // POST; [] on success; refusals reported to connection.report() too
    subscribe(l: () => void): () => void;
  }
  export interface WorkspaceClientConfig { url: string; socketFactory?; fetchFn? }   // = ConnectionConfig & FilesConfig's fetchFn
  declare module 'cordis' { interface Context { workspace: WorkspaceClientService } }
  ```

- [ ] **Step 1: Tests** (`workspace.test.ts`, using the fake socket + fake fetch the `connection.test.ts` / `files.test.ts` already use — copy their helpers, do not import across test files):
  - on boot: `GET /api/workspace` once; `state()` is that answer; subscribers notified once.
  - a `{type:'workspace'}` frame replaces `state()` and notifies; frames of other types are ignored; malformed frames ignored (same guard as `connection`).
  - `open('x')` POSTs `{ id: 'x' }`; 200 → `[]` and `state()` replaced by the body; 400/500 with `{ diagnostics }` → returned AND `ctx.connection.report(d)` called for each; network failure → one diagnostic `workspace`, reported.
  - `fetch` of `GET /api/workspace` failing → `state()` stays `null`, one diagnostic reported (the panel shows it).
- [ ] **Step 2: Implement** — its own socket (the `game-diagnostics` plugin's pattern, line 135), its own fetch wrapper (the `files` plugin's pattern, line 101). Reads `connection` via `inject: ['connection']`.
- [ ] **Step 3: `ProjectStatus`** — `useWorkspace(ctx)` hook (subscribe/state) → label `state === null ? 'loading…' : state.active === null ? 'no project' : projects.find(p => p.id === active)?.name ?? active`. `status-items.test.tsx`: name shown; `no project`; loading. Mutation: label from `rows[0]?.id` again.
- [ ] **Step 4: `PreviewWall`** — `computePreviewUrl()` is deleted; `Preview`/`PreviewWall` read `ctx.workspace.state()?.previewUrl`; `null` → `<p className="e8-empty" data-testid="preview-unavailable">preview unavailable: no project open</p>` (English inline, per copy rule) — no iframe. `preview.test.tsx`: iframe `src` equals `previewUrl`; `null` → no iframe, the note; a `workspace` change to a new `previewUrl` remounts the iframe (the existing "reload = new element" rule). Mutation: hardcode `:5679` back.
- [ ] **Step 5: Suite, Playwright (70 — `PreviewWall` now takes the URL from the wire, which Task 2 set to the root URL; behaviour identical), commit** — "Tell the client which project is open, and where its game is"

---

### Task 4: The game on its own origin

**Files:**
- Modify: `engine/ide/host/src/plugins/dev-game.ts`, `runtime-assets.ts`, `project-scope.ts` (`previewUrl` from the scope), `rpc.ts` (nothing new — `attach` from Task 2)
- Test: `dev-game.test.ts`, `runtime-assets.test.ts`, `project-fixture.ts` (`gameUrl` = `previewUrl`, now 5681-or-free)

- [ ] **Step 1: `DevGameConfig` += `previewPort: number`.** In `apply`, before vite:

```ts
// A second HTTP server for the game, on its own origin (spec §6, on
// purpose). `isolate('server')` gives this child context its own
// `server` binding so the root's stays the IDE's; the instance is read
// off the plugin's own fiber ctx — the one place a freshly provided
// service is readable without `inject` (measured in the pre-plan spike;
// the same rule dev-game already applies to `session`).
const previewCtx = ctx.isolate('server');
const previewFiber = previewCtx.plugin(Server, { host: ctx.server.host, port: config.previewPort });
let preview: Server;
try {
  await previewFiber;
  preview = previewFiber.ctx.server;
} catch (error) {
  ctx.ideRpc.reportGameDiagnostics([
    diagnostic('error', 'dev-game', `preview port ${config.previewPort}`, `the preview server could not start: ${message(error)}`, 'free the port, or set PREVIEW_PORT'),
  ]);
  ctx.provide('devGamePreview', { url: null });
  return;
}
ctx.provide('devGamePreview', { url: `http://${preview.host}:${preview.port}` });
```

Then every `ctx.server.post/all` in this file becomes `preview.post/all`; `ctx.ideRpc.attach(preview)`; `runtimeAssets.attachGameRoutes(preview, ctx)` (Step 2). Vite's `server.host/port` config → the preview's. `hmr: false` unchanged.

- [ ] **Step 2: `runtime-assets.ts`** — the two handlers (`/api/composition`, `/plugin-runtime/:id`) become named functions; `apply` registers `/api/composition` on `ctx.server` (the IDE still reads it) and exports `attachGameRoutes(server, ctx)` registering BOTH on the given server. The `/plugin-runtime` registration on the root goes away (nothing on 5679 imports a runtime half — the vite proxy comment in `vite.config.ts` says exactly this).

- [ ] **Step 3: `project-scope.ts`** — `bootProjectScope` returns `previewUrl: fiber.ctx.get('devGamePreview')?.url ?? null` (the scope's own ctx provides it — readable). `dev-game` gets `previewPort: config.previewPort`.

- [ ] **Step 4: Tests** — `dev-game.test.ts`: the game answers on `previewUrl`, NOT on the root (`GET <root>/` → 404 JSON, `GET <preview>/` → vite's html); `/api/spin` on preview only; `/ide` ws upgrades on both; a busy `previewPort` (bind a throwaway `net` server first) → diagnostic, `devGamePreview.url === null`, scope still up; dispose closes 5681 (connect refused) and leaves 5679. `runtime-assets.test.ts`: `/plugin-runtime/:id` is on the preview server, and `/api/composition` on both. Fixture: `gameUrl: state.previewUrl!` (previewPort: 0 in the fixture → free port; Playwright specs that hardcode `5679` for the game — grep `5679` in `tests/e2e/*.spec.ts` — switch to `host.gameUrl`).

- [ ] **Step 5: Playwright 70/70 alone; `pgrep`; commit** — "Serve the game from its own origin, on purpose"

---

### Task 5: The host serves the IDE

**Files:**
- Create: `engine/ide/host/src/plugins/ide-static.ts`
- Modify: `engine/ide/host/src/index.ts` (plug it LAST), `engine/apps/cli/src/index.ts` (print the IDE URL)
- Test: `engine/ide/host/tests/ide-static.test.ts`

- [ ] **Step 1:** `ide-static`: config `{ dist?: string }` — default `process.env.IDE_DIST ?? fileURLToPath(new URL('../../../../apps/web/dist', import.meta.url))` (the same ESM-relative trick `project.ts` uses for `REPO_BUNDLES_DIR`). Registered as the catch-all `ctx.server.all(/^.*$/, …)` on the ROOT server (dev-game's catch-all no longer lives there after Task 4): `GET`/`HEAD` only; paths starting with `/api/`, `/ide`, `/plugin-client/` → `next()`; resolve `join(dist, path)` with `realpath` containment (the `files` rule); a file → stream it with a content type from a small map (`html js css map png svg woff2 json ico`), else `application/octet-stream`; a path with no extension → `index.html`; no `dist` (`index.html` absent) → `503` `text/html` page with the diagnostic text «оболочка не собрана: `npm run build -w @energy8engine/ide-web`» and the same as JSON on `Accept: application/json`.
- [ ] **Step 2: Tests** — serve a temp `dist` with `index.html` + `assets/app.js`: `/` and `/#/doc/x`-style paths (no extension) → index; `/assets/app.js` → js with content type; `/assets/../../etc/passwd` → index (contained) or 404, never a file outside; `/api/health` still JSON; `/ide` still upgrades; no dist → 503 page. Mutations: drop the `next()` for `/api/` → health becomes html; drop containment.
- [ ] **Step 3: CLI** prints `IDE: ${host.url}/` and, when `dist` is missing, the one-line hint. Commit — "Serve the built IDE from the host, so one process is enough"

---

### Task 6: Projects in the sidebar, and switching that respects unsaved work

**Files:**
- Create: `engine/ide/client/src/shell/Projects.tsx`
- Modify: `engine/apps/web/src/App.tsx`, `engine/ide/client/src/plugins/workspace.ts` (switch semantics), `engine/ide/client/src/styles.css` (rows reuse `.e8-explorer-entry` rules — add `.e8-project-active` mark only)
- Test: `engine/ide/client/tests/projects.test.tsx`, `workspace.test.ts` (switch cases)

- [ ] **Step 1: `Projects.tsx`** — `useWorkspace(ctx)`; header row «Проекты» (`.e8-explorer-header` rules); list `ul.e8-explorer-tree` of `li.e8-explorer-entry[data-testid=project-<id>]` with `name` and a muted `id` when different; active → `aria-current="true"` + `.e8-project-active`; click → `ctx.workspace.open(id)` through the switch guard (Step 2); empty → `<p class="e8-empty" data-testid="projects-empty">нет проектов в этой папке</p>` plus each `state.diagnostics` as `.e8-explorer-diagnostic`; `state === null` → «loading…».
- [ ] **Step 2: switch semantics in the client `workspace` plugin** (`inject: ['connection', 'shell']`):
  - `open(id)`: if `ctx.shell.hasDirtyDocuments()` → `ctx.shell.confirm?`… the shell has no generic confirm API; the plan's rule: `Projects.tsx` asks with the SAME confirm element the shell uses for tab close — expose it: `ShellService.confirm(message, onYes)` is NOT in the surface. Cheapest honest path: `Projects.tsx` renders its own inline confirm row (`data-testid="confirm-yes"`/`confirm-no`, the testids the suite already knows) under the clicked project when `hasDirtyDocuments()`; «Да» → `open(id)`. No new shell API.
  - on a `workspace` frame whose `active` differs from the last seen: for every `doc` in `ctx.shell.documents()` with key starting `f:` → `ctx.shell.close(key, { force: true })`; if any of those was `dirty` → `ctx.connection.report(diagnostic('warning','workspace', <active>, 'unsaved changes discarded on project switch: ' + paths.join(', ')))`.
- [ ] **Step 3: `App.tsx`** — register `shell.activity` `{ key: 'workspace', title: 'Проекты', icon: 'workspace' (add a simple SVG in the icon map next to `files`), order: -1, opens: 'sidebar' }` and `shell.sidebar` `{ key: 'workspace', title: 'Проекты' }` → `Projects`. Default sidebar at fresh load: `workspace` when `state.active === null`, else `explorer` (App's line 178 rule extended).
- [ ] **Step 4: Tests** — `projects.test.tsx`: renders names/ids, active mark, click → `open`; empty state + diagnostics; dirty → confirm row, «Нет» keeps, «Да» opens. `workspace.test.ts` (client): frame with new `active` closes `f:` docs by identity (register two `f:` docs + one plugin doc, assert only the two closed), dirty one → one diagnostic naming the path; same `active` again → nothing closed. Mutations: drop the `f:` filter (plugin doc closed too); drop the dirty report.
- [ ] **Step 5: ide-client suite; Playwright 70/70 (the new sidebar changes the default sidebar only when no project is open — the fixture always has one); commit** — "List the projects, open one with a click, and never lose an unsaved file silently"

---

### Task 7: Prove it with a live `e8` and a real browser

**Files:**
- Create: `engine/apps/web/tests/e2e/workspace.spec.ts`
- Modify: `engine/apps/web/tests/e2e/project-fixture.ts` (`workspaceCopy(n)` → a temp folder with n copies of the fixture project, the second's `spec.json.name` = `'Second Slot'`; `startHost(root, { previewPort: 0 })`)

Tests (each `try/finally` with `host.stop()` + `rmSync`; all through vite 5680 except test 6):

1. two projects: sidebar `projects-*` shows both names; `doc-none`/«откройте проект»; `status-project` says `no project`.
2. click first: `explorer-game/script.spin` visible; `status-project` shows its name; preview iframe `src` = `previewUrl` from `GET /api/workspace`; `#status` inside the iframe not empty (frame locator).
3. click second: `pgrep -fl e8-server` count 1 before and after, pid differs (read via `execSync` in the test, the way `runtime.spec.ts` shells out — check it does; else `ps`); iframe `src` unchanged host but the game shows `Second Slot`'s spec (`#status` text differs — measure the fixture to pick a visible difference, e.g. bet level); a `.spin` tab opened in step 2 is gone.
4. dirty `.spin` (type into Monaco) + click second → `confirm-yes`/`confirm-no` visible; `confirm-no` → tab still there, `status-project` unchanged; `confirm-yes` → switched, tab gone, panel has the `unsaved changes discarded` warning.
5. (covered by the existing 70 under `e8 dev` semantics — do not duplicate.)
6. `GET http://127.0.0.1:5679/` — build `dist` once in `globalSetup` (`vite build` in `engine/apps/web`, ~20s); the page served from the HOST (no 5680) shows `activity-workspace`; clicking a project works there too (same assertions as 2, minus Monaco).
7. `IDE_DIST=/nonexistent` host → `GET /` 503 with the hint text; `GET /api/workspace` 200.

Mutations (each landed by count): `workspace.ts` `rootIsProject` forced true → test 1 lists one; `doClose` removed → test 3 counts 2 `e8-server`; `f:` close removed → test 3's tab stays; dirty confirm removed → test 4; `ide-static` `next()` for `/api/` removed → test 7's `/api/workspace` is html.

Run alone; `pgrep`, `e8-compose-*` check. Commit — "Measure one process over two projects"

---

## Self-review

- **Spec coverage:** §3 → T2 (CLI, auto-open rule), T5 (static); §4 → T1; §5 → T2 (scope, include, remove); §6 → T4 (+ Ruling A for what the game needs same-origin); §7 → T5; §8 → T3, T6; §9 → T1 (types), T2 (routes, frames); §10 → T1/T2/T4/T5 refusal cases; §12 → T7 + unit tests per task; §13 risks: include/remove and second server settled by the spike (facts in Global Constraints), orphaned `e8-server` → T7 test 3, port 5681 in fixtures → T2/T4 fixture, dist build time → T7 globalSetup, `baseUrl` → T2 Step 3 grep.
- **Placeholders:** T2 Step 5's `project-scope` rejection case says "measure; pick whichever really rejects" — deliberate: the plan must not assert which failure throws before it is measured; the implementer records the answer.
- **Type consistency:** `ProjectScopeHandle` (T1) is what `bootProjectScope` (T2, T4) returns; `WorkspaceState.previewUrl` (T1) is what `PreviewWall` (T3) reads and `dev-game`'s `devGamePreview.url` (T4) feeds; `IdeRpcService.attach` (T2) is what T4 calls; `WorkspaceClientService.open` (T3) is what `Projects.tsx` (T6) and T7's clicks exercise.
