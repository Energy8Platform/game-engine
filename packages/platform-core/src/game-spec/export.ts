import type { GameSpec, GameModel } from './types';
import { defineGame } from './defineGame';

export function buildLuaScript(model: GameModel, logicLua: string): string {
  return model.luaPrelude + '\n' + logicLua;
}

export function exportGame(
  spec: GameSpec,
  opts: { logicLua: string },
): { 'gameDefinition.json': string; 'script.lua': string } {
  const model = defineGame(spec);
  return {
    'gameDefinition.json': JSON.stringify(model.gameDefinition, null, 2),
    'script.lua': buildLuaScript(model, opts.logicLua),
  };
}
