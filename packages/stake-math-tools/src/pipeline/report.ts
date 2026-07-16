import { formatNativeResult } from '@energy8platform/platform-core/simulation';
import type { NativeSimulationResult } from '@energy8platform/platform-core/simulation';
import { detectHitRateGaps } from '../stake-report.js';
import { classifyVolatility } from '../metrics.js';
import { STAKE_EVENTS_MAX_BYTES } from '../types.js';
import type { OptimizeResult, ToleranceMet } from '../types.js';

/** Full go-native report for one mode (formatNativeResult already includes per-stage + distribution). */
export function formatGoReport(mode: string, result: NativeSimulationResult): string {
  return `── ${mode} ──\n${formatNativeResult(result)}`;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtBytes = (b: number) => (b >= 1024 ? `${(b / 1024).toFixed(1)} KiB` : `${b} B`);

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
  // Полный итог по КУРИРОВАННОЙ таблице — те же секции и единицы, что в
  // сим-отчёте (RTP — доля стоимости раунда, Max Win в x, шкала волатильности
  // casino_platform, взвешенная гистограмма по сим-бакетам).
  lines.push('', ...formatCuratedResult(result));

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

  // Stake caps a book's serialized `events` field at STAKE_EVENTS_MAX_BYTES (1 MiB).
  const evMark =
    sr.booksOverEventsLimit > 0 ? `${sr.booksOverEventsLimit} OVER LIMIT ✗` : 'within limit ✓';
  lines.push(
    `  events size (max)   : ${fmtBytes(sr.maxEventsBytes)} / ${fmtBytes(STAKE_EVENTS_MAX_BYTES)} ` +
      `(${pct(sr.maxEventsBytes / STAKE_EVENTS_MAX_BYTES)})` +
      `${sr.maxEventsBytesBookId >= 0 ? `   book #${sr.maxEventsBytesBookId}` : ''}   ${evMark}`,
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

/** Sim-style report computed from the curated weighted table (rows). */
export function formatCuratedResult(result: OptimizeResult): string[] {
  const { rows, stakeReport: sr } = result;
  const cost = sr.costMultiplier || 1;

  let totalW = 0;
  let hitW = 0;
  let sum = 0; // Σ w · x  (x = payout in bet-multiples)
  let sumSq = 0; // Σ w · x²
  let maxX = 0;
  const edges: Array<[number, number, string]> = [
    [0, 0, '0x'],
    [0, 1, '>0-1x'],
    [1, 5, '1-5x'],
    [5, 20, '5-20x'],
    [20, 100, '20-100x'],
    [100, 500, '100-500x'],
    [500, Infinity, '500x+'],
  ];
  const dist = new Array(edges.length).fill(0);
  for (const r of rows) {
    const w = r.weight;
    const x = r.payoutCents / 100;
    totalW += w;
    sum += w * x;
    sumSq += w * x * x;
    if (x > 0) hitW += w;
    if (x > maxX) maxX = x;
    const bi = x <= 0 ? 0 : edges.findIndex(([lo, hi]) => x > lo && x <= hi);
    dist[bi === -1 ? edges.length - 1 : bi] += w;
  }
  const mean = totalW > 0 ? sum / totalW : 0;
  const variance = Math.max(0, (totalW > 0 ? sumSq / totalW : 0) - mean * mean);
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0;
  const vol = classifyVolatility(cv);
  const hit = totalW > 0 ? hitW / totalW : 0;

  const lines: string[] = [
    '  --- Curated Result ---',
    `  Rows: ${rows.length.toLocaleString()}   Σweight: ${totalW.toLocaleString()}   Cost: ×${cost}`,
    `  Total RTP: ${((mean / cost) * 100).toFixed(2)}%`,
    `  Hit Frequency: ${(hit * 100).toFixed(2)}%`,
    `  Max Win: ${maxX.toLocaleString()}x`,
    `  Volatility: ${vol.score}/10 (${vol.label})   StdDev: ${stddev.toFixed(2)}   CV: ${cv.toFixed(2)}`,
    '  Win Distribution (weighted):',
  ];
  for (let i = 0; i < edges.length; i++) {
    if (!dist[i]) continue;
    const p = totalW > 0 ? (dist[i] / totalW) * 100 : 0;
    const bar = '█'.repeat(Math.max(0, Math.round(p / 2.5)));
    lines.push(`    ${edges[i][2].padEnd(9)} ${p.toFixed(2).padStart(6)}% ${bar}`);
  }
  return lines;
}
