import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@/diagnostics';
import type { FieldSchema, Schema } from '@/schema/types';
import { defaultOf, isPlainObject, validate } from '@/schema/validate';

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

describe('cloneValue safety', () => {
  it('does not throw on a circular value inside a default', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const field = { kind: 'list', of: { kind: 'text' }, default: [circular] } as FieldSchema;
    expect(() => defaultOf(field)).not.toThrow();
    expect(() => validate({}, { thing: field })).not.toThrow();
  });

  it('passes a non-plain object through instead of destroying it', () => {
    const when = new Date('2020-01-01T00:00:00.000Z');
    const field = { kind: 'list', of: { kind: 'text' }, default: [when] } as FieldSchema;
    const [copied] = defaultOf(field) as Date[];
    expect(copied).toBeInstanceOf(Date);
    expect(copied.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  it('still gives each caller its own copy of plain nested data', () => {
    const schema: Schema = {
      stops: { kind: 'list', of: { kind: 'object', fields: { a: { kind: 'number', default: 1 } } }, default: [{ a: 1 }] },
    };
    const first = validate({}, schema);
    (first.value.stops as { a: number }[])[0].a = 999;
    expect((validate({}, schema).value.stops as { a: number }[])[0].a).toBe(1);
  });
});

describe('a non-object schema field never throws (fix round 1: was TypeError reading .kind)', () => {
  it('defaultOf(null) returns a safe value instead of throwing', () => {
    expect(() => defaultOf(null as unknown as FieldSchema)).not.toThrow();
    expect(defaultOf(null as unknown as FieldSchema)).toBe('');
  });

  it('defaultOf(undefined) returns a safe value instead of throwing', () => {
    expect(() => defaultOf(undefined as unknown as FieldSchema)).not.toThrow();
    expect(defaultOf(undefined as unknown as FieldSchema)).toBe('');
  });

  it('defaultOf reports schema/bad-field when given a diagnostics sink and a path', () => {
    const diagnostics: Diagnostic[] = [];
    defaultOf(null as unknown as FieldSchema, 0, diagnostics, 'speed');
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'schema/bad-field', path: 'speed' });
  });

  it('validate() reports schema/bad-field, not a throw, for a null field with a value supplied', () => {
    expect(() => validate({ speed: 1 }, { speed: null as unknown as FieldSchema })).not.toThrow();
    const { value, diagnostics } = validate({ speed: 1 }, { speed: null as unknown as FieldSchema });
    expect(value.speed).toBe('');
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'schema/bad-field', path: 'speed' });
  });

  it('validate() reports schema/bad-field for a null field with no value supplied either', () => {
    const { value, diagnostics } = validate({}, { speed: null as unknown as FieldSchema });
    expect(value.speed).toBe('');
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'schema/bad-field', path: 'speed' });
  });

  it('does not throw for a field that is a string, an array, or an object with no kind', () => {
    for (const bad of ['garbage', [1, 2, 3], {}, { notKind: 1 }] as unknown as FieldSchema[]) {
      expect(() => validate({ x: 1 }, { x: bad })).not.toThrow();
      expect(validate({ x: 1 }, { x: bad }).diagnostics.some((d) => d.code === 'schema/bad-field')).toBe(true);
    }
  });

  it('catches a null field nested inside an object field (fix round 1 case: nested in object.fields)', () => {
    const schema: Schema = { motion: { kind: 'object', fields: { speed: null as unknown as FieldSchema } } };
    expect(() => validate({ motion: { speed: 1 } }, schema)).not.toThrow();
    const { value, diagnostics } = validate({ motion: { speed: 1 } }, schema);
    expect(value).toEqual({ motion: { speed: '' } });
    expect(diagnostics.some((d) => d.code === 'schema/bad-field' && d.path === 'motion.speed')).toBe(true);
  });

  it('catches a null field.fields itself, not only a null field nested inside it', () => {
    const schema: Schema = { motion: { kind: 'object', fields: null as unknown as Schema } };
    expect(() => validate({ motion: { speed: 1 } }, schema)).not.toThrow();
    expect(() => defaultOf(schema.motion)).not.toThrow();
    expect(validate({}, schema).value).toEqual({ motion: {} });
  });

  it('catches a null list.of once a value is supplied for that list (fix round 1 case)', () => {
    const schema: Schema = { stops: { kind: 'list', of: null as unknown as FieldSchema } };
    expect(() => validate({ stops: [1, 2] }, schema)).not.toThrow();
    const { value, diagnostics } = validate({ stops: [1, 2] }, schema);
    expect(value.stops).toEqual(['', '']);
    expect(diagnostics.filter((d) => d.code === 'schema/bad-field')).toHaveLength(2);
  });

  it('a null list.of does not itself throw when no value is supplied (defaultOf never reads .of)', () => {
    const schema: Schema = { stops: { kind: 'list', of: null as unknown as FieldSchema } };
    expect(() => validate({}, schema)).not.toThrow();
    expect(validate({}, schema).value.stops).toEqual([]);
  });
});

