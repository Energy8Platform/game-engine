import type { LookupRow, OptimizeAchieved, StakeReport, TopKShare, HitRateBucket } from './types.js';

/**
 * Stake's hit-rate distribution table boundaries (payout multipliers).
 * Mirrors the ranges shown in Engine's publish UI under
 * "Hit-Rate Ranges". Stake flags any intermediate empty range as a gap.
 *
 * Note: Stake displays the first range as `[0, 0.1)` (closed-open) — this
 * captures zero-payout rows. All other ranges are `[low, high)` here for
 * consistency; the last entry is `[20000, ∞)`.
 */
export const HIT_RATE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 0.1],
  [0.1, 1],
  [1, 2],
  [2, 5],
  [5, 10],
  [10, 20],
  [20, 50],
  [50, 100],
  [100, 200],
  [200, 500],
  [500, 1000],
  [1000, 2000],
  [2000, 5000],
  [5000, 10000],
  [10000, 20000],
  [20000, Infinity],
];

/**
 * Stake's cost-multiplier probability scaling rule (verif spec, P(>=5000)/
 * P(>=10000) section). Higher-cost modes are treated more leniently because
 * their effective tail-risk contribution per bet is reduced relative to the
 * 1× base. Returns the multiplier used to scale the measured probability
 * before comparing against the published limit.
 */
function costScale(cost: number): number {
  if (cost >= 1000) return 0.2;
  if (cost >= 500) return 0.5;
  if (cost >= 200) return 0.8;
  return 1.0;
}

/**
 * Compute the full Stake-compatible report from a finalized lookup table.
 * Single source of truth for both tier-based and NNLS-based outputs.
 *
 * `costMultiplier` defaults to 1 — pass the game/mode's cost multiplier so
 * the scaled P(5K)/P(10K) and the ETL>40×cost threshold reflect the actual
 * cost-vs-bet relationship the Stake reviewer sees.
 */
