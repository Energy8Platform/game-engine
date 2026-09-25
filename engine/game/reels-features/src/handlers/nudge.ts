/**
 * `nudge { reel, by, settled }` — the reel's cells slide `by` rows (down for +, up for −), then
 * land home on `settled`, the column the mechanic says the nudge ends on. `by: 0` moves nothing.
 * Ported from the legacy `NudgeReels` demo's shift, minus its choice of reel and its xNudge wild
 * fill (a `settled` column of wilds is that).
 */
import { easingByName, rowStepOf, type CellData, type EasingName } from '@energy8engine/reel-core';
import { Tween } from '@energy8engine/tween';
import { cellData, type BoardCell } from '@energy8engine/contracts';
import type { StepHandler } from '@energy8engine/play-loop';
import { createFeatureHandler, type FeatureDeps } from '../shared';

export interface NudgeStep {
  kind: 'nudge';
  reel: number;
  /** Whole rows, ±. */
  by: number;
  /** The reel after the nudge, top to bottom — one entry per row. */
  settled: (number | string | BoardCell)[];
}

export interface NudgeConfig {
  /** The slide. */
  ms: number;
  easing: EasingName;
}

export function createNudgeHandler(deps: FeatureDeps<NudgeConfig>): StepHandler {
  return createFeatureHandler<NudgeStep, NudgeConfig>('nudge', deps, {
    changes({ reel, by, settled }, grid) {
      if (!Number.isInteger(reel) || reel < 0 || reel >= grid.cols) {
        throw new Error(`nudge: reel ${reel} is outside the grid`);
      }
      if (!Number.isInteger(by)) throw new Error('nudge: by must be a whole number');
      const rows = grid.rowsOf(reel);
      const count = Array.isArray(settled) ? settled.length : 0;
      if (count !== rows) {
        throw new Error(`nudge: settled has ${count} cells, reel ${reel} has ${rows}`);
      }
      return settled.map((cell, row) => ({ col: reel, row, data: cellData(cell) as CellData }));
    },

    async animate({ reel, by }, changes, { kit, cell, pace }, cfg) {
      if (!by) return;
      const shift = rowStepOf(kit.grid, reel) * by;
      await Promise.all(
        changes.map(({ col, row }) => {
          const target = cell(col, row);
          return Tween.to(
            target,
            { 'position.y': target.y + shift },
            pace.ms(cfg.ms),
            easingByName(cfg.easing),
          );
        }),
      );
      // the run's end puts the cells home, the re-seat puts `settled` in them
    },
  });
}
