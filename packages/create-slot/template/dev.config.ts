import { buildSpinScript } from '@energy8platform/platform-core/game-spec';
import { model } from './src/game.spec';
// Математика — SpinML: в деве раунды ведёт e8-server (vite-плагин spinPlugin
// из defineGameConfig). Для клиентского DevBridge luaScript — лишь маркер
// «играть через POST /__lua-play»; исполняет всегда сервер.
import logic from './src/game/script.spin?raw';

export default {
  balance: 100000,
  currency: model.spec.currency ?? 'EUR',
  networkDelay: 80,
  debug: true,
  gameDefinition: model.gameDefinition,
  luaScript: buildSpinScript(model, logic),
  luaSeed: 12345,
};
