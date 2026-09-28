/**
 * The legacy harness's balance levels (`packages/harness/src/plugin.ts`,
 * `BALANCE_LEVELS` — major units), PINNED here: that constant is not
 * exported, and `packages/*` is read-only. Keep it equal by hand.
 */
export const BALANCE_LEVELS: readonly { value: number; label: string }[] = [
  { value: 1, label: '1' },
  { value: 10, label: '10' },
  { value: 100, label: '100' },
  { value: 1_000, label: '1K' },
  { value: 10_000, label: '10K' },
  { value: 100_000, label: '100K' },
  { value: 1_000_000, label: '1M' },
  { value: 10_000_000, label: '10M' },
  { value: 100_000_000, label: '100M' },
  { value: 1_000_000_000, label: '1B' },
  { value: 10_000_000_000, label: '10B' },
];

export const isBalanceLevel = (n: number) => BALANCE_LEVELS.some((l) => l.value === n);
