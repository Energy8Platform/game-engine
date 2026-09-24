/**
 * `reels-features`: data-driven reel feature steps. Each kind is a play-loop `StepHandler` that
 * animates an outcome the mechanic put in its plan and re-seats the board where the data says —
 * see `./shared` for the shape they share and `./layer` for the overlays that outlive a run.
 * `./runtime` is the `features1` row that registers all nine into a composition.
 */
export { name, apply } from './runtime';
export type { FeaturesRowConfig } from './runtime';
export { Config } from './schema';
export { checkCells, createFeatureHandler, createPace, need, needLayer, reseat } from './shared';
export type { Cell, Change, Feature, FeatureDeps, FeatureRun, Pace, RefillBoard } from './shared';
export { createOverlayLayer } from './layer';
export type { OverlayLayer } from './layer';
export { createExpandWildHandler } from './handlers/expandWild';
export type { ExpandWildConfig, ExpandWildStep } from './handlers/expandWild';
export { createDropWildsHandler } from './handlers/dropWilds';
export type { DropWildsConfig, DropWildsStep } from './handlers/dropWilds';
export { createRevealHandler } from './handlers/reveal';
export type { RevealConfig, RevealStep } from './handlers/reveal';
export { createTransformHandler } from './handlers/transform';
export type { TransformConfig, TransformStep } from './handlers/transform';
export { createMultipliersHandler } from './handlers/multipliers';
export type { MultipliersConfig, MultipliersStep } from './handlers/multipliers';
export { createStickyHandler } from './handlers/sticky';
export type { StickyConfig, StickyStep } from './handlers/sticky';
export { createGiantHandler } from './handlers/giant';
export type { GiantConfig, GiantStep } from './handlers/giant';
export { createWalkWildHandler } from './handlers/walkWild';
export type { WalkWildConfig, WalkWildStep } from './handlers/walkWild';
export { createNudgeHandler } from './handlers/nudge';
export type { NudgeConfig, NudgeStep } from './handlers/nudge';
