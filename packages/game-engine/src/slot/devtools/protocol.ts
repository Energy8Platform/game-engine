// packages/game-engine/src/slot/devtools/protocol.ts
//
// The postMessage protocol between the harness reel panel (parent window) and the
// reel dev bridge (game iframe). Pure constants + message types — no deps.

import type { DeepPartial, ReelSystemConfig } from '../config/ReelSystemConfig';

/** Game → panel: announces the current resolved config (on mount + on request). */
export interface ReelReadyMessage {
  type: 'e8:reel:ready';
  config: ReelSystemConfig;
}

/** Panel → game: apply a partial config live (system.update). */
export interface ReelApplyMessage {
  type: 'e8:reel:apply';
  patch: DeepPartial<ReelSystemConfig>;
}

/** Panel → game: (re)request the current config, e.g. when the panel opens late. */
export interface ReelRequestMessage {
  type: 'e8:reel:request';
}

export type ReelDevMessage = ReelReadyMessage | ReelApplyMessage | ReelRequestMessage;

export const REEL_READY = 'e8:reel:ready';
export const REEL_APPLY = 'e8:reel:apply';
export const REEL_REQUEST = 'e8:reel:request';
