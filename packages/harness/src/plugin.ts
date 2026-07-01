/**
 * `createHarness()` — the dev-only (apply: 'serve') vite plugin that assembles
 * the renderer- and platform-agnostic dev harness:
 *   • serves the wrapper page (iframe framing + tab bar + sidebar) on the root,
 *   • serves the core client ESM at `/__harness/client.js`,
 *   • serves each panel's client ESM at `/__harness/panel/<id>.js`,
 *   • mounts every backend/panel plugin's own server middleware.
 *
 * Node-only: imports node builtins. Never pulled into a browser bundle.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { SCREEN_PRESETS } from './screens';
import { LANGS } from './langs';
import { renderWrapperHtml } from './wrapper';
import { GAME_MARKER } from './launch';
import type {
  CreateHarnessOptions,
  HarnessBackend,
  HarnessPanel,
  HarnessServer,
  HarnessServerContext,
  IncomingLike,
  OutgoingLike,
  WrapperData,
  WrapperPanelInfo,
} from './types';

interface VitePlugin {
  name: string;
  apply: 'serve';
  configureServer(server: HarnessServer): void;
}

const CLIENT_URL = '/__harness/client.js';
const PANEL_PREFIX = '/__harness/panel/';

// Balance levels the core Settings panel offers (major units).
const BALANCE_LEVELS: { value: number; label: string }[] = [
  { value: 1, label: '1' },
  { value: 10, label: '10' },
  { value: 100, label: '100' },
  { value: 1_000, label: '1K' },
  { value: 10_000, label: '10K' },
  { value: 100_000, label: '100K' },
  { value: 1_000_000, label: '1M' },
  { value: 10_000_000, label: '10M' },
  { value: 100_000_000, label: '100M' },
  { value: 1_000_000_000, label: '1B' },
  { value: 10_000_000_000, label: '10B' },
];

function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, json: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(json));
}

/** Serve a built ESM file (+ its sourcemap for `.map` requests) from disk. */
function serveFile(res: ServerResponse, path: string): void {
  try {
    const body = readFileSync(path, 'utf8');
    res.statusCode = 200;
    res.setHeader('content-type', path.endsWith('.map') ? 'application/json' : 'application/javascript');
    res.end(body);
  } catch (err) {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain');
    res.end(`harness: not found — ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function createHarness(opts: CreateHarnessOptions = {}): VitePlugin {
  const plugins = opts.plugins ?? [];
  const backend: HarnessBackend | undefined = plugins.find((p) => p.backend)?.backend;
  const panels: HarnessPanel[] = plugins.filter((p) => p.panel).map((p) => p.panel as HarnessPanel);
  const version = opts.version ?? '1';
  const startingBalance = opts.startingBalance ?? 10_000;

  const clientPath = fileURLToPath(new URL('./client.js', import.meta.url));
  const panelById = new Map(panels.map((p) => [p.id, p]));

  async function buildWrapperData(host: string): Promise<WrapperData> {
    const backendInfo = backend ? { id: backend.id, ...(await backend.describe({ host })) } : null;
    const wrapperPanels: WrapperPanelInfo[] = panels.map((p) => ({
      id: p.id,
      title: p.title,
      placement: p.placement,
      clientUrl: PANEL_PREFIX + p.id + '.js',
      config: p.config,
    }));
    return {
      title: opts.title ?? backendInfo?.id ?? 'Harness',
      version,
      screens: SCREEN_PRESETS,
      langs: LANGS,
      balances: BALANCE_LEVELS,
      defaultBalance: startingBalance,
      defaultCurrency: backendInfo?.currencies.includes('EUR') ? 'EUR' : (backendInfo?.currencies[0] ?? 'EUR'),
      defaultLang: 'en',
      backend: backendInfo,
      panels: wrapperPanels,
    };
  }

  return {
    name: 'harness',
    apply: 'serve',
    configureServer(server: HarnessServer): void {
      // Shared context for backend/panel middleware.
      const ctx: HarnessServerContext = {
        server,
        readBody: (req) => collectBody(req as unknown as IncomingMessage),
        sendJson: (res, status, json) => sendJson(res as unknown as ServerResponse, status, json),
      };
      for (const p of plugins) {
        void p.backend?.configureServer(ctx);
        void p.panel?.configureServer?.(ctx);
      }

      // ── core client + panel client ESM ──────────────────────────────
      server.middlewares.use('/__harness', (req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const full = '/__harness' + url;
        if (full === CLIENT_URL || full === CLIENT_URL + '.map') {
          serveFile(res as unknown as ServerResponse, clientPath + (full.endsWith('.map') ? '.map' : ''));
          return;
        }
        if (full.startsWith(PANEL_PREFIX)) {
          const rest = full.slice(PANEL_PREFIX.length); // '<id>.js' or '<id>.js.map'
          const isMap = rest.endsWith('.map');
          const id = rest.replace(/\.js(\.map)?$/, '');
          const panel = panelById.get(id);
          if (panel) {
            serveFile(res as unknown as ServerResponse, panel.clientEntry + (isMap ? '.map' : ''));
            return;
          }
        }
        next();
      });

      // ── wrapper page on the bare root document ───────────────────────
      server.middlewares.use('/', (req: IncomingLike, res: OutgoingLike, next: () => void) => {
        const url = req.url ?? '/';
        const accept = (req.headers.accept ?? '') as string;
        const isDocument = accept.includes('text/html');
        const path = url.split('?')[0];
        const isRoot = path === '/' || path === '/index.html' || path === '';
        const isGame = url.includes(`${GAME_MARKER}=1`);

        // The iframe's launch carries the game marker → let vite serve the real
        // game index.html. The bare root document → serve the wrapper.
        if (!isRoot || !isDocument || isGame) {
          next();
          return;
        }

        const host = (req.headers.host ?? 'localhost') as string;
        void buildWrapperData(host)
          .then((data) => {
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.end(renderWrapperHtml(data, CLIENT_URL));
          })
          .catch((err) => {
            res.statusCode = 500;
            res.setHeader('content-type', 'text/plain');
            res.end(`harness: failed to render wrapper — ${err instanceof Error ? err.message : String(err)}`);
          });
      });
    },
  };
}
