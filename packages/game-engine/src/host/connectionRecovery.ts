// packages/game-engine/src/host/connectionRecovery.ts

/**
 * What the game does while the link to the platform is down, and when it comes back.
 *
 * The rules come from a certification remark: *"if connection is lost during autoplay, autoplay
 * stops, and after reconnection the counter is displayed correctly"*. What the game used to do
 * instead was worse in both halves — the in-flight play rejected, the host classified that
 * rejection as an ordinary round failure and put up a "reload the page" screen (visible only in
 * autoplay, because only autoplay always has a play in flight), and the autoplay counter was
 * cleared to zero on the way. Reconnecting healed the link but nothing took the screen back down.
 *
 * So, per transition:
 *  - **lost** — halt autoplay (the counter survives, see `autoplay.halt()`) and put up the
 *    reconnect overlay. Repeated `lost` (one per failed reconnect attempt) doesn't restack it.
 *  - **lost + `ConnectionGone`** — the bridge gave up retrying. That is terminal and honest about
 *    it: a Reload modal, not a "Reconnecting…" that will never resolve.
 *  - **restored** — take the overlay down and finish what the drop interrupted: if the platform
 *    still holds an open round, play it out silently to settlement. No modal asks the player to
 *    confirm this — it is their own round, they already paid for it, and an extra screen here is
 *    the very thing the remark objected to.
 *
 * A `restored` that never followed a `lost` does nothing at all: it must not close a modal that
 * belongs to someone else.
 *
 * Pure over injected deps — unit-testable, which `createSlotGame` itself is not.
 */

import type { PlayResultData } from '@energy8platform/platform-core';

export interface ConnectionState {
  status: 'lost' | 'restored' | 'connecting';
  code?: string;
  message?: string;
}

export interface ConnectionRecoveryDeps {
  /** Stop an autoplay run WITHOUT clearing its counter (`Autoplay.halt`). */
  haltAutoplay(): void;
  /** Put up the blocking "Reconnecting…" overlay. */
  showReconnecting(): void;
  /** Put up the terminal "the connection is gone — reload" modal. */
  showGone(): void;
  /** Take down whatever the loss put up. */
  dismiss(): void;
  /** The platform's snapshot of an unfinished round, or `null` when there is nothing to finish. */
  getState(): Promise<PlayResultData | null>;
  /** Play a recovered round out to settlement (the host's `resumeDrain`). */
  drain(snapshot: PlayResultData): Promise<void>;
  /** Report a recovery that itself failed (the host routes it to its play-error modal). */
  onError(err: unknown): void;
  /**
   * True while a modal the player must act on owns the screen. The overlay must not mask it, and
   * a restored link must not close it — but the round underneath is still finished.
   */
  isBlocked?(): boolean;
}

export interface ConnectionRecovery {
  /** Feed one `connectionStateChanged` payload. Awaitable: `restored` finishes the open round. */
  onState(state: ConnectionState): Promise<void>;
}

/** The bridge has stopped retrying — see `ArtubeClient`'s exhausted reconnect loop. */
const GONE = 'ConnectionGone';

export function createConnectionRecovery(deps: ConnectionRecoveryDeps): ConnectionRecovery {
  let linkLost = false;

  const blocked = (): boolean => deps.isBlocked?.() ?? false;

  async function recover(): Promise<void> {
    let snapshot: PlayResultData | null = null;
    try {
      snapshot = await deps.getState();
    } catch {
      // The platform couldn't tell us. Nothing to finish, and nothing worth a screen: the player
      // is back in the game, and the next play resolves the open round (or refuses it, loudly).
      return;
    }
    if (!snapshot) return;
    try {
      await deps.drain(snapshot);
    } catch (err) {
      deps.onError(err);
    }
  }

  return {
    async onState(state: ConnectionState): Promise<void> {
      if (state.status === 'connecting') return; // in transit — the screen stays as it is

      if (state.status === 'lost') {
        // Halt first: it is what the remark asks for, and it holds even when a modal already owns
        // the screen and the overlay below is skipped.
        deps.haltAutoplay();
        if (state.code === GONE) {
          if (!blocked()) deps.showGone();
          return;
        }
        if (linkLost) return; // already announced — reconnect attempts don't restack the overlay
        linkLost = true;
        if (!blocked()) deps.showReconnecting();
        return;
      }

      if (!linkLost) return; // nothing of ours is on screen; nothing of ours to recover
      linkLost = false;
      if (!blocked()) deps.dismiss();
      await recover();
    },
  };
}
