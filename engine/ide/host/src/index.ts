import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { Context } from 'cordis';
import Loader from '@cordisjs/plugin-loader';
import Server from '@cordisjs/plugin-server';
import * as yaml from 'js-yaml';

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
   * Boot-time failures (currently: a missing or unparsable e8.yml) that did
   * not stop the host from starting. The host still serves so the IDE can
   * show these to the user instead of a blank page.
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

export async function createIdeHost(options: IdeHostOptions): Promise<IdeHost> {
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(options.cwd).href + '/';

  try {
    await ctx.plugin(Loader);

    const diagnostics = await loadComposition(ctx, options.cwd);

    await ctx.plugin(Server, { host: options.host ?? '127.0.0.1', port: options.port ?? 5679 });
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
 * Reads and parses e8.yml ourselves before handing the path to
 * `@cordisjs/plugin-include`.
 *
 * This is a deliberate workaround, not stylistic preference. When e8.yml is
 * missing or fails to parse, `@cordisjs/plugin-include`'s `[Service.init]`
 * throws — but `@cordisjs/plugin-loader`'s `Entry.init` observes that failure
 * on an orphaned promise chain (`this.fiber?.await().finally(...)` with no
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
 * Validating the file ourselves before ever calling `ctx.loader.create()`
 * sidesteps the buggy codepath entirely instead of trying to catch its
 * fallout.
 */
async function loadComposition(ctx: Context, cwd: string): Promise<Diagnostic[]> {
  const filename = join(cwd, COMPOSITION_FILENAME);
  try {
    const content = await readFile(filename, 'utf8');
    yaml.load(content);
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

  await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: { path: COMPOSITION_FILE },
  });
  return [];
}
