export * from './context';
export * from './plugins/connection';
// Not `export *`: every plugin module follows the cordis convention of
// exporting top-level `name` and `apply` for `ctx.plugin(module)`, and a
// second (or third) wildcard export of those would collide with
// connection's (TS2308) — exactly as it did for slots in Task 9.
// `context.ts` already consumes `name`/`apply` directly via a namespace
// import, so the barrel only needs to re-export the public surface a
// consumer actually uses.
export { useSlot, type SlotMeta, type SlotEntry, type SlotsService } from './plugins/slots';
export {
  useLayout,
  type ScreenMeta,
  type ScreenEntry,
  type LayoutService,
} from './plugins/layout';
export type { ModulesService, ModulesConfig } from './plugins/modules';
export {
  useGameComposition,
  type GameCompositionService,
  type GameCompositionState,
  type GameCompositionConfig,
} from './plugins/game-composition';
export {
  useGameDiagnostics,
  type GameDiagnosticsGroup,
  type GameDiagnosticsService,
  type GameDiagnosticsState,
  type GameDiagnosticsConfig,
} from './plugins/diagnostics';
export * from './schema-form/SchemaForm';
export * from './schema-form/fields';
export { CompositionScreen, useEditorDiagnostics } from './screens/CompositionScreen';
export {
  Preview,
  PreviewWall,
  computePreviewUrl,
  type PreviewWallProps,
} from './screens/PreviewWall';
export { DiagnosticsPanel, type DiagnosticsPanelProps } from './screens/DiagnosticsPanel';
export { Layout } from './screens/Layout';
