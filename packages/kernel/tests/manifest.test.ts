import { describe, expect, it } from 'vitest';
import { checkManifestShape, definePlugin } from '@/manifest/define';
import type { PluginManifest } from '@/manifest/types';

function base(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: '@e8/reel-system',
    version: '1.0.0',
    engine: '^0.1.0',
    ...over,
  };
}

describe('definePlugin', () => {
  it('returns the manifest unchanged', () => {
    const m = base();
    expect(definePlugin(m)).toBe(m);
  });
});

describe('checkManifestShape', () => {
  it('accepts a minimal valid manifest', () => {
    expect(checkManifestShape(base())).toEqual([]);
  });

  it('rejects an empty id', () => {
    const d = checkManifestShape(base({ id: '' }));
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/missing-id' });
  });

  it('rejects a version that is not semver', () => {
    const d = checkManifestShape(base({ version: 'latest' }));
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/bad-version' });
  });

  it('rejects a missing engine range', () => {
    const d = checkManifestShape(base({ engine: '' }));
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/missing-engine' });
  });

  it('rejects a point declared without documentation', () => {
    const d = checkManifestShape(
      base({ points: { 'reel.feature': { phase: 'runtime', arity: 'many', schema: {}, doc: '' } } }),
    );
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/missing-doc', pointId: 'reel.feature' });
  });

  it('rejects two contributions sharing an id within one point', () => {
    const d = checkManifestShape(
      base({
        contributes: {
          'reel.feature': [
            { id: 'wild', doc: 'A', create: async () => () => null },
            { id: 'wild', doc: 'B', create: async () => () => null },
          ],
        },
      }),
    );
    expect(d[0]).toMatchObject({
      severity: 'error',
      code: 'manifest/duplicate-contribution',
      contributionId: 'wild',
    });
  });

  it('rejects a contribution with no documentation', () => {
    const d = checkManifestShape(
      base({ contributes: { 'reel.feature': [{ id: 'wild', doc: '', create: async () => () => null }] } }),
    );
    expect(d[0]).toMatchObject({ severity: 'error', code: 'manifest/missing-doc', contributionId: 'wild' });
  });

  it('collects every problem rather than stopping at the first', () => {
    const d = checkManifestShape(base({ id: '', version: 'nope', engine: '' }));
    expect(d).toHaveLength(3);
  });

  it('rejects a point whose schema is missing or not an object', () => {
    const noSchema = checkManifestShape(
      base({ points: { 'p': { phase: 'runtime', arity: 'many', doc: 'x' } as never } }),
    );
    expect(noSchema[0]).toMatchObject({ severity: 'error', code: 'manifest/bad-point-schema', pointId: 'p' });

    const badSchema = checkManifestShape(
      base({ points: { 'p': { phase: 'runtime', arity: 'many', schema: [] as never, doc: 'x' } } }),
    );
    expect(badSchema[0]).toMatchObject({ severity: 'error', code: 'manifest/bad-point-schema' });

    const emptyIsFine = checkManifestShape(
      base({ points: { 'p': { phase: 'runtime', arity: 'many', schema: {}, doc: 'x' } } }),
    );
    expect(emptyIsFine).toEqual([]);
  });
});
