export type { SymbolView, SymbolResolver } from './grid/SymbolView';
export { AnimatedSymbol } from './grid/AnimatedSymbol';
export type { SymbolTextures, AnimatedSymbolConfig } from './grid/AnimatedSymbol';
export { SymbolCell } from './grid/SymbolCell';
export type { CellFrameStyle, CellData, CellState, SymbolCellConfig } from './grid/SymbolCell';
export { ReelGrid } from './grid/ReelGrid';
export type { DecorationConfig, ReelGridConfig } from './grid/ReelGrid';
export { resolveGeometry, cellPositionOf } from './grid/geometry';
export type { GeometryInput, ResolvedGeometry, CellSizeSpec } from './grid/geometry';
export { CascadeController } from './anim/CascadeController';
export type { CascadeStepData, CascadeTimings, CascadeAnim } from './anim/CascadeController';
export { ReelSpinController } from './anim/ReelSpinController';
export type { ReelSpinData, ReelSpinTimings, ReelStopPlan } from './anim/ReelSpinController';
export { EASING_BY_NAME, easingByName } from './anim/easing-map';

// ── configurable reel system ────────────────────────────────────────────────
export {
  DEFAULT_REEL_CONFIG,
  INTENSITY_SCALE,
  FEATURE_KEYS,
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
  MotionStyle,
  StopMode,
  StopOrder,
  Intensity,
  GridConfig,
  MotionConfig,
  SettleConfig,
  SquashConfig,
  BlurConfig,
  AnticipationConfig,
  AnticipationOverride,
  PerReel,
  CascadeConfig,
  WinConfig,
  FeaturesConfig,
  FeatureKey,
  ExpandingWildConfig,
  StickyConfig,
  WalkingWildConfig,
  MultiplierConfig,
  MysteryConfig,
  TransformConfig,
  GiantConfig,
  SplitConfig,
  StackedConfig,
  NudgeConfig,
  ReelModifierConfig,
  HoldAndSpinConfig,
  RandomWildConfig,
} from './config/ReelSystemConfig';
export { PRESETS, PRESET_LIST } from './config/presets';
export type { PresetId, ReelPreset } from './config/presets';

export { SpinEngine } from './motion/SpinEngine';
export type { SpinData, SpinRunOpts, ReelStopPlan as SpinStopPlan } from './motion/SpinEngine';
export { AnticipationController } from './motion/AnticipationController';
export type { AnticipationDecision } from './motion/AnticipationController';
export { TumbleController } from './cascade/TumbleController';
export type { TumbleStep } from './cascade/TumbleController';
export { ReelStepController, buildReelStepTape } from './cascade/ReelStepController';
export type { ReelStepData } from './cascade/ReelStepController';

export { FEATURES, FEATURE_LIST } from './features';
export type { ReelFeature, FeatureContext } from './features';

export { createReelSystem } from './system/ReelSystem';
export type { ReelSystem, CreateReelSystemOptions, StepRunOpts } from './system/ReelSystem';

export { pickTier, tierIndexAtValue } from './overlay/tiers';
export type { WinTier } from './overlay/tiers';
export { valueAt, CountUpDisplay } from './overlay/CountUpDisplay';
export type { CountUpConfig } from './overlay/CountUpDisplay';
export { BigWinOverlay } from './overlay/BigWinOverlay';
export type { BigWinOverlayConfig } from './overlay/BigWinOverlay';
export { MultiplierAccumulator } from './multiplier/MultiplierAccumulator';
export type { CarryPolicy } from './multiplier/MultiplierAccumulator';
