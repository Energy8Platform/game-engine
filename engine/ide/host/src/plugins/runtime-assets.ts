import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Context } from 'cordis';
import { parseManifest } from '@energy8engine/contracts';
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
 */
export function apply(ctx: Context, config: RuntimeAssetsConfig) {
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
    res.json({ rows: ctx.project.composition.rows, diagnostics: ctx.project.diagnostics });
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
