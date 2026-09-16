/**
 * `dev-game`: the second half of `e8 dev` — vite serves the game's browser
 * bundle, and a route carries a spin through to `ctx.session`
 * (`@energy8engine/session-dev`, composed here exactly like
 * `@energy8engine/game-runtime`'s `createGame` composes it, minus the
 * canvas — there is no canvas on this side of the wire, only the math).
 *
 * **Two servers, on purpose (spec §6).** The game is served from its OWN
 * origin: this plugin boots a second `@cordisjs/plugin-server` instance
 * (`config.previewPort`, 5681 by default) inside its scope and hangs
 * everything the page fetches same-origin on it — vite's catch-all,
 * `/api/spin`, the `/@fs/` guard, `/api/composition` + `/plugin-runtime/:id`
 * (`ctx.runtimeAssets.attachGameRoutes`) and the `/ide` socket
 * (`ctx.ideRpc.attach`, the game's `ide-bridge` opens
 * `ws://${location.host}/ide` — accepting only `game-diagnostics` from
 * it, so the game can report but not `update` e8.yml). The root
 * (`ctx.server`) is the IDE's and gets NO game route; and it refuses a
 * cross-origin WRITE (any non-GET/HEAD request, and any `/ide` upgrade,
 * carrying an `Origin` outside the IDE's own — `createIdeHost`'s
 * allowlist), so a page on the game's origin cannot move the workspace or
 * rewrite e8.yml through the browser's own credentials. That is the whole
 * of what §6.2 enforces: the preview socket accepts only reports; the root
 * refuses cross-origin writes and upgrades. A working invariant now, not
 * the accident of `apps/web`'s vite happening to be a different process,
 * which is all that kept the two apart before. The preview server dies
 * with this scope; a port it cannot bind is a diagnostic and
 * `devGamePreview.url === null` (the project is open without its game).
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
 *  2. `server.use(cb)` is `ctx.on('server/request', cb, { prepend:
 *     true })` — it ALWAYS runs before the route-dispatch listener
 *     (registered once, in `Server`'s own constructor, without prepend).
 *     With `appType: 'spa'` (the default), Vite's own SPA fallback
 *     middleware serves `index.html` for literally ANY unmatched request —
 *     measured directly: wiring vite via `.use()` made it swallow
 *     `/api/health` itself, 200, before our route ever saw the request.
 *     So vite must NOT be a `.use()` middleware here.
 *  3. The fix: register vite as a plain, catch-all ROUTE —
 *     `preview.all(/^.*$/, ...)` — and register it LAST. `HttpRoute`s
 *     registered via `.get()`/`.post()`/`.all()` all land in the same
 *     `httpRoutes` list, checked in REGISTRATION order by the one
 *     dispatch listener; an earlier, more specific route (`/api/spin`,
 *     `/api/composition`, `/plugin-runtime/:id`) wins, and only a
 *     genuinely unmatched request falls through to this plugin's catch-all.
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
 *     matches no registered `.ws()` route on the server vite is mounted
 *     on (`preview`) is 404'd and the socket destroyed immediately.
 *     Measured directly: pointing Vite's own HMR websocket at that same
 *     server (`hmr: { server: preview._http }`) raced that refusal and
 *     failed the handshake outright ("Received
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
import Server from '@cordisjs/plugin-server';
import * as session from '@energy8engine/session-dev';
import { diagnostic, type SpinResult } from '@energy8engine/contracts';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { installErrorBoundary } from '../error-boundary';
import { runtimeEntryPaths } from './runtime-assets';

/**
 * `runtime-assets.ts` reads this service twice over: its mere PRESENCE
 * switches `/api/composition`'s `runtimeUrl` from `null` (nothing to
 * import into) to `/@fs/<realpath>` served through THIS plugin's own vite
 * instance, and `warmedEntries` lets it say when a row
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

/** Where the game is served (spec §6) — `null` when the preview port could not be bound. */
export interface DevGamePreviewService {
  readonly url: string | null;
}

