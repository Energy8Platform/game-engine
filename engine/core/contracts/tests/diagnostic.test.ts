import { describe, expect, it } from 'vitest';
import { diagnostic } from '../src/index';

describe('diagnostic', () => {
  it('builds a diagnostic with the given fields', () => {
    const d = diagnostic('error', 'probe-plugin', 'config.speed', 'speed must be a number');
    expect(d).toEqual({
      severity: 'error',
      plugin: 'probe-plugin',
      where: 'config.speed',
      message: 'speed must be a number',
    });
  });

  it('includes the fix hint when given', () => {
    const d = diagnostic('warning', 'p', 'w', 'm', 'set it to 8');
    expect(d.fix).toBe('set it to 8');
  });

  it('omits the fix key entirely when not given', () => {
    expect('fix' in diagnostic('info', 'p', 'w', 'm')).toBe(false);
  });

  it('has no `at` unless a producer attaches one', () => {
    // `at` is not a constructor argument — see `diagnostic.ts`'s doc comment
    // on why a sixth positional string would be worse than the problem it
    // solves. A producer that knows a position attaches it the same way
    // `fileDiagnostic` attaches `code`.
    expect('at' in diagnostic('error', 'p', 'w', 'm')).toBe(false);
  });
});
