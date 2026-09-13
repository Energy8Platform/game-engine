import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Context } from 'cordis';
import type { Server } from '@cordisjs/plugin-server';
import {
  type Diagnostic,
  diagnostic,
  type E8Manifest,
  parseManifest,
  type ResolvedRow,
} from '@energy8engine/contracts';
import { readPackageJson, unresolvedReason } from '../resolvePackage';

export const name = 'runtime-assets';
export const inject = ['server', 'project', 'spinSchema'];

declare module 'cordis' {
  interface Context {
    runtimeAssets: RuntimeAssetsService;
  }
}

/**
 * How the GAME's server gets this plugin's routes (spec §6, Task 4). The
 * game is served from its own origin — a second server `dev-game` boots
 * in its scope — and everything the page fetches same-origin has to be
 * there: `/api/composition` (`@energy8engine/loader`) and
 * `/plugin-runtime/:id`. A service rather than a free function because
 * the handlers close over THIS plugin's ctx (`project`, `spinSchema`);
 * `dev-game` injects it and calls it once the preview is listening.
 */
export interface RuntimeAssetsService {
  /** Registers `/api/composition` and `/plugin-runtime/:id` on `server`, as effects of that server's own scope. */
  attachGameRoutes(server: Server): void;
}

/** Vite's own prefix for "serve this absolute path off disk" — the shape `resolveRuntimeUrl` hands out once `dev-game` is composed. */
const FS_PREFIX = '/@fs/';

export interface RuntimeAssetsConfig {
  cwd: string;
}

