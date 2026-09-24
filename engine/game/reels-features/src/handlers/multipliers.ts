/**
 * `multipliers { cells: {col,row,value}[], total? }` — each cell takes its multiplier badge (its
 * symbol kept) and pulses, then a `×value` label floats up from it, the cells together; then
 * `total`, when given, floats at the grid's centre. Ported from the legacy `MultiplierSymbols`
 * demo, minus its picked cells, its hard-coded values and its combine/cap math — the mechanic
 * hands in the values and the total.
 */
import { cellCenter, pulseCell } from '@energy8engine/reel-core';
import type { StepHandler } from '@energy8engine/play-loop';
import { checkCells, createFeatureHandler, type Cell, type FeatureDeps } from '../shared';

export interface MultipliersStep {
  kind: 'multipliers';
  cells: (Cell & { value: number })[];
  /** The combined multiplier, shown at the centre — the mechanic's own sum or product. */
  total?: number;
}

export interface MultipliersConfig {
  /** Each cell's pulse, up and back. */
  pulseMs: number;
  /** Each cell's `×value` label. */
  labelMs: number;
  /** The total's label. */
  totalMs: number;
  labelColor: number;
  totalColor: number;
}

const positive = (value: unknown) =>
  typeof value === 'number' && value > 0 && Number.isFinite(value);

export function createMultipliersHandler(deps: FeatureDeps<MultipliersConfig>): StepHandler {
  return createFeatureHandler<MultipliersStep, MultipliersConfig>('multipliers', deps, {
    changes({ cells, total }, grid) {
      checkCells('multipliers', grid, cells);
      cells.forEach(({ value }, i) => {
        if (!positive(value)) {
          throw new Error(`multipliers: cells[${i}].value must be a positive number`);
        }
      });
      if (total !== undefined && !positive(total)) {
        throw new Error('multipliers: total must be a positive number');
      }
      return cells.map(({ col, row, value }) => ({
        col,
        row,
        data: { ...grid.getCell(col, row).data, multiplier: value },
      }));
    },

    async animate({ total }, changes, { kit, cell, label, pace }, cfg) {
      await Promise.all(
        changes.map(async ({ col, row, data }) => {
          const target = cell(col, row);
          target.setData(data);
          await pulseCell(target, 1.2, pace.ms(cfg.pulseMs));
          if (pace.skipped) return;
          const { x, y } = cellCenter(kit.grid, col, row);
          await label(x, y, `×${data.multiplier}`, cfg.labelColor, pace.ms(cfg.labelMs));
        }),
      );
      if (pace.skipped || total === undefined) return;
      const { x, y } = kit.grid.center();
      await label(x, y, `×${total}`, cfg.totalColor, pace.ms(cfg.totalMs));
    },
  });
}
