import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';

export interface SlotPlayDeps<T extends SlotSpinResultBase> {
  play(params: { action: string; bet: number; roundId?: string }): Promise<unknown>;
  normalize: SlotResultNormalizer<T>;
  onWin?: (totalWin: number) => void;
  /** Host hook to acknowledge a finished result (PlatformSession.playAck). Called by `ack()`
   *  with the raw host result of the most recent play. On Stake this is what settles the round
   *  (`/wallet/end-round`) AFTER the win animation — so the scene must call `ack()` once it has
   *  finished presenting each result. */
  ack?: (raw: unknown) => void;
}

/** A bound play/ack pair the host uses to drive the play loop (createSlotGame → runRound). */
export interface SlotPlay<T extends SlotSpinResultBase> {
  /** play → normalize → onWin(totalWin) → return T. Pass `roundId` to advance an in-flight round
   *  (drain the next segment of a multi-segment bonus) instead of starting a new one. */
  play(action: string, bet: number, roundId?: string): Promise<T>;
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
    play: async (action, bet, roundId) => {
      const raw = await deps.play({ action, bet, roundId });
      lastRaw = raw;
      const result = deps.normalize(raw);
      // Enrich the normalized result with round-continuation metadata from the raw play result so
      // the scene can drain the remaining segments of a multi-segment round (e.g. free spins) by
      // replaying the SAME roundId. The game's normalizer stays focused on render data.
      const meta = (raw ?? {}) as {
        roundId?: string;
        nextActions?: string[];
        session?: { completed?: boolean } | null;
      };
      result.roundId = meta.roundId;
      result.nextActions = meta.nextActions;
      // A round is complete when there is no open session, or the session reports completed. The
      // host sets a session on every segment, so this is `session.completed` in practice.
      result.complete = !meta.session || meta.session.completed === true;
      deps.onWin?.(result.totalWin);
      return result;
    },
    ack: () => {
      if (lastRaw != null) deps.ack?.(lastRaw);
    },
  };
}
