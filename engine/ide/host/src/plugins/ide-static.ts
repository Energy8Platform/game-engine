/**
 * `ide-static`: the ROOT server serves the built IDE shell
 * (`engine/apps/web/dist`) so one process is enough (spec §7). Plugged
 * LAST in `../index.ts` as a catch-all route — `HttpRoute`s dispatch in
 * registration order (see dev-game.ts, point 3), so every `/api/*`,
 * `/ide` and `/plugin-client/*` route registered before it wins. Those
 * prefixes are ALSO excluded from the route's own regexp rather than
 * `next()`-ed inside the handler: an `all` route that MATCHES a path turns
 * cordis's answer for an unhandled request from 404 into 405 (`allow: *`)
 * — measured on `/api/files` before a project is open — so a path this
 * plugin will never serve must not match at all.
 *
 * Nothing here throws (spec §10): outside-of-dist and missing files are a
 * 404 `DiagnosticsResponse`; an unbuilt `dist` is a 503 page (or the
 * same diagnostic as JSON when the client accepts it) — the host lives,
 * the API works.
 *
 * The body goes through cordis's own `res.body` (a `Uint8Array`), which
 * marks the wrapper `claimed` and is piped by its `_end()` — no raw
 * `res._res` bridge as dev-game needs for vite, because there is no third
 * party writing here.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from 'cordis';
import type { Response } from '@cordisjs/plugin-server';
import { type DiagnosticsResponse, diagnostic } from '@energy8engine/contracts';

export const name = 'ide-static';
export const inject = ['server'];

export interface IdeStaticConfig {
  /** The built IDE. Defaults to `IDE_DIST`, else this repo's `engine/apps/web/dist`. */
  dist?: string;
}

/** Same ESM-relative trick as `project.ts`'s `REPO_BUNDLES_DIR`; measured to land on `engine/apps/web/dist`. */
export const DEFAULT_DIST = fileURLToPath(new URL('../../../../apps/web/dist', import.meta.url));

export const BUILD_HINT = 'npm run build -w @energy8engine/ide-web';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** Everything but the root's own surfaces: `/api/*`, the `/ide` socket, `/plugin-client/*`. */
const SERVED = /^(?!\/api\/|\/ide|\/plugin-client\/).*$/;

export function apply(ctx: Context, config: IdeStaticConfig = {}): void {
  const dist = resolve(config.dist ?? process.env.IDE_DIST ?? DEFAULT_DIST);

  /**
   * Bytes of `dist/<path>` when its realpath is a regular file inside
   * `realpath(dist)`, else `null`. ponytail: whole file in memory per
   * request (3.3 MB for the Monaco chunk today); switch to `open()` +
   * `handle.createReadStream()` → `Readable.toWeb` if the build outgrows that.
   */
  async function readInside(path: string): Promise<Buffer | null> {
    try {
      const root = await realpath(dist);
      const real = await realpath(join(dist, path));
      if (real !== root && !real.startsWith(root + sep)) return null;
      if (!(await stat(real)).isFile()) return null;
      return await readFile(real);
    } catch {
      return null;
    }
  }

  function send(res: Response, type: string, bytes: Buffer) {
    res.headers.set('content-type', type);
    res.headers.set('content-length', String(bytes.byteLength));
    // `readFile`'s Buffer sits on a plain ArrayBuffer; only TS's
    // `ArrayBufferLike` widening keeps it out of `BodyInit`.
    res.body = bytes as Uint8Array<ArrayBuffer>;
  }

  function refuse(res: Response, status: number, where: string, message: string, fix?: string) {
    res.status = status;
    const refusal: DiagnosticsResponse = {
      diagnostics: [diagnostic('error', 'ide-static', where, message, fix)],
    };
    res.json(refusal);
  }

  ctx.server.all(SERVED, async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    let path: string;
    try {
      path = decodeURIComponent(req.path);
    } catch {
      return refuse(res, 404, req.path, `"${req.path}" is not a valid path`);
    }

    const ext = extname(path).toLowerCase();
    const bytes = ext ? await readInside(path) : null;
    if (bytes) return send(res, CONTENT_TYPES[ext] ?? 'application/octet-stream', bytes);
    if (ext) return refuse(res, 404, req.path, `"${req.path}" is not in the built IDE`);

    const index = await readInside('index.html');
    if (index) return send(res, CONTENT_TYPES['.html'], index);

    const message = `оболочка не собрана: ${BUILD_HINT}`;
    if ((req.headers.get('accept') ?? '').includes('application/json')) {
      return refuse(res, 503, dist, message, BUILD_HINT);
    }
    res.status = 503;
    res.headers.set('content-type', CONTENT_TYPES['.html']);
    res.body = `<!doctype html><meta charset="utf-8"><title>e8</title><p>${message}</p>`;
  });
}
