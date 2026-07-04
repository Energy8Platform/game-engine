export interface LookupRow {
  /** Simulation number — opaque identifier, preserved on output. */
  sim: number;
  /** Input weight, integer (typically large, e.g. 1.99e11). */
  weight: number;
  /** Payout multiplier × 100, integer, ≥ 0. */
  payoutCents: number;
}

export interface OptimizeParams {
  targetRTP: number;
  toleranceRTP: number;

  targetCV: number;
  toleranceCV: number;

  targetHitRate: number;
  toleranceHitRate: number;

  /** Hard cap. Rows with payoutCents > capMaxWin are dropped. */
  capMaxWin: number;

  /** Cost of a single bet in cents. Used to convert payouts to "bet multiplier" units
   *  for the Stake-style report. Default 100 (1.0 bet = 100 cents). */
  betCostCents?: number;

  /** When true, force ≥ 1 row with payoutCents ≥ maxReachedFraction × capMaxWin. Default true. */
  requireMaxReached?: boolean;
  /** Default 0.95. */
  maxReachedFraction?: number;

  nRowsOut: number;
  /** Sum of integer output weights. Default = nRowsOut × 1_000_000. Must be ≥ nRowsOut. */
  totalWeightOut?: number;

  /** Sampling RNG seed. Default 0xC0FFEE. */
  seed?: number;
  /** Expand-and-retry attempts on tolerance miss. Default 5. */
  maxIterations?: number;
  /** Number of log-buckets between min-nonzero and capMaxWin. Default 100. */
  bucketCount?: number;
  /** Minimum sample slots per non-empty non-zero bucket. Default 3. */
  minPerBucket?: number;

  /** Maximum fraction of total RTP that any single output row may contribute.
   *  Stake Engine's "Within Liability Limits" check fails when one row dominates RTP.
   *  Default 0.05 (5%). Set to 1.0 to disable.
   */
  maxRowRtpShare?: number;

  /** Maximum integer weight allowed for any single output row, as a multiple of the
   *  uniform prior weight (totalWeightOut / nRowsOut). E.g., 10 means no row can have
   *  weight greater than 10 × (totalWeightOut / nRowsOut). This prevents Stake's ETL
   *  ("Within Liability Limits") check from failing due to over-concentrated weight.
   *  Default 10. Set to Infinity to disable. */
  maxWeightPerRow?: number;

  /** Algorithm for compressing source rows into a weighted lookup table.
   *  - 'tiered' (default): tier-based rarity weighting (cap/large rows get weight=1,
   *    small rows get calculated weight W). Preserves source distribution rates;
   *    passes Stake Engine's "Within Liability Limits" check.
   *  - 'nnls': legacy NNLS optimization; hits RTP/CV/HR targets exactly but may
   *    concentrate weight on few rows and fail Stake's Liability check. */
  algorithm?: 'tiered' | 'nnls';

  /** Tier-based only: payout multiplier (payoutCents / betCostCents) above which
   *  a row is in the "cap" tier (weight=1, rare). Default: 0.95 × max source pm. */
  capPmThreshold?: number;

  /** Tier-based only: payout multiplier threshold for the "large" tier.
   *  Rows with capPmThreshold > pm >= largePmThreshold get weight=1.
   *  Default: undefined (no large tier — only cap vs small). */
  largePmThreshold?: number;

  /** Tier-based only: target effective probability for cap+large rows in output.
   *  Default: natural rate from source = (n_cap + n_large) / n_source. */
  largeTarget?: number;

  /** Tier-based only: when true, ensure every Stake hit-rate distribution range
   *  up to the actual max payout has ≥ 1 output row when source has rows in
   *  that range. Prevents Stake's "Gaps in the Hit Rate Table" rejection.
   *  Default true. */
  ensureRangeCoverage?: boolean;

