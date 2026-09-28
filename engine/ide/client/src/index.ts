import './styles.css';

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
export { type LanguageDef, type LanguagesService } from './plugins/languages';
export { type ViewerDef, type ViewerProps, type ViewersService } from './plugins/viewers';
export { type AssetNodeType, type AssetNodeTypesService } from './plugins/asset-node-types';
export { IMAGE_EXTENSIONS, AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from './plugins/viewers-media';
export {
  useShell,
  type ActivityOpens,
  type ActivityMeta,
  type SidebarMeta,
  type DocumentMeta,
  type PanelMeta,
  type StatusMeta,
  type OpenDocument,
  type ShellService,
} from './plugins/shell';
export type { ModulesService, ModulesConfig } from './plugins/modules';
export {
  useGameComposition,
  type GameCompositionService,
  type GameCompositionState,
  type GameCompositionConfig,
} from './plugins/game-composition';
export {
  useScenes,
  type SceneSelection,
  type ScenesService,
  type ScenesConfig,
} from './plugins/scenes';
export { useFlow, type FlowClientService, type FlowConfig } from './plugins/flow';
export {
  useSymbols,
  type SymbolsClientService,
  type SymbolSelection,
  type SymbolsConfig,
} from './plugins/symbols';
export {
  useGameDiagnostics,
  type GameDiagnosticsEntry,
  type GameDiagnosticsGroup,
  type GameDiagnosticsService,
  type GameDiagnosticsState,
  type GameDiagnosticsConfig,
} from './plugins/diagnostics';
export { type FilesService, type FilesConfig } from './plugins/files';
export {
  useWorkspace,
  type WorkspaceClientService,
  type WorkspaceClientConfig,
} from './plugins/workspace';
export { type CheckService, type CheckConfig } from './plugins/check';
export * from './schema-form/SchemaForm';
export * from './schema-form/fields';
export { CompositionScreen, useEditorDiagnostics } from './screens/CompositionScreen';
export {
  Preview,
  DEFAULT_PREVIEW_STATE,
  previewAddress,
  readPreviewState,
  type PreviewState,
} from './screens/Preview';
export { DiagnosticsPanel, type DiagnosticsPanelProps } from './screens/DiagnosticsPanel';
export { Shell } from './shell/Shell';
export {
  ProjectStatus,
  SessionStatus,
  DirtyStatus,
  ThemeStatus,
  GameStatus,
  type ThemeName,
} from './shell/StatusItems';
export { Explorer, openPath } from './shell/Explorer';
export { ScenesSidebar } from './shell/ScenesSidebar';
export { Projects } from './shell/Projects';
export { EditorDocument } from './shell/EditorDocument';
export { ViewerDocument, looksBinary } from './shell/ViewerDocument';
export { Monaco, type MonacoProps } from './editor/Monaco';
