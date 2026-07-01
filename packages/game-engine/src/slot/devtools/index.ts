// packages/game-engine/src/slot/devtools/index.ts
//
// Browser-facing reel devtools: the game-side bridge plus the shared control-panel /
// diff builders (reused by the reel-lab playground). Pixi-free.

export { mountReelDevBridge } from './reelDevBridge';
export type {
  ReelDevBridge,
  ReelDevBridgeOptions,
  ReelDevBridgeTarget,
} from './reelDevBridge';

export { buildControlPanel, getPath, setPath } from './controlPanel';
export type { ControlPanelOptions } from './controlPanel';

export { REEL_FIELD_SCHEMA, REEL_SECTION_KEYS } from './fieldSchema';
export type { Control, Section, SectionKey } from './fieldSchema';

export { configDiff, diffFromDefaults, emitReelConfigTs } from './configDiff';

export {
  REEL_READY,
  REEL_APPLY,
  REEL_REQUEST,
} from './protocol';
export type {
  ReelDevMessage,
  ReelReadyMessage,
  ReelApplyMessage,
  ReelRequestMessage,
} from './protocol';
