/**
 * `e8 spin` — N spins through a real `e8-server`, summarized the way the
 * math panel would show them. Deterministic under `seed` (`serverSeed`
 * reaches the process through `session`'s config, which IS
 * `StartE8ServerOptions`), and every failure is a diagnostic in the
 * report, never a throw: the session did not start, a spin was refused
 * mid-run (the report covers what was played), a bad `n`.
 *
 * `session.apply(ctx, …)` is called directly on a bare `Context`, the
 * form `dev-game.ts` uses — see that module's doc for why not
 * `ctx.plugin`. Disposing the root fiber runs `session`'s stop effect
 * (measured: no `e8-server` survives it), which is what `finally` leans on.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Context } from 'cordis';
import { diagnostic, type Diagnostic, type SpinResult } from '@energy8engine/contracts';
import * as session from '@energy8engine/session-dev';
import { check } from './check';

export interface SpinInput {
  /** Project directory; `game/` lives here. */
  cwd: string;
  /** Spins to play (default 100). */
  n?: number;
  /** Bet level (default: the spec's first `betLevels` entry). */
  bet?: number;
  /** `serverSeed` for every round (default: 8 random bytes, hex). */
  seed?: string;
  /** Action to play (default `spin`). */
  action?: string;
  /** Explicit `e8-server` binary; see `StartE8ServerOptions.binPath`. */
  binPath?: string;
  onProgress?: (done: number, n: number) => void;
}

export interface SpinReport {
  spins: number;
  bet: number;
  /** Mean win multiplier — `win` is already a multiple of the bet. */
  rtp: number;
  hitRate: number;
  maxWin: number;
  avgWin: number;
  stages: Record<string, number>;
  wins: { p50: number; p90: number; p99: number };
  /**
   * Rounds whose first response was not `roundComplete` — a bonus entry,
   * a cascade the server steps on request. `spin` plays one response per
   * round and never steps, so `rtp` and `wins` cover those first responses
   * only; a count above 0 also carries a `warning` in `diagnostics`.
   */
  incompleteRounds: number;
  seed: string;
  scriptSha256: string | null;
  diagnostics: Diagnostic[];
}

/** Nearest-rank percentiles of `values` (any order); zeros when empty. */
export function percentiles(values: number[]): SpinReport['wins'] {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => (sorted.length ? sorted[Math.ceil((p / 100) * sorted.length) - 1] : 0);
  return { p50: at(50), p90: at(90), p99: at(99) };
}

/**
 * The numbers of a report from the responses played — the part of `spin`
 * that is pure, so it can be tested with results no fixture produces
 * (`first-slot` completes every round on its first response). Its
 * `diagnostics` hold at most the incomplete-rounds warning; `spin`
 * prepends its own (session, input).
 */
export function summarise(results: SpinResult[]): Omit<SpinReport, 'bet' | 'seed'> {
  const wins = results.map((r) => r.win);
  const sum = wins.reduce((a, b) => a + b, 0);
  const stages: Record<string, number> = {};
  for (const r of results) stages[r.stage] = (stages[r.stage] ?? 0) + 1;
  const incomplete = results.filter((r) => !r.roundComplete);
  const diagnostics: Diagnostic[] = [];
  if (incomplete.length) {
    const next = [...new Set(incomplete.flatMap((r) => r.nextActions))].sort().join(', ');
    diagnostics.push(
      diagnostic(
        'warning',
        'compute',
        'roundComplete',
        `${incomplete.length} of ${results.length} rounds did not complete on the first response (nextActions: ${next}); rtp covers first responses only`,
        'a later e8 spin will step rounds to completion',
      ),
    );
  }
  return {
    spins: wins.length,
    rtp: wins.length ? sum / wins.length : 0,
    hitRate: wins.length ? wins.filter((w) => w > 0).length / wins.length : 0,
    maxWin: wins.length ? Math.max(...wins) : 0,
    avgWin: wins.length ? sum / wins.length : 0,
    stages,
    wins: percentiles(wins),
    incompleteRounds: incomplete.length,
    scriptSha256: results.at(-1)?.scriptSha256 ?? null,
    diagnostics,
  };
}

export async function spin(input: SpinInput): Promise<SpinReport> {
  const n = input.n ?? 100;
  const seed = input.seed ?? randomBytes(8).toString('hex');
  const results: SpinResult[] = [];
  const diagnostics: Diagnostic[] = [];
  let bet = input.bet ?? 0;

  const report = (): SpinReport => {
    const summary = summarise(results);
    return { ...summary, bet, seed, diagnostics: [...diagnostics, ...summary.diagnostics] };
  };

  if (!Number.isInteger(n) || n < 1) {
    diagnostics.push(diagnostic('error', 'compute', 'n', 'n must be ≥ 1'));
    return report();
  }
  if (input.bet !== undefined && !(input.bet > 0)) {
    diagnostics.push(diagnostic('error', 'compute', 'bet', 'bet must be > 0'));
    return report();
  }

  const game = await readGame(input.cwd);
  if ('diagnostic' in game) {
    diagnostics.push(game.diagnostic);
    return report();
  }
  if (input.bet === undefined) bet = game.betLevel;

  const ctx = new Context();
  try {
    await session.apply(ctx, {
      gamesDir: join(input.cwd, 'game'),
      port: 0,
      serverSeed: seed,
      binPath: input.binPath,
    });
    if (ctx.session.startupDiagnostic) {
      diagnostics.push(ctx.session.startupDiagnostic);
      return report();
    }
    const req = { gameId: game.gameId, action: input.action ?? 'spin', betLevel: bet };
    for (let i = 1; i <= n; i++) {
      const played = await ctx.session.play(req);
      if (!played.result) {
        diagnostics.push(...played.diagnostics);
        break;
      }
      results.push(played.result);
      input.onProgress?.(i, n);
    }
    return report();
  } finally {
    await ctx.fiber.dispose();
  }
}

/**
 * The game's id and first bet level — from `game/spec.json` the way the
 * project scope reads it, else from the `game` block of the `.spin` the
 * spec's `scriptPath` names (default `script.spin`).
 */
async function readGame(
  cwd: string,
): Promise<{ gameId: string; betLevel: number } | { diagnostic: Diagnostic }> {
  const gamesDir = join(cwd, 'game');
  let scriptPath = 'script.spin';
  try {
    const spec = JSON.parse(await readFile(join(gamesDir, 'spec.json'), 'utf8')) as {
      id?: unknown;
      betLevels?: unknown;
      scriptPath?: unknown;
    };
    if (typeof spec.scriptPath === 'string') scriptPath = spec.scriptPath;
    if (typeof spec.id === 'string') {
      const first = Array.isArray(spec.betLevels) ? spec.betLevels[0] : undefined;
      return { gameId: spec.id, betLevel: typeof first === 'number' ? first : 1 };
    }
  } catch {
    // No usable spec.json — the .spin declares the same two facts.
  }
  const { schema, diagnostics } = await check({ file: join(gamesDir, scriptPath) });
  if (schema) return { gameId: schema.gameId, betLevel: schema.betLevels[0] ?? 1 };
  return {
    diagnostic: diagnostics[0] ?? diagnostic('error', 'compute', cwd, 'no game found here'),
  };
}
