import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Context } from 'cordis';
import { parseManifest } from '@energy8engine/contracts';
import { readPackageJson } from '../resolvePackage';

export const name = 'client-assets';
export const inject = ['server', 'loader'];

export interface ClientAssetsConfig {
  cwd: string;
}

/**
 * Hands the browser a plugin's client half. `composition.snapshot()` only
 * advertises this route (as `clientUrl`) for entries whose manifest
 * declares `e8.client.entry` — this handler re-derives the same fact from
 * disk rather than trusting the id, since the id in the request came back
 * from the network and the package on disk can have changed since the last
 * snapshot.
 */
export function apply(ctx: Context, config: ClientAssetsConfig) {
  ctx.server.get('/plugin-client/:id', async (req, res) => {
    const entry = [...ctx.loader.entries()].find((candidate) => candidate.id === req.params.id);
    if (!entry) {
      res.status = 404;
      res.json({ error: `no entry with id "${req.params.id}"` });
      return;
    }

    const pkg = readPackageJson(config.cwd, entry.options.name);
    const manifest = pkg ? parseManifest(pkg.json, entry.options.name).manifest : null;
    if (!pkg || !manifest?.client) {
      res.status = 404;
      res.json({ error: `"${entry.options.name}" has no client half` });
      return;
    }

    // `manifest.client.entry` is an unvalidated string straight out of a
    // package's package.json. `path.resolve` alone is a *lexical* check —
    // it closes `..` segments and sibling-directory-name-prefix tricks, but
    // it never touches the filesystem, so a symlink sitting *inside* the
    // package directory (legal in any npm tarball) walks straight through
    // it: `entry.js -> /etc/passwd` resolves lexically to a path under
    // `pkg.dir` while actually reading `/etc/passwd`. Comparing realpaths
    // instead closes that: both sides are resolved through any symlinks
    // before the containment check, so the comparison is against where the
    // bytes actually come from, not where the path string merely points.
    //
    // Both sides go through `realpathSync`, not just the entry — plugin
    // packages are themselves routinely symlinked (npm workspaces symlink
    // `probe-plugin` into `node_modules`; the ephemeral test fixtures do
    // the same). Resolving only the entry would make `pkg.dir` and the
    // entry stop sharing a prefix even for a perfectly ordinary in-package
    // file, breaking every legitimate case. Resolving both keeps them
    // consistent.
    //
    // `realpathSync` throws for a path that doesn't exist (including a
    // dangling symlink) — that's folded into the same "missing on disk"
    // 404 as an ordinary missing file, since both are "nothing to serve",
    // not "attempted escape".
    const packageRoot = resolve(pkg.dir);
    const entryPath = resolve(packageRoot, manifest.client.entry);

    let realEntryPath: string;
    let realPackageRoot: string;
    try {
      realEntryPath = realpathSync(entryPath);
      realPackageRoot = realpathSync(packageRoot);
    } catch (error) {
      res.status = 404;
      res.json({
        error: `"${entry.options.name}" declares e8.client.entry "${manifest.client.entry}" but it is missing on disk`,
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (realEntryPath !== realPackageRoot && !realEntryPath.startsWith(realPackageRoot + sep)) {
      res.status = 404;
      res.json({
        error: `"${entry.options.name}" declares e8.client.entry "${manifest.client.entry}" which escapes its package directory`,
      });
      return;
    }

    let source: string;
    try {
      source = readFileSync(realEntryPath, 'utf8');
    } catch (error) {
      res.status = 404;
      res.json({
        error: `"${entry.options.name}" declares e8.client.entry "${manifest.client.entry}" but it is missing on disk`,
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    res.headers.set('content-type', 'text/javascript; charset=utf-8');
    res.text(source);
  });
}
