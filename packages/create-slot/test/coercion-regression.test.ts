import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { deriveArrayFields, coerceLuaArrays } from '@energy8platform/stake-kit';

describe('schema-driven Lua {} coercion (the normalize crash fix)', () => {
  const schema = z.object({ cascades: z.array(z.object({}).passthrough()).optional() });
  const fields = deriveArrayFields(schema);

  it('turns a nested empty Lua table {} into [] so .map never throws', () => {
    const out = coerceLuaArrays({ data: { cascades: {} } } as Record<string, unknown>, fields) as any;
    expect(out.data.cascades).toEqual([]);
    expect(() => out.data.cascades.map((x: unknown) => x)).not.toThrow();
  });

  it('passes a real array through unchanged', () => {
    const out = coerceLuaArrays({ data: { cascades: [{ a: 1 }] } } as Record<string, unknown>, fields) as any;
    expect(out.data.cascades).toEqual([{ a: 1 }]);
  });
});
