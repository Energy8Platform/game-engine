import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { Context } from 'cordis';
import Loader from '@cordisjs/plugin-loader';
import Server from '@cordisjs/plugin-server';
import * as yaml from 'js-yaml';
import * as clientAssets from './plugins/client-assets';
import * as composition from './plugins/composition';
import * as rpc from './plugins/rpc';

export interface IdeHostOptions {
  /** Project directory; its e8.yml is the composition. */
  cwd: string;
  /** 0 picks a free port — used by tests. */
  port?: number;
  host?: string;
}

export interface IdeHost {
  ctx: Context;
  /** Base URL the browser talks to, e.g. http://127.0.0.1:5679 */
  url: string;
  /**
   * Boot-time failures (currently: e8.yml missing, unparsable, or not a
   * well-formed composition) that did not stop the host from starting. The
   * host still serves so the IDE can show these to the user instead of a
   * blank page.
   */
  diagnostics: Diagnostic[];
  stop(): Promise<void>;
}

/**
 * The composition file. This is the Slice 0 stand-in for the profile + patch
 * format; the project package replaces it without touching this module's API.
 */
export const COMPOSITION_FILE = './e8.yml';
const COMPOSITION_FILENAME = 'e8.yml';

/**
 * Boots an IDE host for the project at `options.cwd`: loads its e8.yml
 * composition, starts the plugin loader and HTTP/WS server, and returns a
 * handle to both.
 *
 * Side effect worth knowing about before embedding this: booting installs a
 * process-wide `process.on('unhandledRejection')` listener (once per
 * process, shared across every host) so that a plugin whose `apply()`
 * throws degrades to a row-level diagnostic instead of crashing the host —
 * see the doc comment on `ensureUnhandledRejectionGuard` in
 * `plugins/composition.ts` for the full mechanics. The listener is never
 * removed and is not scoped to any one `IdeHost` instance or its `stop()`.
 */
export async function createIdeHost(options: IdeHostOptions): Promise<IdeHost> {
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(options.cwd).href + '/';

  try {
    await ctx.plugin(Loader);

    const diagnostics = await loadComposition(ctx, options.cwd);

    await ctx.plugin(composition, { cwd: options.cwd, bootDiagnostics: diagnostics });

    await ctx.plugin(Server, { host: options.host ?? '127.0.0.1', port: options.port ?? 5679 });
    await ctx.plugin(rpc);
    await ctx.plugin(clientAssets, { cwd: options.cwd });
    await ctx.loader.await();

    ctx.server.get('/api/health', async (_req, res) => {
      res.json({ ok: true });
    });

    return {
      ctx,
      url: `http://${ctx.server.host}:${ctx.server.port}`,
      diagnostics,
      stop: async () => {
        await ctx.fiber.dispose();
      },
    };
  } catch (error) {
    // A later boot step (most likely the server failing to bind a port)
    // threw before we could hand back an IdeHost — nothing external holds a
    // reference to `ctx`, so whatever got registered on it (the loader, and
    // any composition already loaded into it) would otherwise leak.
    await ctx.fiber.dispose();
    throw error;
  }
}

/**
 * Reads, parses, and shape-checks e8.yml ourselves before handing the path
 * to `@cordisjs/plugin-include`.
 *
 * This is a deliberate workaround, not stylistic preference — for the
 * read/parse half of it. When e8.yml is missing or fails to parse,
 * `@cordisjs/plugin-include`'s `[Service.init]` throws — but
 * `@cordisjs/plugin-loader`'s `Entry.init` observes that failure on an
 * orphaned promise chain (`this.fiber?.await().finally(...)` with no
 * `.catch`, see node_modules/@cordisjs/plugin-loader/lib/index.js). That
 * chain rejects independently of anything we do after `ctx.loader.create()`
 * resolves:
 *  - `ctx.loader.await()` can't see it either — `EntryTree.await()` polls
 *    fiber "inertia" promises via `Promise.allSettled`, which never rejects.
 *  - Awaiting the created entry's own fiber ourselves (`entry.fiber.await()`)
 *    does let us observe the failure (`entry.fiber._error`), but it does not
 *    retroactively attach a handler to the library's own, separate,
 *    already-orphaned promise object — that promise rejects and crashes the
 *    process regardless (verified empirically against the installed
 *    `@cordisjs/plugin-loader@1.0.0-rc.5` / `@cordisjs/plugin-include@1.0.4`).
 *
 * The same crash also happens *after* a successful parse: `[Service.init]`'s
 * try/catch only covers `await this.read()`; `applyPatches([...this.data])`
 * runs unguarded right after it and throws `TypeError: this.data is not
 * iterable` whenever the parsed document isn't an array (e.g. `foo: bar`),
 * landing on the exact same orphaned chain. So the shape check below isn't
 * mirroring a library workaround — e8.yml is *our own* format (the Slice 0
 * stand-in for the profile + patch format), and validating that it's a
 * well-formed composition (an array of `{ name, ... }` entries) is our
 * contract to enforce regardless of what plugin-include happens to crash on.
 *
 * Validating the file ourselves before ever calling `ctx.loader.create()`
 * sidesteps the buggy codepath entirely instead of trying to catch its
 * fallout.
 *
 * One more rule lives here, independent of the crash: **a composition with
 * no entries registers no include entry.** An empty file (`undefined`) and
 * an explicit `[]` are the same composition and must produce the same graph
 * — see the `length === 0` branch below for why we don't let the two
 * equivalent spellings diverge.
 */
