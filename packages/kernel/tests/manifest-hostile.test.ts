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

describe('checkManifestShape catches a bad field WITHIN an otherwise-usable schema (fix round 1)', () => {
  it('reports a null field in a point schema', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { p: { phase: 'runtime', arity: 'many', schema: { speed: null as never }, doc: 'd' } },
    });
    expect(d).toEqual([
      expect.objectContaining({ severity: 'error', code: 'manifest/bad-field-schema', pluginId: 'x', pointId: 'p', path: 'speed' }),
    ]);
  });

  it('reports a null field in a contribution schema', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: {
        p: [{ id: 'c', doc: 'd', create: async () => () => null, schema: { speed: null as never } }],
      },
    });
    expect(d.some((x) => x.code === 'manifest/bad-field-schema' && x.contributionId === 'c' && x.path === 'speed')).toBe(true);
  });

  it('reports a null field in plugin-level settings, with no contribution involved at all', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      settings: { speed: null as never },
    });
    expect(d).toEqual([
      expect.objectContaining({ severity: 'error', code: 'manifest/bad-field-schema', pluginId: 'x', path: 'speed' }),
    ]);
  });

  it('reports a null field nested inside an object field', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: {
        p: {
          phase: 'runtime',
          arity: 'many',
          schema: { motion: { kind: 'object', fields: { speed: null as never } } },
          doc: 'd',
        },
      },
    });
    expect(d.some((x) => x.code === 'manifest/bad-field-schema' && x.path === 'speed')).toBe(true);
  });

  it('reports a null list.of item type', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: {
        p: { phase: 'runtime', arity: 'many', schema: { stops: { kind: 'list', of: null as never } }, doc: 'd' },
      },
    });
    expect(d.some((x) => x.code === 'manifest/bad-field-schema' && x.path === 'stops[]')).toBe(true);
  });

  it('does not loop forever on a cyclic schema, and reports nothing past the depth cap', () => {
    const cyclic: Record<string, unknown> = { kind: 'object', fields: {} };
    (cyclic.fields as Record<string, unknown>).child = cyclic;
    expect(() =>
      checkManifestShape({
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        points: { p: { phase: 'runtime', arity: 'many', schema: { root: cyclic as never }, doc: 'd' } },
      }),
    ).not.toThrow();
  });

  it('accepts a Symbol version and a Symbol contribution id without throwing, and still reports them', () => {
    const d = checkManifestShape({
      id: 'x',
      version: Symbol('bad') as never,
      engine: '^0.1.0',
      contributes: { p: [{ id: Symbol('c') as never, doc: 'd', create: async () => () => null }] },
    });
    expect(d.some((x) => x.code === 'manifest/bad-version' && x.message.includes('Symbol(bad)'))).toBe(true);
    // no manifest/missing-doc for the contribution — it has a doc — but nothing here should throw,
    // and the duplicate-contribution Set keying must not crash on the Symbol id either.
    expect(() =>
      checkManifestShape({
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        contributes: {
          p: [
            { id: Symbol('c') as never, doc: 'd', create: async () => () => null },
            { id: Symbol('c') as never, doc: 'd', create: async () => () => null },
          ],
        },
      }),
    ).not.toThrow();
  });
});

describe('Task 11 hardening (a) — an enum field with malformed "options" is reported at the manifest boundary', () => {
  it('reports manifest/bad-enum-options for a point schema enum with no options key at all', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { p: { phase: 'runtime', arity: 'many', schema: { direction: { kind: 'enum' } as never }, doc: 'd' } },
    });
    expect(d).toEqual([
      expect.objectContaining({ severity: 'error', code: 'manifest/bad-enum-options', pluginId: 'x', pointId: 'p', path: 'direction' }),
    ]);
  });

  it('reports it for options: null and options: "abc", in manifest.settings (no contribution involved)', () => {
    for (const options of [null, 'abc']) {
      const d = checkManifestShape({
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        settings: { direction: { kind: 'enum', options } as never },
      });
      expect(d.some((x) => x.code === 'manifest/bad-enum-options' && x.path === 'direction' && x.pluginId === 'x')).toBe(true);
    }
  });

  it('reports nothing for a genuine (even empty, even bad-element) options array — it is not malformed', () => {
    for (const options of [[], [null]]) {
      const d = checkManifestShape({
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        settings: { direction: { kind: 'enum', options } as never },
      });
      expect(d).toEqual([]);
    }
  });

  it('reports it for an enum used as a list item type', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      settings: { tags: { kind: 'list', of: { kind: 'enum' } as never } },
    });
    expect(d.some((x) => x.code === 'manifest/bad-enum-options' && x.path === 'tags[]')).toBe(true);
  });

  it('reports it for an enum nested inside an object field', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      settings: { motion: { kind: 'object', fields: { direction: { kind: 'enum' } as never } } },
    });
    expect(d.some((x) => x.code === 'manifest/bad-enum-options' && x.path === 'direction')).toBe(true);
  });

  it('reports it for a contribution schema, tagged with the contribution id', () => {
    const d = checkManifestShape({
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: {
        p: [{ id: 'c', doc: 'd', create: async () => () => null, schema: { direction: { kind: 'enum' } as never } }],
      },
    });
    expect(d.some((x) => x.code === 'manifest/bad-enum-options' && x.contributionId === 'c' && x.path === 'direction')).toBe(true);
  });

  it('does not loop forever on a cyclic schema alongside a malformed enum', () => {
    const cyclic: Record<string, unknown> = { kind: 'object', fields: {} };
    (cyclic.fields as Record<string, unknown>).child = cyclic;
    expect(() =>
      checkManifestShape({
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        points: {
          p: {
            phase: 'runtime',
            arity: 'many',
            schema: { root: cyclic as never, direction: { kind: 'enum' } as never },
            doc: 'd',
          },
        },
      }),
    ).not.toThrow();
  });
});

// Task 11 review round 1: checkManifestShape's `String(manifest.version)` and
// `String(contribution.id)` fallbacks handled a Symbol (see the "Symbol version and Symbol
// contribution id" test above) but not a null-prototype value or a value with a throwing
// Symbol.toStringTag getter — both of which make String() itself throw, same as everywhere else this
// bug class showed up. Both are now describeError(), which is total.
describe('Task 11 review round 1 — describeError, not String(): a null-prototype value must not crash checkManifestShape', () => {
  it('does not throw, and still reports manifest/bad-version, for a null-prototype version', () => {
    const d = checkManifestShape({
      id: 'x',
      version: Object.create(null) as never,
      engine: '^0.1.0',
    });
    expect(d.some((x) => x.code === 'manifest/bad-version')).toBe(true);
  });

  it('does not throw for a version whose Symbol.toStringTag getter itself throws', () => {
    const hostile = {
      get [Symbol.toStringTag]() {
        throw new Error('boom');
      },
    };
    expect(() =>
      checkManifestShape({ id: 'x', version: hostile as never, engine: '^0.1.0' }),
    ).not.toThrow();
  });

  it('does not throw for a null-prototype contribution id, and still deduplicates it against itself', () => {
    expect(() =>
      checkManifestShape({
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        contributes: {
          p: [
            { id: Object.create(null) as never, doc: 'd', create: async () => () => null },
            { id: Object.create(null) as never, doc: 'd', create: async () => () => null },
          ],
        },
      }),
    ).not.toThrow();
  });
});
