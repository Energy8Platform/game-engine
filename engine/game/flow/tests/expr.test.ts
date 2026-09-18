import { describe, expect, it } from 'vitest';
import { evaluate, readPath } from '../src/expr';

const vars = { result: { stage: 'free_spins', win: 12.5 }, ready: true, n: 0, s: 'x' };

describe('evaluate', () => {
  it.each([
    ["result.stage == 'free_spins'", true],
    ['result.stage != "base_game"', true],
    ['result.win >= 12.5', true],
    ['result.win > 12.5', false],
    ['n < 1 && ready', true],
    ['n < 1 && !ready', false],
    ['s == "y" || ready', true],
    ['!(ready && n == 0)', false],
    ['ready', true],
    ['n', false],
    ['missing', false],
    ['missing.deep == null', true],
    ['result.win == 12.5', true],
  ])('%s → %s', (expr, out) => expect(evaluate(expr, vars)).toBe(out));

  it('a bad expression throws a SyntaxError naming the position', () => {
    expect(() => evaluate('n ==', vars)).toThrow(SyntaxError);
    expect(() => evaluate('(n > 1', vars)).toThrow(/position/);
  });

  it('readPath accepts a leading $', () => expect(readPath('$result.stage', vars)).toBe('free_spins'));

  it('readPath returns the plain value for a path with no $', () =>
    expect(readPath('result.win', vars)).toBe(12.5));

  it('readPath returns null (not undefined) through a missing branch', () =>
    expect(readPath('missing.deep', vars)).toBeNull());
});
