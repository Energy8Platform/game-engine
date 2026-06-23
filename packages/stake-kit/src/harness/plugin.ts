/**
 * `stakeHarnessPlugin()` — the dev-only (apply: 'serve') vite plugin that
 * assembles the Stake dev harness:
 *   • serves the wrapper page (control bar + iframe) on the root document,
 *   • mounts the dev-RGS at `/__rgs/*` (the 6 Stake RGS endpoints),
 *   • backs `play` with the curated e8-math books, falling back to LuaEngine
 *     for modes that have no books.
 *
 * Node-only: imports node builtins + `vite` (externalised in the rollup build).
 * Must NOT be pulled into the browser stake-kit entry.
 */

import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { API_MULTIPLIER, CURRENCY_META } from '@energy8platform/stake-bridge';
import type { RGSPlayResponse, StakeRound } from '@energy8platform/stake-bridge';
import { LuaEngine } from '@energy8platform/platform-core/lua';

import { loadIndex } from './books';
import { createDevRgs, type DevRgs } from './dev-rgs';
import { handleRgsRequest, type LuaPlay } from './rgs-http';
import { renderWrapperHtml, type WrapperMode } from './wrapper';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StakeHarnessPluginOptions {
  /** Path to the harness MathConfig file. Default './math.config.ts'. */
  config?: string;
  /** Curated books directory. Default 'stake-math'. */
  booksDir?: string;
  /** Starting dev balance in MAJOR units. Default 10_000. */
  startingBalance?: number;
}

/**
 * Minimal MathConfig shape we consume (avoids a hard dep on stake-math-tools).
 * The config's default export is `{ model, luaScript, modes? }`.
 */
interface HarnessMathConfig {
  model: {
    spec: { id: string; betLevels: number[]; currency?: string };
    gameDefinition: unknown;
    mathModes?: { action: string; mode: string }[];
    modeMap?: Record<string, string>;
  };
  luaScript: string;
}

// Loose vite typings — we only touch `configureServer` + `middlewares.use`.
interface ViteDevServer {
  middlewares: {
    use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void;
    use(
      route: string,
      handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
    ): void;
  };
}

interface VitePlugin {
  name: string;
  apply: 'serve';
  configureServer(server: ViteDevServer): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CURRENCY = 'USD';

function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, json: unknown): void {
  const body = JSON.stringify(json);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(body);
}