declare module 'cordis' {
  interface Context {
    devGameRoot: DevGameRootService;
    devGamePreview: DevGamePreviewService;
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
  /** The game's own server's port (spec §6); `0` picks a free one. */
  previewPort: number;
}

export const name = 'dev-game';
/**
 * `ideRpc` is injected, not read leniently as it once was: `project-scope`
 * (the one thing that plugs this in) injects it from the root, and this
 * plugin needs it before anything else — the preview's `/ide` socket and
 * the bind-failure diagnostic both go through it.
 */
export const inject = ['server', 'runtimeAssets', 'ideRpc'];

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
  // The game's own server (spec §6, see the module doc). `isolate('server')`
  // gives this child context its own `server` binding so the root's stays
  // the IDE's; the instance is read off the plugin's own fiber ctx — the
  // one place a freshly provided service is readable without `inject`
  // (measured in the pre-plan spike; the same rule `session` below
  // follows). First, before `e8-server` is spawned: a game nothing can
  // reach needs no math process.
  const previewFiber = ctx
    .isolate('server')
    .plugin(Server, { host: ctx.server.host, port: config.previewPort });
  let preview: Server;
  try {
    await previewFiber;
    preview = previewFiber.ctx.server;
  } catch (error) {
    await previewFiber.dispose();
    ctx.ideRpc.reportGameDiagnostics('dev-game', [
      diagnostic(
        'error',
        'dev-game',
        `preview port ${config.previewPort}`,
        `the preview server could not start: ${error instanceof Error ? error.message : String(error)}`,
        'free the port, or set PREVIEW_PORT',
      ),
    ]);
    ctx.provide('devGamePreview', { url: null });
    return;
  }
  ctx.provide('devGamePreview', { url: `http://${preview.host}:${preview.port}` });
  // The root's `URIError → 400` boundary, on this server too: without it a
  // `/plugin-runtime/%zz` here was the empty 500 the root had already closed.
  installErrorBoundary(preview);
  // What the page fetches same-origin besides this plugin's own routes.
  // The socket is send-restricted: a game reports, it does not edit e8.yml.
  ctx.ideRpc.attach(preview, { accept: ['game-diagnostics'] });
  ctx.runtimeAssets.attachGameRoutes(preview);

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
   * The write's own HTTP response must not block on a process respawn (a
   * real `e8-server` spawn takes real wall-clock time — see
   * `startE8Server`'s readiness poll), so the restart is not awaited. Its
   * result is not dropped either: it carries the compiler's own
   * `script.spin:LINE:COL`, which for a mistake inside `execute` is the
   * only location there is (the parser never reads that far), and it used
   * to reach the panel only if a spin happened to 502 afterwards. Verified
   * in a browser: save `record {`, and nothing, anywhere, said why the
   * game had stopped answering. It goes down the same road a failed spin's
   * diagnostics already take — see the route below for why that road is
   * `report`, not `broadcast`.
   *
   * Every restart reports its result, a clean one included — as the
   * `session` speaker, whose group the call REPLACES (see
   * `IdeRpcService.reportGameDiagnostics`). So a clean restart's empty list
   * is the retract: the "failed to restart" row leaves the panel with the
   * save that cured it. It used to stay for the life of the project, the
   * list having no retract at all.
   *
   * The `spin` speaker's row goes with it: a spin failure was about the
   * process that just died, and nothing a spin said about the old process
   * is still true of the new one. Measured before this: a failed spin's
   * row outlived the save that fixed the math, until someone spun again.
   *
   * `alive`: the restart is not awaited, so its `.then` can land after
   * this scope is gone (a project switch mid-restart). `ctx.ideRpc` is the
   * root's and outlives the scope, so without the flag the old project's
   * "gone" answer was reported under whatever project came next.
   */
  let alive = true;
  ctx.effect(() => {
    return () => {
      alive = false;
    };
  }, 'dev-game:alive');
  //
  // `files/removed` too, with the same predicate: a `.spin` moved or
  // removed out of `gamesDir` is as much a change to the math as a save
  // into it, and a removed or renamed `game/` directory (the path IS
  // `gamesDir`, or an ancestor of it) takes every `.spin` with it. Before
  // this, both left e8-server answering spins from a script that was no
  // longer in the project.
  const mathChanged = (path: string): boolean => {
    const abs = resolve(config.root, path);
    return (path.endsWith('.spin') && isInside(gamesDir, abs)) || isInside(abs, gamesDir);
  };
  const restartOn = ({ path }: { path: string }) => {
    if (!mathChanged(path)) return;
    void ctx.session.restart().then(({ diagnostics }) => {
      if (!alive) return;
      ctx.ideRpc.reportGameDiagnostics('session', diagnostics);
      ctx.ideRpc.reportGameDiagnostics('spin', []);
    });
  };
  ctx.on('files/written', restartOn);
  ctx.on('files/removed', restartOn);

