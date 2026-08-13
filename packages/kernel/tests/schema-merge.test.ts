import { describe, expect, it } from 'vitest';
import type { Schema } from '@/schema/types';
import { mergeSchemas } from '@/schema/merge';

const CTX = { pluginId: '@e8/reel-system', pointId: 'reel.feature', contributionId: 'expandingWild' };

const POINT: Schema = {
  enabled: { kind: 'boolean', default: true },
  priority: { kind: 'number', default: 0 },
};

describe('mergeSchemas', () => {
  it('returns the point schema when the contribution adds nothing', () => {
    const { schema, diagnostics } = mergeSchemas(POINT, undefined, CTX);
    expect(Object.keys(schema)).toEqual(['enabled', 'priority']);
    expect(diagnostics).toEqual([]);
  });

  it('adds the contribution fields after the point fields', () => {
    const own: Schema = { holdSpins: { kind: 'number', default: 3 } };
    const { schema, diagnostics } = mergeSchemas(POINT, own, CTX);
    expect(Object.keys(schema)).toEqual(['enabled', 'priority', 'holdSpins']);
    expect(diagnostics).toEqual([]);
  });

  it('refuses a contribution field that redefines a point field', () => {
    const own: Schema = { priority: { kind: 'text', default: 'high' } };
    const { schema, diagnostics } = mergeSchemas(POINT, own, CTX);
    expect(schema.priority).toEqual(POINT.priority);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'schema/field-conflict',
      pluginId: '@e8/reel-system',
      pointId: 'reel.feature',
      contributionId: 'expandingWild',
      path: 'priority',
    });
  });

  it('does not mutate either input', () => {
    const own: Schema = { holdSpins: { kind: 'number', default: 3 } };
    mergeSchemas(POINT, own, CTX);
    expect(Object.keys(POINT)).toEqual(['enabled', 'priority']);
    expect(Object.keys(own)).toEqual(['holdSpins']);
  });

  it('does not throw when the point schema is missing', () => {
    const own: Schema = { holdSpins: { kind: 'number', default: 3 } };
    expect(() => mergeSchemas(undefined as unknown as Schema, own, CTX)).not.toThrow();
    const { schema, diagnostics } = mergeSchemas(null as unknown as Schema, own, CTX);
    expect(Object.keys(schema)).toEqual(['holdSpins']);
    expect(diagnostics).toEqual([]);
  });

  it('does not mistake an inherited Object.prototype name for a point field', () => {
    const own: Schema = { toString: { kind: 'text', default: 'x' } };
    const { schema, diagnostics } = mergeSchemas(POINT, own, CTX);
    expect(diagnostics).toEqual([]);
    expect(schema.toString).toEqual(own.toString);
  });

  it('shares field objects with its inputs by design, and says so', () => {
    const own: Schema = { holdSpins: { kind: 'number', default: 3 } };
    const { schema } = mergeSchemas(POINT, own, CTX);
    // The record is fresh...
    expect(schema).not.toBe(POINT);
    // ...but the field objects are shared on purpose: schemas are immutable declarations.
    expect(schema.priority).toBe(POINT.priority);
    expect(schema.holdSpins).toBe(own.holdSpins);
  });
});
