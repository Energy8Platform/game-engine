import type { GameModel } from '@energy8platform/platform-core/game-spec';

/** Reverse the model's modeMap (Stake bet mode → SDK action key) for replay labelling/cost. */
export function resolveReplayBonusId(model: GameModel, stakeMode: string): string {
  for (const [action, mode] of Object.entries(model.modeMap)) {
    if (mode === stakeMode) return action;
  }
  return stakeMode;
}