export function computeStakeReport(
  outRows: ReadonlyArray<LookupRow>,
  achieved: OptimizeAchieved,
  betCostCents: number,
  costMultiplier: number = 1,
): StakeReport {
  const threshold5K = 5000 * betCostCents;
  const threshold10K = 10000 * betCostCents;
  const threshold40xCost = Math.floor(40 * costMultiplier * betCostCents);

  let w5K = 0n;
  let w10K = 0n;
  let wTotal = 0n;
  let nonZeroPayouts = 0;
  // RTP contributions for ETL — accumulated in floating-point because
  // weight × payoutCents already overflows 32-bit on large LUTs.
  let totalWP = 0;
  let wp40xCost = 0;
  let wpP10000 = 0;
  const uniquePayouts = new Set<number>();
  for (const r of outRows) {
    const w = BigInt(r.weight);
    wTotal += w;
    if (r.payoutCents >= threshold5K) w5K += w;
    if (r.payoutCents >= threshold10K) w10K += w;
    if (r.payoutCents > 0) nonZeroPayouts++;
    uniquePayouts.add(r.payoutCents);
    const wp = r.weight * r.payoutCents;
    totalWP += wp;
    if (r.payoutCents >= threshold40xCost) wp40xCost += wp;
    if (r.payoutCents >= threshold10K) wpP10000 += wp;
  }
  const prob5K = wTotal > 0n ? Number(w5K) / Number(wTotal) : 0;
  const prob10K = wTotal > 0n ? Number(w10K) / Number(wTotal) : 0;
  const probScale = costScale(costMultiplier);
  const prob5KScaled = prob5K * probScale;
  const prob10KScaled = prob10K * probScale;
  const etl40xCost = totalWP > 0 ? wp40xCost / totalWP : 0;
  const etlP10000 = totalWP > 0 ? wpP10000 / totalWP : 0;

  // Top-K cumulative RTP shares (by w·payout descending).
  const sortedWP = outRows
    .map((r) => r.weight * r.payoutCents)
    .sort((a, b) => b - a);
  const topKShare: TopKShare[] = [];
  const Ks = [1, 5, 10, 100];
  let cum = 0;
  let kIdx = 0;
  for (let i = 0; i < sortedWP.length; i++) {
    cum += sortedWP[i];
    while (kIdx < Ks.length && i + 1 === Ks[kIdx]) {
      topKShare.push({ k: Ks[kIdx], share: totalWP > 0 ? cum / totalWP : 0 });
      kIdx++;
    }
    if (kIdx >= Ks.length) break;
  }
  while (kIdx < Ks.length) {
    topKShare.push({ k: Ks[kIdx], share: totalWP > 0 ? cum / totalWP : 0 });
    kIdx++;
  }

  // CVaR (Expected Shortfall) at the 0.1% tail.
  // Sort rows by payoutCents DESC, then walk the prefix until cumulative
  // weight reaches 0.1% of totalWeight. The conditional mean across that
  // prefix is the CVaR — "expected payout in the worst 0.1% of outcomes".
  // Stake compares the normalised (CVaR / betCost) value against caps of
  // 700 (2-star) / 800 (3-star).
  const wTotalNum = Number(wTotal);
  const tailWeightTarget = wTotalNum * 0.001;
  let cvarAbsoluteCents = 0;
  if (wTotalNum > 0 && tailWeightTarget > 0) {
    const byPayoutDesc = outRows
      .slice()
      .sort((a, b) => b.payoutCents - a.payoutCents);
    let tailWeightAcc = 0;
    let tailWPAcc = 0;
    for (const r of byPayoutDesc) {
      const remaining = tailWeightTarget - tailWeightAcc;
      if (remaining <= 0) break;
      // Partial slice the last row at the exact 0.1% boundary so the
      // averaging doesn't bias against very large LUTs where individual
      // weights exceed the entire 0.1% budget.
      const take = Math.min(r.weight, remaining);
      tailWeightAcc += take;
      tailWPAcc += take * r.payoutCents;
      if (tailWeightAcc >= tailWeightTarget) break;
    }
    cvarAbsoluteCents = tailWeightAcc > 0 ? tailWPAcc / tailWeightAcc : 0;
  }
  const cvarNormalized = betCostCents > 0 ? cvarAbsoluteCents / betCostCents : 0;

  // Hit-rate distribution table.
  // pm (payout multiplier) = payoutCents / betCostCents. Range [low, high).
  const counts = new Array<number>(HIT_RATE_RANGES.length).fill(0);
  const weights = new Array<bigint>(HIT_RATE_RANGES.length).fill(0n);
  for (const r of outRows) {
    const pm = r.payoutCents / betCostCents;
    for (let i = 0; i < HIT_RATE_RANGES.length; i++) {
      const [low, high] = HIT_RATE_RANGES[i];
      if (pm >= low && pm < high) {
        counts[i]++;
        weights[i] += BigInt(r.weight);
        break;
      }
    }
  }
  const totalWeightNum = Number(wTotal);
  const hitRateDistribution: HitRateBucket[] = HIT_RATE_RANGES.map(([low, high], i) => ({
    low,
    high,
    count: counts[i],
    effectiveHitRate: totalWeightNum > 0 ? Number(weights[i]) / totalWeightNum : 0,
  }));

  return {
    payoutMultMax: achieved.maxPayout / betCostCents,
    baseStd: (achieved.cv * achieved.rtp * 100) / betCostCents,
    prob5K,
    prob10K,
    prob5KScaled,
    prob10KScaled,
    costMultiplier,
    cvarNormalized,
    cvarAbsoluteCents,
    etl40xCost,
    etlP10000,
    topKShare,
    hitRateDistribution,
    uniqueEvents: uniquePayouts.size,
    nonZeroPayouts,
    betCostCents,
    // Filled in by curate once the books are serialized (unknown at optimize time).
    maxEventsBytes: 0,
    maxEventsBytesBookId: -1,
    booksOverEventsLimit: 0,
  };
}

/**
 * Returns the [low, high) ranges that are EMPTY but lie BETWEEN two non-empty
 * ranges. These are the "intermediate gaps" Stake's "Gaps in the Hit Rate
 * Table" check flags. Empty ranges above the highest non-empty range are
 * natural (the source distribution doesn't reach that far) and are not gaps.
 */
export function detectHitRateGaps(
  hitRateDistribution: ReadonlyArray<{ low: number; high: number; count: number }>,
): Array<{ low: number; high: number }> {
  // Find the index of the last non-empty range.
  let lastNonEmpty = -1;
  for (let i = hitRateDistribution.length - 1; i >= 0; i--) {
    if (hitRateDistribution[i].count > 0) {
      lastNonEmpty = i;
      break;
    }
  }
  if (lastNonEmpty < 0) return [];

  const gaps: Array<{ low: number; high: number }> = [];
  let seenNonEmpty = false;
  for (let i = 0; i <= lastNonEmpty; i++) {
    const b = hitRateDistribution[i];
    if (b.count > 0) {
      seenNonEmpty = true;
    } else if (seenNonEmpty) {
      gaps.push({ low: b.low, high: b.high });
    }
  }
  return gaps;
}

