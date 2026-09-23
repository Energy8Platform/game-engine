import { describe, expect, it, vi } from 'vitest';
import { evaluate, evaluateValue, formatValue, readPath, resolveValue } from '../src/expression';

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
    n: 1,
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
    // Regression: a bare `-` right after a number token (not part of the
    // number itself — the tokenizer's digit scan stops at it).
    ['1-2', -1],
    // Regression: unary `-` right after a binary `*`, no space.
    ['$result.win * -2', -25],
    // `&&` returns the right operand (not a boolean) when the left is truthy.
    ['$result.win && $result.winAmount', 4.604],
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
    // A missing value formats as NaN (num() propagates it), not `0`.
    ['$missing | currency', '$NaN'],
    ['$missing | int', 'NaN'],
    // Regression: a format arg can itself be a `$path`, not just a literal.
    ['$result.winAmount | fixed:$n', '4.6'],
    // Regression: pipes chain — `int`'s string output feeds `fixed`.
    ['$result.win | int | fixed:1', '13.0'],
  ])('%s → %s', (expr, out) => expect(evaluateValue(expr, v)).toBe(out));
  it('currency follows position: right puts the symbol after a space', () => {
    const right = { ...v, session: { currency: { code: 'EUR', symbol: '€', decimals: 2, position: 'right' } } };
    expect(evaluateValue('$result.winAmount | currency', right)).toBe('4.60 €');
  });
  it('currency with no session root is toFixed(2), no symbol', () =>
    expect(evaluateValue('$result.winAmount | currency', { result: v.result })).toBe('4.60'));
  it('an unknown format is a SyntaxError naming it', () =>
    expect(() => evaluateValue('1 | bogus', v)).toThrow(/unknown format 'bogus'/));
  it('a pipe cannot appear inside a parenthesised group — it only binds at the very top', () =>
    expect(() => evaluateValue('($result.win | int)', v)).toThrow(SyntaxError));
  it('evaluate is Boolean(evaluateValue): arithmetic reaches if', () =>
    expect(evaluate('$result.data.fs_total - $result.data.fs_remaining > 5', v)).toBe(true));
});

/**
 * The pipe formats, reachable on their own: `count` (`@energy8engine/flow-fx`)
 * formats every tick of a count-up with the SAME code the `| currency` pipe
 * runs, rather than a second implementation of "what a number looks like".
 */
describe('formatValue', () => {
  const vars = { session: { currency: { symbol: '$', decimals: 2, position: 'left' } } };
  it.each<[string, unknown, unknown, string]>([
    ['currency', 4.604, undefined, '$4.60'],
    ['int', 4.604, undefined, '5'],
    ['fixed', 4.604, 1, '4.6'],
    ['multiplier', 2.5, undefined, 'x2.5'],
  ])('%s of %s → %s', (name, value, arg, out) => expect(formatValue(name, value, arg, vars)).toBe(out));

  it('currency with no $session.currency is toFixed(2), no symbol', () =>
    expect(formatValue('currency', 4.604, undefined, {})).toBe('4.60'));

  it('an unknown format is a SyntaxError naming it', () =>
    expect(() => formatValue('bogus', 1, undefined, {})).toThrow(/unknown format 'bogus'/));

  it('the pipe still appends the position the parser knows', () =>
    expect(() => evaluateValue('1 | bogus', {})).toThrow(/unknown format 'bogus' at position 4/));
});

const resolveVars = { result: { win: 12.5, winAmount: 4.6, data: { mult_running: 48, fs_total: 10, fs_remaining: 4 } }, session: { currency: { symbol: '$', decimals: 2, position: 'left' } } };

describe('resolveValue', () => {
  it('a bare $path is the typed value, as before', () => expect(resolveValue('$result.win', resolveVars)).toBe(12.5));
  it('a $expression computes', () => expect(resolveValue('$result.data.fs_total - $result.data.fs_remaining', resolveVars)).toBe(6));
  it('a template joins literal text and {expr}s into a string', () => {
    expect(resolveValue('x{$result.data.mult_running}', resolveVars)).toBe('x48');
    expect(resolveValue('{$result.data.fs_total - $result.data.fs_remaining}/{$result.data.fs_total}', resolveVars)).toBe('6/10');
    expect(resolveValue('{$result.winAmount | currency} won', resolveVars)).toBe('$4.60 won');
  });
  it('a literal (no $, no braces) and a non-string pass through', () => {
    expect(resolveValue('tapped', resolveVars)).toBe('tapped');
    expect(resolveValue(3, resolveVars)).toBe(3);
    expect(resolveValue({ a: 1 }, resolveVars)).toEqual({ a: 1 });
  });
  it('a syntax error or an unknown format reports and leaves the string as written', () => {
    const report = vi.fn();
    expect(resolveValue('{$result.win +}', resolveVars, report)).toBe('{$result.win +}');
    expect(resolveValue('$result.win | bogus', resolveVars, report)).toBe('$result.win | bogus');
    expect(resolveValue('{', resolveVars, report)).toBe('{');
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1][0]).toMatch(/unknown format 'bogus'/);
  });
  it('a missing var in a template reads as an empty string, not "null"', () =>
    expect(resolveValue('[{$nothing}]', resolveVars)).toBe('[]'));
});
