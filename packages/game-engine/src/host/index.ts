// packages/game-engine/src/host/index.ts
export { createSlotGame } from './createSlotGame';
export type {
  CreateSlotGameOptions,
  SlotGameHandle,
  StakeIntegration,
  SceneEntry,
} from './types';
export { buildShellConfig } from './shellConfig';
export type { SlotShellOptions } from './shellConfig';
export { resolveReplayBonusId } from './replay';
export type { SlotSceneController } from './sceneController';
