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
 * A template is a directory under `templatesDir` holding a FILE named
 * `e8.template.yml` with a `name`. `create` copies one (minus
 * `node_modules`), writes the new id where the template left `{{id}}`
 * (`game/spec.json`, `index.html`) and into `package.json`'s `name` (a
 * JSON edit — a literal `{{id}}` there would break the monorepo's own
 * workspace glob), then rescans and opens the result.
 *
 * `open`/`close`/`rescan`/`create` are serialized on one promise chain: two
 * clicks in a row are two operations in order, never one scope booting
 * while another is still tearing down. Nothing here throws; every refusal
 * is a `Diagnostic` in the returned list and in `state().diagnostics`.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'cordis';
import * as yaml from 'js-yaml';
import {
  type Diagnostic,
  PROJECT_ID_PATTERN,
  type Project,
  type Template,
  type WorkspaceState,
  diagnostic,
} from '@energy8engine/contracts';

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
  /**
   * `[]` — created and open. A refusal to create carries `code`:
   * `invalid` | `exists` | `unknown-template` | `single-project` |
   * `copy-failed`; a project that was created but did not start returns
   * `open`'s own diagnostic (no code).
   */
  create(input: { template: string; id: string }): Promise<Diagnostic[]>;
}

export interface ProjectScopeHandle {
  previewUrl: string | null;
  dispose(): Promise<void>;
}

export interface WorkspaceConfig {
  root: string;
  /** Boots one project's scope under `ctx`. Rejects → a diagnostic; `active` stays `null`. */
  scope(ctx: Context, cwd: string): Promise<ProjectScopeHandle>;
  /** Where templates live. Default: `E8_TEMPLATES`, else this repo's `engine/templates`. */
  templatesDir?: string;
}

export const name = 'workspace';

const COMPOSITION_FILENAME = 'e8.yml';
const TEMPLATE_MANIFEST = 'e8.template.yml';
const REPO_TEMPLATES_DIR = fileURLToPath(new URL('../../../../templates', import.meta.url));
/** Files where the template writes `{{id}}` literally. `package.json` is a JSON edit instead. */
const SUBSTITUTED = ['game/spec.json', 'index.html'];

/** What `e8.template.yml` may hold, before validation. */
type TemplateManifest = { name?: unknown; description?: unknown };

