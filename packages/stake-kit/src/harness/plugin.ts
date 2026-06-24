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

import { resolve as resolvePath } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { API_MULTIPLIER, CURRENCY_META } from '@energy8platform/stake-bridge';
import type { RGSPlayResponse } from '@energy8platform/stake-bridge';
import { LuaEngine } from '@energy8platform/platform-core/lua';

import { countLutRows, loadIndex } from './books';
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
    spec: {
      id: string;
      betLevels: number[];
      currency?: string;
      /** Action specs carry the bet-cost multiplier for buy/ante modes (e.g. buy_bonus cost 100). */
      actions?: Record<string, { cost?: number }>;
    };
    gameDefinition: unknown;
    mathModes?: { action: string; mode: string }[];
    modeMap?: Record<string, string>;
  };
  luaScript: string;
}

// Loose vite typings — we only touch `configureServer` + `middlewares.use` + `ssrLoadModule`.
interface ViteDevServer {
  middlewares: {
    use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void;
    use(
      route: string,
      handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
    ): void;
  };
  ssrLoadModule(url: string): Promise<Record<string, unknown>>;
}

interface VitePlugin {
  name: string;
  apply: 'serve';
  configureServer(server: ViteDevServer): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CURRENCY = 'EUR';

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

/** Bet-cost multiplier for an action (buy/ante cost a multiple of the base bet). Default 1. */
function costForAction(cfg: HarnessMathConfig, action: string): number {
  return cfg.model.spec.actions?.[action]?.cost ?? 1;
}

/** Shape of a single LuaEngine.execute() result we read in the session loop. */
interface LuaExecResult {
  totalWin?: number;
  data?: Record<string, unknown>;
  nextActions?: string[];
  session?: { completed?: boolean } | null;
}

/** Minimal LuaEngine surface the session loop needs (keeps runLuaRound unit-testable). */
interface LuaRunner {
  execute(state: { action: string; bet: number }): LuaExecResult;
}

/**
 * Drive the game's Lua as ONE round and collect every spin into a `events` array (the kitsune
 * full-event book shape), so a bonus bought/triggered in a no-books game plays out
 * segment-by-segment in the harness.
 *
 * Executes the trigger action, then — if it opened a free-spins session — replays its
 * `nextActions[0]` until the session completes. Each spin becomes one event carrying its
 * stage-derived `type`, the per-spin bet-multiplier `win_x`, and the render `data` (with
 * `total_win` injected as that spin's multiplier so the adapter reads a consistent per-segment win).
 * `payoutCents` is the round's total bet-multiplier × 100.
 *
 * Per-spin win: a mid-session (or non-session) `execute` returns that spin's own win, but the spin
 * that COMPLETES the session returns the SESSION total — so its own win is `total − alreadyCollected`.
 */
export function runLuaRound(
  engine: LuaRunner,
  triggerAction: string,
  betMajor: number,
): { payoutCents: number; events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  let runningWinX = 0; // accumulated bet-MULTIPLIER across collected spins

  const pushSpin = (action: string, result: LuaExecResult): void => {
    const completed = !!result.session?.completed;
    // result.totalWin is a win AMOUNT (multiplier × bet); convert to a multiplier.
    const callWinX = betMajor > 0 ? (result.totalWin ?? 0) / betMajor : 0;
    // The completing spin reports the SESSION total; its own win is the remainder.
    const winX = completed ? callWinX - runningWinX : callWinX;
    runningWinX += winX;
    const isFs = action === 'free_spin';
    const data: Record<string, unknown> = { ...(result.data ?? {}), total_win: winX };
    events.push({
      type: isFs ? 'free_spin' : 'spin',
      stage: isFs ? 'free_spins' : 'base_game',
      win_x: winX,
      data,
    });
  };

  let result = engine.execute({ action: triggerAction, bet: betMajor });
  pushSpin(triggerAction, result);

  // Drain the free-spins session, if one was opened. Guard against a runaway script.
  let guard = 100_000;
  while (
    result.session &&
    !result.session.completed &&
    result.nextActions &&
    result.nextActions.length > 0 &&
    guard-- > 0
  ) {
    const nextAction = result.nextActions[0];
    result = engine.execute({ action: nextAction, bet: betMajor });
    pushSpin(nextAction, result);
  }

  return { payoutCents: Math.round(runningWinX * 100), events };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function stakeHarnessPlugin(opts: StakeHarnessPluginOptions = {}): VitePlugin {
  const configPath = opts.config ?? './math.config.ts';
  const booksDir = opts.booksDir ?? 'stake-math';
  const startingBalanceMajor = opts.startingBalance ?? 10_000;

  // Captured vite dev server — set in configureServer, used by loadConfig.
  let server: ViteDevServer | null = null;

  // Lazily-loaded harness config (loaded on first request so a missing config
  // degrades gracefully rather than crashing the dev server at boot).
  // Uses server.ssrLoadModule so that .ts files are transpiled by vite.
  let cfgPromise: Promise<HarnessMathConfig> | null = null;
  function loadConfig(): Promise<HarnessMathConfig> {
    if (!cfgPromise) {
      if (!server) throw new Error('stake-harness: loadConfig called before configureServer');
      cfgPromise = server.ssrLoadModule(configPath).then(
        (m) => (m.default ?? m) as HarnessMathConfig,
      );
    }
    return cfgPromise;
  }

  // One DevRgs + one LuaEngine per dev-server run (created on first request).
  let devRgs: DevRgs | null = null;
  let luaEngine: LuaEngine | null = null;
  let resolvedCfg: HarnessMathConfig | null = null;

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
          // The harness replays each action as an isolated round; a books-path bonus buy never
          // creates an engine session, so a follow-up free_spin (Lua fallback) must run sessionless.
          allowSessionlessActions: true,
        });
      } catch {
        luaEngine = null;
      }
    }

    // Lua fallback: run the game's Lua for a no-books mode, delegate balance
    // bookkeeping entirely to devRgs.playWithOutcome so that all endpoints
    // (authenticate/balance/play/end-round) share the SAME internal balance.
    const luaPlay: LuaPlay = async ({ mode, amount }): Promise<RGSPlayResponse> => {
      if (!luaEngine) throw new Error('stake-harness: LuaEngine unavailable for no-books fallback');
      const betMajor = amount / API_MULTIPLIER;
      const triggerAction = actionForMode(cfg, mode);
      // Debit bet × cost for buy/ante (no index.json cost in the no-books path → use the spec's).
      const cost = costForAction(cfg, triggerAction);
      const { payoutCents, events } = runLuaRound(luaEngine, triggerAction, betMajor);
      return devRgs!.playWithOutcome(mode, amount, { payoutCents, state: { events }, cost });
    };

    return { devRgs, luaPlay };
  }

  // The wrapper page's config blob (built once the config is loaded).
  function wrapperHtmlFor(host: string): Promise<string> {
    return loadConfig().then((cfg) => {
      const booksAbs = resolvePath(process.cwd(), booksDir);
      const modes = loadIndex(booksAbs);
      const wrapperModes: WrapperMode[] = (modes ?? []).map((m) => ({
        name: m.name,
        cost: m.cost,
        // LUT row count → Replay "Event ID (Range: 0 – N)".
        count: countLutRows(booksAbs, m.name),
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
    configureServer(srv: ViteDevServer): void {
      server = srv;

      // ── dev-RGS at /__rgs/* ──────────────────────────────────────────
      srv.middlewares.use('/__rgs', (req, res) => {
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

            // ── Dev-only balance setter — must be checked BEFORE handleRgsRequest
            //    so it does not accidentally match an RGS route.
            //    GET /__rgs/__dev/balance?major=<n>
            if (method === 'GET' && url.startsWith('/__dev/balance')) {
              const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
              const params = new URLSearchParams(qs);
              const major = Number(params.get('major') ?? 0);
              rgs.setBalance(major * API_MULTIPLIER);
              const { balance } = await rgs.balance();
              sendJson(res, 200, { ok: true, balance });
              return;
            }

            // ── Dev-only currency setter — must be checked BEFORE handleRgsRequest.
            //    GET /__rgs/__dev/currency?code=<CODE>
            if (method === 'GET' && url.startsWith('/__dev/currency')) {
              const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
              const params = new URLSearchParams(qs);
              const code = params.get('code') ?? DEFAULT_CURRENCY;
              rgs.setCurrency(code);
              sendJson(res, 200, { ok: true });
              return;
            }

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
      srv.middlewares.use('/', (req, res, next) => {
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
