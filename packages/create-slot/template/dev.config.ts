import { buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { model } from './src/game.spec';
import logic from './src/game/script.logic.lua?raw';

export default {
  balance: 100000,
  currency: model.spec.currency ?? 'EUR',
  networkDelay: 80,
  debug: true,
  gameDefinition: model.gameDefinition,
  luaScript: buildLuaScript(model, logic),
  luaSeed: 12345,
};
