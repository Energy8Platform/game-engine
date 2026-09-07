/**
 * Curation in the engine.
 *
 * The optimizer is the pipeline's memory ceiling: measured at ~200 bytes per
 * pool row (the source array of `{sim, weight, payoutCents}` objects is 56 of
 * them, the rest is the optimizer's working copies), which puts a 100M-round
 * pool at ~20 GB — past any Node heap. The engine holds the same pool in three
 * parallel integer vectors, so it curates the run instead of dying on it.
 *
 * `e8 curate run` is a byte-for-byte port of `tiered.ts`, verified against this
 * package's implementation on real pools across all five branches (main path,
 * shapeDistribution, shapeAutoMatchCV, the probability-limit retry loop and the
 * starRating preset). It reads the pool lookUpTable, writes the curated table
 * and the book map, and returns the report as JSON.
 *
 * An engine that does not have the subcommand — or `E8_CURATE=js` — falls back
 * to the TypeScript path, which stays the reference implementation.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findE8Binary } from '@energy8platform/platform-core/simulation';
import type { LookupRow, OptimizeParams, OptimizeResult } from '../types.js';
import { readLut } from './lut-io.js';

/**
 * Source metrics straight from the engine — what the optimizer's defaults are
 * seeded from. Null when the engine cannot answer.
 */
export function engineSourceMetrics(
  poolLutPath: string,
): { rows: number; achieved: OptimizeResult['achieved'] } | null {
  if (process.env.E8_CURATE === 'js') return null;
  const binary = findE8Binary();
  if (!binary) return null;
  try {
    const stdout = execFileSync(binary, ['curate', 'metrics', '--lut', poolLutPath], {
      encoding: 'utf-8',
      maxBuffer: 4 * 1024 * 1024,
    });
    const m = JSON.parse(stdout) as {
      rows: number; rtp: number; cv: number; hitRate: number;
      maxPayout: number; totalWeight: number;
    };
    return {
      rows: m.rows,
      achieved: {
        rtp: m.rtp, cv: m.cv, hitRate: m.hitRate,
        maxPayout: m.maxPayout, totalWeight: m.totalWeight,
      },
    };
  } catch {
    return null;
  }
}

/** Ask the engine to curate. Returns null when it cannot, so the caller runs the JS path. */
export async function curateWithEngine(
  poolLutPath: string,
  params: OptimizeParams,
  outLutPath: string,
  outMapPath: string,
): Promise<OptimizeResult | null> {
  if (process.env.E8_CURATE === 'js') return null;
  const binary = findE8Binary();
  if (!binary) return null;

  const dir = mkdtempSync(join(tmpdir(), 'e8-curate-'));
  const paramsPath = join(dir, 'params.json');
  try {
    writeFileSync(paramsPath, JSON.stringify(params));
    const stdout = execFileSync(
      binary,
      ['curate', 'run', '--lut', poolLutPath, '--params', paramsPath,
        '--out-lut', outLutPath, '--out-map', outMapPath],
      { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
    const report = JSON.parse(stdout) as EngineReport;
    return toOptimizeResult(report, await readLut(outLutPath));
  } catch (err) {
    // An engine without `curate` exits non-zero on the unknown command; anything
    // else here (bad params, unreadable pool) is equally a reason to let the JS
    // path speak, since it will hit the same input and report properly.
    if (process.env.E8_CURATE === 'engine') {
      throw new Error(
        `E8_CURATE=engine was requested but the engine could not curate: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return null;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

interface EngineReport {
  rows: number;
  achieved: OptimizeResult['achieved'];
  toleranceMet: OptimizeResult['toleranceMet'];
  maxRowRtpShare: number;
  maxWeightRatio: number;
  refinement: OptimizeResult['refinement'];
  warnings: string[];
  stakeReport: Omit<OptimizeResult['stakeReport'], 'hitRateDistribution'> & {
    hitRateDistribution: { low: number; high: number | null; count: number; effectiveHitRate: number }[];
  };
}

/**
 * The engine's report, shaped like the optimizer's result.
 *
 * `rows` is read back from the table the engine just wrote. That is the OUTPUT
 * (hundreds of thousands of rows), not the pool that made this port necessary —
 * the JS path holds exactly the same array — and callers do read it, so
 * returning an empty one would be a silent contract change.
 */
function toOptimizeResult(report: EngineReport, rows: LookupRow[]): OptimizeResult {
  return {
    rows,
    achieved: report.achieved,
    toleranceMet: report.toleranceMet,
    maxRowRtpShare: report.maxRowRtpShare,
    maxWeightRatio: report.maxWeightRatio,
    refinement: report.refinement,
    warnings: report.warnings,
    stakeReport: {
      ...report.stakeReport,
      // The top hit-rate range is `[20000, ∞)`, and JSON has no infinity — it
      // arrives as null. Restoring it here keeps the report identical to the
      // one the TypeScript optimizer returns, including how it prints.
      hitRateDistribution: report.stakeReport.hitRateDistribution.map((b) => ({
        ...b,
        high: b.high === null ? Infinity : b.high,
      })),
    },
  };
}
