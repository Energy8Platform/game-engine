import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Context } from 'cordis';
import { type E8Manifest, parseManifest, type ResolvedRow } from '@energy8engine/contracts';
import { readPackageJson } from '../resolvePackage';

export const name = 'runtime-assets';
export const inject = ['server', 'project'];

export interface RuntimeAssetsConfig {
  cwd: string;
}

/**
 * The wire between task 4's resolved GAME composition and the browser:
 * `GET /api/composition` hands over the row list (and diagnostics) task 6
 * needs to know which ids exist; `GET /plugin-runtime/:id` hands over one
 * row's runtime half so the browser can dynamically `import()` it into the
 * running game.
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
 * Both routes are plain `ctx.server.get(path, handler)` registrations.
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
  ctx.inject(['devGameRoot'], () => {
    devGamePresent = true;
  });

  /**
   * `null` when the row's package has no runtime half at all — a
   * legitimate, silent case (see `plugin-runtime/:id`'s identical check
   * below), not an error this function reports.
   */
  function resolveRuntimeUrl(row: ResolvedRow, manifest: E8Manifest | null, pkg: { dir: string } | null): string | null {
    if (!pkg || !manifest?.runtime) return null;

    if (devGamePresent) {
      const entryPath = resolve(pkg.dir, manifest.runtime.entry);
      try {
        // Real-pathed for the same reason `/plugin-runtime/:id` below
        // resolves through symlinks before trusting a path — an npm
        // workspace routinely symlinks the package directory itself.
        return `/@fs/${realpathSync(entryPath)}`;
      } catch {
        // Missing on disk — not this route's job to explain why; a
        // fetch of the (also `null`-safe) `/plugin-runtime/:id` fallback
        // would report the same fact if something asked for it.
        return null;
      }
    }

    return `/plugin-runtime/${row.id}`;
  }

  ctx.server.get('/api/composition', async (_req, res) => {
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
    const rows = ctx.project.composition.rows.map((row) => {
      const pkg = readPackageJson(config.cwd, row.name);
      const manifest = pkg ? parseManifest(pkg.json, row.id).manifest : null;
      return { ...row, runtimeUrl: resolveRuntimeUrl(row, manifest, pkg) };
    });
    res.json({ rows, diagnostics: ctx.project.diagnostics });
  });

  ctx.server.get('/plugin-runtime/:id', async (req, res) => {
    const row = ctx.project.composition.rows.find((candidate) => candidate.id === req.params.id);
    if (!row) {
      res.status = 404;
      res.json({ error: `no row with id "${req.params.id}"` });
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
  });
}
