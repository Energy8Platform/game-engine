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