// Task 11 hardening (a): an `enum` field with malformed `options` throws in the pre-fix source —
// `defaultOf` did `field.options[0]?.value` (throws for `undefined`/`null`, since indexing happens
// before the `?.`) and `validateField` did `field.options.map(...)` (throws for `undefined`, `null`,
// a string, and — one level deeper — for `[null]`, since `.map` succeeds but `null.value` does not).
// Reachable from a plain typo (`option:` for `options:`) in any point schema, contribution schema,
// or `manifest.settings`. Confirmed against the pre-fix source, not assumed.
describe('an enum field with malformed options never throws (Task 11 hardening a)', () => {
  const malformedShapes: Array<[string, unknown]> = [
    ['no options key at all', undefined],
    ['options: null', null],
    ["options: 'abc'", 'abc'],
    ['options: []', []],
    ['options: [null]', [null]],
  ];

  describe('defaultOf', () => {
    for (const [label, options] of malformedShapes) {
      it(`does not throw and returns '' for ${label}`, () => {
        const field = { kind: 'enum', options } as unknown as FieldSchema;
        expect(() => defaultOf(field)).not.toThrow();
        expect(defaultOf(field)).toBe('');
      });
    }

    it('reports schema/bad-enum-options, given a sink, when options is not an array at all', () => {
      for (const options of [undefined, null, 'abc']) {
        const diagnostics: Diagnostic[] = [];
        const field = { kind: 'enum', options } as unknown as FieldSchema;
        defaultOf(field, 0, diagnostics, 'direction');
        expect(diagnostics).toEqual([
          expect.objectContaining({ severity: 'error', code: 'schema/bad-enum-options', path: 'direction' }),
        ]);
      }
    });

    it('reports nothing for a genuine (even empty, even bad-element) options array — it is not malformed', () => {
      for (const options of [[], [null]]) {
        const diagnostics: Diagnostic[] = [];
        defaultOf({ kind: 'enum', options } as unknown as FieldSchema, 0, diagnostics, 'direction');
        expect(diagnostics).toEqual([]);
      }
    });
  });

  describe('validate', () => {
    for (const [label, options] of malformedShapes) {
      it(`does not throw validating a supplied value against ${label}`, () => {
        const schema: Schema = { direction: { kind: 'enum', options } as unknown as FieldSchema };
        expect(() => validate({ direction: 'vertical' }, schema)).not.toThrow();
        const { value, diagnostics } = validate({ direction: 'vertical' }, schema);
        expect(value.direction).toBe(''); // nothing can match a broken/empty option set
        expect(diagnostics.length).toBeGreaterThan(0);
      });

      it(`does not throw defaulting ${label} when no value is supplied`, () => {
        const schema: Schema = { direction: { kind: 'enum', options } as unknown as FieldSchema };
        expect(() => validate({}, schema)).not.toThrow();
        expect(validate({}, schema).value.direction).toBe('');
      });
    }

    it('reports schema/bad-enum-options exactly once — the defaultOf() fallback must not duplicate it', () => {
      const schema: Schema = { direction: { kind: 'enum' } as unknown as FieldSchema };
      const { diagnostics } = validate({ direction: 'vertical' }, schema);
      expect(diagnostics.filter((d) => d.code === 'schema/bad-enum-options')).toHaveLength(1);
    });

    it('drops an unusable element from an options array instead of throwing, and still validates the good ones', () => {
      const schema: Schema = {
        direction: { kind: 'enum', options: [null, { value: 'vertical', label: 'Vertical' }] } as unknown as FieldSchema,
      };
      expect(() => validate({ direction: 'vertical' }, schema)).not.toThrow();
      expect(validate({ direction: 'vertical' }, schema).value.direction).toBe('vertical');
      expect(validate({ direction: 'sideways' }, schema).diagnostics[0]).toMatchObject({ code: 'schema/not-an-option' });
    });

    it('is unaffected for a well-formed enum (no regression)', () => {
      const schema: Schema = {
        direction: {
          kind: 'enum',
          default: 'vertical',
          options: [
            { value: 'vertical', label: 'Vertical' },
            { value: 'horizontal', label: 'Horizontal' },
          ],
        },
      };
      expect(validate({ direction: 'horizontal' }, schema).value.direction).toBe('horizontal');
      expect(validate({ direction: 'horizontal' }, schema).diagnostics).toEqual([]);
      expect(validate({ direction: 'diagonal' }, schema).diagnostics[0]).toMatchObject({ code: 'schema/not-an-option' });
    });
  });
});