  // The engine dying is the same speaker's fact, said without waiting for
  // a spin to find the corpse — and the next clean restart above is what
  // takes it back.
  ctx.on('session/exited', (d) => ctx.ideRpc.reportGameDiagnostics('session', [d]));

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
      host: preview.host,
      port: preview.port,
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

  preview.post('/api/spin', async (req, res) => {
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

    // This route runs in the HOST process, not the browser, so nothing on
    // the game's own side can write these into `ctx.diagnostics` the way
    // an in-page seam does — the HTTP response below is read by whatever
    // page made the request, and ONLY a page that relays what it reads
    // (`first-slot/src/main.ts` does) would otherwise get this any
    // further. Speaking `game-diagnostics` here too means the IDE panel
    // sees it unconditionally, the same way it would for a game that
    // never wires that relay. Reported as the `spin` speaker on EVERY
    // spin, the clean ones included: a spin's list replaces the last
    // spin's (see `IdeRpcService.reportGameDiagnostics`), so the first
    // clean spin after a fix takes the failed one's row back — and
    // `session`'s own account of a restart is a different speaker, never
    // overwritten from here.
    //
    // Except the one answer that is a WAIT, not a failure: a spin that
    // lands while `restart()` is between the old process and the new one.
    // The page that asked gets it as data (the 502 below), and that is
    // where it stops — the next spin may be minutes away, and a state that
    // stops being true two seconds later must not sit in the panel until
    // then. Measured before this: after a fix-and-save the panel still
    // read "the math engine is restarting — wait for the restart to
    // finish" while the game was already playing the fixed math.
    //
    // And the session's own fact, whichever it is: a spin against a
    // process that never started, or died, is answered with THE object
    // `ctx.session.startupDiagnostic` holds (`play()`'s `!handle` branch
    // returns it as-is), and the `session` group already carries that row
    // (`session/exited` above, or the restart report). Said again here as
    // `spin`'s row it was two rows for one fact — and `spin`'s copy stayed
    // after the save that cured `session`'s, until the next spin. Identity,
    // read right after `play()`: `play()` returns synchronously on that
    // branch, so nothing has swapped the object in between.
    const own = ctx.session.startupDiagnostic;
    ctx.ideRpc.reportGameDiagnostics(
      'spin',
      diagnostics.filter((d) => d.code !== session.RESTARTING && d !== own),
    );

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

  preview.all(/^\/@fs\//, async (req, res, next) => {
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
  // plugin (and `attachGameRoutes` above) registers more specifically must
  // already be in `httpRoutes` by the time this runs, since only an
  // unmatched request reaches it.
  preview.all(/^.*$/, async (req, res, next) => {
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
    // The session's own fact, as the `session` speaker — the same group a
    // restart's failure and the process's death land in (above), so the
    // rule the spin route relies on holds from the first boot: what a
    // spin against a session that cannot play is answered with is ALREADY
    // the `session` group's row, never `spin`'s second copy. It used to
    // reach the panel only through a spin (as `spin`'s row), and a boot
    // that failed before anyone clicked was a fact only this console
    // knew. The next save's clean restart takes it back, like the others.
    const d = ctx.session.startupDiagnostic;
    ctx.ideRpc.reportGameDiagnostics('session', [d]);
    ctx.logger?.('dev-game').warn(`[${d.severity}] ${d.plugin} (${d.where}): ${d.message}`);
  }
}
