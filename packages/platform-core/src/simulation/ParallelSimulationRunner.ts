/// <reference types="node" />
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { SimulationConfig, SimulationResult, SimulationRawAccumulators } from '../lua/types';
import type { WorkerMessage, WorkerConfig } from './SimulationWorker';

const SEED_STRIDE = 1 << 20; // 2^20 — gap between worker seeds to avoid overlap

/**
 * Runs simulation across multiple worker threads for parallel speedup.
 * Each worker gets an independent LuaEngine with a partitioned seed range.
 *
 * Results are statistically equivalent to single-threaded mode but not
 * bit-identical (different RNG sequence ordering).
 *
 * @example
 * ```ts
 * const runner = new ParallelSimulationRunner({
 *   script: luaSource,
 *   gameDefinition,
 *   iterations: 1_000_000,
 *   bet: 1.0,
 *   workerCount: 8,
 *   onProgress: (done, total) => console.log(`${done}/${total}`),
 * });
 * const result = await runner.run();
 * ```
 */
export class ParallelSimulationRunner {
  private config: SimulationConfig;
  private workerCount: number;

  constructor(config: SimulationConfig) {
    this.config = config;
    const maxWorkers = cpus().length;
    this.workerCount = Math.max(1, Math.min(
      config.workerCount ?? maxWorkers,
      maxWorkers,
      config.iterations, // no point having more workers than iterations
    ));
  }

  async run(): Promise<SimulationResult> {
    const {
      iterations,
      seed,
      onProgress,
      workerCount: _,
      ...restConfig
    } = this.config;

    const workerCount = this.workerCount;

    // Split iterations evenly, remainder goes to last worker
    const baseChunk = Math.floor(iterations / workerCount);
    const remainder = iterations - baseChunk * workerCount;

    const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'SimulationWorker.ts');

    const progressPerWorker = new Array<number>(workerCount).fill(0);
    const totalIterations = iterations;

    const promises = Array.from({ length: workerCount }, (_, i) => {
      const workerIterations = baseChunk + (i < remainder ? 1 : 0);
      const workerSeed = seed !== undefined ? seed + i * SEED_STRIDE : undefined;

      const workerConfig: WorkerConfig = {
        config: {
          ...restConfig,
          iterations: workerIterations,
          seed: workerSeed,
          progressInterval: this.config.progressInterval,
        },
      };

      return new Promise<SimulationResult>((resolve, reject) => {
        const worker = new Worker(workerPath, {
          workerData: workerConfig,
          // tsx registers itself via --require/--import; pass through to workers
          execArgv: process.execArgv,
        });

        worker.on('message', (msg: WorkerMessage) => {
          if (msg.type === 'progress' && onProgress) {
            progressPerWorker[i] = msg.progress!.completed;
            const totalCompleted = progressPerWorker.reduce((a, b) => a + b, 0);
            onProgress(totalCompleted, totalIterations);
          } else if (msg.type === 'result') {
            resolve(msg.result!);
          } else if (msg.type === 'error') {
            reject(new Error(`Worker ${i} failed: ${msg.error}`));
          }
        });

        worker.on('error', (err: Error) => reject(new Error(`Worker ${i} error: ${err.message}`)));
        worker.on('exit', (code) => {
          if (code !== 0) reject(new Error(`Worker ${i} exited with code ${code}`));
        });
      });
    });

    const results = await Promise.all(promises);
    return aggregateResults(results);
  }
}

function aggregateResults(results: SimulationResult[]): SimulationResult {
  const raw: SimulationRawAccumulators = {
    totalWagered: 0,
    totalWon: 0,
    baseGameWin: 0,
    bonusWin: 0,
    hits: 0,
  };

  let iterations = 0;
  let maxWin = 0;
  let maxWinHits = 0;
  let bonusTriggered = 0;
  let bonusSpinsPlayed = 0;
  let maxDurationMs = 0;

  for (const r of results) {
    const rr = r._raw!;
    raw.totalWagered += rr.totalWagered;
    raw.totalWon += rr.totalWon;
    raw.baseGameWin += rr.baseGameWin;
    raw.bonusWin += rr.bonusWin;
    raw.hits += rr.hits;

    iterations += r.iterations;
    if (r.maxWin > maxWin) maxWin = r.maxWin;
    maxWinHits += r.maxWinHits;
    bonusTriggered += r.bonusTriggered;
    bonusSpinsPlayed += r.bonusSpinsPlayed;
    if (r.durationMs > maxDurationMs) maxDurationMs = r.durationMs;
  }

  return {
    gameId: results[0].gameId,
    action: results[0].action,
    iterations,
    durationMs: maxDurationMs,
    totalRtp: raw.totalWagered > 0 ? (raw.totalWon / raw.totalWagered) * 100 : 0,
    baseGameRtp: raw.totalWagered > 0 ? (raw.baseGameWin / raw.totalWagered) * 100 : 0,
    bonusRtp: raw.totalWagered > 0 ? (raw.bonusWin / raw.totalWagered) * 100 : 0,
    hitFrequency: iterations > 0 ? (raw.hits / iterations) * 100 : 0,
    maxWin,
    maxWinHits,
    bonusTriggered,
    bonusSpinsPlayed,
    _raw: raw,
  };
}
