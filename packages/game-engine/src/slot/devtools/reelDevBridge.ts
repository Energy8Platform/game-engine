// packages/game-engine/src/slot/devtools/reelDevBridge.ts
//
// Game-side opt-in bridge for the harness reel panel. Call once, after creating the
// ReelSystem, to let the harness sidebar tune the reels LIVE:
//
//   import { mountReelDevBridge } from '@energy8platform/game-engine/devtools';
//   const bridge = mountReelDevBridge({ system });
//
// It announces the system's current config to the parent (the harness wrapper) and
// applies incoming patches via `system.update()`. Changes are EPHEMERAL — they live
// only in this running iframe and are lost on reload. To persist, use the panel's
// "Copy config" button and paste the snippet into your game's reel config.
//
// No-op outside an iframe (window.parent === window), so it is safe to leave in.

import type { DeepPartial, ReelSystemConfig } from '../config/ReelSystemConfig';
import { REEL_APPLY, REEL_READY, REEL_REQUEST, type ReelDevMessage } from './protocol';

/** Minimal ReelSystem surface the bridge needs (keeps it decoupled/testable). */
export interface ReelDevBridgeTarget {
  readonly config: ReelSystemConfig;
  update(partial: DeepPartial<ReelSystemConfig>): void;
}

export interface ReelDevBridgeOptions {
  system: ReelDevBridgeTarget;
  /** postMessage targetOrigin for the parent. Default '*' (dev harness, same-origin). */
  targetOrigin?: string;
  /**
   * Guard: only mount when true. Defaults to `import.meta.env?.DEV` when available,
   * else true. Pass `false` to hard-disable.
   */
  enabled?: boolean;
}

export interface ReelDevBridge {
  /** Re-announce the current config to the parent. */
  announce(): void;
  /** Detach the message listener. */
  dispose(): void;
}

function defaultEnabled(): boolean {
  try {
    // vite injects import.meta.env.DEV; guard so non-vite builds don't throw.
    const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
    return env?.DEV ?? true;
  } catch {
    return true;
  }
}

export function mountReelDevBridge(opts: ReelDevBridgeOptions): ReelDevBridge {
  const enabled = opts.enabled ?? defaultEnabled();
  const noop: ReelDevBridge = { announce: () => {}, dispose: () => {} };
  if (!enabled || typeof window === 'undefined' || window.parent === window) return noop;

  const origin = opts.targetOrigin ?? '*';
  const { system } = opts;

  const announce = (): void => {
    window.parent.postMessage({ type: REEL_READY, config: system.config } satisfies ReelDevMessage, origin);
  };

  const onMessage = (e: MessageEvent): void => {
    if (e.source !== window.parent) return;
    const msg = e.data as ReelDevMessage | undefined;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === REEL_APPLY) system.update(msg.patch);
    else if (msg.type === REEL_REQUEST) announce();
  };

  window.addEventListener('message', onMessage);
  announce(); // cover the panel-already-open case

  return {
    announce,
    dispose: () => window.removeEventListener('message', onMessage),
  };
}
