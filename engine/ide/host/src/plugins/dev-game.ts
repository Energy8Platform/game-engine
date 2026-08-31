/**
 * `dev-game`: the second half of `e8 dev` — vite serves the game's browser
 * bundle, and a route carries a spin through to `ctx.session`
 * (`@energy8engine/session-dev`, composed here exactly like
 * `@energy8engine/game-runtime`'s `createGame` composes it, minus the
 * canvas — there is no canvas on this side of the wire, only the math).
 *
 * **One server, two consumers.** This plugin is registered onto the SAME
 * `ctx` `createIdeHost` already stood up `@cordisjs/plugin-server` on — not
 * a second server. `e8 dev`'s CLI command plugs this in after
 * `createIdeHost()` resolves; `e8 ide` does not, so an ordinary IDE session
 * never spawns an `e8-server` process it has no use for.
 *
 * **Step 1's spike, measured against the real packages (not guessed —
 * see task-11-report.md for the full transcript):**
 *
 *  1. Vite in middleware mode (`createServer({ server: { middlewareMode:
 *     true } })`) hands back `.middlewares` — a plain Connect app:
 *     `(req: IncomingMessage, res: ServerResponse, next) => void`. It does
 *     NOT know about `@cordisjs/plugin-server`'s `Request`/`Response`
 *     wrappers at all; bridging needs the RAW node objects, which those
 *     wrappers expose as plain (not TS-`private`) fields — `req._req`,
 *     `res._res`.
 *  2. `ctx.server.use(cb)` is `ctx.on('server/request', cb, { prepend:
 *     true })` — it ALWAYS runs before the route-dispatch listener
 *     (registered once, in `Server`'s own constructor, without prepend).
 *     With `appType: 'spa'` (the default), Vite's own SPA fallback
 *     middleware serves `index.html` for literally ANY unmatched request —
 *     measured directly: wiring vite via `.use()` made it swallow
 *     `/api/health` itself, 200, before our route ever saw the request.
 *     So vite must NOT be a `.use()` middleware here.
 *  3. The fix: register vite as a plain, catch-all ROUTE —
 *     `ctx.server.all(/^.*$/, ...)` — and register it LAST. `HttpRoute`s
 *     registered via `.get()`/`.post()`/`.all()` all land in the same
 *     `httpRoutes` list, checked in REGISTRATION order by the one
 *     dispatch listener; an earlier, more specific route (`/api/spin`,
 *     and whatever the host already registered — `/api/health`,
 *     `/plugin-client/:id`) wins, and only a genuinely unmatched request
 *     falls through to this plugin's catch-all.
 *  4. Bridging one HTTP request: call `vite.middlewares(req._req, res._res,
 *     next)`, and race two signals for "is this settled yet" — the
 *     Connect `next` callback firing (vite didn't handle it — fall through
 *     to cordis's own 404) against the raw response's `finish`/`close`
 *     event (vite wrote and ended it directly). When vite handled it,
 *     `res.status = res._res.statusCode` marks cordis's `Response` wrapper
 *     `claimed` so the outer dispatcher's own 404 logic doesn't also run
 *     over the top — belt-and-suspenders: `Response._end()` is a no-op
 *     once `headersSent` regardless, but this keeps `res.status`/logging
 *     truthful.
 *  5. WebSocket does NOT get the same treatment, and deliberately has no
 *     bridge here. `@cordisjs/plugin-server`'s upgrade handler is bound
 *     directly to the raw `http.Server`'s `'upgrade'` event and — unlike
 *     HTTP routes — has no "fall through" path: any upgrade whose path
 *     matches no registered `ctx.server.ws()` route is 404'd and the
 *     socket destroyed immediately. Measured directly: pointing Vite's own
 *     HMR websocket at this same server (`hmr: { server: ctx.server._http
 *     }`) raced that refusal and failed the handshake outright ("Received
 *     network error or non-101 status code"). `hmr: false` avoids relying
 *     on that coexistence — `e8 dev` has no live-reload; a manual browser
 *     reload picks up an edited file on next load (Vite still serves
 *     modules on demand, uncached, so nothing stale is served). Also
 *     measured: `hmr: false` alone does not stop `/@vite/client` from
 *     still containing HMR-connect code — it just means nothing on our
 *     side is listening for it, so a browser that does attempt it gets the
 *     same clean, harmless refusal described above, not a crash.
 *  6. Process lifecycle: `vite.close()` plus letting the owning `ctx`
 *     dispose (which closes `_http`) was measured sufficient for a clean
 *     exit — no lingering listeners, no hang.
 *
 * One more cordis fact, measured here (not in Step 1's spike, but the same
 * way): `await ctx.plugin(session, config)` creates session as a CHILD
 * scope of THIS plugin's own `ctx` — reading `ctx.session` straight back
 * afterward throws `cannot get property "session" without inject`, because
 * a plugin scope may only read a service an ANCESTOR provided (or one it
 * provided on itself directly), never one a child it just registered
 * provided on ITS OWN scope, unless the parent also declares `inject`
 * (impossible here — `dev-game` is the one registering session, so it
 * can't statically depend on the thing it hasn't registered yet).
 * `@energy8engine/game-runtime`'s `createGame` doesn't hit this: its `ctx`
 * is a bare root `Context`, which cordis's reflection layer treats
 * leniently. `dev-game`'s `ctx`, in contrast, is itself a plugin scope
 * (handed to it by whatever registered `dev-game`), so the strict rule
 * applies. Fix: call `session.apply(ctx, config)` directly — a plain
 * function call, not `ctx.plugin()` — so `session`'s own `ctx.provide(...)`
 * lands on `dev-game`'s OWN scope instead of a child's. That satisfies the
 * one case the rule always allows: reading back a service you provided on
 * yourself.
 */
