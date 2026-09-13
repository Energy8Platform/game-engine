import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from 'cordis';
import Server from '@cordisjs/plugin-server';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as ideStatic from '../src/plugins/ide-static';

const HINT = 'оболочка не собрана: npm run build -w @energy8engine/ide-web';
const OUTSIDE = 'SENTINEL: this file lives outside dist and must never be served';

let tmp: string;
let dist: string;
let ctx: Context | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ide-static-'));
  dist = join(tmp, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>ide</title>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("app")');
  writeFileSync(join(dist, 'assets', 'app.css'), 'body{}');
  writeFileSync(join(tmp, 'secret.txt'), OUTSIDE);
});

afterEach(async () => {
  await ctx?.fiber.dispose();
  ctx = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * A root shaped like `createIdeHost`'s: a health route and the `/ide`
 * socket registered BEFORE `ide-static`, which is plugged last — the
 * order that decides who answers.
 */
async function boot(distPath: string): Promise<string> {
  ctx = new Context();
  await ctx.plugin(Server, { host: '127.0.0.1', port: 0 });
  ctx.server.get('/api/health', async (_req, res) => {
    res.json({ ok: true });
  });
  ctx.server.ws('/ide', async (_req, accept) => {
    (await accept()).send('hello');
  });
  await ctx.plugin(ideStatic, { dist: distPath });
  return `http://${ctx.server.host}:${ctx.server.port}`;
}

describe('ide-static', () => {
  it('serves index.html at / and for any extension-less path (SPA fallback)', async () => {
    const url = await boot(dist);
    for (const path of ['/', '/doc/x', '/anything']) {
      const res = await fetch(`${url}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toBe('text/html; charset=utf-8');
      expect(await res.text(), path).toContain('<title>ide</title>');
    }
  });

  it('serves assets with a content type from the extension', async () => {
    const url = await boot(dist);
    const js = await fetch(`${url}/assets/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript');
    expect(await js.text()).toBe('console.log("app")');
    const css = await fetch(`${url}/assets/app.css`);
    expect(css.headers.get('content-type')).toBe('text/css');
  });

  it('serves a file whose name merely STARTS with "ide" — the /ide exclusion is a segment, not a prefix', async () => {
    writeFileSync(join(dist, 'ide-icon.svg'), '<svg/>');
    const url = await boot(dist);
    const icon = await fetch(`${url}/ide-icon.svg`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(await icon.text()).toBe('<svg/>');
  });

  it('404s as diagnostics JSON for a missing file with an extension', async () => {
    const url = await boot(dist);
    const res = await fetch(`${url}/assets/nope.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({
      diagnostics: [{ severity: 'error', plugin: 'ide-static', where: '/assets/nope.js' }],
    });
  });

  it('never serves a file outside dist, spelled or percent-encoded', async () => {
    const url = await boot(dist);
    for (const path of [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
    ]) {
      // node's fetch normalises `..` itself, so hit the socket raw
      const res = await rawGet(url, path);
      expect(res.body, path).not.toContain(OUTSIDE);
      expect([200, 404], path).toContain(res.status);
      if (res.status === 200) expect(res.body, path).toContain('<title>ide</title>');
    }
  });

  it('refuses a symlink inside dist that points outside', async () => {
    symlinkSync(join(tmp, 'secret.txt'), join(dist, 'assets', 'leak.js'));
    const url = await boot(dist);
    const res = await fetch(`${url}/assets/leak.js`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(OUTSIDE);
  });

  it('leaves /api routes, /ide upgrades and non-GET methods to the rest of the root', async () => {
    const url = await boot(dist);
    const health = await fetch(`${url}/api/health`);
    expect(health.headers.get('content-type')).toContain('application/json');
    expect(await health.json()).toEqual({ ok: true });

    const socket = new WebSocket(`${url.replace('http', 'ws')}/ide`);
    const first = await new Promise<string>((resolve, reject) => {
      socket.once('message', (data) => resolve(String(data)));
      socket.once('error', reject);
    });
    expect(first).toBe('hello');
    socket.close();

    // a route plugged in AFTER the catch-all — the prefix guard, not
    // registration order, is what keeps this one JSON
    ctx!.server.get('/api/late', async (_req, res) => {
      res.json({ late: true });
    });
    const late = await fetch(`${url}/api/late`);
    expect(await late.json()).toEqual({ late: true });

    const post = await fetch(url, { method: 'POST' });
    expect(post.status).not.toBe(200);
    expect(post.headers.get('content-type') ?? '').not.toContain('text/html');
  });

  describe('without a built dist', () => {
    it('answers GET / with a 503 page naming the build command', async () => {
      const url = await boot(join(tmp, 'not-built'));
      const res = await fetch(`${url}/`);
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const body = await res.text();
      expect(body).toContain(HINT);
      expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
    });

    it('answers the same as diagnostics JSON when the client accepts json', async () => {
      const url = await boot(join(tmp, 'not-built'));
      const res = await fetch(`${url}/doc/x`, { headers: { accept: 'application/json' } });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({
        diagnostics: [
          {
            severity: 'error',
            plugin: 'ide-static',
            where: join(tmp, 'not-built'),
            fix: 'npm run build -w @energy8engine/ide-web',
          },
        ],
      });
    });

    it('404s assets as diagnostics JSON', async () => {
      const url = await boot(join(tmp, 'not-built'));
      const res = await fetch(`${url}/assets/app.js`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ diagnostics: [{ plugin: 'ide-static' }] });
    });
  });
});

/** `GET path` over a raw socket: fetch/URL would collapse `..` before the host ever saw it. */
async function rawGet(base: string, path: string): Promise<{ status: number; body: string }> {
  const { createConnection } = await import('node:net');
  const { host, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = createConnection(Number(port), host.split(':')[0], () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => (raw += chunk));
    socket.on('error', reject);
    socket.on('end', () => {
      const status = Number(raw.match(/^HTTP\/1\.1 (\d+)/)?.[1]);
      resolve({ status, body: raw.slice(raw.indexOf('\r\n\r\n') + 4) });
    });
  });
}
