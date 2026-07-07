import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { accessSync, constants as fsConstants } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { GameDefinition, SimulationResult } from '../lua/types';

// ─── Types ──────────────────────────────────────────────

export type NativeRNGKind = 'provably-fair' | 'fast';

/**
 * Replay mode parameters. Forces single-worker deterministic execution over a
 * specific (server_seed, client_seed, nonce-start) triple — used to reproduce a
 * production round captured in `provably_fair_rounds`.
 */
export interface NativeReplayParams {
  serverSeed: string;
  clientSeed: string;
  nonceStart: number;
}

export interface NativeSimulationConfig {
  /** Path to native simulation binary */
  binaryPath: string;
  /** Lua script source code */
  script: string;
  /**
   * Extension of the temp script file (default 'lua'). The e8 SpinML engine
   * takes 'spin' — the runner is otherwise runtime-agnostic: it writes the
   * script, points config.script_path at it and spawns the binary.
   */
  scriptExt?: 'lua' | 'spin';
  /**
   * Args prepended before the flag args (default none). The e8 binary is a
   * multi-command CLI — its Go-compatible mode is the `simulate` subcommand.
   */
  argsPrefix?: string[];
  /** Platform game definition */
  gameDefinition: GameDefinition;
  /** Number of iterations */
  iterations: number;
  /** Bet amount */
  bet: number;
  /** Action to simulate (default: auto-detect by binary) */
  action?: string;
  /** Action params (buy_bonus, ante_bet, etc.) */
  params?: Record<string, unknown>;
  /**
   * Hex-encoded master seed for reproducible runs. The binary derives per-worker
   * server_seeds via sha256(seed || ":" || worker_idx). When omitted, the binary
   * generates one and returns it on the result so the run can be reproduced via
   * `seed: result.masterSeed`. Ignored when `rng === 'fast'`.
   */
  seed?: string;
  /**
   * RNG backend: `'provably-fair'` (default, matches production) or `'fast'`
   * (math/rand PCG — local iteration only, do NOT publish those RTP numbers).
   */
  rng?: NativeRNGKind;
  /** Replay mode: requires `rng: 'provably-fair'` (or default). */
  replay?: NativeReplayParams;
  /**
   * Path to write per-round JSONL book dump. When set, the binary writes one
   * JSON object per line (one per round) to this file, enabling post-run
   * analysis of the full round log.
   */
  dump?: string;
  /** Progress callback */
  onProgress?: (completed: number, total: number) => void;
}

export interface StageStats {
  totalWin: number;
  spinCount: number;
  hitCount: number;
  maxWin: number;
  rtp: number;
  perSpinRtp: number;
  hitFrequency: number;
  avgWin: number;
}

export interface DistributionBucket {
  label: string;
  count: number;
  pct: number;
}

export interface NativeSimulationResult extends SimulationResult {
  /** Iterations per second */
  speed?: number;
  /** Number of parallel workers used */
  workersUsed?: number;
  /** Per-stage breakdown */
  perStage?: Record<string, StageStats>;
  /** Win distribution histogram */
  winDistribution?: DistributionBucket[];
  /** RNG backend that produced these numbers. */
  rngKind?: NativeRNGKind;
  /**
   * Hex master seed that drove worker-seed derivation. Always set for
   * `provably-fair` runs (supplied or auto-generated). Pass back via `seed`
   * to reproduce the run bit-for-bit.
   */
  masterSeed?: string;
  /** Per-worker server_seed sequence (lets support reproduce any individual spin). */
  workerSeeds?: string[];
  /** Echo of replay params when the run was in replay mode. */
  replay?: NativeReplayParams;
  /** Round-win standard deviation (currency units). */
  stddev?: number;
  /** Coefficient of variation (stddev / mean round win). */
  cv?: number;
  /** Volatility score 0..10 (casino_platform classifyVolatility buckets). */
  volatility?: number;
  /** Volatility tier label (Low … Extreme). */
  volatilityLabel?: string;
}

// ─── Go JSON output shape (snake_case) ──────────────────

