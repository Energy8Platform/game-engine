import { describe, expect, it, vi } from 'vitest';
import { resolveValue } from '../src/value';

const vars = { result: { win: 12.5, winAmount: 4.6, data: { mult_running: 48, fs_total: 10, fs_remaining: 4 } }, session: { currency: { symbol: '$', decimals: 2, position: 'left' } } };

describe('resolveValue', () => {
  it('a bare $path is the typed value, as before', () => expect(resolveValue('$result.win', vars)).toBe(12.5));
  it('a $expression computes', () => expect(resolveValue('$result.data.fs_total - $result.data.fs_remaining', vars)).toBe(6));
  it('a template joins literal text and {expr}s into a string', () => {
    expect(resolveValue('x{$result.data.mult_running}', vars)).toBe('x48');
    expect(resolveValue('{$result.data.fs_total - $result.data.fs_remaining}/{$result.data.fs_total}', vars)).toBe('6/10');
    expect(resolveValue('{$result.winAmount | currency} won', vars)).toBe('$4.60 won');
  });
  it('a literal (no $, no braces) and a non-string pass through', () => {
    expect(resolveValue('tapped', vars)).toBe('tapped');
    expect(resolveValue(3, vars)).toBe(3);
    expect(resolveValue({ a: 1 }, vars)).toEqual({ a: 1 });
  });
  it('a syntax error or an unknown format reports and leaves the string as written', () => {
    const report = vi.fn();
    expect(resolveValue('{$result.win +}', vars, report)).toBe('{$result.win +}');
    expect(resolveValue('$result.win | bogus', vars, report)).toBe('$result.win | bogus');
    expect(resolveValue('{', vars, report)).toBe('{');
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1][0]).toMatch(/unknown format 'bogus'/);
  });
  it('a missing var in a template reads as an empty string, not "null"', () =>
    expect(resolveValue('[{$nothing}]', vars)).toBe('[]'));
});
