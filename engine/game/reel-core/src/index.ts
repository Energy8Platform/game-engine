// Forked from packages/game-engine/src/slot/index.ts (slice 35).
import { markModuleCopy } from '@energy8engine/contracts';

// Its classes cross the plugin boundary — a second copy is reported at boot (contracts' module-copies.ts).
markModuleCopy('@energy8engine/reel-core', import.meta.url);

export type { SymbolView, SymbolResolver } from './grid/SymbolView';
export { AnimatedSymbol } from './grid/AnimatedSymbol';
export { SymbolCell, DEFAULT_CELL_FRAME_STYLE, resolveFrameStyle } from './grid/SymbolCell';
export type { CellData, CellState, CellFrameStyle, CellFrameStateStyle, ResolvedCellFrameStyle } from './grid/SymbolCell';
export { ReelGrid } from './grid/ReelGrid';
export type { ReelGridConfig } from './grid/ReelGrid';
export { resolveGeometry, cellPositionOf } from './grid/geometry';
export { EASING_BY_NAME, easingByName } from './anim/easing-map';

// ── fx: animation primitives for feature presentations ─────────────────────
export {
  cellCenter,
  rowStepOf,
  colStepOf,
  glowRing,
  pulseCell,
  floatLabel,
  morphSymbol,
  dropCell,
  moveCell,
} from './fx';

// ── configurable reel system ────────────────────────────────────────────────
export {
  DEFAULT_REEL_CONFIG,
  INTENSITY_SCALE,
  resolveReelConfig,
  mergeReelConfig,
  effectiveRowsPerReel,
  resolveGridGeometry,
  waysCount,
  perReelValue,
} from './config/ReelSystemConfig';
export type {
  ReelSystemConfig,
  DeepPartial,
  EasingName,
  EvaluationMode,
  CellSizeSpec,
  ResolvedGeometry,
  GridConfig,
  MotionConfig,
  MotionStyleKey,
  StopMode,
  StopOrder,
  DropOrder,
  DropSequence,
  Intensity,
  SettleConfig,
  SquashConfig,
  BlurConfig,
  AnticipationConfig,
  AnticipationOverride,
  PerReel,
  CascadeConfig,
  WinConfig,
} from './config/ReelSystemConfig';

// ── motion / cascade controllers ────────────────────────────────────────────
export { SpinEngine } from './motion/SpinEngine';
export type { SpinData, SpinRunOpts, ReelStopPlan } from './motion/SpinEngine';
export { AnticipationController } from './motion/AnticipationController';
export type { AnticipationDecision } from './motion/AnticipationController';
export { TumbleController } from './cascade/TumbleController';
export type { TumbleStep } from './cascade/TumbleController';
export { ReelStepController, buildReelStepTape } from './cascade/ReelStepController';
export type { ReelStepData } from './cascade/ReelStepController';

// ── pluggable reel system ───────────────────────────────────────────────────
export { createReelSystem } from './system/ReelSystem';
export type { CreateReelSystemOptions, ReelSystem } from './system/ReelSystem';
export { BUILTIN_MOTION_STYLES, createAnticipator, tumbleController } from './system/builtins';
export type {
  ReelKit,
  MotionRunner,
  MotionStyle,
  Anticipator,
  ControllerRunner,
  BoardController,
  Registry,
  Report,
} from './system/contracts';