export async function apply(ctx: Context, config: WorkspaceConfig): Promise<void> {
  const templatesDir = config.templatesDir ?? process.env.E8_TEMPLATES ?? REPO_TEMPLATES_DIR;
  let projects: Project[] = [];
  let templates: Template[] = [];
  let scanDiagnostics: Diagnostic[] = [];
  let openDiagnostics: Diagnostic[] = [];
  let active: { id: string; handle: ProjectScopeHandle } | null = null;
  let disposed = false;
  // The serialization chain. Every public operation appends to it.
  let chain: Promise<unknown> = Promise.resolve();

  const state = (): WorkspaceState => ({
    projects: [...projects],
    templates: [...templates],
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
      templates = [];
      scanDiagnostics = [];
      return;
    }
    scanDiagnostics = await scanTemplates();
    let entries: string[];
    try {
      entries = await readdir(config.root);
    } catch (error) {
      projects = [];
      scanDiagnostics.push(
        diagnostic(
          'error',
          'workspace',
          config.root,
          `cannot list ${config.root}: ${message(error)}`,
          'run e8 in a folder that exists and can be read',
        ),
      );
      return;
    }
    const found: Project[] = [];
    for (const id of entries.sort()) {
      const dir = join(config.root, id);
      if (await isProjectDir(dir)) found.push({ id, name: await projectName(dir) });
    }
    projects = found;
  }

  /** Sets `templates`; returns what kept a directory out of the list. */
  async function scanTemplates(): Promise<Diagnostic[]> {
    templates = [];
    let entries: string[];
    try {
      entries = await readdir(templatesDir);
    } catch (error) {
      return [
        diagnostic(
          'error',
          'workspace',
          templatesDir,
          `cannot list templates in ${templatesDir}: ${message(error)}`,
          'point E8_TEMPLATES at a folder of templates',
        ),
      ];
    }
    const problems: Diagnostic[] = [];
    for (const id of entries.sort()) {
      const dir = join(templatesDir, id);
      if (!(await hasFile(dir, TEMPLATE_MANIFEST))) continue;
      let manifest: TemplateManifest = {};
      try {
        manifest = (yaml.load(await readFile(join(dir, TEMPLATE_MANIFEST), 'utf8')) ??
          {}) as TemplateManifest;
      } catch {
        // an unreadable/malformed manifest is "no name" below
      }
      const name = manifest.name;
      if (typeof name !== 'string' || name.length === 0) {
        problems.push(
          diagnostic(
            'error',
            'workspace',
            id,
            `template "${id}" (${dir}) has no name in ${TEMPLATE_MANIFEST}; not listed`,
            `give ${TEMPLATE_MANIFEST} a non-empty name`,
          ),
        );
        continue;
      }
      const description = manifest.description;
      templates.push({ id, name, description: typeof description === 'string' ? description : '' });
    }
    return problems;
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
        diagnostic(
          'error',
          'workspace',
          id,
          `no project "${id}" in ${config.root}`,
          'pick one of the listed projects',
        ),
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
        diagnostic(
          'error',
          'workspace',
          id,
          `project "${id}" did not start: ${message(error)}`,
          'fix the project and open it again',
        ),
      ];
    }
    changed();
    return openDiagnostics;
  }

  async function doCreate({
    template,
    id,
  }: {
    template: string;
    id: string;
  }): Promise<Diagnostic[]> {
    const refuse = (code: string, text: string, fix: string): Diagnostic[] => {
      openDiagnostics = [{ ...diagnostic('error', 'workspace', id, text, fix), code }];
      changed();
      return openDiagnostics;
    };
    if (rootIsProject) {
      return refuse(
        'single-project',
        'this folder is a single project; run e8 in a folder of projects',
        'start e8 one folder up',
      );
    }
    if (!PROJECT_ID_PATTERN.test(id)) {
      return refuse(
        'invalid',
        `"${id}" is not a project id`,
        'lowercase letters, digits and dashes, starting with a letter or digit, at most 64 characters',
      );
    }
    const dest = join(config.root, id);
    if (projects.some((p) => p.id === id) || existsSync(dest)) {
      return refuse('exists', `project "${id}" already exists`, 'pick another id');
    }
    if (!templates.some((t) => t.id === template)) {
      return refuse(
        'unknown-template',
        `no template "${template}"`,
        'pick one of the listed templates',
      );
    }
    try {
      cpSync(join(templatesDir, template), dest, {
        recursive: true,
        filter: (p) => basename(p) !== 'node_modules',
      });
      for (const rel of SUBSTITUTED) {
        const file = join(dest, rel);
        if (existsSync(file))
          writeFileSync(file, readFileSync(file, 'utf8').replaceAll('{{id}}', id));
      }
      const pkg = join(dest, 'package.json');
      if (existsSync(pkg)) {
        const json = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string };
        json.name = id;
        writeFileSync(pkg, `${JSON.stringify(json, null, 2)}\n`);
      }
    } catch (error) {
      rmSync(dest, { recursive: true, force: true });
      return refuse(
        'copy-failed',
        `could not create "${id}" from template "${template}": ${message(error)}`,
        'check that the template is readable and the workspace writable',
      );
    }
    await scan();
    changed();
    return doOpen(id);
  }

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
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
    create: (input) => enqueue(() => doCreate(input)),
  };

  await scan();
  ctx.provide('workspace', service);
  // cordis awaits a disposer's returned thenable: `fiber.dispose()` resolves
  // only once the open scope is really down.
  ctx.effect(
    () => () => {
      disposed = true;
      return enqueue(doClose);
    },
    'workspace:close-on-dispose',
  );

  if (rootIsProject) await service.open(projects[0].id);
}

const isProjectDir = (dir: string) => hasFile(dir, COMPOSITION_FILENAME);

/** `dir` is a directory (not a symlink) holding a FILE named `filename`. */
async function hasFile(dir: string, filename: string): Promise<boolean> {
  try {
    if (!(await lstat(dir)).isDirectory()) return false;
    return (await lstat(join(dir, filename))).isFile();
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
