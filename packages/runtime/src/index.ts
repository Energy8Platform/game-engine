/**
 * @energy8engine/runtime — the host that turns a resolved plugin plan into a live session.
 *
 * The kernel knows how plugins compose. This package knows what a slot game needs composed:
 * which points exist, what a session provider is, and how a project's plan becomes a running game.
 */

/** Runtime version. Distinct from the kernel's — they version independently. */
export const RUNTIME_VERSION = '0.1.0';

// The vocabulary
export {
  HOOK_IDS,
  hostPlugin,
  POINT_BUILD_TARGET,
  POINT_SESSION_PROVIDER,
  SESSION_PROVIDER_SCHEMA,
} from './points';
export type { HookId } from './points';

// The session contract and the built-in providers
export type {
  DevBridgeCtor,
  DevBridgeLike,
  InstalledSession,
  SessionContext,
  SessionProvider,
  StakeAdapterBundle,
  StakeBridgeCtor,
  StakeBridgeLike,
} from './session/types';
export { provider } from './session/types';
export { sessionDevPlugin } from './session/dev';
export { POINT_STAKE_ADAPTER, sessionStakePlugin } from './session/stake';

// The host
export { runGame } from './runGame';
export type { RunGameInput, RunGameResult } from './runGame';
