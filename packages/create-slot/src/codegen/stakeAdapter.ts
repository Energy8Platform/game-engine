import type { Answers } from '../answers';

export function genStakeAdapter(a: Answers): { adapter: string; schema: string } {
  const cascade = a.cascades === true;
  const schema = `import { z } from 'zod';

export const spinSchema = z.object({
  total_win: z.number().optional(),
  free_spins_awarded: z.number().optional(),
  ${cascade ? 'cascades: z.array(z.object({})).optional(),' : 'matrix: z.array(z.array(z.number())).optional(),'}
});
export type SpinData = z.infer<typeof spinSchema>;
`;
  const adapter = `import { createGameAdapter, type SegmentCore } from '@energy8platform/stake-kit';
import { model } from '../game.spec';
import { spinSchema, type SpinData } from './schema';

export const adapter = createGameAdapter<SpinData>({
  model,
  schema: spinSchema,
  segmentOf: ({ event, payload, round }) => {
    const isFs = (event as { stage?: string }).stage === 'free_spins';
    const core: SegmentCore<SpinData> = {
      action: isFs ? 'free_spin' : round.triggerAction,
      winX: payload.total_win ?? 0,
      session: { roundId: round.roundId },
    };
    if (!isFs && (payload.free_spins_awarded ?? 0) > 0) {
      core.bonusFreeSpin = { grantId: 1, remainingSpins: payload.free_spins_awarded! };
    }
    return core;
  },
});

export default adapter;
`;
  return { adapter, schema };
}
