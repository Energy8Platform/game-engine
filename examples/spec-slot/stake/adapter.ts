import { createGameAdapter } from '@energy8platform/stake-kit';
import { model } from '../game.spec';
import { spinSchema, type SpinData } from './schema';

export const adapter = createGameAdapter<SpinData>({
  model,
  schema: spinSchema,
  segmentOf: ({ event, payload, round }) => {
    const isFs = (event as { stage?: string }).stage === 'free_spins';
    const core: import('@energy8platform/stake-kit').SegmentCore<SpinData> = {
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
