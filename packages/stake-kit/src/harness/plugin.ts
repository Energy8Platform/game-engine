/**
 * `stakeRgsPlugin()` — the **backend** plugin for `@energy8platform/harness`.
 *
 * It contributes only the Stake-specific play backend: the dev-RGS mounted at
 * `/__rgs/*` (the 6 Stake RGS endpoints + dev balance/currency setters), backed
 * by the curated e8-math books with a LuaEngine fallback for book-less modes,
 * plus a `describe()` that tells the harness core how to launch the iframe and
 * what modes to offer in Replay.
 *
 * The harness core owns all UI (screens, Settings, Replay, sidebar). Nothing
 * about the wrapper page lives here anymore.
 *
 * Node-only: imports node builtins + reads the game's math.config via the vite
 * dev server. Never pulled into the browser stake-kit bundle.
 */

import { resolve as resolvePath } from 'node:path';

import { API_MULTIPLIER, CURRENCY_META } from '@energy8platform/stake-bridge';
import type { RGSPlayResponse } from '@energy8platform/stake-bridge';
import { LuaEngine } from '@energy8platform/platform-core/lua';
import type {
  HarnessBackend,
  HarnessBackendInfo,
  HarnessDescribeContext,
  HarnessPlugin,
  HarnessServer,
  HarnessServerContext,
} from '@energy8platform/harness';

import { countLutRows, loadIndex } from './books';
import { createDevRgs, type DevRgs } from './dev-rgs';
import { handleRgsRequest, type LuaPlay } from './rgs-http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StakeRgsPluginOptions {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CURRENCY = 'EUR';

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
 * segment-by-segment in the harness. (Unchanged from the pre-split harness.)
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
    const callWinX = betMajor > 0 ? (result.totalWin ?? 0) / betMajor : 0;
    const winX = completed ? callWinX - runningWinX : callWinX;
    runningWinX += winX;
    const isFs = action === 'free_spin';
    const spin: Record<string, unknown> = { ...(result.data ?? {}), total_win: winX };
    events.push({ type: isFs ? 'free_spin' : 'spin', spin });
  };

  let result = engine.execute({ action: triggerAction, bet: betMajor });
  pushSpin(triggerAction, result);

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
// Backend
// ---------------------------------------------------------------------------

/**
 * The Stake RGS backend. Use it via the harness:
 *   createHarness({ plugins: [ stakeRgsPlugin({ config, booksDir }) ] })
 */
export function stakeRgsPlugin(opts: StakeRgsPluginOptions = {}): HarnessPlugin {
  const configPath = opts.config ?? './math.config.ts';
  const booksDir = opts.booksDir ?? 'stake-math';
  const startingBalanceMajor = opts.startingBalance ?? 10_000;

  // Captured vite dev server — set in configureServer, used by loadConfig/describe.
  let server: HarnessServer | null = null;

  // Lazily-loaded harness config (loaded on first use so a missing config degrades
  // gracefully). Uses server.ssrLoadModule so that .ts files are transpiled by vite.
  let cfgPromise: Promise<HarnessMathConfig> | null = null;
  function loadConfig(): Promise<HarnessMathConfig> {
    if (!cfgPromise) {
      if (!server) throw new Error('stake-rgs: loadConfig called before configureServer');
      cfgPromise = server.ssrLoadModule(configPath).then(
        (m) => (m.default ?? m) as HarnessMathConfig,
      );
    }
    return cfgPromise;
  }

  // One DevRgs + one LuaEngine per dev-server run (created on first RGS request).
  let devRgs: DevRgs | null = null;
  let luaEngine: LuaEngine | null = null;

  async function ensure(currency: string): Promise<{ devRgs: DevRgs; luaPlay: LuaPlay }> {
    const cfg = await loadConfig();

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
          allowSessionlessActions: true,
        });
      } catch {
        luaEngine = null;
      }
    }

    const luaPlay: LuaPlay = async ({ mode, amount }): Promise<RGSPlayResponse> => {
      if (!luaEngine) throw new Error('stake-rgs: LuaEngine unavailable for no-books fallback');
      const betMajor = amount / API_MULTIPLIER;
      const triggerAction = actionForMode(cfg, mode);
      const cost = costForAction(cfg, triggerAction);
      const { payoutCents, events } = runLuaRound(luaEngine, triggerAction, betMajor);
      return devRgs!.playWithOutcome(mode, amount, { payoutCents, state: { events }, cost });
    };

    return { devRgs, luaPlay };
  }

  const backend: HarnessBackend = {
    id: 'stake-rgs',

    configureServer(ctx: HarnessServerContext): void {
      server = ctx.server;

      ctx.server.middlewares.use('/__rgs', (req, res) => {
        void (async () => {
          try {
            const url = req.url ?? '/';
            const method = req.method ?? 'GET';
            const raw = method === 'GET' || method === 'HEAD' ? '' : await ctx.readBody(req);

            const cfg = await loadConfig();
            const currency = cfg.model.spec.currency ?? DEFAULT_CURRENCY;
            const { devRgs: rgs, luaPlay } = await ensure(currency);

            // Dev-only balance setter — GET /__rgs/__dev/balance?major=<n>
            if (method === 'GET' && url.startsWith('/__dev/balance')) {
              const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
              const major = Number(new URLSearchParams(qs).get('major') ?? 0);
              rgs.setBalance(major * API_MULTIPLIER);
              const { balance } = await rgs.balance();
              ctx.sendJson(res, 200, { ok: true, balance });
              return;
            }

            // Dev-only currency setter — GET /__rgs/__dev/currency?code=<CODE>
            if (method === 'GET' && url.startsWith('/__dev/currency')) {
              const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
              const code = new URLSearchParams(qs).get('code') ?? DEFAULT_CURRENCY;
              rgs.setCurrency(code);
              ctx.sendJson(res, 200, { ok: true });
              return;
            }

            const result = await handleRgsRequest(rgs, { method, path: url, body: raw }, luaPlay);
            ctx.sendJson(res, result.status, result.json);
          } catch (err) {
            ctx.sendJson(res, 500, {
              error: 'ERR_HARNESS',
              message: err instanceof Error ? err.message : String(err),
            });
          }
        })();
      });
    },

    async describe(ctx: HarnessDescribeContext): Promise<HarnessBackendInfo> {
      const cfg = await loadConfig();
      const booksAbs = resolvePath(process.cwd(), booksDir);
      const modes = (loadIndex(booksAbs) ?? []).map((m) => ({
        name: m.name,
        cost: m.cost,
        count: countLutRows(booksAbs, m.name),
      }));
      const rgsUrl = `${ctx.host}/__rgs`;
      const gameId = cfg.model.spec.id;
      return {
        currencies: Object.keys(CURRENCY_META),
        betLevelsMajor: cfg.model.spec.betLevels,
        modes,
        launch: {
          base: { rgs_url: rgsUrl, sessionID: 'dev' },
          replayBase: { replay: 'true', game: gameId, version: '1', rgs_url: rgsUrl },
        },
        controls: {
          setBalanceUrl: '/__rgs/__dev/balance',
          setCurrencyUrl: '/__rgs/__dev/currency',
        },
      };
    },
  };

  return { backend };
}
