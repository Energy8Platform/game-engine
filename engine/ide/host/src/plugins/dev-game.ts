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
 * **The spec's separate-origin rule (§9) holds today only incidentally —
 * do not read that as this plugin keeping the two apart on purpose.** The
 * rule: the game preview must live on a different origin from the IDE
 * itself, so a game a project author didn't write can't reach the IDE's
 * own session/credentials in the browser. In this repo's current setup
 * that separation exists because `engine/apps/web` runs its OWN vite dev
 * server (a different process, a different port) for the IDE's React SPA,
 * while THIS plugin's vite instance — reached through `createIdeHost`'s
 * server, proxied from `apps/web`'s dev server — serves only the game.
 * Two different servers, so two different origins, but nothing here
 * enforces that on purpose. Collapse them into one and the rule silently
 * stops holding: under `e8 dev` *alone* (no `apps/web` vite in front —
 * exactly what `engine/apps/cli`'s `dev` command boots on its own, and
 * what a real deployment of this plugin would look like) there is no IDE
 * SPA served at all, because this plugin's own catch-all route (point 3
 * below) claims `/` outright — `dev-game` was written assuming it owns
 * the whole origin it's mounted on, precisely because nothing else was
 * ever competing for `/` on that origin. The next person wiring a real
 * preview-serving path (the cloud trajectory this spec's §9 describes)
 * needs to keep the origins apart DELIBERATELY, not rely on this
 * accidental two-process arrangement continuing to exist.
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
import { realpathSync } from 'node:fs';
import { posix, resolve, sep } from 'node:path';
import type { Context } from 'cordis';
import * as session from '@energy8engine/session-dev';
import type { SpinResult } from '@energy8engine/contracts';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import type { IdeRpcService } from './rpc';
import { runtimeEntryPaths } from './runtime-assets';

/**
 * `runtime-assets.ts` reads this service twice over: its mere PRESENCE
 * switches `/api/composition`'s `runtimeUrl` from the raw
 * `/plugin-runtime/:id` route to `/@fs/<realpath>` served through THIS
 * plugin's own vite instance, and `warmedEntries` lets it say when a row
 * arrived too late for that vite's dependency crawl.
 *
 * It was empty, deliberately — it used to carry `root`, provided and never
 * read, and a field kept "for anyone debugging" reads as data something
 * depends on. `warmedEntries` is here because it IS read, and because it is
 * the only place the fact lives: no other party knows what this vite
 * instance was told at startup.
 */
export interface DevGameRootService {
  /**
   * The row runtime entries this vite's dependency optimizer was told to
   * crawl before it started serving — see `warmupEntries` below. A row
   * whose entry is not in this list joined the composition after the
   * server did, so its dependencies were not part of that crawl.
   */
  readonly warmedEntries: readonly string[];
}

declare module 'cordis' {
  interface Context {
    devGameRoot: DevGameRootService;
  }
}

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

/** Vite's own prefix for "serve this absolute path off disk". */
const FS_PREFIX = '/@fs/';

/**
 * The absolute file path a `/@fs/` request names — derived exactly the way
 * vite derives it (`fsPathFromUrl`), so the guard below and vite's own
 * check are looking at the same string and cannot disagree about WHICH
 * file is being asked for.
 *
 * `?import`, `?t=…` and a `#fragment` are stripped (vite's `cleanUrl`),
 * the prefix is sliced off, the result is posix-normalized (so `..`
 * segments collapse before anything compares it), and a leading `/` is
 * restored — `/@fs/Users/x` and `/@fs//Users/x` are both spellings vite
 * accepts and both mean `/Users/x`.
 */
function fsPathFromRequestUrl(url: string): string | null {
  const clean = url.replace(/[?#].*$/s, '');
  if (!clean.startsWith(FS_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = decodeURI(clean);
  } catch {
    // A malformed escape is not ours to interpret; vite answers it.
    return null;
  }
  const path = posix.normalize(decoded.slice(FS_PREFIX.length));
  return path.startsWith('/') ? path : `/${path}`;
}

/** Is `file` the root itself, or somewhere under it? */
function isInside(root: string, file: string): boolean {
  return file === root || file.startsWith(root + sep);
}

export async function apply(ctx: Context, config: DevGameConfig): Promise<void> {
  // Resolved once, here, rather than read as `config.gamesDir` at every use
  // below. A trailing slash is an easy way to spell the same directory
  // (`join(cwd, 'game')` never produces one, which is why this was not hit
  // by anything that runs today, but nothing stops a future caller from
  // passing `gamesDir + '/'`) — measured directly: `isInside('/x/game/',
  // …)` compares every candidate against `/x/game//`, which no real
  // resolved path ever starts with, so the restart trigger below silently
  // never fires. `resolve()` also drops a trailing `.`/`..` the same way.
  const gamesDir = resolve(config.gamesDir);

  // A direct function call, not `ctx.plugin(session, ...)` — see the
  // module doc's last point for why: it keeps `ctx.session` readable on
  // THIS scope instead of landing it on an unreadable child.
  await session.apply(ctx, {
    gamesDir,
    port: config.port ?? 0,
    binPath: config.binPath,
  });

  /**
   * The link task-6-report.md measured missing: `ctx.spinSchema` and
   * `GET /api/composition` were already fresh on their next request, but
   * `ctx.session`'s `e8-server` process is spawned once and never told to
   * reload — the math a spin actually PLAYS stayed the pre-edit version
   * until the whole host restarted.
   *
   * `files.ts` does not know `game/script.spin` is special, and per
   * `schema.ts`'s own doc it should not learn that — the knowledge "this
   * path is the math" belongs where the math is SERVED, which is here.
   * `files.ts` only emits a plain `files/written` event naming the path
   * that changed; this is the one place that decides the path matters.
   *
   * **What "matters" means, corrected in review.** The first version
   * compared `path` against the one literal `SPIN_FILENAME` string
   * `schema.ts` reads — `schema.ts`'s reading of the game, not this
   * plugin's own. `e8-server` is told `--games-dir` and loads every
   * `.spin` it finds there (see `session-dev`'s own diagnostic: "the
   * folder holding the .spin file(s)", plural) — so the actual question is
   * "did a `.spin` file inside `gamesDir` change", answered against
   * `gamesDir` (this plugin's own config, the session's actual notion of
   * where the math lives — resolved once, above), not against a string
   * borrowed from a different reader of the same project.
   *
   * Two checks below, two SEPARATE limitations, kept apart here because an
   * earlier version of this comment attributed one to the wrong check:
   *
   *  - `isInside` is the same lexical containment check the `/@fs/` route
   *    already uses — not realpath'd, so a path that reaches `gamesDir`
   *    only via a symlink is not recognized, same as that route's own
   *    documented limitation. It also compares the DIRECTORY portion of the
   *    path lexically, so two spellings of the same directory that differ
   *    only by case on a case-insensitive filesystem would not match
   *    either — closing either needs `realpathSync`/`realpathSync.native`
   *    and is out of scope here.
   *  - `path.endsWith('.spin')` is an ordinary, case-SENSITIVE string
   *    comparison. `game/script.SPIN` does not end in the literal
   *    substring `'.spin'`, so it does not restart, even on a filesystem
   *    that treats the two extensions as the same file — this is the ONE
   *    that misses an uppercase extension, not `isInside`. Filename casing
   *    elsewhere is irrelevant to either check: `game/Script.spin` DOES
   *    restart, because both the containment and the (lowercase) extension
   *    still match.
   *
   * Fire-and-forget: the write's own HTTP response must not block on a
   * process respawn (a real `e8-server` spawn takes real wall-clock time —
   * see `startE8Server`'s readiness poll), and `restart()` already turns a
   * failed respawn into a `Diagnostic` the next `play()`/`/api/spin` call
   * reports, the same contract the very first spawn already has. Nothing
   * here needs to await or re-report it.
   */
  ctx.on('files/written', ({ path }) => {
    if (!path.endsWith('.spin')) return;
    if (!isInside(gamesDir, resolve(config.root, path))) return;
    void ctx.session.restart();
  });

  /**
   * The row runtime halves vite's dependency optimizer must see BEFORE the
   * browser loads anything.
   *
   * The optimizer crawls what it can reach statically from the project's
   * own html. A row's runtime half is not reachable that way by design —
   * the whole point of the composition is that the page imports it by a
   * URL it is handed at runtime — so any bare dependency reachable ONLY
   * through a row was discovered mid-load, which makes vite re-optimize
   * and change the `?v=` stamp on every optimized module.
   *
   * Vite's own remedy for that is a full page reload sent over HMR, and
   * `hmr: false` above means it is never delivered. So the page kept
   * running with half its module graph on the pre-optimization generation
   * and half on the post-: two copies of `pixi.js`, two `Container`
   * classes, and the reel board's containers instances of the one whose
   * prototype never received pixi's own `FederatedContainer` mixin. The
   * visible symptom was `TypeError: currentTarget.isInteractive is not a
   * function`, twice per pointer interaction over the canvas, from pixi's
   * federated event system — and, less visibly, no pointer events reaching
   * the board at all.
   *
   * Measured, cold cache versus warm: a first `e8 dev` in a project served
   * `chunk-XPXRP5GS.js?v=d407f451` AND `?v=e6b31c4e` and raised the two
   * errors; a second run against the same `node_modules/.vite` served one
   * stamp and raised none. Naming the row entries here makes every run the
   * warm one.
   *
   * `ctx.project` is read reactively rather than injected: `dev-game` is
   * composed onto a bare `Context` in its own tests, and a host with no
   * project has nothing to warm — an empty list simply leaves vite's
   * default behaviour in place.
   *
   * The residual, stated rather than left to be discovered: a row ADDED to
   * the composition while the server is up brings its dependencies with
   * it, and this vite instance is already running. That case still
   * re-optimizes mid-session. Closing it needs vite to be able to tell the
   * browser to reload, which is the thing `hmr: false` gives up (see point
   * 5 above, and note that enabling HMR would also make an edit to
   * `e8.yml` reload the page — exactly what the live-rebind path exists
   * not to do).
   */
  const project = ctx.reflect.get('project', false);
  const warmupEntries = project ? runtimeEntryPaths(config.root, project.composition.rows) : [];

  // Announces this plugin's presence to `runtime-assets.ts`, and hands it
  // the crawl list — see `DevGameRootService`. Provided as early as it can
  // be (right after the list exists, before vite is created and before
  // anything here can fail), so a later throw in this function still leaves
  // the marker up for as long as `ctx` (this fiber) is alive; if this fiber
  // is disposed the effect system tears the provision down with it, same as
  // every other `ctx.provide` in this codebase.
  ctx.provide('devGameRoot', { warmedEntries: warmupEntries });

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
    optimizeDeps: {
      // `'**/*.html'` is vite's own default for this field, restated
      // because naming any entry replaces the default rather than adding
      // to it. Everything after it is this composition's row entries —
      // see `warmupEntries` above.
      entries: ['**/*.html', ...warmupEntries],
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
      // This route runs in the HOST process, not the browser, so nothing
      // on the game's own side can write these into `ctx.diagnostics` the
      // way an in-page seam does — the HTTP response above is read by
      // whatever page made the request, and ONLY a page that relays what
      // it reads (`first-slot/src/main.ts` does) would otherwise get this
      // any further. Speaking `game-diagnostics` here too means the IDE
      // panel sees it unconditionally, the same way it would for a game
      // that never wires that relay. `report`, not `broadcast`: this route
      // hands over what just went wrong and `rpc` keeps the HOST's whole
      // list — otherwise a second failed spin would replace the first on a
      // reader that replaces per source, with the panel asserting nothing
      // had been lost. `ideRpc` is read leniently — `rpc`
      // and `dev-game` are SIBLING plugin scopes under `e8 dev`'s shared
      // host `ctx`, and this plugin's own standalone tests compose it with
      // no `rpc` at all, so a static `inject` would leave this fiber
      // PENDING forever waiting for a service nobody provides.
      const ideRpc = ctx.reflect.get('ideRpc', false) as IdeRpcService | undefined;
      ideRpc?.reportGameDiagnostics(diagnostics);
      return;
    }

    // Shipped unchanged — the measured SpinResult envelope, see
    // contracts/spin.ts. The browser rebuilds nothing.
    const payload: SpinResult = result;
    res.json(payload);
  });

  /**
   * The containment check on the path the browser actually loads through.
   *
   * `runtime-assets.ts` realpaths both sides before it hands out a
   * `runtimeUrl`, and `/plugin-runtime/:id` re-checks at request time. But
   * `/@fs/<path>` is vite's OWN route, reachable by any same-origin script
   * that builds the URL itself rather than only by one this host handed
   * out — so the hardened check guarded a door nobody walks through.
   *
   * What stands there instead is `server.fs.allow`, and it compares
   * LEXICALLY. Measured, not reasoned about: with the allow list at the
   * vite root, `GET /@fs/<root>/link.js` where `link.js` is a symlink to a
   * file outside the root returns **200 with that file's contents**, while
   * `GET /@fs/<the target itself>` returns 403. Same bytes, two answers,
   * decided by which spelling was asked for.
   *
   * This route runs before the catch-all that hands requests to vite and
   * closes exactly that difference: it resolves the request's path through
   * symlinks and requires the REAL file to still be inside one of the
   * roots vite would allow. It is strictly additive — it can only refuse
   * something vite would have served, never allow something vite would
   * have refused — because a passing request is handed straight on with
   * `next()` and vite's own check still runs after it.
   *
   * The alternative the carried-forward note named — narrowing `fs.allow`
   * to each row package's root — was measured and rejected. Loading the
   * real `first-slot` in a browser issues 31 `/@fs/` requests across 13
   * package directories, and only 8 of those are composition rows: the
   * game reaches `contracts`, `loader`, `seam`, `mechanic-classic`,
   * `mechanic-cascade`, `ide-bridge` and `vite/dist/client` as ordinary
   * transitive imports out of rows. Narrowing the allow list to row roots
   * would 403 every one of them and the game would not compose at all.
   *
   * **What this does NOT close, said plainly so nobody reads it as more
   * than it is.** The boundary here is the same one vite draws — the
   * allowed roots — resolved through symlinks. It is not a per-package
   * boundary, and it cannot become one: those same 31 requests are the
   * proof that a running game legitimately reaches six workspace packages
   * that are not rows of its composition. So a script on this origin can
   * still read any file under the workspace root through `/@fs/`, exactly
   * as it could before. What it can no longer do is use a symlink to reach
   * OUT of that root, which is the only thing the lexical check was
   * missing.
   *
   * Nothing is cached across requests except the allow roots themselves,
   * which vite fixes at config time. The realpath is re-read per request,
   * for the same reason `/plugin-runtime/:id` re-derives its own: a
   * symlink can be repointed while the server is up.
   */
  const allowRoots = vite.config.server.fs.allow.map((root) => {
    try {
      return realpathSync(root);
    } catch {
      // A root that is not on disk cannot contain anything; keeping the
      // lexical form means it simply never matches, which is the safe way
      // for this to fail.
      return resolve(root);
    }
  });

  ctx.server.all(/^\/@fs\//, async (req, res, next) => {
    const requested = fsPathFromRequestUrl(req._req.url ?? '');
    if (requested === null) return next();

    let real: string;
    try {
      real = realpathSync(requested);
    } catch {
      // Not on disk at all, so there is no real file to have an opinion
      // about — hand it on. Refusing here would turn "missing file" into
      // "access denied", the exact confusion that makes an escape test
      // pass for the wrong reason.
      //
      // What vite then answers is its own business, and it is not a 404:
      // `appType: 'spa'` means the catch-all below serves the root's
      // `index.html` with a 200 for anything unmatched (measured — see
      // `dev-game.test.ts`). That is fine; what this route owes is only
      // that an absence is never dressed up as a refusal.
      return next();
    }

    if (allowRoots.some((root) => isInside(root, real))) return next();

    res.status = 403;
    res.json({
      error: `"${requested}" resolves to "${real}", which is outside every path this server may serve`,
      allow: allowRoots,
    });
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
