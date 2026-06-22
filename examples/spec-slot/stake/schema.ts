import { z } from 'zod';

export const spinSchema = z.object({
  total_win: z.number().optional(),
  free_spins_awarded: z.number().optional(),
  reels: z.array(z.array(z.string())),
});
export type SpinData = z.infer<typeof spinSchema>;
