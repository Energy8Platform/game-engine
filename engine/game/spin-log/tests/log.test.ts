/**
 * The two properties the log stands on, and one test each for the ways
 * either can be lost.
 *
 * "Append-only" is not a promise about the log's own methods — there is no
 * `remove` to leave out. It is a promise about what a HOLDER of an entry
 * can do: a record of what happened that a caller can edit afterwards is
 * not a record. Three of the tests below are that one property, checked
 * from the three directions a naive implementation loses it from — the
 * entry object, the caller's own object it was built from, and something
 * nested inside either.
 *
 * "Never throws" is the other. A log that throws while recording a spin
 * turns a bad result into a broken game, so the last two tests hand it
 * exactly what a naive implementation dies on: a value that cannot be
 * serialised, and one whose fields cannot even be read.
 */
import { describe, expect, it } from 'vitest';
import type { PresentationStep } from '@energy8engine/contracts';
import { createSpinLog, DEFAULT_LIMIT, type SpinLogEntry } from '../src/index';

/**
 * Runs an edit that is SUPPOSED to fail, and swallows how it failed.
 *
 * The log's own copy is frozen now, so an assignment through what
 * `entries()` returns throws in strict mode instead of quietly doing
 * nothing. Which of those two happens is a detail of the mechanism; the
 * property is what the log holds AFTERWARDS, and that is asserted at every
 * call site below. Absorbing the throw here keeps each test measuring the
 * property rather than the implementation that currently keeps it — a
 * copy-on-read log, where the same edit is silently harmless, passes these
 * unchanged.
 */
function attemptToEdit(edit: () => void): void {
  try {
    edit();
  } catch {
    // Frozen. The assertion that follows is the one that matters.
  }
}

/** Stand-ins for a spin result and the plan that presented it — plain data, same as the real ones. */
const RESULT = {
  stage: 'base_game',
  win: 2,
  data: {
    grid: [
      [1, 2],
      [3, 4],
    ],
  },
};
const PLAN: PresentationStep[] = [
  {
    kind: 'spinTo',
    board: [
      [1, 2],
      [3, 4],
    ],
  },
  { kind: 'revealWins', total: 2, lines: [] },
];

describe('createSpinLog', () => {
  it('records a spin: what was asked, what came back, how it was presented', () => {
    const log = createSpinLog();
    log.append({ request: { bet: 1 }, result: RESULT, plan: PLAN });
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]).toMatchObject({ request: { bet: 1 }, result: RESULT, plan: PLAN });
  });

  it('entries are append-only — a returned entry cannot be edited into the log', () => {
    const log = createSpinLog();
    log.append({ request: {}, result: RESULT, plan: PLAN });
    attemptToEdit(() => {
      (log.entries()[0] as { request: unknown }).request = 'tampered';
    });
    expect(log.entries()[0].request).not.toBe('tampered');
  });

  /**
   * The same property one level down. Replacing a whole field is the
   * obvious way to tamper and the test above catches it; reaching THROUGH
   * a field is the one a fresh-array-of-the-same-objects implementation
   * still allows, and it edits the record just as thoroughly.
   */
  it('… and neither can something nested inside one', () => {
    const log = createSpinLog();
    log.append({ request: { bet: 1 }, result: RESULT, plan: PLAN });
    attemptToEdit(() => {
      (log.entries()[0].request as { bet: number }).bet = 999;
    });
    expect((log.entries()[0].request as { bet: number }).bet).toBe(1);
  });

  /**
   * The third direction, and the one that matters most in the running
   * game: the caller still holds the object it appended. `first-slot`'s
   * page hands over the very `SpinResult` it is about to present and keeps
   * using it afterwards — if the log stored that reference, the record
   * would be of whatever the object became, not of what came back.
   */
  it('… and neither can the caller, through the object it appended', () => {
    const log = createSpinLog();
    const result = { win: 1 };
    log.append({ request: {}, result, plan: [] });
    result.win = 999;
    expect((log.entries()[0].result as { win: number }).win).toBe(1);
  });

  it('keeps insertion order', () => {
    const log = createSpinLog();
    log.append({ request: { n: 1 }, result: RESULT, plan: [] });
    log.append({ request: { n: 2 }, result: RESULT, plan: [] });
    expect(log.entries().map((e) => (e.request as { n: number }).n)).toEqual([1, 2]);
  });

  it('never throws on a result it cannot serialise', () => {
    const log = createSpinLog();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => log.append({ request: {}, result: cyclic, plan: [] })).not.toThrow();
    expect(log.entries()).toHaveLength(1);
  });

  /**
   * The other half of "never throws", and a different failure: above, the
   * value is readable and uncopyable; here reading it is what blows up.
   * A guard around the copy alone misses this — the same distinction
   * `executePlan` already draws between a board whose METHOD throws and
   * one whose property LOOKUP does.
   */
  it('never throws on an entry whose fields cannot even be read', () => {
    const log = createSpinLog();
    const hostile = {
      request: { bet: 1 },
      plan: [],
      get result(): unknown {
        throw new Error('not readable');
      },
    } as unknown as SpinLogEntry;

    expect(() => log.append(hostile)).not.toThrow();
    // The spin still happened, so it is still one line in the log — the
    // unreadable field is what is missing, not the record of the spin.
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0].request).toEqual({ bet: 1 });
  });

  /**
   * The step vocabulary is open (task 7), so the plan a spin was presented
   * with can carry a kind the engine has no name for — `reel-step`'s own
   * `reelStep`, for one. A log typed against the closed `PresentationPlan`
   * could not hold the plan `first-slot` actually runs; this is the
   * compile-time half of that, and it is why `SpinLogEntry.plan` is
   * `PresentationStep[]`.
   */
  it('records a plan carrying a step the engine has no name for', () => {
    const log = createSpinLog();
    const plan: PresentationStep[] = [
      { kind: 'spinTo', board: [[1]] },
      { kind: 'reelStep', shifts: [1, 0], settled: [[2]] },
    ];
    log.append({ request: {}, result: RESULT, plan });
    expect(log.entries()[0].plan.map((step) => step.kind)).toEqual(['spinTo', 'reelStep']);
  });
});

