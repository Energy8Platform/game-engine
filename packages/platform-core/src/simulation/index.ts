// Node-only simulation runners.
//
// These import worker_threads / child_process / fs / os, which makes
// them unsuitable for browser bundles. Keep them in this dedicated
// sub-path so consumers who only need browser-safe Lua execution can
// pull from `/lua` (or the main entry) without dragging Node modules
// into their browser bundle.

export {
  NativeSimulationRunner,
  findNativeBinary,
  formatNativeResult,
} from './NativeSimulationRunner';
export type {
  NativeSimulationConfig,
  NativeSimulationResult,
  StageStats,
  DistributionBucket,
} from './NativeSimulationRunner';

export { ParallelSimulationRunner } from './ParallelSimulationRunner';
