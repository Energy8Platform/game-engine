import { describe, expect, it } from 'vitest';
import { checkShape } from '../src/index';

describe('checkShape', () => {
  it('passes when every required field is present with the right kind', () => {
    const req = { fields: { grid: 'grid', win: 'number' } } as const;
    expect(checkShape(req, { grid: [[1]], win: 0 }, 'classic', 'base_game')).toEqual([]);
  });

  it('names the mechanic, the stage and the missing field', () => {
    const req = { fields: { steps: 'list' } } as const;
    const [d] = checkShape(req, { grid: [[1]] }, 'cascade', 'base_game');
    expect(d.severity).toBe('error');
    expect(d.message).toContain('cascade');
    expect(d.message).toContain('base_game');
    expect(d.message).toContain('steps');
  });

  it('reports a field that exists with the wrong kind', () => {
    const req = { fields: { grid: 'grid' } } as const;
    const [d] = checkShape(req, { grid: 7 }, 'classic', 'base_game');
    expect(d.message).toContain('grid');
  });

  it('reports every mismatch, not just the first', () => {
    const req = { fields: { grid: 'grid', steps: 'list' } } as const;
    expect(checkShape(req, {}, 'cascade', 'base_game')).toHaveLength(2);
  });
});

describe('checkShape — the `list` kind', () => {
  it('accepts a non-empty array', () => {
    const req = { fields: { lines: 'list' } } as const;
    expect(checkShape(req, { lines: [1, 2] }, 'classic', 'base_game')).toEqual([]);
  });

  it('rejects a value that is not an array at all', () => {
    const req = { fields: { lines: 'list' } } as const;
    const [d] = checkShape(req, { lines: 'nope' }, 'classic', 'base_game');
    expect(d.message).toContain('lines');
  });

  it('accepts an empty array — a losing spin legitimately has no lines to show', () => {
    const req = { fields: { lines: 'list' } } as const;
    expect(checkShape(req, { lines: [] }, 'classic', 'base_game')).toEqual([]);
  });
});
