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

  it('rejects a point whose phase is not one of runtime/build/editor', () => {
    const d = checkManifestShape(
      base({ points: { p: { phase: 'buildtime' as never, arity: 'many', schema: {}, doc: 'x' } } }),
    );
    expect(d).toEqual([
      expect.objectContaining({ severity: 'error', code: 'manifest/bad-phase', pointId: 'p' }),
    ]);
  });

  it('rejects a point with a capitalized or otherwise-wrong arity, distinctly from phase', () => {
    const d = checkManifestShape(
      base({ points: { p: { phase: 'runtime', arity: 'Many' as never, schema: {}, doc: 'x' } } }),
    );
    expect(d).toEqual([
      expect.objectContaining({ severity: 'error', code: 'manifest/bad-arity', pointId: 'p' }),
    ]);
  });

  it('rejects a point missing phase or arity entirely, the same as a wrong value', () => {
    const missingPhase = checkManifestShape(
      base({ points: { p: { arity: 'many', schema: {}, doc: 'x' } as never } }),
    );
    expect(missingPhase.some((d) => d.code === 'manifest/bad-phase' && d.pointId === 'p')).toBe(true);

    const missingArity = checkManifestShape(
      base({ points: { p: { phase: 'runtime', schema: {}, doc: 'x' } as never } }),
    );
    expect(missingArity.some((d) => d.code === 'manifest/bad-arity' && d.pointId === 'p')).toBe(true);
  });

  it('accepts every valid phase and every valid arity without complaint', () => {
    for (const phase of ['runtime', 'build', 'editor'] as const) {
      for (const arity of ['one', 'many'] as const) {
        const d = checkManifestShape(base({ points: { p: { phase, arity, schema: {}, doc: 'x' } } }));
        expect(d).toEqual([]);
      }
    }
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

  it('rejects a contribution with no create() function — missing, or not a function', () => {
    const missing = checkManifestShape(
      base({ contributes: { 'reel.feature': [{ id: 'wild', doc: 'x' } as never] } }),
    );
    expect(missing).toEqual([
      expect.objectContaining({ severity: 'error', code: 'manifest/bad-create', contributionId: 'wild' }),
    ]);

    const notAFunction = checkManifestShape(
      base({ contributes: { 'reel.feature': [{ id: 'wild', doc: 'x', create: 'nope' as never }] } }),
    );
    expect(notAFunction).toEqual([
      expect.objectContaining({ severity: 'error', code: 'manifest/bad-create', contributionId: 'wild' }),
    ]);
  });

  it('accepts a contribution whose create() is a real function', () => {
    const d = checkManifestShape(
      base({ contributes: { 'reel.feature': [{ id: 'wild', doc: 'x', create: async () => () => null }] } }),
    );
    expect(d).toEqual([]);
  });

  it('warns, rather than errors, when a point or a contribution schema declares a field named "enabled"', () => {
    const pointLevel = checkManifestShape(
      base({ points: { 'reel.feature': { phase: 'runtime', arity: 'many', schema: { enabled: { kind: 'boolean' } }, doc: 'x' } } }),
    );
    expect(pointLevel).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'manifest/enabled-collision', pointId: 'reel.feature' }),
    ]);

    const contributionLevel = checkManifestShape(
      base({
        points: { 'reel.feature': { phase: 'runtime', arity: 'many', schema: {}, doc: 'x' } },
        contributes: {
          'reel.feature': [
            { id: 'wild', doc: 'x', create: async () => () => null, schema: { enabled: { kind: 'boolean' } } },
          ],
        },
      }),
    );
    expect(contributionLevel).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'manifest/enabled-collision',
        pointId: 'reel.feature',
        contributionId: 'wild',
      }),
    ]);
  });

  it('does not warn about "enabled" nested inside an object field — only the top-level key collides', () => {
    const d = checkManifestShape(
      base({
        points: {
          p: {
            phase: 'runtime',
            arity: 'many',
            schema: { motion: { kind: 'object', fields: { enabled: { kind: 'boolean' } } } },
            doc: 'x',
          },
        },
      }),
    );
    expect(d.filter((x) => x.code === 'manifest/enabled-collision')).toEqual([]);
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
