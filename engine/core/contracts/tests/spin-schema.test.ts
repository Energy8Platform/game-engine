import { describe, expect, it } from 'vitest';
import { isSpinSchema, type SpinSchema } from '../src/spin-schema';

const SCHEMA: SpinSchema = {
  gameId: 'first-slot',
  betLevels: [0.2, 1, 5],
  maxWin: 500,
  vars: { max_win_reached: { kind: 'bool' } },
  stages: {
    base_game: {
      grid: { kind: 'list', of: { kind: 'list', of: { kind: 'int' } } },
      base_win: { kind: 'float' },
      lines: { kind: 'list', of: { kind: 'record', name: 'LineWin' } },
    },
  },
  records: { LineWin: { line: { kind: 'int' }, win: { kind: 'float' } } },
  actions: [{ name: 'spin', stage: 'base_game', cost: 1 }],
};

describe('spin schema vocabulary', () => {
  it('accepts a schema with a stage and an action', () => {
    expect(isSpinSchema(SCHEMA)).toBe(true);
  });

  it('rejects one whose stages is not an object', () => {
    expect(isSpinSchema({ ...SCHEMA, stages: [] })).toBe(false);
  });

  it('rejects one with no gameId', () => {
    const { gameId: _drop, ...rest } = SCHEMA;
    expect(isSpinSchema(rest)).toBe(false);
  });

  it('an action naming a stage the schema does not declare is still a well-formed schema', () => {
    // Vocabulary, not policy: whether that is a MISTAKE is task 3's diagnostic
    // to make, not this type guard's. The guard says "is this the right shape",
    // never "is this a good game".
    expect(isSpinSchema({ ...SCHEMA, actions: [{ name: 'x', stage: 'nope', cost: 1 }] })).toBe(true);
  });
});

// A malformed field nested inside a stage's `RecordShape` — every recursive
// `FieldType` branch gets its own case, so a corrupt `of`/`length`/`name`
// buried inside a `list`/`array`/`record`/`optional` is actually rejected,
// not just accepted because the outer `kind` string looked right.
describe('spin schema vocabulary — FieldType shapes', () => {
  function withField(field: unknown): unknown {
    return { ...SCHEMA, stages: { base_game: { bad: field } } };
  }

  it('rejects a list whose element type is malformed', () => {
    expect(isSpinSchema(withField({ kind: 'list', of: { kind: 'nonsense' } }))).toBe(false);
  });

  it('rejects an array missing its length', () => {
    expect(isSpinSchema(withField({ kind: 'array', of: { kind: 'int' } }))).toBe(false);
  });

  it('rejects an array whose element type is malformed', () => {
    expect(isSpinSchema(withField({ kind: 'array', of: { kind: 'nonsense' }, length: 5 }))).toBe(false);
  });

  it('rejects a record reference missing its name', () => {
    expect(isSpinSchema(withField({ kind: 'record' }))).toBe(false);
  });

  it('rejects an optional whose inner type is malformed', () => {
    expect(isSpinSchema(withField({ kind: 'optional', of: { kind: 'nonsense' } }))).toBe(false);
  });

  it('rejects a field with an unknown kind', () => {
    expect(isSpinSchema(withField({ kind: 'nonsense' }))).toBe(false);
  });
});

// `ActionDef`'s own optional fields — each gets a rejection test, so a
// mutation that stops checking one (e.g. lets any `cost` through) shows up
// as a failure here instead of silently passing 38 green tests.
describe('spin schema vocabulary — ActionDef shape', () => {
  function withAction(action: unknown): unknown {
    return { ...SCHEMA, actions: [action] };
  }

  it('rejects a non-number cost', () => {
    expect(isSpinSchema(withAction({ name: 'spin', stage: 'base_game', cost: 'one' }))).toBe(false);
  });

  it('rejects a non-boolean session', () => {
    expect(
      isSpinSchema(withAction({ name: 'spin', stage: 'base_game', cost: 1, session: 'yes' })),
    ).toBe(false);
  });

  it('rejects opens given as a single object, not an array', () => {
    // The pre-fix shape (task 1's original vocabulary) — kitsune-wrath's
    // `spin` opens two actions from one `opens =`/`opens =` pair, so a
    // single object can no longer represent every real `.spin` file.
    expect(
      isSpinSchema(
        withAction({ name: 'spin', stage: 'base_game', cost: 1, opens: { action: 'free_spin', countVar: 'n' } }),
      ),
    ).toBe(false);
  });

  it('rejects an opens entry missing countVar', () => {
    expect(
      isSpinSchema(withAction({ name: 'spin', stage: 'base_game', cost: 1, opens: [{ action: 'free_spin' }] })),
    ).toBe(false);
  });

  it('rejects an opens entry whose "when" is not a string', () => {
    expect(
      isSpinSchema(
        withAction({
          name: 'spin',
          stage: 'base_game',
          cost: 1,
          opens: [{ action: 'free_spin', countVar: 'n', when: 7 }],
        }),
      ),
    ).toBe(false);
  });

  it('accepts multiple opens entries, one carrying a "when"', () => {
    expect(
      isSpinSchema(
        withAction({
          name: 'spin',
          stage: 'base_game',
          cost: 1,
          opens: [
            { action: 'free_spin', countVar: 'free_spins_awarded' },
            { action: 'spirit_gate', countVar: 'spirit_gate_open', when: 'spirit_gate_open == -1' },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('rejects a feature map with a non-number value', () => {
    expect(
      isSpinSchema(withAction({ name: 'spin', stage: 'base_game', cost: 1, feature: { buy: 'one' } })),
    ).toBe(false);
  });
});