/**
 * The wire between task 4's resolved GAME composition and the browser:
 * `GET /api/composition` hands over the row list (and diagnostics) task 6
 * needs to know which ids exist, plus (task 3 of "the math describes
 * itself") the `SpinSchema` `ctx.spinSchema` read off `game/script.spin` —
 * a mechanic's `expects` can be checked against it before the first spin
 * rather than against the data of one that already happened. `schema`
 * rides in THIS response rather than a route of its own on purpose: the
 * check that consumes it runs in the browser at composition-build time,
 * and a second network call is a second way to get the order wrong (see
 * `plugins/schema.ts`'s sibling task-3 brief). `GET /plugin-runtime/:id`
 * hands over one row's runtime half so the browser can dynamically
 * `import()` it into the running game.
 *
 * `/plugin-runtime/:id` is NOT "the fallback" — it is the NON-VITE path:
 * a row's runtime half raw and untransformed, the only way one could be
 * served without a vite instance in the process. Since Task 4 it lives on
 * the GAME's own server only (see `RuntimeAssetsService`): the root serves
 * no game, so nothing on it ever imports a runtime half — `engine/apps/web/
 * vite.config.ts` says the same from the IDE's side. Under `e8 dev` every
 * `runtimeUrl` comes out `/@fs/<realpath>` and nothing asks for this
 * route; a host with no `dev-game` hands out `/plugin-runtime/<id>` URLs
 * that no server answers — and has no page to import them either. It also
 * carries its own realpath containment check, re-derived at request time
 * from whatever is on disk right now — see task-6-brief.md: that check
 * used to be the ONLY one, and the `/@fs/` URL had none of its own,
 * relying entirely on vite's workspace-wide `server.fs.allow`, which has
 * no notion of "this row's own package" to confine anything to.
 * `resolveRuntimeUrl` below now performs the equivalent check itself,
 * once, before EITHER url shape is handed out.
 *
 * State the guarantee exactly, not more than it is: the HOST will not
 * hand out an escaping URL through `/api/composition`, and
 * `/plugin-runtime/:id` refuses to serve one even asked for directly, by
 * id, bypassing composition entirely. `/@fs/<realpath>` itself is vite's
 * own route, not this plugin's, and stays reachable by any same-origin
 * script that constructs the URL itself rather than only by a URL this
 * host handed out. That door is no longer guarded by `server.fs.allow`
 * alone: `dev-game.ts` now runs its own realpath containment check ahead
 * of vite, because `fs.allow` compares LEXICALLY and a symlink inside an
 * allowed root therefore served whatever it pointed at (measured — see
 * that route's own doc and `dev-game.test.ts`). Narrowing `fs.allow` was
 * the other candidate and was rejected on measurement, also recorded
 * there: the real game reaches six workspace packages that are not rows
 * at all, as ordinary transitive imports.
 *
 * The second route is `client-assets.ts` with two differences, not a fresh
 * design — read that file's doc comments for the full reasoning behind the
 * realpath containment check and the missing-half 404 shape; this only
 * notes where it diverges:
 *  1. it reads `manifest.runtime` (`e8.runtime.entry`), not `manifest.client`
 *  2. ids come from `ctx.project.composition.rows` (the GAME's plugins),
 *     not `ctx.loader.entries()` (the HOST's own IDE-editor plugin graph)
 *     — two different id spaces that happen to share a shape.
 *
 * One more divergence, deliberate, not an oversight: this route answers
 * `content-type: application/javascript`, where `client-assets.ts` answers
 * `text/javascript`. That is what the brief's interface for this route
 * specifies verbatim — do not "fix" the two into agreement; that would
 * quietly change what content-type the browser is told for one half or
 * the other. Both are registered, valid JS MIME types; nothing here reads
 * them and cares which one it gets.
 *
 * Both routes are plain `server.get(path, handler)` registrations.
 * `@cordisjs/plugin-server` matches routes against `req.path`, which is
 * already stripped of the query string (see `Request`'s constructor in
 * `@cordisjs/plugin-server`) — so `/plugin-runtime/reels1?import`, the
 * shape Vite's dev server rewrites a dynamic-import specifier into even
 * behind `/* @vite-ignore *\/` (measured in task 1's spike), reaches this
 * handler with `req.params.id === 'reels1'` for free. No special-casing
 * needed here; the test for it exists to prove that fact stays true, not
 * to work around it.
 *
 * **`runtimeUrl`.** A raw byte-for-byte response (this file's whole
 * reason to exist) cannot resolve TypeScript syntax or a bare
 * `import 'pixi.js'` — measured directly: a real browser's native
 * `import()` throws on the first one it hits. `dev-game` (`dev-game.ts`)
 * owns a real vite instance on this same origin whenever it's composed,
 * and vite already solves both problems for a file living in a sibling
 * workspace package (`/@fs/<realpath>` — types stripped, bare specifiers
 * rewritten to vite's optimized-deps URLs; measured directly, see
 * task-8-report.md's appended finding). So each row in `/api/composition`'s
 * response now carries `runtimeUrl`: `/@fs/<realpath of the entry>` when
 * `dev-game` is present, `/plugin-runtime/<id>` (this file's own raw
 * route, unchanged) when it is not — e.g. under `e8 ide`, which never
 * spawns a vite instance for the game at all. `engine/game/loader/src/
 * index.ts`'s `composeFromProject` imports whatever URL it's handed
 * rather than constructing one — the same precedent `clientUrl` already
 * set for the EDITOR's own rows (`composition.ts`, consumed by
 * `engine/ide/client/src/plugins/modules.ts`).
 *
 * A `null` `runtimeUrl` means the row loads nothing, and it comes with a
 * diagnostic in the SAME response whenever that is a mistake rather than
 * a legal absence — see `resolveRuntimeUrl`.
 *
 * `dev-game`'s presence is read reactively, not through a static
 * `inject` (which would make `runtime-assets` wait forever for a service
 * that never arrives under `e8 ide`): `ctx.inject(['devGameRoot'], ...)`
 * only ever fires if and when `dev-game` is later composed onto the same
 * `ctx` tree (see `dev-game.ts`'s own `ctx.provide('devGameRoot', ...)` —
 * `e8 dev`'s CLI command adds it to `host.ctx` right after `createIdeHost`
 * returns, so it is normally in place well before the browser's first
 * `/api/composition` fetch).
 */