  /** Tier-based only: reshape the high-tier sampling so the per-bucket row
   *  counts follow a log-decay curve across Stake hit-rate ranges — each
   *  bucket above the lowest one in the high tier targets `ratio × prev`
   *  rows. Turns the typical sparse tail of `…18 → 1 → 1 → 1 → 4` into
   *  a smooth `…18 → 9 → 4 → 2 → 1` instead.
   *
   *  When true and `largePmThreshold` is unset, auto-sets it to
   *  `max(50, capPmThreshold / 20)` so the decay covers multiple Stake
   *  buckets, not just the single cap bucket. Default false. */
  shapeDistribution?: boolean;

  /** Tier-based only: ratio between adjacent Stake-bucket row counts when
   *  `shapeDistribution=true`. 0.5 = each higher bucket has half the rows
   *  of the one below it. Default 0.5. */
  shapeDecayRatio?: number;

  /** Tier-based only: auto-pick `shapeDecayRatio` by binary search so the
   *  achieved CV lands at `targetCV` within `toleranceCV`. Requires
   *  `shapeDistribution=true` and a `targetCV > 0`. Runs the full pipeline
   *  up to 6 times (one per bisection step) — expect a 5×-6× wall-clock
   *  hit on builds where it triggers. Default false. */
  shapeAutoMatchCV?: boolean;

  /** Stake's "Within Probability Limits" — the maximum allowed P(payout ≥
   *  5000 × bet). When set, the optimizer auto-tunes `largeTarget` (and
   *  auto-sets `largePmThreshold=5000` if it was unset) by re-running up
   *  to 4 times, halving `largeTarget` proportionally to the overshoot
   *  each iteration, until the achieved P(5K) lands under the limit.
   *  When unset, no check is performed and `ToleranceMet.prob5K` is
   *  always true. */
  maxProb5K?: number;

  /** Same as `maxProb5K` but for P(payout ≥ 10000 × bet). The retry loop
   *  enforces BOTH limits simultaneously — `largeTarget` shrinks by the
   *  worse of the two overshoots each iteration. */
  maxProb10K?: number;

  /** Game/mode cost multiplier (e.g. 1 for BASE, 250 for BONUS_ADEPT).
   *  Used to:
   *    - scale P(≥5K)/P(≥10K) before comparing against `maxProb5K`/
   *      `maxProb10K` (Stake leniency for higher-cost modes: c≥1000→×0.2,
   *      500≤c<1000→×0.5, 200≤c<500→×0.8, else ×1.0).
   *    - set the threshold for ETL>40×cost (`40 × costMultiplier × bet`).
   *  Default 1. */
  costMultiplier?: number;

  /** Stake star rating (2 or 3). When set, populates default values for
   *  the verif.md limits: `maxCVaRNormalized`, `maxEtl40xCost`,
   *  `maxEtlP10000`, `minBaseStd`/`maxBaseStd`, `maxPayoutMultiplier`,
   *  `maxCostMultiplier`. Explicit overrides on the individual fields
   *  still win. */
  starRating?: 2 | 3;

  /** Stake's Risk Limit — CVaR (normalised) cap. 2-star: 700, 3-star: 800.
   *  When set and exceeded, `toleranceMet.cvar` is false and a warning is
   *  emitted. No auto-enforcement yet (would require structural changes
   *  to the high-tier sample). */
  maxCVaRNormalized?: number;

  /** Stake's Liability ETL cap with threshold = 40×costMultiplier. 2-star:
   *  0.8, 3-star: 0.9. */
  maxEtl40xCost?: number;

  /** Stake's Liability ETL cap with threshold = 10000× bet. 2-star: 0.6,
   *  3-star: 0.8. */
  maxEtlP10000?: number;

  /** Minimum / maximum allowed base StdDev (bet-cost units) for cost=1
   *  modes. Stake: min 0.6 both ratings; max 50 (2-star) / 60 (3-star).
   *  Only checked when `costMultiplier === 1`. */
  minBaseStd?: number;
  maxBaseStd?: number;

  /** Stake's Max Payout Multiplier cap. 2-star: 25000, 3-star: 100000.
   *  `toleranceMet.payoutMultiplierCap` checks `payoutMultMax ≤ this`. */
  maxPayoutMultiplier?: number;

