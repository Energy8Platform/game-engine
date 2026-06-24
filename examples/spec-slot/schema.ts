import { z } from 'zod';

/** The inner Lua "data" table script.logic.lua returns (the engine nests it under result.data).
 * Array fields MUST stay z.array(...) so deriveArrayFields/coerceLuaArrays turns Lua {} into []. */
export const spinSchema = z.object({
  total_win: z.number().optional(),
  cascades: z.array(z.object({}).passthrough()).optional(),
  multiplier: z.number().optional(),
  free_spins: z.object({ awarded: z.number(), total: z.number() }).optional(),
});
export type SpinDataRaw = z.infer<typeof spinSchema>;
