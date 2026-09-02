import { describe, expect, it } from 'vitest';
import type { Profile, ResolvedComposition, ResolvedRow } from '../src/project';

/**
 * `isResolvedRow` used to live here with three tests against it. It had no
 * non-test consumer — both real ones (the host serving `/api/composition`,
 * the IDE client reading it back) cast instead, because at both of those
 * points the value's provenance is already known. A guard nothing guards
 * with is a shape assertion the type system already makes.
 *
 * What is left is what this file can honestly check about a vocabulary
 * package: that the shapes compose the way the two sides agree they do.
 */
describe('project vocabulary', () => {
  it('a resolved composition is a list of rows, each remembering its layer', () => {
    const rows: ResolvedRow[] = [
      { id: 'boot1', name: '@energy8engine/boot', config: {}, from: 'bundle:e8-base' },
      { id: 'reels1', name: '@energy8engine/reels', config: { grid: {} }, from: 'patch' },
    ];
    const composition: ResolvedComposition = { rows };
    expect(composition.rows.map((row) => row.from)).toEqual(['bundle:e8-base', 'patch']);
  });

  it('a profile is the ordered list of bundles that stack', () => {
    const profile: Profile = { bundles: ['e8-base', 'acme-extras'] };
    expect(profile.bundles).toEqual(['e8-base', 'acme-extras']);
  });
});