  /** Stake's Max Cost Multiplier cap. 2-star: 1000, 3-star: 1500. Compared
   *  against `costMultiplier`. */
  maxCostMultiplier?: number;

  /** Tier-based only: minimum fraction of nRowsOut that must be distinct payoutCents
   *  values in the output. Stake Engine rejects "Insufficient Unique Events" when
   *  too few distinct outcomes exist (same events repeat in a session). Default 0.01
   *  (1%). For 100K output → 1K unique payouts required. Set to 0 to disable.
   *
   *  When the target cannot be reached (source lacks enough distinct payouts, or
   *  RTP-drift budget exhausts), the optimizer falls back to maximizing unique
   *  count under the budget and emits a warning. */
  minUniqueEventsRate?: number;
}

export interface OptimizeAchieved {
  rtp: number;
  cv: number;
  hitRate: number;
  maxPayout: number;
  totalWeight: number;
}

export interface ToleranceMet {
  rtp: boolean;
  cv: boolean;
  hitRate: boolean;
  maxReached: boolean;
  /** True if no output row contributes more than maxRowRtpShare of total RTP. */
  rtpConcentration: boolean;
  /** True if no output row's weight exceeds maxWeightPerRow × (totalWeightOut / nRowsOut). */
  weightCap: boolean;
  /** True if maxProb5K is unset OR cost-scaled P(5K) ≤ maxProb5K. */
  prob5K: boolean;
  /** True if maxProb10K is unset OR cost-scaled P(10K) ≤ maxProb10K. */
  prob10K: boolean;
  /** True if maxCVaRNormalized is unset OR cvarNormalized ≤ maxCVaRNormalized. */
  cvar: boolean;
  /** True if maxEtl40xCost is unset OR etl40xCost ≤ maxEtl40xCost. */
  etl40xCost: boolean;
  /** True if maxEtlP10000 is unset OR etlP10000 ≤ maxEtlP10000. */
  etlP10000: boolean;
  /** True when costMultiplier is not 1 (rule skipped), OR baseStd lies in
   *  [minBaseStd, maxBaseStd] (each defaulted from starRating). */
  baseStdRange: boolean;
  /** True if maxPayoutMultiplier is unset OR payoutMultMax ≤ this. */
  payoutMultiplierCap: boolean;
  /** True if maxCostMultiplier is unset OR costMultiplier ≤ this. */
  costMultiplierCap: boolean;
}

export interface TopKShare {
  /** Cumulative share of total RTP coming from the top-K rows (ordered by w·payout descending). */
  k: number;
  share: number;
}

export interface HitRateBucket {
  /** Inclusive lower bound of the payout-multiplier range. */
  low: number;
  /** Exclusive upper bound (Infinity for the open top bucket). */
  high: number;
  /** Number of distinct output rows with pm in [low, high). */
  count: number;
  /** Σ weight in this range / Σ weight total — the player-facing probability. */
  effectiveHitRate: number;
}

export interface StakeReport {
  /** Maximum payout in the output, as a bet multiplier (payoutCents / betCostCents). */
  payoutMultMax: number;

  /** Standard deviation of payouts in bet-cost units (= stddev_payout_cents / betCostCents).
   *  Equivalent to cv × rtp × (100 / betCostCents). For bet=100 cents, equals cv × rtp × 1. */
  baseStd: number;

  /** Probability that a sampled spin pays ≥ 5000 × betCost. */
  prob5K: number;

  /** Probability that a sampled spin pays ≥ 10000 × betCost. */
  prob10K: number;

  /** Top-K cumulative RTP shares, sorted by per-row (w × payout) descending.
   *  Standard K values reported: 1, 5, 10, 100. */
  topKShare: TopKShare[];

  /** Stake's hit-rate-distribution table: payout-multiplier ranges with row count
   *  and effective probability. Ranges are: [0, 0.1), [0.1, 1), [1, 2), [2, 5),
   *  [5, 10), [10, 20), [20, 50), [50, 100), [100, 200), [200, 500), [500, 1000),
   *  [1000, 2000), [2000, 5000), [5000, 10000), [10000, 20000), [20000, ∞).
   *  Stake fails publication when any intermediate range is empty (gap). */
  hitRateDistribution: HitRateBucket[];

