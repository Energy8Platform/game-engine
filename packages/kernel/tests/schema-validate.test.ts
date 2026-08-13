import { describe, expect, it } from 'vitest';
import type { FieldSchema, Schema } from '@/schema/types';
import { defaultOf, validate } from '@/schema/validate';

const FEATURE: Schema = {
  enabled: { kind: 'boolean', default: true },
  priority: { kind: 'number', default: 0, min: 0, max: 100 },
  label: { kind: 'text', default: 'Wild' },
  direction: {
    kind: 'enum',
    default: 'vertical',
    options: [
      { value: 'vertical', label: 'Vertical' },
      { value: 'horizontal', label: 'Horizontal' },
    ],
  },
  texture: { kind: 'asset', accept: 'image' },
};

describe('validate', () => {
  it('fills every missing field from its default', () => {
    const { value, diagnostics } = validate({}, FEATURE);
    expect(value).toEqual({
      enabled: true,
      priority: 0,
      label: 'Wild',
      direction: 'vertical',
      texture: '',
    });
    expect(diagnostics).toEqual([]);
  });

  it('keeps values that are already valid', () => {
    const { value, diagnostics } = validate({ priority: 42, label: 'Sticky' }, FEATURE);
    expect(value.priority).toBe(42);
    expect(value.label).toBe('Sticky');
    expect(diagnostics).toEqual([]);
  });

  it('reports a type mismatch and falls back to the default', () => {
    const { value, diagnostics } = validate({ priority: 'high' }, FEATURE);
    expect(value.priority).toBe(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'schema/type-mismatch',
      path: 'priority',
    });
  });

  it('clamps a number outside its range and warns', () => {
    const { value, diagnostics } = validate({ priority: 500 }, FEATURE);
    expect(value.priority).toBe(100);
    expect(diagnostics[0]).toMatchObject({ severity: 'warning', code: 'schema/out-of-range' });
  });

  it('rejects an enum value outside its options', () => {
    const { value, diagnostics } = validate({ direction: 'diagonal' }, FEATURE);
    expect(value.direction).toBe('vertical');
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'schema/not-an-option' });
    expect(diagnostics[0].message).toContain('vertical, horizontal');
  });

  it('warns about an unknown field and drops it', () => {
    const { value, diagnostics } = validate({ nonsense: 1 }, FEATURE);
    expect(value).not.toHaveProperty('nonsense');
    expect(diagnostics[0]).toMatchObject({ severity: 'warning', code: 'schema/unknown-field' });
  });

  it('treats every domain string kind as a plain string', () => {
    const { value, diagnostics } = validate({ texture: 'symbols/wild.png' }, FEATURE);
    expect(value.texture).toBe('symbols/wild.png');
    expect(diagnostics).toEqual([]);
  });

  it('validates nested objects and prefixes the diagnostic path', () => {
    const schema: Schema = {
      motion: { kind: 'object', fields: { speed: { kind: 'number', default: 1 } } },
    };
    const { value, diagnostics } = validate({ motion: { speed: 'fast' } }, schema);
    expect(value).toEqual({ motion: { speed: 1 } });
    expect(diagnostics[0].path).toBe('motion.speed');
  });

  it('validates every item of a list and indexes the path', () => {
    const schema: Schema = { stops: { kind: 'list', of: { kind: 'number', default: 0 } } };
    const { value, diagnostics } = validate({ stops: [1, 'two', 3] }, schema);
    expect(value).toEqual({ stops: [1, 0, 3] });
    expect(diagnostics[0].path).toBe('stops[1]');
  });

  it('reports a non-object input instead of throwing', () => {
    const { value, diagnostics } = validate('not an object', FEATURE);
    expect(value.enabled).toBe(true);
    expect(diagnostics.some((d) => d.code === 'schema/not-an-object')).toBe(true);
  });
});

describe('defaultOf', () => {
  it('builds a default object from nested fields', () => {
    expect(defaultOf({ kind: 'object', fields: { a: { kind: 'number', default: 7 } } })).toEqual({ a: 7 });
  });

  it('falls back to the first option for an enum with no default', () => {
    expect(defaultOf({ kind: 'enum', options: [{ value: 'x', label: 'X' }] })).toBe('x');
  });
});

describe('defaults are never shared', () => {
  it('gives each caller its own copy of a list default containing objects', () => {
    const schema: Schema = {
      stops: { kind: 'list', of: { kind: 'object', fields: { a: { kind: 'number', default: 1 } } }, default: [{ a: 1 }] },
    };
    const first = validate({}, schema);
    const second = validate({}, schema);
    (first.value.stops as { a: number }[])[0].a = 999;
    expect((second.value.stops as { a: number }[])[0].a).toBe(1);
    expect((schema.stops as { default: { a: number }[] }).default[0].a).toBe(1);
  });

  it('gives each caller its own copy of a nested list default', () => {
    const schema: Schema = {
      grid: { kind: 'list', of: { kind: 'list', of: { kind: 'number', default: 0 } }, default: [[1, 2]] },
    };
    const first = validate({}, schema);
    (first.value.grid as number[][])[0].push(3);
    expect((validate({}, schema).value.grid as number[][])[0]).toEqual([1, 2]);
  });
});

describe('schema depth', () => {
  it('reports a cyclic schema instead of overflowing the stack', () => {
    const cyclic = { kind: 'object', fields: {} } as unknown as FieldSchema & { fields: Schema };
    cyclic.fields.child = cyclic;
    expect(() => defaultOf(cyclic)).not.toThrow();
    const { diagnostics } = validate({ root: {} }, { root: cyclic });
    expect(diagnostics.some((d) => d.code === 'schema/too-deep')).toBe(true);
  });
});
