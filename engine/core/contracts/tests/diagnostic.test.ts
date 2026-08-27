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
});
