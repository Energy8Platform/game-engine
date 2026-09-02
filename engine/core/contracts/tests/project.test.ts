import { describe, expect, it } from 'vitest';
import { isResolvedRow, type Profile, type ResolvedComposition } from '../src/project';

describe('project vocabulary', () => {
  it('a resolved row remembers which layer put it there', () => {
    const row = { id: 'reels1', name: '@energy8engine/reels', config: { grid: {} }, from: 'bundle:e8-base' };
    expect(isResolvedRow(row)).toBe(true);
  });

  it('a row without provenance is not a resolved row', () => {
    expect(isResolvedRow({ id: 'reels1', name: '@energy8engine/reels', config: {} })).toBe(false);
  });

  it('rejects a row whose id is not a string', () => {
    expect(isResolvedRow({ id: 1, name: 'x', config: {}, from: 'patch' })).toBe(false);
  });
});
