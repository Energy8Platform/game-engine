import { formatNativeResult } from '@energy8platform/platform-core/simulation';
import type { NativeSimulationResult } from '@energy8platform/platform-core/simulation';
import { detectHitRateGaps } from '../stake-report.js';
import type { OptimizeResult, ToleranceMet } from '../types.js';

/** Full go-native report for one mode (formatNativeResult already includes per-stage + distribution). */
export function formatGoReport(mode: string, result: NativeSimulationResult): string {
  return `── ${mode} ──\n${formatNativeResult(result)}`;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/**
 * Full curate report for one mode — prints everything from `OptimizeResult`:
 * achieved metrics, which tolerance checks failed, the Stake report (risk /
 * liability / probability limits), the hit-rate distribution + detected gaps,
 * refinement swap counts, warnings, and the final optimized row count.
 */
export function formatCurateReport(mode: string, result: OptimizeResult): string {
  const { achieved, toleranceMet, stakeReport: sr, refinement: ref, warnings, rows } = result;
  const lines: string[] = [];

  lines.push(`── ${mode} (curate) ──`);
  lines.push(`  rows                : ${rows.length.toLocaleString()}`);
  lines.push(
    `  achieved            : rtp ${pct(achieved.rtp)}   cv ${achieved.cv.toFixed(3)}   ` +
      `hit ${pct(achieved.hitRate)}   max ${achieved.maxPayout.toLocaleString()}c   ` +
      `Σweight ${achieved.totalWeight.toLocaleString()}`,
  );

  const failed = (Object.keys(toleranceMet) as (keyof ToleranceMet)[]).filter((k) => !toleranceMet[k]);
  lines.push(`  tolerance           : ${failed.length === 0 ? 'all met ✓' : `FAILED: ${failed.join(', ')} ✗`}`);

  lines.push(
    `  stake report        : payoutMultMax ${sr.payoutMultMax.toFixed(2)}   baseStd ${sr.baseStd.toFixed(3)}   ` +
      `uniqueEvents ${sr.uniqueEvents.toLocaleString()}   nonZeroPayouts ${sr.nonZeroPayouts.toLocaleString()}`,
  );
  lines.push(
    `  probability limits  : P(≥5K) ${sr.prob5K.toExponential(2)} (scaled ${sr.prob5KScaled.toExponential(2)})   ` +
      `P(≥10K) ${sr.prob10K.toExponential(2)} (scaled ${sr.prob10KScaled.toExponential(2)})   costMult ${sr.costMultiplier}`,
  );
  lines.push(
    `  risk / liability    : CVaR(norm) ${sr.cvarNormalized.toFixed(2)}×bet   ` +
      `ETL>40×cost ${pct(sr.etl40xCost)}   ETL>10000×bet ${pct(sr.etlP10000)}`,
  );

  const top = (k: number) => (sr.topKShare.find((t) => t.k === k)?.share ?? 0);
  lines.push(
    `  RTP concentration   : top-1 ${pct(top(1))}   top-5 ${pct(top(5))}   ` +
      `top-10 ${pct(top(10))}   top-100 ${pct(top(100))}`,
  );

  lines.push(
    `  refinement swaps    : rtp ${ref.rtpSwaps}   cv ${ref.cvSwaps}   gap-fill ${ref.gapFillSwaps}   ` +
      `diversify ${ref.diversifySwaps}   unfillable ${ref.gapsUnfillable}`,
  );

  lines.push(`  hit-rate distribution (pm = payoutCents / ${sr.betCostCents}):`);
  for (const b of sr.hitRateDistribution) {
    const hi = b.high === Infinity ? '∞' : String(b.high);
    lines.push(
      `    [${String(b.low).padStart(8)}, ${hi.padEnd(6)})   count ${b.count.toLocaleString().padStart(8)}   ` +
        `eff-hit ${pct(b.effectiveHitRate)}`,
    );
  }

  const gaps = detectHitRateGaps(sr.hitRateDistribution);
  if (gaps.length > 0) {
    lines.push(`  hit-rate GAPS       : ${gaps.map((g) => `[${g.low}, ${g.high === Infinity ? '∞' : g.high})`).join('  ')} ✗`);
  } else {
    lines.push(`  hit-rate gaps       : none ✓`);
  }

  if (warnings.length > 0) {
    lines.push(`  warnings (${warnings.length}):`);
    for (const w of warnings) lines.push(`    ! ${w}`);
  }

  return lines.join('\n');
}
