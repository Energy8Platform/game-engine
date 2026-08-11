/**
 * WS-соединение с фронтом.
 *
 * Всё, что живёт на соединении — `ctx` и `current`, — восстанавливается из
 * SessionInfo при переподключении: пода это состояние не переживает и
 * пережить не должно.
 */

import type { WebSocket } from 'ws';
import type { GamesApiClient } from '../games-api/client.js';
import { GamesApiError } from '../games-api/errors.js';
import type { EngineClient } from '../engine/index.js';
import {
  startRound, advanceRound, acknowledgeSegment,
  type ActiveRound, type RoundDeps,
} from '../round/orchestrator.js';
import { resumeRound } from '../round/resume.js';
import { withSessionRecovery } from '../session/recovery.js';
import { buildInit, isDemoSession, toSessionContext } from '../session/init.js';
import { createDemoApi } from '../session/demo.js';
import type { SessionContext } from '../session/types.js';
import { parseClientMessage, type ServerMessage } from './wire.js';
import type { Logger } from './log.js';

export interface WsDeps {
  api: GamesApiClient;
  engine: EngineClient;
  gameId: string;
  costMultipliers: Record<string, number>;
  startingDemoBalance: number;
  log: Logger;
}

export async function handleConnection(
  socket: WebSocket,
  sessionId: string,
  deps: WsDeps,
): Promise<void> {
  const log = deps.log.child({ session_id: sessionId });
  const send = (msg: ServerMessage) => socket.send(JSON.stringify(msg));

  let ctx: SessionContext;
  let current: ActiveRound | null = null;
  let demo = false;

  const roundDeps: RoundDeps = {
    api: deps.api,
    engine: deps.engine,
    gameId: deps.gameId,
    costMultipliers: deps.costMultipliers,
  };

  const fail = (err: unknown, id?: string) => {
    const code = err instanceof GamesApiError ? err.code : 'InternalServerError';
    const message = err instanceof Error ? err.message : String(err);
    log.error('request failed', err, { code });
    send({ t: 'error', id, code, message });
  };

  try {
    const info = await deps.api.sessionInfo({
      session_id: sessionId,
      player_connection_info: {},
    });
    ctx = toSessionContext(sessionId, info);
    demo = isDemoSession(info);
    if (demo) {
      // Games API отвечает OperationNotAllowed на раундовые RPC демо-сессии —
      // подменяем источник раундов локальной заглушкой без сети.
      roundDeps.api = createDemoApi(
        deps.startingDemoBalance,
        (index) => ctx.allowedBets[index] ?? 0,
      );
    }
    const init = buildInit(info);

    // Незакрытый раунд возвращаем игроку туда, где он остановился.
    let resume = null;
    if (!demo && info.last_round && !info.last_round.finished_at) {
      const outcome = await resumeRound(roundDeps, ctx, info.last_round);
      if (outcome) {
        resume = outcome.delivery;
        current = outcome.round;
        if (outcome.recovered) log.warn('round recovered after script mismatch');
      }
    }
    send({ t: 'init', ...init, resume });
  } catch (err) {
    fail(err);
    socket.close(1011, 'session init failed');
    return;
  }

  // События платформы, пока это соединение живо.
  const onBalance = (p: { session_id: string; balance: number; reason: string }) => {
    if (p.session_id === sessionId) send({ t: 'balance', balance: p.balance, reason: p.reason });
  };
  const onClosed = (p: { session_id: string; reason?: string }) => {
    if (p.session_id !== sessionId) return;
    send({ t: 'session_closed', reason: p.reason ?? 'closed' });
    socket.close(1000, 'session closed');
  };
  deps.api.on('balanceChanged', onBalance);
  deps.api.on('sessionClosed', onClosed);
  socket.on('close', () => {
    deps.api.off('balanceChanged', onBalance);
    deps.api.off('sessionClosed', onClosed);
  });

  // Сообщения обрабатываем строго по одному: и `ack`, и `play` читают и
  // пишут одну и ту же `current` за пределами своего запроса. Без очереди
  // `play`, отправленный сразу вслед за `ack` (обычный паттерн фронта —
  // подтвердить сегмент и тут же запросить следующий), может выполниться
  // раньше, чем завершится await внутри `ack`, и своим присваиванием
  // `current = outcome.round` затрёт курсор, который ack только что продвинул.
  let queue: Promise<void> = Promise.resolve();
  const onMessage = async (raw: string): Promise<void> => {
    let msg;
    try {
      msg = parseClientMessage(raw);
    } catch (err) {
      return fail(err);
    }
    try {
      if (msg.t === 'ack') {
        // Курсор — производная от состояния сервера, не вход от клиента:
        // клиентское значение используется лишь как проверка на протухший
        // ack (отставший roundId или число, не совпадающее с тем, что мы
        // сейчас готовы подтвердить). Несовпадение — просто игнорируем,
        // а не подтверждаем чужим/неверным курсором.
        if (current) {
          const expectedCursor = current.state.cursor + 1;
          if (msg.roundId === current.roundId && msg.cursor === expectedCursor) {
            current = await acknowledgeSegment(roundDeps, ctx, current, expectedCursor);
          } else {
            log.warn('stale or mismatched ack ignored', {
              round_id: msg.roundId, cursor: msg.cursor, expected: expectedCursor,
            });
          }
        }
        return;
      }
      // Демо: движок крутится, платформу не трогаем — она отвечает
      // OperationNotAllowed на раундовые RPC демо-сессии.
      //
      // `SessionIsNotInitialized` и `InvalidRoundOperation` чинятся
      // перечитыванием состояния, а не слепым ретраем — withSessionRecovery
      // переинициализирует сессию/раунд и повторяет попытку ровно один раз.
      const outcome = await withSessionRecovery(
        {
          sessionInfo: async () => {
            const info = await deps.api.sessionInfo({
              session_id: sessionId, player_connection_info: {},
            });
            // Смысл перечитывания — синхронизироваться с платформой: ставки
            // и фри-раунд могли поменяться, повтор обязан идти со свежими
            // значениями, а не с теми, что были на коннекте.
            ctx = toSessionContext(sessionId, info);
            return info;
          },
          resume: async (info) => {
            if (!info.last_round || info.last_round.finished_at) return { settled: false, round: null };
            const recovered = await resumeRound(roundDeps, ctx, info.last_round);
            if (!recovered) return { settled: false, round: null };
            // Сегмент, который мы переигрывали, оказался финальным —
            // resumeRound уже сам закрыл раунд на платформе. Клиентское
            // действие относилось к этому (уже закрытому) раунду: отдаём
            // готовый исход, а не гоняем его через startRound как entry
            // нового раунда — тот принял бы его буквально и выставил бы
            // реальный счёт за раунд, который игрок не заказывал.
            return recovered.round
              ? { settled: false, round: recovered.round }
              : { settled: true, outcome: { delivery: recovered.delivery, round: null } };
          },
        },
        (activeRound) =>
          activeRound
            ? advanceRound(roundDeps, ctx, activeRound, msg)
            : startRound(roundDeps, ctx, msg),
        current,
      );
      current = outcome.round;
      send({ t: 'result', id: msg.id, ...outcome.delivery });
    } catch (err) {
      fail(err, msg.t === 'play' ? msg.id : undefined);
    }
  };
  socket.on('message', (raw) => {
    queue = queue.then(() => onMessage(raw.toString()));
  });
}