// Task 11 review round 1: `schema/not-an-option`'s message built `String(raw)` on the untrusted
// settings value being validated. `raw` reaches this from project.json — or, since `validate()` is
// itself a public export, from a hand-built input passed directly to it — so a null-prototype value
// or a value with a throwing Symbol.toStringTag getter reaches it exactly like everywhere else this
// bug class showed up. It is now describeError(), which is total.
describe('an enum field reports a not-an-option value that cannot be stringified, instead of throwing (Task 11 review round 1)', () => {
  const schema: Schema = {
    direction: {
      kind: 'enum',
      options: [{ value: 'vertical', label: 'Vertical' }],
    },
  };

  it('does not throw for a null-prototype settings value', () => {
    const raw = Object.create(null);
    expect(() => validate({ direction: raw }, schema)).not.toThrow();
    const { value, diagnostics } = validate({ direction: raw }, schema);
    expect(value.direction).toBe('vertical'); // falls back to the default
    expect(diagnostics[0]).toMatchObject({ code: 'schema/not-an-option' });
  });

  it('does not throw for a settings value whose Symbol.toStringTag getter itself throws', () => {
    const hostile = {
      get [Symbol.toStringTag]() {
        throw new Error('boom');
      },
    };
    expect(() => validate({ direction: hostile }, schema)).not.toThrow();
  });
});

// Task 11 review round 1 (Minor): `isPlainObject` reads `Object.getPrototypeOf(value)` unguarded, so
// a Proxy whose `getPrototypeOf` trap itself throws makes it throw — reachable through
// `resolvePlan -> checkManifestShape -> checkSchemaFields -> isUsableField -> isPlainObject`. This
// module is now a public export the README calls "the shared hostile-input guard"; a guard advertised
// by name should not itself be a throw site.
describe('isPlainObject does not throw on a Proxy that hides its own prototype (Task 11 review round 1)', () => {
  it('treats a Proxy with a throwing getPrototypeOf trap as not plain, rather than throwing', () => {
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('boom'); } });
    expect(() => isPlainObject(hostile)).not.toThrow();
    expect(isPlainObject(hostile)).toBe(false);
  });

  it('is unaffected for an ordinary plain object and an ordinary null-prototype object (no regression)', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});
