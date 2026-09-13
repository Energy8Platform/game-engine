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
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Context } from 'cordis';
import { type Diagnostic, type Project, type WorkspaceState, diagnostic } from '@energy8engine/contracts';

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
    projects: [...projects],
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
        diagnostic(
          'error',
          'workspace',
          config.root,
          `cannot list ${config.root}: ${message(error)}`,
          'run e8 in a folder that exists and can be read',
        ),
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

  /**
   * Never rejects: a scope that fails to stop is a diagnostic, and the next
   * open proceeds. Returns whether anything was closed.
   */
  async function doClose(): Promise<boolean> {
    if (!active) return false;
    const current = active;
    active = null;
    try {
      await current.handle.dispose();
    } catch (error) {
      openDiagnostics = [
        diagnostic(
          'error',
          'workspace',
          current.id,
          `project "${current.id}" did not stop cleanly: ${message(error)}`,
          'the next open proceeds; check the host log',
        ),
      ];
    }
    return true;
  }

  async function doOpen(id: string): Promise<Diagnostic[]> {
    if (active?.id === id) return [];
    const cwd = pathOf(id);
    if (cwd === null) {
      openDiagnostics = [
        diagnostic('error', 'workspace', id, `no project "${id}" in ${config.root}`, 'pick one of the listed projects'),
      ];
      changed();
      return openDiagnostics;
    }
    // A frame with `active: null` goes out BETWEEN the two projects, before
    // the next scope boots: listeners that reset per-project state on
    // "a project left" (`rpc`) do it here, so nothing the NEXT boot reports
    // (an unusable spec.json, a busy preview port) is wiped by its own open.
    if (await doClose()) changed();
    if (disposed) return [];
    try {
      const handle = await config.scope(ctx, cwd);
      active = { id, handle };
      openDiagnostics = [];
    } catch (error) {
      openDiagnostics = [
        diagnostic('error', 'workspace', id, `project "${id}" did not start: ${message(error)}`, 'fix the project and open it again'),
      ];
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
  // cordis awaits a disposer's returned thenable: `fiber.dispose()` resolves
  // only once the open scope is really down.
  ctx.effect(() => () => {
    disposed = true;
    return enqueue(doClose);
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
