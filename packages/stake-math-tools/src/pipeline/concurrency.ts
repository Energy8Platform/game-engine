/**
 * Bounded-concurrency map. Modes are independent from `pool` onward, so curating
 * six of them one after another leaves most of the machine idle — but running
 * all six at once is not free either: each mode holds its whole source LUT in
 * memory (millions of `LookupRow`s), so the bound is what keeps a 14M-round game
 * from paging. Hence a limit rather than `Promise.all`.
 */

/**
 * Run `fn` over `items` with at most `limit` in flight, resolving to the results
 * in INPUT order (so per-mode reports still print in config order regardless of
 * which mode finished first). Rejects with the first error.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  // `width` workers pulling from a shared cursor: a slow item never blocks the
  // queue behind it, which a chunked `Promise.all` would.
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
