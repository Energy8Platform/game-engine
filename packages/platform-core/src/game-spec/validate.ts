import type { GameSpec } from './types';

export class GameSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameSpecError';
  }
}

export function validateSpec(spec: GameSpec): void {
  if (!spec.id || spec.id.trim() === '') throw new GameSpecError('spec.id is required');
  if (spec.maxWin <= 0) throw new GameSpecError('spec.maxWin must be > 0');
  if (spec.grid.cols <= 0 || spec.grid.rows <= 0) throw new GameSpecError('spec.grid dimensions must be > 0');

  if (!spec.betLevels.length) throw new GameSpecError('spec.betLevels must be non-empty');
  for (let i = 1; i < spec.betLevels.length; i++) {
    if (spec.betLevels[i] <= spec.betLevels[i - 1]) {
      throw new GameSpecError('spec.betLevels must be strictly ascending');
    }
  }

  const ids = new Set<string>();
  for (const sym of spec.symbols) {
    if (ids.has(sym.id)) throw new GameSpecError(`duplicate symbol id: ${sym.id}`);
    ids.add(sym.id);
    if (sym.pay) {
      for (const [count, mult] of Object.entries(sym.pay)) {
        if (Number(count) <= 0 || !Number.isInteger(Number(count))) {
          throw new GameSpecError(`symbol ${sym.id} pay key must be a positive integer: ${count}`);
        }
        if (mult <= 0) throw new GameSpecError(`symbol ${sym.id} pay[${count}] must be > 0`);
      }
    }
  }

  const actionKeys = new Set(Object.keys(spec.actions));
  for (const [key, action] of Object.entries(spec.actions)) {
    if (action.cost !== undefined && action.cost <= 0) {
      throw new GameSpecError(`action ${key} cost must be > 0`);
    }
    for (const t of action.transitions ?? []) {
      for (const next of t.next_actions) {
        if (!actionKeys.has(next)) {
          throw new GameSpecError(`action ${key} transition next_actions references unknown action: ${next}`);
        }
      }
    }
  }
}
