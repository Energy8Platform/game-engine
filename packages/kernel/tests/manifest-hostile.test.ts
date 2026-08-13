import { describe, expect, it } from 'vitest';
import { checkManifestShape } from '@/manifest/define';
import type { PluginManifest } from '@/manifest/types';

describe('checkManifestShape - hostile input (never throws)', () => {
  it('handles null manifest gracefully', () => {
    const result = checkManifestShape(null as any);
    expect(result).toBeInstanceOf(Array);
    expect(result[0]?.code).toBe('manifest/invalid');
  });

  it('handles empty object gracefully', () => {
    const result = checkManifestShape({} as any);
    expect(result).toBeInstanceOf(Array);
    expect(result.some((d) => d.code === 'manifest/missing-id')).toBe(true);
  });

  it('handles points set to null gracefully', () => {
    const result = checkManifestShape({
      id: 'test',
      version: '1.0.0',
      engine: '^0.1.0',
      points: null,
    } as any);
    expect(result).toBeInstanceOf(Array);
    // null points is treated as {} via nullish coalescing, so no error
  });

  it('handles contributes set to string gracefully', () => {
    const result = checkManifestShape({
      id: 'test',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: 'invalid',
    } as any);
    expect(result).toBeInstanceOf(Array);
    // string contributes is treated as {} via Object.entries
  });

  it('handles contribution list not array gracefully', () => {
    const result = checkManifestShape({
      id: 'test',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { p: {} },
    } as any);
    expect(result).toBeInstanceOf(Array);
    expect(result[0]?.code).toBe('manifest/bad-contributions');
  });

  it('handles id as a Symbol gracefully', () => {
    const result = checkManifestShape({
      id: Symbol('test'),
      version: '1.0.0',
      engine: '^0.1.0',
    } as any);
    expect(result).toBeInstanceOf(Array);
    // Symbol id is not a string, so it's treated as missing
    expect(result.some((d) => d.code === 'manifest/missing-id')).toBe(true);
  });

  it('does not throw on a null entry inside points, and keeps earlier diagnostics', () => {
    const d = checkManifestShape({
      id: '',
      version: 'nope',
      engine: '',
      points: { p: null as never },
    } as never);
    expect(d.length).toBeGreaterThanOrEqual(4);
    expect(d.some((x) => x.code === 'manifest/bad-point-schema' && x.pointId === 'p')).toBe(true);
  });

  it('does not throw on a null element inside a contributes array', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { p: [null] as never },
    } as never);
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x) => x.severity === 'error')).toBe(true);
  });

  it('does not throw on a string element inside a contributes array', () => {
    expect(() =>
      checkManifestShape({
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        contributes: { p: ['nope'] as never },
      } as never),
    ).not.toThrow();
  });

  it('rejects non-plain objects as a point schema', () => {
    for (const bad of [new Map(), new Set(), new Date(), [] as never]) {
      const d = checkManifestShape({
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        points: { p: { phase: 'runtime', arity: 'many', schema: bad as never, doc: 'x' } },
      });
      expect(d.some((x) => x.code === 'manifest/bad-point-schema')).toBe(true);
    }
  });

  it('accepts an empty and a null-prototype schema', () => {
    for (const ok of [{}, Object.create(null) as Record<string, never>]) {
      const d = checkManifestShape({
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        points: { p: { phase: 'runtime', arity: 'many', schema: ok, doc: 'x' } },
      });
      expect(d).toEqual([]);
    }
  });
});
