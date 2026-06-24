import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';

export interface SlotPlayDeps<T extends SlotSpinResultBase> {
  play(params: { action: string; bet: number }): Promise<unknown>;
  normalize: SlotResultNormalizer<T>;
  onWin?: (totalWin: number) => void;
  /** Host hook to acknowledge a finished result (PlatformSession.playAck). Called by `ack()`
   *  with the raw host result of the most recent play. On Stake this is what settles the round
   *  (`/wallet/end-round`) AFTER the win animation — so the scene must call `ack()` once it has
   *  finished presenting each result. */
  ack?: (raw: unknown) => void;
}

/** A bound play/ack pair injected into a scene via bindHost. */
export interface SlotPlay<T extends SlotSpinResultBase> {
  /** play → normalize → onWin(totalWin) → return T. */
  play(action: string, bet: number): Promise<T>;
  /** Acknowledge the most recent result (call AFTER its animation). Settles the round on Stake. */
  ack(): void;
}

/** Build the host play/ack pair. Host-agnostic wiring; unit-testable. The returned `play` stashes
 *  the raw host result so the matching `ack()` can forward it to `deps.ack` (PlatformSession.playAck)
 *  once the scene has finished animating. Plays are sequential (awaited), so a single stash is safe. */
export function createSlotPlay<T extends SlotSpinResultBase>(
  deps: SlotPlayDeps<T>,
): SlotPlay<T> {
  let lastRaw: unknown = null;
  return {
    play: async (action, bet) => {
      const raw = await deps.play({ action, bet });
      lastRaw = raw;
      const result = deps.normalize(raw);
      deps.onWin?.(result.totalWin);
      return result;
    },
    ack: () => {
      if (lastRaw != null) deps.ack?.(lastRaw);
    },
  };
}
