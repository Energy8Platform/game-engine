import { createGameAdapter, type SegmentCore } from '@energy8platform/stake-kit';
import { model } from '../game.spec';
import { spinSchema, type SpinDataRaw } from '../schema';

export const adapter = createGameAdapter<SpinDataRaw>({
  model,
  schema: spinSchema,
  segmentOf: ({ event, payload, round }) => {
    const isFs = (event as { stage?: string }).stage === 'free_spins';
    const core: SegmentCore<SpinDataRaw> = {
      action: isFs ? 'free_spin' : round.triggerAction,
      winX: payload.total_win ?? 0,
      session: { roundId: round.roundId },
    };
    const awarded = payload.free_spins?.awarded ?? 0;
    if (!isFs && awarded > 0) {
      core.bonusFreeSpin = { grantId: 1, remainingSpins: awarded };
    }
    return core;
  },
});

export default adapter;
