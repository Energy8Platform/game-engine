import type { Answers } from '../answers';

/** Generate src/game/normalize.ts: the game-declared SpinData + the mandatory normalizer the host calls. */
export function genNormalize(a: Answers): string {
  const cascade = a.cascades === true;

  const dataShape = cascade
    ? `  /** Cascade steps the scene animates via CascadeController. */
  steps: CascadeStepData[];
  /** Optional running multiplier the scene reflects. */
  multiplier?: number;`
    : `  /** Result grid by column for the reel spin. */
  targetGrid: CellData[][];`;

  const mapBody = cascade
    ? `    steps: (d.cascades ?? []).map((s: any) => ({
      winningCells: s.winning ?? [],
      removedCells: s.removed ?? [],
      newCells: s.new ?? [],
      settledGrid: s.grid ?? [],
    })),
    multiplier: d.multiplier,`
    : `    targetGrid: d.matrix ?? [],`;

  return `import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';
import type { ${cascade ? 'CascadeStepData' : 'CellData'} } from '@energy8platform/game-engine/slot';

/** The game's typed play result. Extend with any fields your script.logic.lua returns. */
export interface SpinData extends SlotSpinResultBase {
${dataShape}
}

/**
 * REQUIRED: map the raw play result into SpinData. The host calls this on every play.
 * The field names on the right (cascades/winning/removed/new/grid/${cascade ? 'multiplier' : 'matrix'}/free_spins)
 * are what your script.logic.lua must produce — edit both sides to match your math.
 */
export const normalize: SlotResultNormalizer<SpinData> = (raw) => {
  const r = (raw ?? {}) as { totalWin?: number; data?: any };
  const d = r.data ?? {};
  return {
    totalWin: r.totalWin ?? 0,
    freeSpins: d.free_spins
      ? { awarded: d.free_spins.awarded, total: d.free_spins.total }
      : undefined,
${mapBody}
  };
};
`;
}
