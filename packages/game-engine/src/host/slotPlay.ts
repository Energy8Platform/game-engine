import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';

export interface SlotPlayDeps<T extends SlotSpinResultBase> {
  play(params: { action: string; bet: number }): Promise<unknown>;
  normalize: SlotResultNormalizer<T>;
  onWin?: (totalWin: number) => void;
}

/** play → normalize → onWin(totalWin) → return T. Host-agnostic wiring; unit-testable. */
export function createSlotPlay<T extends SlotSpinResultBase>(
  deps: SlotPlayDeps<T>,
): (action: string, bet: number) => Promise<T> {
  return async (action, bet) => {
    const raw = await deps.play({ action, bet });
    const result = deps.normalize(raw);
    deps.onWin?.(result.totalWin);
    return result;
  };
}
