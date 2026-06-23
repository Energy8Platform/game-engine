// examples/spec-slot/normalize.ts
import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';
import type { CascadeStepData } from '@energy8platform/game-engine/slot';

export interface SpinData extends SlotSpinResultBase {
  steps: CascadeStepData[];
  multiplier?: number;
}

export const normalize: SlotResultNormalizer<SpinData> = (raw) => {
  const r = (raw ?? {}) as { totalWin?: number; data?: any };
  const d = r.data ?? {};
  return {
    totalWin: r.totalWin ?? 0,
    freeSpins: d.free_spins ? { awarded: d.free_spins.awarded, total: d.free_spins.total } : undefined,
    steps: (d.cascades ?? []).map((s: any) => ({
      winningCells: s.winning ?? [],
      removedCells: s.removed ?? [],
      newCells: s.new ?? [],
      settledGrid: s.grid ?? [],
    })),
    multiplier: d.multiplier,
  };
};
