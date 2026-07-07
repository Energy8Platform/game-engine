import type { Answers } from '../answers';

/** Generate src/game/schema.ts: the zod schema for the inner Lua data table.
 * Array fields are plain z.array(...) so stake-kit's deriveArrayFields() finds them
 * and coerceLuaArrays() can turn Lua {} into [] (used by normalize AND the stake adapter). */
export function genSchema(a: Answers): string {
  const cascade = a.cascades === true;
  const arrayFields = cascade
    ? `    cascades: z.array(z.object({}).passthrough()).optional(),`
    : `    matrix: z.array(z.array(z.number())).optional(),
    wins: z.array(z.object({}).passthrough()).optional(),`;
  return `import { z } from 'zod';

/** The inner "data" value your script.spin returns (the engine nests it under result.data).
 * Edit these fields to match your math. Array fields MUST stay z.array(...) so Lua {} coerces to []. */
export const spinSchema = z.object({
  total_win: z.number().optional(),
${arrayFields}
  multiplier: z.number().optional(),
  free_spins: z.object({ awarded: z.number(), total: z.number() }).optional(),
});
export type SpinDataRaw = z.infer<typeof spinSchema>;
`;
}
