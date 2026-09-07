import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../src/pipeline/concurrency';

/** A promise plus the handles to settle it from the test body. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('mapWithConcurrency', () => {
  it('returns results in input order, not completion order', async () => {
    const out = await mapWithConcurrency([30, 20, 10], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 20, 10]);
  });

  it('runs at most `limit` tasks at once', async () => {
    const gates = [0, 1, 2, 3, 4].map(() => deferred<void>());
    let active = 0;
    let peak = 0;

    const run = mapWithConcurrency(gates, 2, async (g) => {
      active++;
      peak = Math.max(peak, active);
      await g.promise;
      active--;
      return null;
    });

    await tick();
    expect(active).toBe(2); // only the first two started

    gates[0].resolve();
    await tick();
    expect(active).toBe(2); // a slot freed, the third took it

    for (const g of gates) g.resolve();
    await run;
    expect(peak).toBe(2);
  });

  it('runs everything sequentially at limit 1', async () => {
    const order: number[] = [];
    await mapWithConcurrency([1, 2, 3], 1, async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 4 - n)); // later items are faster
      order.push(-n);
      return n;
    });
    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });

  it('passes the index of each item', async () => {
    const out = await mapWithConcurrency(['a', 'b', 'c'], 2, async (item, i) => `${i}:${item}`);
    expect(out).toEqual(['0:a', '1:b', '2:c']);
  });

  it('rejects with the failing task error instead of hanging', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('mode BONUS failed');
        return n;
      }),
    ).rejects.toThrow('mode BONUS failed');
  });

  it('handles an empty input', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
