/**
 * `stakeRgsPlugin()` — the **backend** plugin for `@energy8platform/harness`.
 *
 * It contributes only the Stake-specific play backend: the dev-RGS mounted at
 * `/__rgs/*` (the 6 Stake RGS endpoints + dev balance/currency setters), backed
 * by the curated e8-math books with a live-e8-round fallback for book-less modes,
 * plus a `describe()` that tells the harness core how to launch the iframe and
 * what modes to offer in Replay.
 *
 * The harness core owns all UI (screens, Settings, Replay, sidebar). Nothing
 * about the wrapper page lives here anymore.
 *
 * Node-only: imports node builtins + reads the game's math.config via the vite
 * dev server. Never pulled into the browser stake-kit bundle.
 */

import { resolve as resolvePath, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { findE8Binary } from '@energy8platform/platform-core/simulation';

import { API_MULTIPLIER, CURRENCY_META } from '@energy8platform/stake-bridge';
import type { RGSPlayResponse } from '@energy8platform/stake-bridge';
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
  /**
   * Base URL the game loads assets from in the harness. Threaded to the game via the
   * launch URL (`?assetsUrl=`) so the harness matches `npm run dev`. Default '' — RELATIVE
   * to the game document (the asset folder lives in the paths, not the base), which also
   * matches a CDN sub-path deploy. Set an absolute URL only for a separate asset CDN.
   */
  assetsUrl?: string;
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

/**
 * Play ONE live round through the e8 SpinML engine and collect every spin
 * into a book-shaped `events` array — the no-books fallback plays a bonus
 * out segment-by-segment exactly like a curated book would.
 */
export function runSpinRound(
  spinScript: string,
  gameId: string,
  triggerAction: string,
  betMajor: number,
): { payoutCents: number; events: Array<Record<string, unknown>> } {
  const e8 = findE8Binary();
  if (!e8) {
    throw new Error(
      'stake-rgs: e8 engine binary not found for the no-books fallback (npm install fetches it, or set E8_BINARY)',
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'rgs-spin-'));
  const scriptPath = join(dir, 'game.spin');
  const cfgPath = join(dir, 'cfg.json');
  const dumpPath = join(dir, 'round.jsonl');
  try {
    writeFileSync(scriptPath, spinScript);
    writeFileSync(cfgPath, JSON.stringify({ id: gameId, script_path: scriptPath }));
    execFileSync(
      e8,
      [
        'simulate',
        '-config',
        cfgPath,
        '-iterations',
        '1',
        '-bet',
        String(betMajor || 1),
        '-format',
        'json',
        '-action',
        triggerAction,
        '-rng',
        'fast',
        '-dump',
        dumpPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const rec = JSON.parse(readFileSync(dumpPath, 'utf8').split('\n')[0]) as {
      total_win_x: number;
      cost_multiplier?: number;
      spins: Array<{ stage: string; win_x: number; data?: Record<string, unknown> }>;
    };
    const events = rec.spins.map((sp) => ({
      type: sp.stage === 'free_spins' ? 'free_spin' : 'spin',
      spin: { ...(sp.data ?? {}), total_win: sp.win_x },
    }));
    // total_win_x в дампе — Go-парность: нормирован на round_cost. Payout
    // для книги должен быть в множителях БАЗОВОЙ ставки (мост кредитует
    // bet × payout), поэтому восстанавливаем умножением на cost_multiplier.
    const payoutX = rec.total_win_x * (rec.cost_multiplier || 1);
    return { payoutCents: Math.round(payoutX * 100), events };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  const assetsUrl = opts.assetsUrl ?? '';

  // Captured vite dev server — set in configureServer, used by loadConfig/describe.
  let server: HarnessServer | null = null;

  // Lazily-loaded harness config (loaded on first use so a missing config degrades
  // gracefully). Uses server.ssrLoadModule so that .ts files are transpiled by vite.
  let cfgPromise: Promise<HarnessMathConfig> | null = null;
  function loadConfig(): Promise<HarnessMathConfig> {
    if (!cfgPromise) {
      if (!server) throw new Error('stake-rgs: loadConfig called before configureServer');
      cfgPromise = server
        .ssrLoadModule(configPath)
        .then((m) => (m.default ?? m) as HarnessMathConfig);
    }
    return cfgPromise;
  }

  // One DevRgs per dev-server run (created on first RGS request).
  let devRgs: DevRgs | null = null;

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

    const luaPlay: LuaPlay = async ({ mode, amount }): Promise<RGSPlayResponse> => {
      const betMajor = amount / API_MULTIPLIER;
      const triggerAction = actionForMode(cfg, mode);
      const cost = costForAction(cfg, triggerAction);
      // живой раунд через e8 (rng fast, недетерминированный — дев-фолбэк)
      const { payoutCents, events } = runSpinRound(
        cfg.luaScript,
        cfg.model.spec.id,
        triggerAction,
        betMajor,
      );
      return devRgs!.playWithOutcome(mode, amount, { payoutCents, state: { events }, cost });
    };

    return { devRgs, luaPlay };
  }

  const backend: HarnessBackend = {
    id: 'stake-rgs',

    configureServer(ctx: HarnessServerContext): void {
      server = ctx.server;

      // Hot-reload the game logic: editing the .spin / math config drops the
      // cached config so the next play runs fresh code, then reloads the
      // iframe. The dev-RGS balance is kept; it doesn't depend on the math.
      ctx.watchReload(
        (f) => f.endsWith('.spin') || f.includes('math.config') || f.includes('game.spec'),
        () => {
          cfgPromise = null;
        },
      );

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
      // Match `npm run dev`: pass the asset base to the game so it loads assets from the
      // same place (the DevBridge default `/assets/`). Omit when '' → relative resolution.
      const assets: Record<string, string> = assetsUrl ? { assetsUrl } : {};
      return {
        currencies: Object.keys(CURRENCY_META),
        betLevelsMajor: cfg.model.spec.betLevels,
        modes,
        launch: {
          base: { rgs_url: rgsUrl, sessionID: 'dev', ...assets },
          replayBase: { replay: 'true', game: gameId, version: '1', rgs_url: rgsUrl, ...assets },
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
