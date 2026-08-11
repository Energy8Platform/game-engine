/**
 * `AutocloseRequestEvent` — платформа просит закрыть раунд, который игрок
 * бросил без завершения. Событие приходит на общий, подовый `GamesApiClient`
 * (не на конкретное WS-соединение — того соединения обычно уже нет), поэтому
 * подписка живёт на уровне сервера, один раз, а не внутри `handleConnection`.
 *
 * Даём шанс честному автозакрытию (Task 9: доиграть раунд от лица игрока и
 * отдать реальный итог) прежде, чем платформа через минуту откатит раунд
 * сама — тот путь не знает математики раунда и просто возвращает ставку.
 */

import type { GamesApiClient } from '../games-api/client.js';
import type { EngineClient } from '../engine/index.js';
import type { RoundDeps } from '../round/orchestrator.js';
import { autocloseRound } from '../round/resume.js';
import { toSessionContext } from '../session/init.js';
import type { AutocloseRequestEvent } from '../games-api/types.js';
import type { Logger } from './log.js';

export interface AutocloseDeps {
  api: GamesApiClient;
  engine: EngineClient;
  gameId: string;
  costMultipliers: Record<string, number>;
  log: Logger;
}

/**
 * Обработчик события с защитой от одновременных запусков по одному раунду.
 *
 * `AutocloseRoundRequest` двигает деньги и потому не повторяется ни при каких
 * условиях, а событие продублировать может кто угодно: реконнект коннекта к
 * Games API, ретрай платформы, две подряд присланные копии. Без этой защиты
 * две копии события запустили бы два параллельных прохода по одному и тому же
 * `last_round` — оба увидели бы раунд незавершённым и оба отправили бы
 * денежную RPC.
 *
 * Множество живёт ровно на время выполнения запроса и не переживает его —
 * это не состояние раунда (то по-прежнему только в `round_state`), а защёлка
 * "прямо сейчас этим раундом занимаются". Повторное событие после ЗАВЕРШЕНИЯ
 * прохода не глотаем: если проход провалился, повтор — единственный шанс
 * закрыть раунд честно, а если удался, событие отсеет проверка `finished_at`.
 */
export function createAutocloseHandler(
  deps: AutocloseDeps,
): (event: AutocloseRequestEvent) => Promise<void> {
  const inFlight = new Set<string>();
  return async (event) => {
    if (inFlight.has(event.round_id)) {
      deps.log.info('autoclose skipped: already in flight', {
        session_id: event.session_id, round_id: event.round_id, outcome: 'skipped_in_flight',
      });
      return;
    }
    inFlight.add(event.round_id);
    try {
      await handleAutocloseRequest(deps, event);
    } finally {
      inFlight.delete(event.round_id);
    }
  };
}

export async function handleAutocloseRequest(
  deps: AutocloseDeps,
  event: AutocloseRequestEvent,
): Promise<void> {
  const log = deps.log.child({ session_id: event.session_id, round_id: event.round_id });
  try {
    const info = await deps.api.sessionInfo({
      session_id: event.session_id,
      player_connection_info: {},
    });
    const lastRound = info.last_round;
    if (!lastRound) {
      log.info('autoclose skipped: session has no last_round', { outcome: 'skipped_no_last_round' });
      return;
    }
    if (lastRound.round_id !== event.round_id) {
      log.info('autoclose skipped: last_round does not match requested round', {
        outcome: 'skipped_round_mismatch', last_round_id: lastRound.round_id,
      });
      return;
    }
    if (lastRound.finished_at) {
      log.info('autoclose skipped: round already finished', { outcome: 'skipped_already_finished' });
      return;
    }

    const ctx = toSessionContext(event.session_id, info);
    const roundDeps: RoundDeps = {
      api: deps.api,
      engine: deps.engine,
      gameId: deps.gameId,
      costMultipliers: deps.costMultipliers,
    };
    const balance = await autocloseRound(roundDeps, ctx, lastRound);
    log.info('autoclose completed', { outcome: 'closed', balance });
  } catch (err) {
    // Не глотаем: если честное автозакрытие не удалось, платформенный
    // откат — единственная страховка игрока. Молчание здесь спрятало бы
    // реальную проблему за ложным ощущением, что всё под контролем.
    log.error('autoclose failed — falling back to platform rollback', err, {
      outcome: 'failed',
    });
  }
}
