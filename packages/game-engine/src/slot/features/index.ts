// packages/game-engine/src/slot/features/index.ts
import type { FeatureKey } from '../config/ReelSystemConfig';
import { FEATURE_KEYS } from '../config/ReelSystemConfig';
import type { ReelFeature } from './types';
import { ExpandingWild, StickySymbols, WalkingWild, RandomWild } from './wilds';
import {
  MysterySymbols,
  SymbolTransform,
  GiantSymbol,
  SplitSymbol,
  StackedSymbols,
} from './symbols';
import { MultiplierSymbols, NudgeReels, HoldAndSpin, ReelModifier } from './extra';

export * from './types';
export { ExpandingWild, StickySymbols, WalkingWild, RandomWild } from './wilds';
export {
  MysterySymbols,
  SymbolTransform,
  GiantSymbol,
  SplitSymbol,
  StackedSymbols,
} from './symbols';
export { MultiplierSymbols, NudgeReels, HoldAndSpin, ReelModifier } from './extra';

/** All feature modules keyed by their FeatureKey. */
export const FEATURES: Record<FeatureKey, ReelFeature> = {
  expandingWild: ExpandingWild,
  sticky: StickySymbols,
  walkingWild: WalkingWild,
  randomWild: RandomWild,
  mystery: MysterySymbols,
  transform: SymbolTransform,
  giant: GiantSymbol,
  split: SplitSymbol,
  stacked: StackedSymbols,
  multiplier: MultiplierSymbols,
  nudge: NudgeReels,
  holdAndSpin: HoldAndSpin,
  reelModifier: ReelModifier,
};

/** Features in canonical resolve order (see docs §3.4). */
export const FEATURE_LIST: ReelFeature[] = FEATURE_KEYS.map((k) => FEATURES[k]);