import type { Context } from 'cordis';
import * as session from '@energy8engine/session-dev';
import type { SpinResult } from '@energy8engine/contracts';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

export interface DevGameConfig {
  /** Vite project root — serves the game's `index.html` and module graph from here. */
  root: string;
  /** Forwarded to `session-dev` — must point directly at the folder holding the `.spin` file(s). */
  gamesDir: string;
  /** `game_id` from the `.spin`'s `game "..." { }` declaration. */
  gameId: string;
  /** Entry action name for a spin request (see the `.spin`'s `action spin { }`). Defaults to `'spin'`. */
  action?: string;
  /** Default bet level, used when `POST /api/spin`'s body doesn't specify one. */
  betLevel: number;
  /** Forwarded to `session-dev`; `0` picks a free port. Defaults to `0`. */
  port?: number;
  /** Forwarded to `session-dev` — explicit `e8-server` binary path, mainly for tests. */
  binPath?: string;
}

export const name = 'dev-game';
export const inject = ['server'];

export async function apply(ctx: Context, config: DevGameConfig): Promise<void> {
  // A direct function call, not `ctx.plugin(session, ...)` — see the
  // module doc's last point for why: it keeps `ctx.session` readable on
  // THIS scope instead of landing it on an unreadable child.
  await session.apply(ctx, {
    gamesDir: config.gamesDir,
    port: config.port ?? 0,
    binPath: config.binPath,
  });

  const vite: ViteDevServer = await createViteServer({
    root: config.root,
    appType: 'spa',
    server: {
      middlewareMode: true,
      host: ctx.server.host,
      port: ctx.server.port,
      // See point 5 above — the coexistence with plugin-server's own
      // WS-upgrade dispatcher is racy and was measured to fail; disabled
      // rather than relied on.
      hmr: false,
    },
  });
  ctx.effect(() => {
    return () => {
      // Fire-and-forget, same shape as session-dev's own process teardown:
      // cordis calls disposers synchronously and does not await them.
      void vite.close();
    };
  }, 'dev-game:vite');

  ctx.server.post('/api/spin', async (req, res) => {
    let body: { betLevel?: number } = {};
    try {
      body = (await req.json()) as { betLevel?: number };
    } catch {
      // An empty or absent body is fine — falls back to config.betLevel.
    }

    const { result, diagnostics } = await ctx.session.play({
      gameId: config.gameId,
      action: config.action ?? 'spin',
      betLevel: body.betLevel ?? config.betLevel,
    });

    // `!result` is never actually reachable alongside an empty
    // `diagnostics` — `SessionService.play()`'s own contract pairs them —
    // but the return type doesn't encode that, and typing this crossing
    // against `SpinResult` (see contracts/spin.ts, the normative source
    // for this envelope) means the compiler catches a future change to
    // that pairing instead of `res.json` silently accepting whatever it's
    // handed.
    if (diagnostics.length > 0 || !result) {
      res.status = 502;
      res.json({ diagnostics });
      return;
    }

    // Shipped unchanged — the measured SpinResult envelope, see
    // contracts/spin.ts. The browser rebuilds nothing.
    const payload: SpinResult = result;
    res.json(payload);
  });

  // Registered LAST, deliberately — see point 3 above. Everything this
  // plugin (and the host it's added to) registers more specifically must
  // already be in `httpRoutes` by the time this runs, since only an
  // unmatched request reaches it.
  ctx.server.all(/^.*$/, async (req, res, next) => {
    let settled = false;
    await new Promise<void>((resolve) => {
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      res._res.once('finish', finish);
      res._res.once('close', finish);
      vite.middlewares(req._req, res._res, finish);
    });

    if (res._res.writableEnded || res._res.headersSent) {
      res.status = res._res.statusCode;
      return;
    }
    return next();
  });

  if (ctx.session.startupDiagnostic) {
    // Not pushed anywhere further up — `dev-game` has no shared
    // `diagnostics` array the way `createGame` does. It's already
    // reachable from `ctx.session.startupDiagnostic` directly, and every
    // `/api/spin` call surfaces it too (see above); logged here so `e8
    // dev`'s own console shows it without a spin being clicked first.
    const d = ctx.session.startupDiagnostic;
    ctx.logger?.('dev-game').warn(`[${d.severity}] ${d.plugin} (${d.where}): ${d.message}`);
  }
}
