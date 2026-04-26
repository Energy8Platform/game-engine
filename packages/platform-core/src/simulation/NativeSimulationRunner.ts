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

export interface NativeSimulationConfig {
  /** Path to native simulation binary */
  binaryPath: string;
  /** Lua script source code */
  script: string;
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
}

// ─── Runner ─────────────────────────────────────────────

export class NativeSimulationRunner {
  private config: NativeSimulationConfig;

  constructor(config: NativeSimulationConfig) {
    this.config = config;
  }

  async run(): Promise<NativeSimulationResult> {
    const { binaryPath, script, gameDefinition, iterations, bet, action, params } = this.config;
    const id = randomBytes(8).toString('hex');
    const tmpDir = tmpdir();
    const luaPath = join(tmpDir, `sim-${id}.lua`);
    const configPath = join(tmpDir, `sim-${id}.json`);

    try {
      // Write temp files
      await Promise.all([
        writeFile(luaPath, script, 'utf-8'),
        writeFile(configPath, JSON.stringify({ ...gameDefinition, script_path: luaPath }), 'utf-8'),
      ]);

      // Build CLI args
      const args = [
        '-config', configPath,
        '-iterations', String(iterations),
        '-bet', String(bet),
        '-format', 'json',
      ];
      if (action) {
        args.push('-action', action);
      }
      if (params && Object.keys(params).length > 0) {
        args.push('-params', JSON.stringify(params));
      }

      // Execute binary
      const output = await this.exec(binaryPath, args);

      // Parse JSON output
      const json: GoSimulationOutput = JSON.parse(output);
      return mapGoResult(json);
    } finally {
      // Cleanup temp files
      await Promise.allSettled([unlink(luaPath), unlink(configPath)]);
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
 * Search for a native simulation binary in standard locations.
 * Returns the absolute path if found, null otherwise.
 */
export function findNativeBinary(baseDir?: string): string | null {
  // 1. Explicit env var
  const envPath = process.env.SIMULATE_BINARY;
  if (envPath && isExecutable(envPath)) {
    return envPath;
  }

  const platform = process.platform; // darwin, linux, win32
  const nodeArch = process.arch; // arm64, x64
  const goArch = nodeArch === 'x64' ? 'amd64' : nodeArch;
  const goPlatform = platform === 'win32' ? 'windows' : platform;
  const ext = platform === 'win32' ? '.exe' : '';

  const names = [
    `simulate-${goPlatform}-${goArch}${ext}`,
    `simulation-${goPlatform}-${goArch}${ext}`,
    `simulate${ext}`,
    `simulation${ext}`,
  ];

  // Search directories: user's project first, then this package's bin/
  const searchDirs: string[] = [];
  if (baseDir) searchDirs.push(baseDir);

  // This package's root (where postinstall downloads the binary)
  try {
    const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    if (!searchDirs.includes(pkgRoot)) searchDirs.push(pkgRoot);
  } catch {
    // fallback for CJS
    if (typeof __dirname !== 'undefined') {
      const pkgRoot = join(__dirname, '..');
      if (!searchDirs.includes(pkgRoot)) searchDirs.push(pkgRoot);
    }
  }

  for (const dir of searchDirs) {
    for (const name of names) {
      const candidate = join(dir, 'bin', name);
      if (isExecutable(candidate)) return candidate;
    }
  }

  // Check $PATH
  for (const bin of ['simulate', 'simulation']) {
    try {
      const cmd = platform === 'win32' ? `where ${bin}` : `which ${bin}`;
      const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (result) return result.split('\n')[0];
    } catch {
      // not found
    }
  }

  return null;
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