interface GoSimulationOutput {
  game_id: string;
  speed: number;
  total_rtp: number;
  hit_frequency: number;
  max_win: number;
  max_win_hits: number;
  total_bet: number;
  total_win: number;
  iterations: number;
  workers_used: number;
  duration_sec: number;
  bonus_triggered: number;
  bonus_spins_total: number;
  per_stage_stats?: Record<string, {
    total_win: number;
    spin_count: number;
    hit_count: number;
    max_win: number;
    rtp: number;
    per_spin_rtp: number;
    hit_frequency: number;
    avg_win: number;
  }>;
  win_distribution?: Array<{
    label: string;
    count: number;
    pct: number;
  }>;
  rng_kind?: NativeRNGKind;
  master_seed?: string;
  worker_seeds?: string[];
  stddev?: number;
  cv?: number;
  volatility?: number;
  volatility_label?: string;
  replay?: {
    server_seed: string;
    client_seed: string;
    nonce_start: number;
  };
}

// ─── Pure arg builder ────────────────────────────────────

export interface NativeArgsInput {
  configPath: string;
  iterations: number;
  bet: number;
  action?: string;
  params?: unknown;
  rng?: string;
  seed?: string;
  dump?: string;
  replay?: { serverSeed: string; clientSeed: string; nonceStart: number };
}

/**
 * Build the CLI args array for the native simulation binary.
 * Pure function — no I/O, easily testable.
 */
export function buildNativeArgs(a: NativeArgsInput): string[] {
  const args = ['-config', a.configPath, '-iterations', String(a.iterations), '-bet', String(a.bet), '-format', 'json'];
  if (a.action) args.push('-action', a.action);
  if (a.params !== undefined && a.params !== null && (typeof a.params !== 'object' || Object.keys(a.params as object).length > 0)) {
    args.push('-params', JSON.stringify(a.params));
  }
  if (a.rng) args.push('-rng', a.rng);
  if (a.seed) args.push('-seed', a.seed);
  if (a.dump) args.push('-dump', a.dump);
  if (a.replay) {
    args.push(
      '-replay-server-seed', a.replay.serverSeed,
      '-replay-client-seed', a.replay.clientSeed,
      '-replay-nonce-start', String(a.replay.nonceStart),
    );
  }
  return args;
}

// ─── Runner ─────────────────────────────────────────────

export class NativeSimulationRunner {
  private config: NativeSimulationConfig;

  constructor(config: NativeSimulationConfig) {
    this.config = config;
  }

  async run(): Promise<NativeSimulationResult> {
    const { binaryPath, script, scriptExt, argsPrefix, gameDefinition, iterations, bet, action, params, seed, rng, replay, dump } = this.config;

    if (replay && rng && rng !== 'provably-fair') {
      throw new Error(`Replay mode requires rng="provably-fair" (got rng="${rng}")`);
    }

    const id = randomBytes(8).toString('hex');
    const tmpDir = tmpdir();
    const scriptPath = join(tmpDir, `sim-${id}.${scriptExt ?? 'lua'}`);
    const configPath = join(tmpDir, `sim-${id}.json`);

    try {
      // Write temp files
      await Promise.all([
        writeFile(scriptPath, script, 'utf-8'),
        writeFile(configPath, JSON.stringify({ ...gameDefinition, script_path: scriptPath }), 'utf-8'),
      ]);

      // Build CLI args
      const args = buildNativeArgs({ configPath, iterations, bet, action, params, rng, seed, dump, replay });

      // Execute binary
      const output = await this.exec(binaryPath, [...(argsPrefix ?? []), ...args]);

      // Parse JSON output
      const json: GoSimulationOutput = JSON.parse(output);
      return mapGoResult(json);
    } finally {
      // Cleanup temp files
      await Promise.allSettled([unlink(scriptPath), unlink(configPath)]);
    }
  }

