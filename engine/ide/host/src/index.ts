import { diagnostic, type DiagnosticsResponse } from '@energy8engine/contracts';
import { Context } from 'cordis';
import Loader from '@cordisjs/plugin-loader';
import Server from '@cordisjs/plugin-server';
import { bootProjectScope } from './plugins/project-scope';
import * as rpc from './plugins/rpc';
import * as workspace from './plugins/workspace';

export interface IdeHostOptions {
  /**
   * The workspace folder. A `root` that itself holds `e8.yml` is the one
   * project and opens at boot (`e8 dev`); otherwise its subfolders with
   * `e8.yml` are the projects and none is open (`e8`). Spec §3.
   */
  root: string;
  /** 0 picks a free port — used by tests. */
  port?: number;
  host?: string;
  /** The game preview's port (spec §6); 0 picks a free one. Defaults to 5681. */
  previewPort?: number;
}

export interface IdeHost {
  ctx: Context;
  /** Base URL the browser talks to, e.g. http://127.0.0.1:5679 */
  url: string;
  stop(): Promise<void>;
}

/**
 * Boots an IDE host over the workspace at `options.root`: the plugin
 * loader, the HTTP/WS server, `rpc`, and `workspace`. Nothing here is
 * bound to a project — everything that reads a project directory lives in
 * `plugins/project-scope.ts`, which `workspace.open()` plugs in and
 * disposes. Boot-time refusals are data, not throws: scan and open
 * failures in `ctx.workspace.state().diagnostics`, an open project's
 * `e8.yml` problems in its composition's `snapshot().diagnostics`.
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

  try {
    await ctx.plugin(Loader);
    await ctx.plugin(Server, { host: options.host ?? '127.0.0.1', port: options.port ?? 5679 });

    // A throw during ROUTE MATCHING, not just inside a handler, reaches
    // here uncaught: `@cordisjs/plugin-server`'s own router decodes every
    // path segment (`decodeURIComponent`, once per named/wildcard param)
    // while deciding which route matches — before any handler runs — so a
    // malformed percent-escape (`/plugin-client/%zz`, `/api/files/%zz`)
    // throws a `URIError` no per-route `try` could ever catch; the throw
    // happens one layer further out than any handler reaches. Left alone,
    // the library's own top-level catch answers `res.status = 500` with NO
    // body at all — the exact empty-500 shape this project has already
    // been burned by once (see files.ts's doc comments on the same scar).
    //
    // `ctx.server.use()` is this library's own sugar for `ctx.on(
    // 'server/request', middleware, { prepend: true })` — `prepend` is
    // what makes this run AHEAD of the router's own `server/request`
    // listener (registered without it, in `Server`'s own constructor)
    // regardless of which plugin happened to load first, so this `try`
    // wraps matching AND handling alike, for every route this host has —
    // not only the ones registered below.
    //
    // `URIError` is the one failure this boundary can name with certainty
    // as the requester's own mistake (a malformed escape is unambiguous),
    // so it answers 400; anything else stays 500, but — unlike the bug
    // this exists to close — never with an empty body.
    ctx.server.use(async (req, res, next) => {
      try {
        return await next();
      } catch (error) {
        res.status = error instanceof URIError ? 400 : 500;
        // `DiagnosticsResponse`, the same body every files route refuses
        // with — named rather than spelled inline because a client has to
        // read this one off a route whose success shape is different
        // (`FileTreeResponse`), and reading them in the wrong order is
        // how the host's own explanation got thrown away once already.
        const refusal: DiagnosticsResponse = {
          diagnostics: [
            diagnostic(
              'error',
              'server',
              req.path,
              `request to "${req.path}" failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ],
        };
        res.json(refusal);
      }
    });

    await ctx.plugin(rpc);
    const previewPort = options.previewPort ?? 5681;
    await ctx.plugin(workspace, {
      root: options.root,
      scope: (c, cwd) => bootProjectScope(c, cwd, previewPort),
    });

    ctx.server.get('/api/workspace', async (_req, res) => {
      res.json(ctx.workspace.state());
    });
    ctx.server.post('/api/workspace/open', async (req, res) => {
      let body: { id?: unknown } = {};
      try {
        body = (await req.json()) as { id?: unknown };
      } catch {
        // no body: refused below
      }
      if (typeof body.id !== 'string') {
        res.status = 400;
        const refusal: DiagnosticsResponse = {
          diagnostics: [
            diagnostic('error', 'workspace', '/api/workspace/open', 'body must be { id: string }'),
          ],
        };
        res.json(refusal);
        return;
      }
      const id = body.id;
      const refused = await ctx.workspace.open(id);
      if (refused.length) {
        // A known project that did not come up is the host's failure (500);
        // an id nobody listed is the caller's (400). Spec §9.
        res.status = ctx.workspace.state().projects.some((p) => p.id === id) ? 500 : 400;
        const refusal: DiagnosticsResponse = { diagnostics: refused };
        res.json(refusal);
        return;
      }
      res.json(ctx.workspace.state());
    });
    ctx.server.post('/api/workspace/close', async (_req, res) => {
      await ctx.workspace.close();
      res.json(ctx.workspace.state());
    });
    ctx.server.get('/api/health', async (_req, res) => {
      res.json({ ok: true });
    });

    return {
      ctx,
      url: `http://${ctx.server.host}:${ctx.server.port}`,
      stop: async () => {
        await ctx.fiber.dispose();
      },
    };
  } catch (error) {
    // A later boot step (most likely the server failing to bind a port)
    // threw before we could hand back an IdeHost — nothing external holds a
    // reference to `ctx`, so whatever got registered on it (the loader, and
    // any project the workspace already opened into it) would otherwise leak.
    await ctx.fiber.dispose();
    throw error;
  }
}
