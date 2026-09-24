// Forked from packages/game-engine/src/slot/index.ts (slice 35).
export type { SymbolView, SymbolResolver } from './grid/SymbolView';
export { AnimatedSymbol } from './grid/AnimatedSymbol';
export { SymbolCell } from './grid/SymbolCell';
export type { CellData, CellState, CellFrameStyle } from './grid/SymbolCell';
export { ReelGrid } from './grid/ReelGrid';
export type { ReelGridConfig } from './grid/ReelGrid';
export { resolveGeometry, cellPositionOf } from './grid/geometry';
export { EASING_BY_NAME, easingByName } from './anim/easing-map';

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