  private exec(binary: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to execute simulation binary: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Simulation binary exited with code ${code}: ${stderr.trim()}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}

// ─── Result mapping ─────────────────────────────────────

function mapGoResult(json: GoSimulationOutput): NativeSimulationResult {
  const baseStage = json.per_stage_stats?.base_game;
  const baseGameRtp = baseStage?.rtp ?? 0;
  const baseGameWin = baseStage?.total_win ?? 0;

  const perStage = json.per_stage_stats
    ? Object.fromEntries(
        Object.entries(json.per_stage_stats).map(([key, s]) => [
          key,
          {
            totalWin: s.total_win,
            spinCount: s.spin_count,
            hitCount: s.hit_count,
            maxWin: s.max_win,
            rtp: s.rtp,
            perSpinRtp: s.per_spin_rtp,
            hitFrequency: s.hit_frequency,
            avgWin: s.avg_win,
          },
        ]),
      )
    : undefined;

  return {
    gameId: json.game_id,
    action: 'spin',
    iterations: json.iterations,
    durationMs: Math.round(json.duration_sec * 1000),
    totalRtp: json.total_rtp,
    baseGameRtp,
    bonusRtp: json.total_rtp - baseGameRtp,
    hitFrequency: json.hit_frequency,
    maxWin: json.max_win,
    maxWinHits: json.max_win_hits,
    bonusTriggered: json.bonus_triggered,
    bonusSpinsPlayed: json.bonus_spins_total,
    speed: json.speed,
    workersUsed: json.workers_used,
    perStage,
    winDistribution: json.win_distribution,
    rngKind: json.rng_kind,
    masterSeed: json.master_seed,
    workerSeeds: json.worker_seeds,
    stddev: json.stddev,
    cv: json.cv,
    volatility: json.volatility,
    volatilityLabel: json.volatility_label,
    replay: json.replay
      ? {
          serverSeed: json.replay.server_seed,
          clientSeed: json.replay.client_seed,
          nonceStart: json.replay.nonce_start,
        }
      : undefined,
    _raw: {
      totalWagered: json.total_bet,
      totalWon: json.total_win,
      baseGameWin,
      bonusWin: json.total_win - baseGameWin,
      hits: json.iterations > 0 ? Math.round((json.hit_frequency * json.iterations) / 100) : 0,
    },
  };
}

// ─── Binary discovery ───────────────────────────────────

/**
 * Search for the e8 SpinML engine binary (Rust) — same lookup discipline as
 * findNativeBinary: env override → <pkg>/bin/e8-<platform>-<arch> → $PATH.
 * Fetched by scripts/install-e8.mjs on postinstall.
 */
export function findE8Binary(baseDir?: string): string | null {
  const envPath = process.env.E8_BINARY;
  if (envPath && isExecutable(envPath)) {
    return envPath;
  }

  const platform = process.platform;
  const nodeArch = process.arch;
  const goArch = nodeArch === 'x64' ? 'amd64' : nodeArch;
  const goPlatform = platform === 'win32' ? 'windows' : platform;
  const ext = platform === 'win32' ? '.exe' : '';

  const names = [`e8-${goPlatform}-${goArch}${ext}`, `e8${ext}`];

  const searchDirs: string[] = [];
  if (baseDir) searchDirs.push(baseDir);
  // Раскладки различаются: dist/simulation.esm.js → ../bin,
  // src/simulation/*.ts (vitest/tsx) → ../../bin. Пробуем оба уровня.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const up of ['..', '../..']) {
      const root = join(here, up);
      if (!searchDirs.includes(root)) searchDirs.push(root);
    }
  } catch {
    if (typeof __dirname !== 'undefined') {
      for (const up of ['..', '../..']) {
        const root = join(__dirname, up);
        if (!searchDirs.includes(root)) searchDirs.push(root);
      }
    }
  }

  for (const dir of searchDirs) {
    for (const name of names) {
      const candidate = join(dir, 'bin', name);
      if (isExecutable(candidate)) return candidate;
    }
  }

  try {
    const cmd = platform === 'win32' ? 'where e8' : 'which e8';
    const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (result) return result.split('\n')[0];
  } catch {
    // not found
  }

  return null;
}