export function apply(ctx: Context, config: RuntimeAssetsConfig) {
  // Set once `dev-game` (if ever) provides `devGameRoot` — see the module
  // doc above. Read at request time by `resolveRuntimeUrl`, not captured
  // eagerly, since `dev-game` is composed strictly after this plugin.
  let devGamePresent = false;
  // The row entries `dev-game`'s vite was told to crawl at startup. `null`
  // until (and unless) `dev-game` arrives — which is a different thing from
  // an empty list, and the check below must not fire for it.
  let warmedEntries: readonly string[] | null = null;
  ctx.inject(['devGameRoot'], (scope: Context) => {
    devGamePresent = true;
    // Read structurally rather than through `DevGameRootService`'s type.
    // The provider is another plugin this one deliberately does not import
    // (the whole relationship is "react to it if it ever shows up"), and
    // the thing that actually shows up may be a stand-in — this file's own
    // tests provide a bare `{}` to exercise the URL-shape branch. A list
    // that is not a list means "nothing was warmed that we can speak
    // about", which is the same silence as `dev-game` never arriving.
    const provided: unknown = (scope.devGameRoot as { warmedEntries?: unknown }).warmedEntries;
    warmedEntries = Array.isArray(provided) ? (provided as readonly string[]) : null;
  });

  /**
   * `url: null` used to be the whole answer, and it collapsed several
   * different situations into the one that is legitimately silent:
   *
   *  1. the package resolved and declares no `e8.runtime` — a client-only
   *     plugin has nothing to load into a game. Legal, and silent.
   *  2. the package could not be resolved at all — a typo in a row's
   *     `name`, which is the most likely first-run mistake there is.
   *  3. the package declares an `entry` that is not on disk.
   *  4. the package declares an `entry` that IS on disk but resolves
   *     outside the package's own directory (a symlink escaping it, most
   *     likely) — see task-6-brief.md. The same class of packaging mistake
   *     as 3, not a check against a hostile package: a legitimate
   *     `e8.runtime.entry` never has a reason to point outside itself.
   *
   * 2, 3, and 4 are author mistakes, and a row that silently contributes
   * nothing is exactly the blank screen with nothing said that this whole
   * design exists to prevent: the loader skips a `null` `runtimeUrl`
   * without comment (`composeFromProject`'s own rule, correct for case 1),
   * so nothing downstream could ever have re-derived the fact this
   * function is the only one holding. So they come back as a `Diagnostic`
   * alongside the (still `null`) url, and `/api/composition` merges them
   * into the same `diagnostics` array `ctx.project.diagnostics` already
   * travels in — which `composeFromProject` carries through untouched and
   * `createGame` puts on the failure screen.
   */
  function resolveRuntimeUrl(
    row: ResolvedRow,
    manifest: E8Manifest | null,
    pkg: { dir: string } | null,
  ): { url: string | null; diagnostic?: Diagnostic } {
    if (!pkg) {
      // Two situations, and until now one message for both. A name
      // nothing answers to is a typo or a missing install; a
      // `plugins/<name>/package.json` that does not parse is a package
      // sitting right there whose manifest is broken, and telling that
      // author to check for a typo in the NAME or to install it sends
      // them looking for a problem that is not there. `unresolvedReason`
      // knows which one happened.
      const reason = unresolvedReason(config.cwd, row.name);
      return {
        url: null,
        diagnostic: reason
          ? diagnostic(
              'error',
              row.id,
              'package',
              `row "${row.id}" names the package "${row.name}", which is present in this project's plugins/ but could not be read: ${reason}`,
              `fix the JSON in ${row.name}'s package.json`,
            )
          : diagnostic(
              'error',
              row.id,
              'package',
              `row "${row.id}" names the package "${row.name}", which could not be resolved from ${config.cwd}`,
              `check "${row.name}" for a typo in e8.patch.yml or the bundle that places "${row.id}", or install it`,
            ),
      };
    }

    // Case 1 — the silent one. Reported nowhere, on purpose.
    if (!manifest?.runtime) return { url: null };

    const entryPath = resolve(pkg.dir, manifest.runtime.entry);
    let realEntryPath: string;
    let realPackageRoot: string;
    try {
      // Real-pathed for the same reason `/plugin-runtime/:id` below
      // resolves through symlinks before trusting a path — an npm
      // workspace routinely symlinks the package directory itself.
      realEntryPath = realpathSync(entryPath);
      realPackageRoot = realpathSync(resolve(pkg.dir));
    } catch (error) {
      return {
        url: null,
        diagnostic: diagnostic(
          'error',
          row.id,
          'e8.runtime.entry',
          `row "${row.id}" (${row.name}) declares e8.runtime.entry "${manifest.runtime.entry}", but ${entryPath} is not on disk: ${
            error instanceof Error ? error.message : String(error)
          }`,
          `fix "e8.runtime.entry" in ${row.name}'s package.json, or build the file it points at`,
        ),
      };
    }

    // The containment check `/plugin-runtime/:id` performs at request
    // time, done HERE instead, once, up front. `/@fs/<realpath>` — the
    // OTHER url shape this function can hand out — has no checkpoint of
    // its own once handed to the browser: it's served by `dev-game.ts`'s
    // own vite instance, gated only by vite's `server.fs.allow`, a single
    // workspace-wide allowlist with no notion of "this row's own package".
    // An entry that escapes its package but still lands inside that
    // allowlist (a sibling row's package, say) would otherwise sail
    // through untouched. Checked unconditionally, not just for the
    // `/@fs/` branch, so a row that fails this reports it one request
    // earlier — at composition time — instead of only on
    // `/plugin-runtime/:id`'s own copy of this same check (kept; that
    // route is reachable directly, without going through composition
    // first, so its own check stays load-bearing regardless).
    if (realEntryPath !== realPackageRoot && !realEntryPath.startsWith(realPackageRoot + sep)) {
      return {
        url: null,
        diagnostic: diagnostic(
          'error',
          row.id,
          'e8.runtime.entry',
          `row "${row.id}" (${row.name}) declares e8.runtime.entry "${manifest.runtime.entry}", which escapes its package directory`,
          `fix "e8.runtime.entry" in ${row.name}'s package.json so it stays inside the package`,
        ),
      };
    }

    // Both branches need the entry to exist and stay contained, so the
    // checks above are not conditional on `dev-game`; only which URL can
    // serve it is.
    return { url: devGamePresent ? `/@fs/${realEntryPath}` : `/plugin-runtime/${row.id}` };
  }

  const composition: Parameters<Server['get']>[1] = async (_req, res) => {
    // Re-resolve from disk before answering. `ctx.project` caches its last
    // resolution until something calls `reload()` — nothing did, before
    // this route existed (see `ProjectService.reload`'s doc comment). This
    // is the one place in the wire where staleness would be a real bug: a
    // project author edits e8.patch.yml, reopens the IDE, and the browser's
    // very first question is "what does the game look like right now".
    // Answering from a snapshot that predates the edit would be wrong in
    // the same way `client-assets.ts` already decided a cached manifest
    // would be wrong (see its doc comment).
    //
    // `/plugin-runtime/:id` below deliberately does NOT also reload: the
    // browser's flow is "fetch composition once, then fetch N runtime
    // halves", and re-reading the profile, patch, and every bundle file on
    // each of those N follow-up requests would multiply the disk cost for
    // a staleness window measured in milliseconds, not reduce a real risk.
    // The trade-off this leaves: an edit landing in the gap between the
    // composition fetch and a runtime-half fetch it drove serves the half
    // for the id the browser already committed to asking for, which is a
    // reasonable reading of "the request that's in flight."
    await ctx.project.reload();
    // Same freshness rule as the composition itself, for the same reason:
    // an edit to `game/script.spin` between page loads must not answer
    // from a schema that predates it.
    await ctx.spinSchema.reload();
    // Starts as the project's own (a malformed profile, a bundle that was
    // not found, …) plus the schema's own (a missing or unparseable
    // `.spin`), and gains one per row that could not be resolved — one
    // array, because a person reading a failure screen is looking for
    // "what is wrong with my game", not for which layer of the host
    // noticed it.
    const diagnostics: Diagnostic[] = [...ctx.project.diagnostics, ...ctx.spinSchema.diagnostics];
    const rows = ctx.project.composition.rows.map((row) => {
      const pkg = readPackageJson(config.cwd, row.name);
      // The manifest's OWN complaints (an `e8.runtime` with no string
      // `entry`, say) travel too. They were being parsed and dropped on
      // the same floor `resolveRuntimeUrl`'s were.
      const parsed = pkg
        ? parseManifest(pkg.json, row.id)
        : { manifest: null, diagnostics: [] as Diagnostic[] };
      diagnostics.push(...parsed.diagnostics);

      const runtime = resolveRuntimeUrl(row, parsed.manifest, pkg);
      if (runtime.diagnostic) diagnostics.push(runtime.diagnostic);

      // A row that joined the composition after `e8 dev` started.
      //
      // Vite's dependency optimizer crawls what it is told to at startup —
      // `dev-game` names the row entries it knew about then, precisely so
      // the browser only ever sees one optimizer generation (see that
      // plugin's `warmupEntries`, and the two-`Container` fault it exists
      // to prevent). A row added since is outside that crawl, so if it
      // brings a bare dependency this server has not already prebundled,
      // vite re-optimizes mid-load and restamps every optimized module —
      // and the reload vite would normally send to fix that goes nowhere,
      // because `dev-game` runs with `hmr: false`.
      //
      // The consequence is otherwise completely silent to the person: vite
      // logs "optimized dependencies changed. reloading" to the SERVER
      // console and the browser simply loses pointer events on the board.
      // This says it where they are already looking.
      //
      // A `warning`, and worded conditionally, because that is the honest
      // shape of what is known here: the row is certainly outside the
      // crawl; whether it brings a new dependency is the optimizer's
      // business, not this route's, and a row that brings none costs
      // nothing at all.
      const entryPath = runtime.url?.startsWith(FS_PREFIX)
        ? runtime.url.slice(FS_PREFIX.length)
        : null;
      if (warmedEntries !== null && entryPath !== null && !warmedEntries.includes(entryPath)) {
        diagnostics.push(
          diagnostic(
            'warning',
            row.id,
            'dev-server',
            `row "${row.id}" (${row.name}) joined this composition after the dev server started, so its dependencies were not part of vite's startup crawl — if it brings one this server has not already prebundled, the page can end up running two copies of it and the board stops receiving pointer events`,
            'restart `e8 dev` to fold this row into the crawl; nothing else about the row is wrong',
          ),
        );
      }

      // `seam` and `requires` both ride along for the reason `runtimeUrl`
      // does: only the host can read a package's manifest, and the browser
      // (which composes from this response) has no `package.json` of its
      // own to fall back on. `requires` is `@energy8engine/game-runtime`'s
      // to enforce, after every row has applied — see `GameCompositionRow
      // .requires` and `E8RuntimeHalf.requires`.
      return {
        ...row,
        runtimeUrl: runtime.url,
        seam: parsed.manifest?.seam,
        requires: parsed.manifest?.runtime?.requires,
      };
    });
    // `schema` always rides here, even `null` — omitting the field on a
    // parse failure would be indistinguishable from an old host that has
    // never heard of a schema at all, and the browser needs to tell those
    // two apart (see task-3-brief.md).
    res.json({ rows, diagnostics, schema: ctx.spinSchema.schema });
  };

  const pluginRuntime: Parameters<Server['get']>[1] = async (req, res) => {
    const id = req.params.id as string;
    const row = ctx.project.composition.rows.find((candidate) => candidate.id === id);
    if (!row) {
      res.status = 404;
      res.json({ error: `no row with id "${id}"` });
      return;
    }

    const pkg = readPackageJson(config.cwd, row.name);
    const manifest = pkg ? parseManifest(pkg.json, row.id).manifest : null;
    if (!pkg || !manifest?.runtime) {
      res.status = 404;
      res.json({ error: `"${row.name}" has no runtime half` });
      return;
    }

    // See `client-assets.ts`'s doc comment on the identical check for the
    // full reasoning: a lexical `path.resolve` alone doesn't catch a
    // symlink sitting inside the package directory whose target escapes
    // it, and npm workspaces routinely symlinks the package directory
    // itself — so both sides go through `realpathSync` before comparison,
    // not just the entry.
    const packageRoot = resolve(pkg.dir);
    const entryPath = resolve(packageRoot, manifest.runtime.entry);

    let realEntryPath: string;
    let realPackageRoot: string;
    try {
      realEntryPath = realpathSync(entryPath);
      realPackageRoot = realpathSync(packageRoot);
    } catch (error) {
      res.status = 404;
      res.json({
        error: `"${row.name}" declares e8.runtime.entry "${manifest.runtime.entry}" but it is missing on disk`,
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (realEntryPath !== realPackageRoot && !realEntryPath.startsWith(realPackageRoot + sep)) {
      res.status = 404;
      res.json({
        error: `"${row.name}" declares e8.runtime.entry "${manifest.runtime.entry}" which escapes its package directory`,
      });
      return;
    }

    let source: string;
    try {
      source = readFileSync(realEntryPath, 'utf8');
    } catch (error) {
      res.status = 404;
      res.json({
        error: `"${row.name}" declares e8.runtime.entry "${manifest.runtime.entry}" but it is missing on disk`,
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    res.headers.set('content-type', 'application/javascript; charset=utf-8');
    res.text(source);
  };

  // The IDE reads the composition off the root; the game reads both off
  // its own server — see `RuntimeAssetsService`.
  ctx.server.get('/api/composition', composition);
  ctx.provide('runtimeAssets', {
    attachGameRoutes(server) {
      server.get('/api/composition', composition);
      server.get('/plugin-runtime/:id', pluginRuntime);
    },
  });
}
/**
 * The real, contained runtime-entry paths of a composition's rows — the
 * files a browser will dynamically `import()` once `/api/composition` has
 * told it their URLs.
 *
 * It exists for `dev-game`, which needs them BEFORE it creates its vite
 * instance, and needs them for a reason that has nothing to do with
 * serving: vite's dependency optimizer only crawls what it can reach
 * statically from the project's own html, and a row's runtime half is
 * reachable only through a dynamic import made minutes later. Discovering
 * a new bare dependency at that point makes vite re-optimize and change
 * the `?v=` stamp on every optimized module — so the page ends up running
 * two generations of the same dependency at once. See `dev-game.ts`, which
 * documents what that cost and how it was measured.
 *
 * Rows that resolve to nothing, declare no runtime half, or whose entry is
 * missing or escapes its package are simply left out: this function
 * reports nothing and is not a second opinion about a composition's
 * health. `/api/composition` above is where a row's problems are named,
 * and it re-derives them from disk at request time.
 */
export function runtimeEntryPaths(cwd: string, rows: readonly ResolvedRow[]): string[] {
  const paths: string[] = [];
  for (const row of rows) {
    const pkg = readPackageJson(cwd, row.name);
    if (!pkg) continue;
    const manifest = parseManifest(pkg.json, row.id).manifest;
    if (!manifest?.runtime) continue;
    try {
      const realEntryPath = realpathSync(resolve(pkg.dir, manifest.runtime.entry));
      const realPackageRoot = realpathSync(resolve(pkg.dir));
      // The same containment rule `resolveRuntimeUrl` applies before
      // handing a URL out, restated rather than shared because this
      // function has no diagnostics to produce and no URL to shape — what
      // the two have in common is exactly this one comparison.
      if (realEntryPath !== realPackageRoot && !realEntryPath.startsWith(realPackageRoot + sep)) {
        continue;
      }
      paths.push(realEntryPath);
    } catch {
      // Not on disk. `/api/composition` says so; this one just has
      // nothing to warm.
    }
  }
  return paths;
}
