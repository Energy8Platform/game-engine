import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import type { Diagnostic } from '@energy8engine/contracts';
import { createTransitions, cut, fade, type TickerLike } from '../src/index';

/** A ticker the test drives by hand: `tick(ms)` runs every registered fn once with that `deltaMS`. */
function fakeTicker(): TickerLike & { tick(ms: number): void; size(): number } {
  const fns = new Set<(t: { deltaMS: number }) => void>();
  return {
    add: (fn) => fns.add(fn),
    remove: (fn) => fns.delete(fn),
    tick: (ms) => [...fns].forEach((fn) => fn({ deltaMS: ms })),
    size: () => fns.size,
  };
}

describe('transitions registry', () => {
  it('registers, lists, gets, retracts', () => {
    const t = createTransitions();
    const off = t.register({ id: 'wipe', run: async () => {} });
    expect(t.ids()).toEqual(['wipe']);
    expect(t.get('wipe')?.id).toBe('wipe');
    off();
    expect(t.ids()).toEqual([]);
  });

  it('the incumbent keeps a taken id; the collision is an error diagnostic; the returned retract is a no-op', () => {
    const reported: Diagnostic[] = [];
    const t = createTransitions((d) => reported.push(d));
    const first = { id: 'wipe', run: async () => {} };
    t.register(first);
    const off = t.register({ id: 'wipe', run: async () => {} });
    expect(t.get('wipe')).toBe(first);
    expect(reported[0]).toMatchObject({ severity: 'error', plugin: 'stage', where: 'wipe' });
    off();
    expect(t.get('wipe')).toBe(first);
  });

  it('subscribers hear register and retract', () => {
    const t = createTransitions();
    let n = 0;
    t.subscribe(() => n++);
    const off = t.register({ id: 'a', run: async () => {} });
    off();
    expect(n).toBe(2);
  });
});

describe('built-in transitions', () => {
  it('cut resolves at once and touches nothing', async () => {
    const a = new Container();
    await cut.run({ from: [a], to: [], ticker: fakeTicker(), ms: 300 });
    expect(a.alpha).toBe(1);
  });

  it('fade tweens alpha over ms on the ticker and cleans up', async () => {
    const from = new Container();
    const to = new Container();
    const ticker = fakeTicker();
    const done = fade.run({ from: [from], to: [to], ticker, ms: 200 });
    expect(to.alpha).toBe(0);
    ticker.tick(100);
    expect(to.alpha).toBeCloseTo(0.5);
    expect(from.alpha).toBeCloseTo(0.5);
    ticker.tick(100);
    await done;
    expect(to.alpha).toBe(1);
    expect(from.alpha).toBe(1);
    expect(ticker.size()).toBe(0);
  });

  it('fade with no ticker behaves as cut', async () => {
    const to = new Container();
    await fade.run({ from: [], to: [to], ticker: null, ms: 200 });
    expect(to.alpha).toBe(1);
  });
});
