/**
 * Slice 26 ("shell, session, build"): `e8 build` on a copy of `first-slot`,
 * and the `dist/` it writes played in a real browser — spec §9's
 * `build.spec.ts`, two cases over one build:
 *
 *  1. `dist/` under a BARE static server (no `/api/session`, no
 *     `/api/spin`): the bundled rows compose — the flow boots (`start`/
 *     `base` in the trace), `base_game` is on screen, the shell is up on
 *     `session-host`'s fallback init — and `__e8.spin()` leaves by `failed`,
 *     the live diagnostics naming the route that was not there.
 *  2. The SAME `dist/` under a static server that proxies `/api/session`
 *     and `/api/spin` to a running `e8 dev` host over the same copy:
 *     `__e8.spin()` resolves `next` and the shell's balance moves — the
 *     bundled rows, a working session.
 *
 * The build runs in-process (`build()` from `@energy8engine/ide-host/
 * compute`, the function `e8 build` calls), and so does the static server:
 * node's own `http` over `dist/` — path → file, `/` → `index.html`, a mime
 * by extension, the extension-less `api/*` files as JSON, 404 otherwise.
 * Nothing serves `dist/` in the product (spec §6: any static server does);
 * this one is the smallest that proves it.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { build } from '@energy8engine/ide-host/compute';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

test.describe.configure({ mode: 'serial' });

interface FlowTraceEntry {
  run: number;
  node: string;
  out: string | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

interface StaticServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Forwards one request to `origin` — method, headers and body through
 * `fetch` — and answers with what came back. `host`/`connection`/
 * `content-length` are the hop's own (fetch sets its own); everything else
 * the browser sent, `content-type` included, travels as it is.
 */
async function forward(req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string' && !['host', 'connection', 'content-length'].includes(name)) {
      headers[name] = value;
    }
  }
  const method = req.method ?? 'GET';
  const upstream = await fetch(`${origin}${req.url ?? '/'}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

/** A static server over `dist`; with `proxy`, the two session routes go to that origin instead. */
async function serveDist(dist: string, proxy?: string): Promise<StaticServer> {
  const root = normalize(dist) + sep;
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (proxy && (path === '/api/session' || path === '/api/spin')) {
      void forward(req, res, proxy).catch((error: unknown) => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(error) }));
      });
      return;
    }
    const rel = path === '/' ? 'index.html' : path.slice(1);
    const file = normalize(join(root, rel));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const type = rel.startsWith('api/')
      ? 'application/json'
      : (MIME[extname(file)] ?? 'application/octet-stream');
    res.writeHead(200, { 'content-type': type });
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

let dir: string;
let dist: string;
let bare: StaticServer;
let proxied: StaticServer | undefined;
let host: DevHost | undefined;

test.beforeAll(async () => {
  dir = projectCopy();
  dist = join(dir, 'dist');
  const result = await build({ cwd: dir, out: dist });
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  for (const rel of [
    'index.html',
    'api/composition',
    'api/flow',
    'api/scenes',
    'api/symbols',
    'assets/spin.wav',
  ]) {
    expect(result.files, rel).toContain(rel);
  }
  bare = await serveDist(dist);
});

test.afterAll(async () => {
  await bare?.close();
  await proxied?.close();
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** `[]` until the page's module has evaluated and installed `__e8` — the poll below starts before it has. */
const trace = (page: Page): Promise<FlowTraceEntry[]> =>
  page.evaluate(() => (window as any).__e8?.flowTrace() ?? []);
const pairs = async (page: Page): Promise<string[]> =>
  (await trace(page)).map((e) => `${e.node}:${e.out}`);

/** Opens the built page and waits for the flow's boot run to have shown `base_game`. */
async function bootedPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect.poll(() => pairs(page), { timeout: 20_000 }).toContain('base:next');
  expect(await pairs(page)).toContain('start:next');
}

test('a bare static server: the bundled rows compose, base_game and the shell are up, a spin fails naming the session routes', async ({
  page,
}) => {
  await bootedPage(page, bare.url);

  expect(await page.evaluate(() => (window as any).__e8.scenesVisible())).toContain('base_game');
  // `session-host`'s fallback init (`/api/session` was a 404) still mounts the shell.
  expect(await page.evaluate(() => (window as any).__e8.shell())).not.toBeNull();

  // `kind: 'spin'`: the host call failed, not the presentation after it.
  const spin = await page.evaluate(() => (window as any).__e8.spin());
  expect(spin).toEqual({ out: 'failed', kind: 'spin' });
  const diagnostics = JSON.stringify(
    await page.evaluate(() => (window as any).__e8.liveDiagnostics()),
  );
  expect(diagnostics).toMatch(/\/api\/(spin|session)/);
});

test('the same dist with /api/session and /api/spin proxied to a running host: a spin resolves next and the balance moves', async ({
  page,
}) => {
  host = await startDevHost(dir);
  proxied = await serveDist(dist, host.gameUrl);
  await bootedPage(page, proxied.url);

  const before = await page.evaluate(
    () => (window as any).__e8.shell().state as { balance: number; bet: number },
  );
  expect(before.balance).toBe(1000);

  const spin = await page.evaluate(() => (window as any).__e8.spin());
  expect(spin).toEqual({ out: 'next', kind: 'present' });
  expect(await pairs(page)).toContain('spin:result');

  // The dev wallet's accounting, read off the spin log the bundled
  // `spinlog1` row kept: charged the bet, credited the win, and the result's
  // own balance landed on the shell — after the reels (`bal` node), so
  // polled; `spin()` resolves on `present`'s exit, a node earlier.
  const result = await page.evaluate(
    () =>
      (window as any).__e8.spins().at(-1).result as { balance: number; winAmount: number },
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window as any).__e8.shell().state.balance)) as number,
      { timeout: 5000 },
    )
    .toBe(result.balance);
  expect(result.balance).toBeCloseTo(before.balance - before.bet + result.winAmount, 6);
});
