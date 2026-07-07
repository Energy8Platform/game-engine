// Node-only simulation runners.
//
// These import worker_threads / child_process / fs / os, which makes
// them unsuitable for browser bundles. Keep them in this dedicated
// sub-path so consumers who only need browser-safe Lua execution can
// pull from `/lua` (or the main entry) without dragging Node modules
// into their browser bundle.

export {
  NativeSimulationRunner,
  formatNativeResult,
  buildNativeArgs,
  findE8Binary,
  requireE8Binary,
} from './NativeSimulationRunner';
export type {
  NativeSimulationConfig,
  NativeSimulationResult,
  NativeRNGKind,
  NativeReplayParams,
  StageStats,
  DistributionBucket,
  NativeArgsInput,
} from './NativeSimulationRunner';
