/** Minimal, renderer-agnostic base every normalized slot result satisfies. */
export interface SlotSpinResultBase {
  /** Currency win amount for this play (PlatformSession.play() already applied the bet). */
  totalWin: number;
  freeSpins?: { awarded?: number; total?: number; remaining?: number };
}

/** A game declares one of these; the host invokes it on every play. Generic over the game's result type. */
export type SlotResultNormalizer<T extends SlotSpinResultBase> = (raw: unknown) => T;
