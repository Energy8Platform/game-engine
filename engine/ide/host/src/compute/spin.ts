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
import {
  diagnostic,
  type Diagnostic,
  type SpinRequest,
  type SpinResult,
} from '@energy8engine/contracts';
import * as session from '@energy8engine/session-dev';
import { check } from './check';

export interface SpinInput {
  /** Project directory; `game/` lives here. */
  cwd: string;
  /**
   * Rounds to play (default 100). Each round is `StartRound` then
   * `Step(roundId, nextActions[0])` until `roundComplete` (or the
   * per-round step cap — see `summarise`).
   */
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
  /** Total `Step` calls across every round (the opening response is not a `Step`). */
  steps: number;
  bet: number;
  /** Mean win multiplier over each round's FINAL `totalWin` — already a multiple of the bet. */
  rtp: number;
  hitRate: number;
  maxWin: number;
  avgWin: number;
  /** Tallies every response played (the opening one and every `Step`), not just finals. */
  stages: Record<string, number>;
  wins: { p50: number; p90: number; p99: number };
  /**
   * Rounds still not `roundComplete` after `MAX_STEPS_PER_ROUND` `Step`
   * calls — should be 0 in practice; each one also carries a `warning` in
   * `diagnostics` naming the round.
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

/** `spin`'s loop steps a round at most this many times before giving up on `roundComplete`. */
export const MAX_STEPS_PER_ROUND = 500;

/**
 * The numbers of a report from the rounds played — the part of `spin` that
 * is pure, so it can be tested with round shapes no fixture produces (a
 * round stuck past the step cap, without a binary). Each entry in `rounds`
 * is one round's full response sequence in play order: the opening
 * response, then every `Step` response — `spin`'s loop stops appending once
 * `roundComplete` is `true` or `MAX_STEPS_PER_ROUND` is reached, so a
 * round's LAST entry still not `roundComplete` means the cap was hit.
 * `win` numbers are each round's FINAL `totalWin` (a mid-round `Step`'s
 * `totalWin` is only the running total); `stages` tallies every response,
 * not just finals. `diagnostics` holds one entry per capped round; `spin`
 * prepends its own (session, input).
 */
export function summarise(rounds: SpinResult[][]): Omit<SpinReport, 'bet' | 'seed'> {
  const finals = rounds.map((r) => r[r.length - 1]);
  const wins = finals.map((r) => r.totalWin);
  const sum = wins.reduce((a, b) => a + b, 0);
  const stages: Record<string, number> = {};
  let steps = 0;
  for (const round of rounds) {
    steps += round.length - 1;
    for (const r of round) stages[r.stage] = (stages[r.stage] ?? 0) + 1;
  }
  const incomplete = finals.filter((r) => !r.roundComplete);
  const diagnostics: Diagnostic[] = incomplete.map((r) =>
    diagnostic(
      'warning',
      'compute',
      'roundComplete',
      `round ${r.roundId} did not complete in ${MAX_STEPS_PER_ROUND} steps`,
    ),
  );
  return {
    spins: wins.length,
    steps,
    rtp: wins.length ? sum / wins.length : 0,
    hitRate: wins.length ? wins.filter((w) => w > 0).length / wins.length : 0,
    maxWin: wins.length ? Math.max(...wins) : 0,
    avgWin: wins.length ? sum / wins.length : 0,
    stages,
    wins: percentiles(wins),
    incompleteRounds: incomplete.length,
    scriptSha256: finals.at(-1)?.scriptSha256 ?? null,
    diagnostics,
  };
}

/** What `playRounds` needs of `session.play` — real or faked. */
export type PlaySpin = (
  req: SpinRequest,
) => Promise<{ result?: SpinResult; diagnostics: Diagnostic[] }>;

/**
 * Plays `n` rounds via `play`, stepping each one forward on its own
 * reported `nextActions[0]` until it completes or hits `MAX_STEPS_PER_ROUND`
 * — see `summarise`'s doc for what a capped round's last entry looks like.
 * Pure apart from `play` itself, so a fake `play` (a canned queue of
 * responses, no session/binary) can test the loop's own behavior, e.g. a
 * `Step` failing partway through a round: that discards the round WHOLE —
 * same as a failed opening call — never a partial entry in `rounds`, and
 * ends the run there (the same "report covers what was played" contract a
 * failure has always had, now also true mid-round).
 */
export async function playRounds(
  n: number,
  req: SpinRequest,
  play: PlaySpin,
  onProgress?: (done: number, n: number) => void,
): Promise<{ rounds: SpinResult[][]; diagnostics: Diagnostic[] }> {
  const rounds: SpinResult[][] = [];
  const diagnostics: Diagnostic[] = [];
  for (let i = 1; i <= n; i++) {
    const first = await play(req);
    if (!first.result) {
      diagnostics.push(...first.diagnostics);
      break;
    }
    const round: SpinResult[] = [first.result];
    let failed = false;
    while (!round.at(-1)!.roundComplete && round.length <= MAX_STEPS_PER_ROUND) {
      const last = round.at(-1)!;
      const played = await play({ ...req, roundId: last.roundId, action: last.nextActions[0] });
      if (!played.result) {
        diagnostics.push(...played.diagnostics);
        failed = true;
        break;
      }
      round.push(played.result);
    }
    if (failed) break;
    rounds.push(round);
    onProgress?.(i, n);
  }
  return { rounds, diagnostics };
}

export async function spin(input: SpinInput): Promise<SpinReport> {
  const n = input.n ?? 100;
  const seed = input.seed ?? randomBytes(8).toString('hex');
  let rounds: SpinResult[][] = [];
  const diagnostics: Diagnostic[] = [];
  let bet = input.bet ?? 0;

  const report = (): SpinReport => {
    const summary = summarise(rounds);
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
    const played = await playRounds(n, req, (r) => ctx.session.play(r), input.onProgress);
    rounds = played.rounds;
    diagnostics.push(...played.diagnostics);
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
