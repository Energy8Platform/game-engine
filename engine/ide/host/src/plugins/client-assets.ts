import { readFileSync } from 'node:fs';
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
    // package's package.json — `path.join`/`path.resolve` happily walk `..`
    // segments right out of `pkg.dir`. Contain the read to the package
    // directory: compare against `packageRoot + sep`, not a bare
    // `startsWith(packageRoot)`, so a sibling directory that merely shares
    // `pkg.dir` as a name prefix (e.g. `.../probe-plugin-evil/...` against
    // `.../probe-plugin`) can't slip through.
    const packageRoot = resolve(pkg.dir);
    const entryPath = resolve(packageRoot, manifest.client.entry);
    if (entryPath !== packageRoot && !entryPath.startsWith(packageRoot + sep)) {
      res.status = 404;
      res.json({
        error: `"${entry.options.name}" declares e8.client.entry "${manifest.client.entry}" which escapes its package directory`,
      });
      return;
    }

    let source: string;
    try {
      source = readFileSync(entryPath, 'utf8');
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