/** Return the e8 binary path or throw an install-guiding error. */
export function requireE8Binary(finder: () => string | null = findE8Binary): string {
  const bin = finder();
  if (!bin) {
    throw new Error(
      'e8 engine binary not found — run `npm install` (platform-core fetches it via install-e8), ' +
      'or point E8_BINARY at a local build (casino-platform/e8/target/release/e8).',
    );
  }
  return bin;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ─── Extended formatting ────────────────────────────────

/** Format a NativeSimulationResult with per-stage and distribution data */
export function formatNativeResult(result: NativeSimulationResult): string {
  const lines: string[] = [
    '',
    '--- Simulation Results ---',
    `Game: ${result.gameId}`,
    `Iterations: ${result.iterations.toLocaleString()}`,
    `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
  ];

  if (result.speed) {
    lines.push(`Speed: ${Math.round(result.speed).toLocaleString()} iterations/sec`);
  }
  if (result.workersUsed) {
    lines.push(`Workers: ${result.workersUsed}`);
  }
  if (result.rngKind) {
    lines.push(`RNG: ${result.rngKind}`);
  }
  if (result.masterSeed) {
    lines.push(`Master seed: ${result.masterSeed}  (pass --seed=${result.masterSeed} to reproduce)`);
  }
  if (result.replay) {
    lines.push(
      `Replay: server_seed=${result.replay.serverSeed} client_seed=${result.replay.clientSeed} nonce_start=${result.replay.nonceStart}`,
    );
  }

  lines.push(
    '',
    '--- Total ---',
    `Total RTP: ${result.totalRtp.toFixed(2)}%`,
    `Base Game RTP: ${result.baseGameRtp.toFixed(2)}%`,
    `Bonus RTP: ${result.bonusRtp.toFixed(2)}%`,
    `Hit Frequency: ${result.hitFrequency.toFixed(2)}%`,
    `Max Win: ${result.maxWin.toFixed(2)}x`,
    `Max Win Cap Hits: ${result.maxWinHits}`,
  );

  if (result.volatilityLabel !== undefined && result.cv !== undefined) {
    lines.push(
      '',
      '--- Volatility ---',
      `Volatility: ${result.volatility}/10 (${result.volatilityLabel})`,
      `StdDev: ${(result.stddev ?? 0).toFixed(2)}   CV: ${result.cv.toFixed(2)}`,
    );
  }

  if (result.bonusTriggered > 0) {
    const frequency = Math.round(result.iterations / result.bonusTriggered);
    lines.push(
      '',
      '--- Bonus Stats ---',
      `Bonus Triggered: ${result.bonusTriggered.toLocaleString()} (1 in ${frequency} spins)`,
      `Bonus Spins Total: ${result.bonusSpinsPlayed.toLocaleString()}`,
    );
  }

  // Per-stage breakdown
  if (result.perStage && Object.keys(result.perStage).length > 0) {
    lines.push('', '--- Per-Stage Breakdown ---');
    const header = 'Stage                | Spins      | RTP (contrib) | Per-Spin RTP | Hit Freq  | Avg Win   | Max Win';
    lines.push(header);
    lines.push('-'.repeat(header.length));

    for (const [stage, stats] of Object.entries(result.perStage)) {
      lines.push(
        `${stage.padEnd(20)} | ${String(stats.spinCount).padStart(10)} | ` +
        `${stats.rtp.toFixed(2).padStart(12)}% | ` +
        `${stats.perSpinRtp.toFixed(2).padStart(11)}% | ` +
        `${stats.hitFrequency.toFixed(2).padStart(8)}% | ` +
        `${stats.avgWin.toFixed(3).padStart(8)}x | ` +
        `${stats.maxWin.toFixed(2).padStart(8)}x`,
      );
    }
  }

  // Win distribution
  if (result.winDistribution && result.winDistribution.length > 0) {
    lines.push('', '--- Win Distribution ---');
    for (const bucket of result.winDistribution) {
      const bar = '█'.repeat(Math.round(bucket.pct / 2));
      lines.push(
        `${bucket.label.padEnd(10)} ${String(bucket.count).padStart(10)} (${bucket.pct.toFixed(2).padStart(6)}%) ${bar}`,
      );
    }
  }

  return lines.join('\n');
}
