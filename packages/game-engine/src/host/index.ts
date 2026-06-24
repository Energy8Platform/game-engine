// packages/game-engine/src/host/index.ts
export { createSlotGame } from './createSlotGame';
export type {
  CreateSlotGameOptions,
  SlotGameHandle,
  StakeIntegration,
  SceneRegistration,
  SceneNavData,
  SceneEntry,
} from './types';
export { buildShellConfig } from './shellConfig';
export type { SlotShellOptions } from './shellConfig';
export { resolveReplayBonusId } from './replay';
export { resolveStartScene } from './sceneStart';
export type { SlotSceneController, SlotHostApi } from './sceneController';
// Social-casino word-swap. The shell auto-socializes all gameInfo/buyBonus text in social mode;
// authors only need this to socialize strings they render themselves (e.g. inside a custom DOM node).
export { socialize } from '@energy8platform/platform-core/shell';
