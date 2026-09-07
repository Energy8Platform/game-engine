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
import { createSpinLog, type SpinLogEntry } from '../src/index';

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
    (log.entries()[0] as { request: unknown }).request = 'tampered';
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
    (log.entries()[0].request as { bet: number }).bet = 999;
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