/** Map a Stake mode → the game's action via mathModes (fallback: mode itself). */
function actionForMode(cfg: HarnessMathConfig, mode: string): string {
  const found = cfg.model.mathModes?.find((m) => m.mode === mode);
  return found?.action ?? mode.toLowerCase();
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function stakeHarnessPlugin(opts: StakeHarnessPluginOptions = {}): VitePlugin {
  const configPath = opts.config ?? './math.config.ts';
  const booksDir = opts.booksDir ?? 'stake-math';
  const startingBalanceMajor = opts.startingBalance ?? 10_000;

  // Lazily-loaded harness config (loaded on first request so a missing config
  // degrades gracefully rather than crashing the dev server at boot).
  let cfgPromise: Promise<HarnessMathConfig> | null = null;
  function loadConfig(): Promise<HarnessMathConfig> {
    if (!cfgPromise) {
      const abs = resolvePath(process.cwd(), configPath);
      cfgPromise = import(pathToFileURL(abs).href).then(
        (m) => (m.default ?? m) as HarnessMathConfig,
      );
    }
    return cfgPromise;
  }

  // One DevRgs + one LuaEngine per dev-server run (created on first request).
  let devRgs: DevRgs | null = null;
  let luaEngine: LuaEngine | null = null;
  let resolvedCfg: HarnessMathConfig | null = null;
  let luaBalanceMinor = startingBalanceMajor * API_MULTIPLIER;

  async function ensure(currency: string): Promise<{ devRgs: DevRgs; luaPlay: LuaPlay }> {
    const cfg = await loadConfig();
    resolvedCfg = cfg;

    if (!devRgs) {
      devRgs = createDevRgs({
        booksDir: resolvePath(process.cwd(), booksDir),
        gameId: cfg.model.spec.id,
        betLevelsMajor: cfg.model.spec.betLevels,
        currency,
        startingBalanceMajor,
      });
    }

    if (!luaEngine) {
      try {
        luaEngine = new LuaEngine({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          gameDefinition: cfg.model.gameDefinition as any,
          script: cfg.luaScript,
        });
      } catch {
        luaEngine = null;
      }
    }

    // Lua fallback: run the game's Lua for a no-books mode, wrap the raw
    // result into an RGSPlayResponse with a simple in-memory balance.
    const luaPlay: LuaPlay = async ({ mode, amount }): Promise<RGSPlayResponse> => {
      if (!luaEngine) throw new Error('stake-harness: LuaEngine unavailable for no-books fallback');
      const betMajor = amount / API_MULTIPLIER;
      const action = actionForMode(cfg, mode);
      const result = luaEngine.execute({ action, bet: betMajor });
      const totalWin = typeof result.totalWin === 'number' ? result.totalWin : 0;
      const payoutMultiplier = betMajor > 0 ? totalWin / betMajor : 0;

      luaBalanceMinor -= amount;
      luaBalanceMinor += Math.round(totalWin * API_MULTIPLIER);

      const round: StakeRound<Record<string, unknown>> = {
        betID: Date.now(),
        payoutMultiplier,
        costMultiplier: 1,
        active: true,
        mode,
        state: result.data ?? {},
        amount: betMajor,
      };
      return { balance: { amount: luaBalanceMinor, currency }, round };
    };

    return { devRgs, luaPlay };
  }

  // The wrapper page's config blob (built once the config is loaded).
  function wrapperHtmlFor(host: string): Promise<string> {
    return loadConfig().then((cfg) => {
      const modes = loadIndex(resolvePath(process.cwd(), booksDir));
      const wrapperModes: WrapperMode[] = (modes ?? []).map((m) => ({
        name: m.name,
        cost: m.cost,
      }));
      return renderWrapperHtml({
        gameId: cfg.model.spec.id,
        version: '1',
        modes: wrapperModes,
        betLevelsMajor: cfg.model.spec.betLevels,
        currencies: Object.keys(CURRENCY_META),
        rgsUrl: `${host}/__rgs`,
      });
    });
  }

  return {
    name: 'stake-harness',
    apply: 'serve',
    configureServer(server: ViteDevServer): void {
      // ── dev-RGS at /__rgs/* ──────────────────────────────────────────
      server.middlewares.use('/__rgs', (req, res) => {
        void (async () => {
          try {
            const url = req.url ?? '/';
            const method = req.method ?? 'GET';
            const raw = method === 'GET' || method === 'HEAD' ? '' : await collectBody(req);

            // Currency: the wrapper's authenticate launch carries it, but the
            // RGS contract POSTs an empty authenticate body — fall back to the
            // config's currency or USD. (Same DevRgs across the run.)
            const cfg = resolvedCfg ?? (await loadConfig());
            const currency = cfg.model.spec.currency ?? DEFAULT_CURRENCY;

            const { devRgs: rgs, luaPlay } = await ensure(currency);
            const result = await handleRgsRequest(rgs, { method, path: url, body: raw }, luaPlay);
            sendJson(res, result.status, result.json);
          } catch (err) {
            sendJson(res, 500, {
              error: 'ERR_HARNESS',
              message: err instanceof Error ? err.message : String(err),
            });
          }
        })();
      });

      // ── wrapper page on the root document (no rgs_url query) ──────────
      server.middlewares.use('/', (req, res, next) => {
        const url = req.url ?? '/';
        const accept = (req.headers.accept ?? '') as string;
        const isDocument = accept.includes('text/html');
        const path = url.split('?')[0];
        const isRoot = path === '/' || path === '/index.html' || path === '';
        const hasRgsUrl = url.includes('rgs_url=');

        // The iframe's own request carries rgs_url → let vite serve the real
        // game index.html. The bare root document → serve the wrapper.
        if (!isRoot || !isDocument || hasRgsUrl) {
          next();
          return;
        }

        const host = (req.headers.host ?? 'localhost') as string;
        void wrapperHtmlFor(host)
          .then((html) => {
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.end(html);
          })
          .catch((err) => {
            res.statusCode = 500;
            res.setHeader('content-type', 'text/plain');
            res.end(
              `stake-harness: failed to render wrapper — ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
      });
    },
  };
}
