import { describe, expect, it } from 'vitest';
import { evaluate, evaluateValue, readPath } from '../src/expr';

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

  it('readPath indexes a numeric segment into an array', () =>
    expect(readPath('$a.0', { a: ['x'] })).toBe('x'));

  it('readPath reads a non-array object the same as before — `$a.b` is unchanged', () =>
    expect(readPath('$a.b', { a: { b: 'y' } })).toBe('y'));
});

describe('evaluateValue', () => {
  const v = {
    result: { win: 12.5, winAmount: 4.604, data: { cascades: [{ step_win: 3 }], fs_total: 10, fs_remaining: 4, mult_running: 48 } },
    session: { currency: { code: 'USD', symbol: '$', decimals: 2, position: 'left' } },
  };
  it.each<[string, unknown]>([
    ['$result.data.fs_total - $result.data.fs_remaining', 6],
    ['$result.win * 2 + 1', 26],
    ['($result.win + 1) * 2', 27],
    ['-$result.win', -12.5],
    ['10 / 4', 2.5],
    ['1 + 2 * 3', 7],
    ['$result.data.cascades.0.step_win', 3],
    ['$result.win - 2 > 10', true],
    ["$result.win + 'x'", NaN],
    ['$missing + 1', NaN],
  ])('%s → %s', (expr, out) => {
    const got = evaluateValue(expr, v);
    Number.isNaN(out as number) ? expect(got).toBeNaN() : expect(got).toBe(out);
  });
  it.each<[string, string]>([
    ['$result.winAmount | currency', '$4.60'],
    ['$result.winAmount | fixed:1', '4.6'],
    ['$result.winAmount | int', '5'],
    ['$result.data.mult_running | multiplier', 'x48'],
    ['2.5 | multiplier', 'x2.5'],
    ['$result.win || 0 | int', '13'],
  ])('%s → %s', (expr, out) => expect(evaluateValue(expr, v)).toBe(out));
  it('currency follows position: right puts the symbol after a space', () => {
    const right = { ...v, session: { currency: { code: 'EUR', symbol: '€', decimals: 2, position: 'right' } } };
    expect(evaluateValue('$result.winAmount | currency', right)).toBe('4.60 €');
  });
  it('currency with no session root is toFixed(2), no symbol', () =>
    expect(evaluateValue('$result.winAmount | currency', { result: v.result })).toBe('4.60'));
  it('an unknown format is a SyntaxError naming it', () =>
    expect(() => evaluateValue('1 | bogus', v)).toThrow(/unknown format 'bogus'/));
  it('evaluate is Boolean(evaluateValue): arithmetic reaches if', () =>
    expect(evaluate('$result.data.fs_total - $result.data.fs_remaining > 5', v)).toBe(true));
});
