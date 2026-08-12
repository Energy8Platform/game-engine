/**
 * Идентификатор игры в ДВИЖКЕ — это не `GameId` платформы.
 *
 * `GameId` (env) — это `publicGameId`, который заводит платформа в своей
 * админке: в песочнице это буквально `game1`. Идентификатор, под которым
 * `e8-server` регистрирует игру, приходит из самого `.spin`-файла (поле
 * `game` математики, например `moon-spice-market`) — его выбирает студия, и
 * он же уезжает на Stake/Energy8. Совпадение этих двух строк — случайность,
 * а не контракт: платформа не спрашивает математику, как её зовут.
 *
 * Раньше сервис подставлял `config.gameId` во ВСЕ вызовы движка, поэтому
 * первый же запуск против песочницы падал на старте с
 * `engine GetConfig: unknown game "game1"`. Разводим два пространства имён:
 * платформе — её `GameId` (заголовок `X-Game-ID`, `/api/version`), движку —
 * то, что движок сам о себе сообщил.
 */
import type { EngineClient } from './client.js';

export interface ResolveEngineGameIdOptions {
  /** Позвали, когда id движка не совпал с `GameId` платформы (не ошибка — норма). */
  onFallback?: (engineGameId: string, platformGameId: string) => void;
}

/**
 * Игровой id для вызовов движка.
 *
 * Точное совпадение с `GameId` выигрывает всегда — студия вправе назвать
 * математику так же, как игру на платформе, и такой конфиг должен работать
 * буквально. Иначе, если движок поднял РОВНО ОДНУ игру (обычный случай:
 * `--spin ./game.spin` → каталог с одним файлом), берём её: выбора нет, и
 * падать тут не за что. Больше одной — молча угадывать нельзя: не тот
 * `.spin` означает не ту математику и не те деньги.
 */
export async function resolveEngineGameId(
  engine: EngineClient,
  platformGameId: string,
  opts: ResolveEngineGameIdOptions = {},
): Promise<string> {
  const games = await engine.listGames();
  if (games.some((g) => g.game_id === platformGameId)) return platformGameId;
  if (games.length === 1) {
    const only = games[0]!.game_id;
    opts.onFallback?.(only, platformGameId);
    return only;
  }
  if (games.length === 0) {
    throw new Error(
      `engine loaded no games from the spin path — nothing to run for platform GameId ` +
        `"${platformGameId}" (check SPIN_PATH / --spin)`,
    );
  }
  throw new Error(
    `engine has no game "${platformGameId}" and ${games.length} games are loaded ` +
      `(${games.map((g) => g.game_id).join(', ')}) — point SPIN_PATH / --spin at a single .spin ` +
      `file, or name the game in it to match the platform GameId`,
  );
}