  /** Number of distinct payoutCents values in the output. Stake flags "Insufficient
   *  Unique Events" when this is too low — same outcomes repeat in a session. */
  uniqueEvents: number;

  /** Number of output rows with payoutCents > 0 (non-zero hit count). Stake
   *  requires a "reasonable portion" of paying results — typically ≥ 5% of
   *  the table, i.e. non-zero hit rate ≥ 1 in 20. */
  nonZeroPayouts: number;

  /** P(payout ≥ 5000 × betCost) after Stake's cost-multiplier scaling rule:
   *  c ≥ 1000 → ×0.2, 500 ≤ c < 1000 → ×0.5, 200 ≤ c < 500 → ×0.8, else ×1.0.
   *  This is the value that gets compared against Stake's published limit
   *  (0.01 for both 2-star and 3-star). Equals `prob5K` when costMultiplier
   *  is unset or < 200. */
  prob5KScaled: number;

  /** P(payout ≥ 10000 × betCost) after Stake's cost-multiplier scaling
   *  (same rule as `prob5KScaled`). Compared against the 2-star limit 0.002
   *  or the 3-star limit 0.005. */
  prob10KScaled: number;

  /** Cost multiplier used for the scaled probabilities (1 when unset). */
  costMultiplier: number;

  /** Conditional Value at Risk (Expected Shortfall) in bet-cost units —
   *  the expected payout, normalised by bet cost, in the worst 0.1% of
   *  outcomes (i.e. the rare-but-huge tail Stake polices via the "Risk
   *  Limits" cap: ≤ 700 for 2-star, ≤ 800 for 3-star). Mean of (payout/bet)
   *  over the top-0.1%-by-payout rows weighted by their `weight`. */
  cvarNormalized: number;

  /** Absolute CVaR — the same expected-shortfall but in cents, before
   *  dividing by bet cost. Useful when comparing against operator maximum
   *  exposure ($10M / $25M caps). */
  cvarAbsoluteCents: number;

  /** Expected Tail Liability — share of total RTP coming from payouts
   *  ≥ 40 × costMultiplier × bet. Stake caps this at 0.8 (2-star) / 0.9
   *  (3-star). When costMultiplier is unset, threshold falls back to the
   *  10000× bet definition (same value as `etlP10000`). */
  etl40xCost: number;

  /** Expected Tail Liability with the threshold fixed at 10000 × bet —
   *  share of total RTP from payouts above that line. Stake limit: 0.6
   *  (2-star) / 0.8 (3-star). */
  etlP10000: number;

  /** Bet cost in cents used for the multiplier conversions (echoed from params). */
  betCostCents: number;
}

export interface RefinementStats {
  /** Single-row swaps applied during refineRtpBySwap to close residual RTP gap. */
  rtpSwaps: number;
  /** Σ-preserving 2-swaps applied during refineCvBySwap to nudge CV. */
  cvSwaps: number;
  /** Swaps applied to fill empty Stake distribution ranges (ensureRangeCoverage). */
  gapFillSwaps: number;
  /** Stake distribution ranges where source has no rows — gaps that cannot be filled. */
  gapsUnfillable: number;
  /** Swaps applied to introduce new distinct payoutCents into the output (minUniqueEventsRate). */
  diversifySwaps: number;
}

export interface OptimizeResult {
  rows: LookupRow[];
  achieved: OptimizeAchieved;
  toleranceMet: ToleranceMet;
  /** The single output row's largest fraction of total RTP. */
  maxRowRtpShare: number;
  /** Maximum integer weight observed in output, as a multiple of uniform prior. */
  maxWeightRatio: number;
  /** Per-pass swap counters from the refinement loops. */
  refinement: RefinementStats;
  warnings: string[];
  stakeReport: StakeReport;
}