async function loadComposition(ctx: Context, cwd: string): Promise<Diagnostic[]> {
  const filename = join(cwd, COMPOSITION_FILENAME);
  let data: unknown;
  try {
    const content = await readFile(filename, 'utf8');
    data = yaml.load(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      diagnostic(
        'error',
        'composition',
        COMPOSITION_FILENAME,
        message,
        `create ${filename} with the game's composition (an array of plugin entries)`,
      ),
    ];
  }

  if (data === undefined) {
    // `yaml.load()` returns `undefined` only for a genuinely empty (or
    // whitespace-only) file — as opposed to a file that spells out `null`,
    // which is an explicit, and still invalid, value. We read this as "a
    // project with no plugins yet", a legitimate state, not an error: treat
    // it as an empty composition, same as an explicit `[]` (see below).
    data = [];
  }

  const diagnostics = validateComposition(data, filename);
  if (diagnostics.length > 0) return diagnostics;

  if ((data as unknown[]).length === 0) {
    // A composition with no entries registers no include entry — an empty
    // file and an explicit `[]` are the same composition and must produce
    // the same graph (`ctx.loader.entries()`), not one with a
    // `@cordisjs/plugin-include` row and one without. We could call
    // `ctx.loader.create()` here too — plugin-include does not choke on a
    // *literal* `[]` it reads back off disk, only on `undefined`/non-array
    // documents (the crash `loadComposition` exists to dodge) — but doing so
    // would make the graph depend on which of the two equivalent spellings
    // the file happens to use. Skipping the entry for both keeps "no
    // entries" meaning one thing. (Consequence, not ours to solve here: the
    // first entry ever added to an empty project has no existing include
    // subtree to write into — Slice 0 only edits configs of entries that
    // already exist, and e8.yml itself is replaced wholesale in a later
    // plan.)
    return [];
  }

  await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: { path: COMPOSITION_FILE },
  });
  return [];
}

/**
 * Checks that a parsed e8.yml document is shaped the way
 * `@cordisjs/plugin-include` needs it to be an array of entries, each
 * resolvable to a plugin by name to avoid the crash documented on
 * {@link loadComposition}.
 */
function validateComposition(data: unknown, filename: string): Diagnostic[] {
  if (!Array.isArray(data)) {
    return [
      diagnostic(
        'error',
        'composition',
        COMPOSITION_FILENAME,
        `e8.yml must be an array of plugin entries; found ${describeShape(data)}`,
        `edit ${filename} so its top-level value is an array, e.g. []`,
      ),
    ];
  }

  const diagnostics: Diagnostic[] = [];
  data.forEach((entry, index) => {
    const where = `${COMPOSITION_FILENAME}[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      diagnostics.push(
        diagnostic(
          'error',
          'composition',
          where,
          `composition entry must be an object; found ${describeShape(entry)}`,
          `edit ${filename} so entry ${index} is an object like { name: "plugin-name" }`,
        ),
      );
      return;
    }
    const name = (entry as Record<string, unknown>).name;
    if (typeof name !== 'string' || name.length === 0) {
      diagnostics.push(
        diagnostic(
          'error',
          'composition',
          where,
          'composition entry is missing a string "name" — it cannot resolve to a plugin',
          `edit ${filename} so entry ${index} has a "name" naming the plugin package`,
        ),
      );
    }
  });
  return diagnostics;
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
