/** Minimal, renderer-agnostic base every normalized slot result satisfies. */
export interface SlotSpinResultBase {
  /** Currency win for the round SO FAR — CUMULATIVE, not this segment's win (PlatformSession.play()
   *  already applied the bet). In a bonus every drained segment must report the running total, so
   *  the host derives each spin's WIN readout as `totalWin - prevSegmentTotal` and the final base
   *  return shows the round total. Feed the RGS `total_win` (accumulated), never `spin_win`. */
  totalWin: number;
  freeSpins?: { awarded?: number; total?: number; remaining?: number };
  // ── Round-continuation metadata (Stake segment-drain) ──────────────────
  // A round may be split into several SEGMENTS (e.g. a base trigger + every free spin of one
  // bonus). The host fills these from the raw play result so a scene can drain the remaining
  // segments by replaying the SAME round; the game's normalizer never sets them.
  /** Round id to pass back to `play(action, bet, roundId)` for the next segment of THIS round. */
  roundId?: string;
  /** Actions valid for the next segment; `nextActions[0]` is what to play to advance the round. */
  nextActions?: string[];
  /** True once the round has no further segments to drain (single spin, or final bonus spin). */
  complete?: boolean;
}

/** A game declares one of these; the host invokes it on every play. Generic over the game's result type. */
export type SlotResultNormalizer<T extends SlotSpinResultBase> = (raw: unknown) => T;