/**
 * The bound, and what it costs.
 *
 * The log lives in memory for the life of the page and had no cap: a
 * session left spinning grew it until the tab did. A cap alone is not
 * enough to be honest about, though — a panel rendering "the log" while
 * the log has silently forgotten the first hour is a panel that lies, so
 * what was dropped is counted and readable.
 */
describe('createSpinLog — the bound', () => {
  function append(log: ReturnType<typeof createSpinLog>, n: number): void {
    for (let i = 0; i < n; i++) log.append({ request: { n: i }, result: RESULT, plan: [] });
  }
  const nth = (log: ReturnType<typeof createSpinLog>) =>
    log.entries().map((e) => (e.request as { n: number }).n);

  it('keeps the most recent spins and drops the oldest', () => {
    const log = createSpinLog({ limit: 3 });
    append(log, 5);
    expect(nth(log)).toEqual([2, 3, 4]);
  });

  it('says how many it dropped, and says zero while it still fits', () => {
    const log = createSpinLog({ limit: 3 });
    append(log, 3);
    expect(log.dropped()).toBe(0);
    append(log, 2);
    expect(log.dropped()).toBe(2);
    // Cumulative and idempotent — reading it is not a reset.
    expect(log.dropped()).toBe(2);
  });

  it('applies the default when no limit is given', () => {
    const log = createSpinLog();
    append(log, DEFAULT_LIMIT + 2);
    expect(log.entries()).toHaveLength(DEFAULT_LIMIT);
    expect(log.dropped()).toBe(2);
  });

  it('treats a nonsense limit as the default rather than throwing or keeping nothing', () => {
    for (const limit of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const log = createSpinLog({ limit });
      append(log, 3);
      expect(log.entries(), `limit ${limit}`).toHaveLength(3);
    }
  });
});

/**
 * Reading used to `structuredClone` every field of every entry on every
 * call, so a panel polling an N-entry log N times did N² clones. The copy
 * that keeps a reader out of the record is now made once, on the way in.
 *
 * Object identity is the honest measurement of that: if two successive
 * reads hand back the SAME entry object, no copy was made between them.
 * The tests above already hold that this costs the log nothing — they are
 * the ones that would fail if identity were bought by handing out the
 * record itself, unfrozen.
 */
describe('createSpinLog — reading does not re-copy the log', () => {
  it('hands back the same entry object on every read', () => {
    const log = createSpinLog();
    log.append({ request: { bet: 1 }, result: RESULT, plan: PLAN });
    expect(log.entries()[0]).toBe(log.entries()[0]);
  });

  it('but a fresh array, so a reader cannot splice the log', () => {
    const log = createSpinLog();
    log.append({ request: {}, result: RESULT, plan: [] });
    const taken = log.entries() as SpinLogEntry[];
    taken.length = 0;
    expect(log.entries()).toHaveLength(1);
  });

  /**
   * The escape hatch, and the reason it exists. `Object.freeze` seals an
   * object's PROPERTIES; a frozen `Map` still takes `set`, a frozen `Date`
   * still takes `setTime`. An entry holding one of those cannot be made
   * immutable by freezing, so it keeps the old copy-on-read path — which
   * is slower and completely safe, and is exactly the trade this log
   * should make for an input it did not expect.
   *
   * Nothing in this repo produces such an entry (a spin result arrives
   * through `res.json()`, a plan is built by a mechanic — both plain
   * data), which is precisely why it is worth a test: the fallback has no
   * other way to be exercised.
   */
  it('falls back to copying for an entry freezing cannot make immutable', () => {
    const log = createSpinLog();
    log.append({ request: { seen: new Map([['a', 1]]) }, result: RESULT, plan: [] });

    // Not the same object twice — this one is copied per read.
    expect(log.entries()[0]).not.toBe(log.entries()[0]);

    // And the property still holds, which is the whole point of the
    // fallback: the Map inside the record cannot be reached and changed.
    attemptToEdit(() => {
      (log.entries()[0].request as { seen: Map<string, number> }).seen.set('a', 999);
    });
    expect((log.entries()[0].request as { seen: Map<string, number> }).seen.get('a')).toBe(1);
  });
});
