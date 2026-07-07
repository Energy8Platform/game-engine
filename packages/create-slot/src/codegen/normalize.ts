import type { Answers } from '../answers';

/** Generate src/game/normalize.ts: game-declared SpinData + the host normalizer.
 * Coercion (Lua {} → []) is schema-driven via stake-kit's deriveArrayFields + coerceLuaArrays. */
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
    ? `    steps: Array.isArray(d.cascades) ? d.cascades.map((step: any) => ({
      winningCells: step.winning ?? [],
      removedCells: step.removed ?? [],
      newCells: step.new ?? [],
      settledGrid: step.grid ?? [],
    })) : [],
    multiplier: d.multiplier,`
    : `    targetGrid: d.matrix ?? [],`;

  return `import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';
import type { ${cascade ? 'CascadeStepData' : 'CellData'} } from '@energy8platform/game-engine/slot';
import { deriveArrayFields, coerceLuaArrays } from '@energy8platform/stake-kit';
import { spinSchema, type SpinDataRaw } from './schema';

/** The game's typed play result. Extend with any fields your script.spin returns. */
export interface SpinData extends SlotSpinResultBase {
${dataShape}
}

// Array fields are derived from the schema once (Lua empty tables {} → []), so the
// scene-facing mapping below can rely on real arrays — no crashes from Lua empty tables.
const arrayFields = deriveArrayFields(spinSchema);

/** REQUIRED: map the raw play result into SpinData. The host calls this on every play. */
export const normalize: SlotResultNormalizer<SpinData> = (raw) => {
  const r = (raw ?? {}) as { totalWin?: number; data?: unknown };
  const coerced = coerceLuaArrays((r.data ?? {}) as Record<string, unknown>, arrayFields);
  const parsed = spinSchema.safeParse(coerced);
  const d = (parsed.success ? parsed.data : coerced) as SpinDataRaw;
  return {
    totalWin: r.totalWin ?? 0,
    freeSpins: d.free_spins ? { awarded: d.free_spins.awarded, total: d.free_spins.total } : undefined,
${mapBody}
  };
};
`;
}
