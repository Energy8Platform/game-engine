import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { deriveArrayFields } from '../src/schema';

describe('deriveArrayFields', () => {
  it('collects array field names at any depth, unwrapping optional/nullable', () => {
    const schema = z.object({
      total_win: z.number().optional(),
      cascades: z.array(
        z.object({
          wins: z.array(z.object({ positions: z.array(z.number()) })),
          meta: z.object({}).optional(),
        }),
      ),
      tags: z.array(z.string()).nullable(),
    });
    const fields = deriveArrayFields(schema);
    expect([...fields].sort()).toEqual(['cascades', 'positions', 'tags', 'wins']);
  });
  it('returns an empty set for a flat object with no arrays', () => {
    expect(deriveArrayFields(z.object({ a: z.number(), b: z.string() })).size).toBe(0);
  });
});
