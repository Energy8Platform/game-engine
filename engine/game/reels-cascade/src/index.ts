/**
 * `reels-cascade`: the `cascade1` row — registers the `tumble` board controller and the
 * `reelStep` step handler. See `./runtime`.
 */
export { name, apply } from './runtime';
export type { CascadeRowConfig } from './runtime';
export { Config } from './schema';
export { createReelStepHandler } from './reelStep';
export type { ReelStepStep } from './reelStep';
