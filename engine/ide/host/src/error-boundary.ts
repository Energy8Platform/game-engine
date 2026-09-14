import { diagnostic, type DiagnosticsResponse } from '@energy8engine/contracts';
import type { Server } from '@cordisjs/plugin-server';

/**
 * One body, two servers: the root (`createIdeHost`) and the game's own
 * preview (`plugins/dev-game.ts`) — the preview's `/plugin-runtime/:id`
 * has a named param the router decodes while matching, so it had the same
 * empty-500 hole until it got this same boundary (spec §2 A6b).
 */
export function installErrorBoundary(server: Server): void {
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
  server.use(async (req, res, next) => {
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
}
