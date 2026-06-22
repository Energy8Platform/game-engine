import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { model } from './src/game.spec';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const logic = readFileSync(resolve(__dirname, 'src/game/script.logic.lua'), 'utf8');

export default {
  balance: 100000,
  currency: model.spec.currency ?? 'EUR',
  networkDelay: 80,
  debug: true,
  gameDefinition: model.gameDefinition,
  luaScript: buildLuaScript(model, logic),
  luaSeed: 12345,
};
