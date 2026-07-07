import type { GameSpec, GameModel } from './types';
import { validateSpec } from './validate';
import { toGameDefinition, toSpinPrelude, toModeMap, toMathModes, toPaytableView } from './derive';

export function defineGame(spec: GameSpec): GameModel {
  validateSpec(spec);
  return {
    spec,
    gameDefinition: toGameDefinition(spec),
    spinPrelude: toSpinPrelude(spec),
    modeMap: toModeMap(spec),
    mathModes: toMathModes(spec),
    paytable: toPaytableView(spec),
    symbols: spec.symbols,
  };
}
