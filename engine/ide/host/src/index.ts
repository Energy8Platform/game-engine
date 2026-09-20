import { diagnostic, type DiagnosticsResponse } from '@energy8engine/contracts';
import { Context } from 'cordis';
import Loader from '@cordisjs/plugin-loader';
import Server from '@cordisjs/plugin-server';
import { installErrorBoundary } from './error-boundary';
import { bootProjectScope } from './plugins/project-scope';
import * as ideStatic from './plugins/ide-static';
import * as rpc from './plugins/rpc';
import * as workspace from './plugins/workspace';

export {
  BUILD_HINT as IDE_BUILD_HINT,
  DEFAULT_DIST as IDE_DIST_DEFAULT,
} from './plugins/ide-static';
export { installErrorBoundary } from './error-boundary';

/** `workspace.create` refusal codes that are the request's fault, not the host's. */
const CALLER_FAULT = new Set(['invalid', 'exists', 'unknown-template', 'single-project']);

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
  /**
   * The game preview's port (spec §6); 0 picks a free one. Defaults to
   * 5681. `null` boots no game server at all — no preview, no vite, no
   * `e8-server` — for a caller that only reads the project's routes off
   * the root (`e8 build`); `workspace.state().previewUrl` is then `null`.
   */
  previewPort?: number | null;
  /**
   * Where the built IDE shell is served from (spec §7). Tests pass a temp
   * dir; the CLI leaves it unset and `ide-static` falls back to `IDE_DIST`,
   * then this repo's `engine/apps/web/dist`.
   */
  ideDist?: string;
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

    installErrorBoundary(ctx.server);

    // Spec §6.2, enforced: the IDE's API accepts WRITES only from the IDE
    // itself. A browser stamps `Origin` on every cross-origin request and
    // every WebSocket upgrade, and the game lives on its own origin (the
    // preview server) precisely so that it — or anything else a browser
    // has open — cannot reach these routes. Reads stay open (the IDE's
    // state is not a secret; the shell on 5680 has always read it); an
    // absent `Origin` (curl, tests, a same-origin fetch on older engines)
    // is not a browser page acting cross-origin and passes.
    //
    // The root's own origin(s), the vite dev server's (5680 — its proxy
    // forwards `Origin` unchanged), and whatever `IDE_ORIGINS` adds.
    const ideOrigins = new Set<string>();
    for (const h of ['127.0.0.1', 'localhost']) {
      ideOrigins.add(`http://${h}:${ctx.server.port}`);
      ideOrigins.add(`http://${h}:5680`);
    }
    for (const o of (process.env.IDE_ORIGINS ?? '').split(','))
      if (o.trim()) ideOrigins.add(o.trim());
    ctx.server.use(async (req, res, next) => {
      const origin = req.headers.get('origin');
      if (
        origin === null ||
        ideOrigins.has(origin) ||
        req.method === 'GET' ||
        req.method === 'HEAD'
      ) {
        return next();
      }
      res.status = 403;
      const refusal: DiagnosticsResponse = {
        diagnostics: [
          diagnostic(
            'error',
            'server',
            req.path,
            `cross-origin request from ${origin} refused`,
            'the IDE API accepts writes only from the IDE itself',
          ),
        ],
      };
      res.json(refusal);
    });

    await ctx.plugin(rpc, { origins: ideOrigins });
    // `=== undefined`, not `??`: `null` is a value here (no game server).
    const previewPort = options.previewPort === undefined ? 5681 : options.previewPort;
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
    ctx.server.post('/api/workspace/create', async (req, res) => {
      let body: { template?: unknown; id?: unknown } = {};
      try {
        body = (await req.json()) as typeof body;
      } catch {
        // no body: refused below
      }
      if (typeof body.template !== 'string' || typeof body.id !== 'string') {
        res.status = 400;
        const refusal: DiagnosticsResponse = {
          diagnostics: [
            diagnostic(
              'error',
              'workspace',
              '/api/workspace/create',
              'body must be { template: string, id: string }',
            ),
          ],
        };
        res.json(refusal);
        return;
      }
      const refused = await ctx.workspace.create({ template: body.template, id: body.id });
      if (refused.length) {
        // The caller's fault is a coded validation refusal (400); anything
        // else — the copy failed, the new project did not boot — is the
        // host's (500). By `code`, never by prose. Spec §3.
        res.status = refused.every((d) => d.code !== undefined && CALLER_FAULT.has(d.code))
          ? 400
          : 500;
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

    // LAST, deliberately: a catch-all route, and `HttpRoute`s dispatch in
    // registration order — everything above must already be in the list.
    await ctx.plugin(ideStatic, { dist: options.ideDist });

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
