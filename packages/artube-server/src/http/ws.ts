/**
 * WS-соединение с фронтом.
 *
 * Всё, что живёт на соединении — `ctx`, `current` и режим кошелька, —
 * восстанавливается из SessionInfo при переподключении: пода это состояние не
 * переживает и пережить не должно.
 *
 * Демо соединение обслуживает локально (`createDemoApi`), а узнаёт о нём двумя
 * путями: `currency: null` в SessionInfo — платформа объявила это сразу; отказ
 * `OperationNotAllowed`/«demo user» на первой раундовой RPC — объявила в
 * ответ на попытку. Второй путь существует потому, что отсутствие `currency`
 * не различает демо и реальные деньги (см. `session/init.ts`).
 */

import type { WebSocket } from 'ws';
import type { GamesApiClient } from '../games-api/client.js';
import type { EngineClient } from '../engine/index.js';
import {
  startRound, advanceRound, acknowledgeSegment,
  type ActiveRound, type RoundDeps,
} from '../round/orchestrator.js';
import { resumeRound } from '../round/resume.js';
import { replayRound } from '../round/engineRound.js';
import { withSessionRecovery, RoundNoLongerOpenError } from '../session/recovery.js';
import { GamesApiError, isDemoUserRejection } from '../games-api/errors.js';
import { activateCampaign, declineCampaign, FrcError } from '../session/frc.js';
import {
  applyCampaignProgress, buildInit, classifyCurrency, demoStartingBalance, toFrcInfo,
  toSessionContext, type CurrencyOnWire,
} from '../session/init.js';
import { createDemoApi, type DemoApi } from '../session/demo.js';
import type { PlayRequest, SessionContext } from '../session/types.js';
import type { PlayerConnectionInfo } from '../games-api/types.js';
import { parseClientMessage, type ServerMessage } from './wire.js';
import type { Logger } from './log.js';

export interface WsDeps {
  api: GamesApiClient;
  engine: EngineClient;
  gameId: string;
  costMultipliers: Record<string, number>;
  startingDemoBalance: number;
  /**
   * Что известно об игроке с его же HTTP-апгрейда — адрес, браузер,
   * идентификатор этого соединения. Платформа определяет по нему регион
   * (GeoIP), поэтому пустой объект здесь означал, что лицензионный контроль
   * решает по адресу нашего пода, а не игрока.
   */
  connection?: PlayerConnectionInfo;
  log: Logger;
}

export async function handleConnection(
  socket: WebSocket,
  sessionId: string,
  deps: WsDeps,
): Promise<void> {
  const log = deps.log.child({ session_id: sessionId });
  const send = (msg: ServerMessage) => socket.send(JSON.stringify(msg));
  // Одно и то же на все SessionInfo этого соединения: платформа обязана видеть
  // один `player_connection_id` за одно соединение, а адрес и браузер за его
  // время не меняются.
  const connection: PlayerConnectionInfo = deps.connection ?? {};

  // Синхронно, до первого await: `ws` рапортует протокольный брак кадра
  // событием 'error' на сокете, и EventEmitter без подписчика перебрасывает
  // его наружу — необработанное исключение убивает под со всеми остальными
  // игроками. `ws` сам закроет это соединение кодом 1002; наше дело — не дать
  // ошибке всплыть и записать её.
  socket.on('error', (err) => log.warn('websocket error', { error: String(err) }));

  let ctx: SessionContext;
  let current: ActiveRound | null = null;
  let demo = false;
  /** Кошелёк демо-сессии; `null` — реальные деньги считает платформа. */
  let demoApi: DemoApi | null = null;
  /**
   * Чем засеять кошелёк, если платформа объявит сессию демо уже на ходу.
   * Снято на коннекте и до тех пор верно, пока ни одна раундовая RPC не
   * прошла: денег на этой сессии никто не двигал.
   */
  let demoSeedBalance = 0;
  /** В какой форме приехала `currency` — для лога, когда вердикт придёт отказом. */
  let currencyOnWire: CurrencyOnWire = 'absent';
  /**
   * Платформа хоть раз ПРИНЯЛА нашу раундовую RPC на этом соединении.
   *
   * После этого её вердикт «демо» противоречил бы ей же, а подмена кошелька
   * стала бы небезопасной сразу дважды: настоящие деньги уже двигались, и
   * снятый на коннекте `demoSeedBalance` уже устарел.
   */
  let platformSettled = false;

  const roundDeps: RoundDeps = {
    api: deps.api,
    engine: deps.engine,
    gameId: deps.gameId,
    costMultipliers: deps.costMultipliers,
  };

  const fail = (err: unknown, id?: string) => {
    // Код берём только у тех ошибок, чей `code` — код нашего протокола:
    // ответ платформы (`GamesApiError`) и наши собственные вроде
    // `RoundNoLongerOpenError`. Утиная проверка на `typeof err.code ===
    // 'string'` пропустила бы во фронт системные ошибки Node — `ECONNRESET`,
    // `ABORT_ERR`, `ENOENT` тоже несут строковый `code`, — и игра приняла бы
    // их за коды платформы.
    const code =
      err instanceof GamesApiError
      || err instanceof RoundNoLongerOpenError
      || err instanceof FrcError
        ? err.code
        : 'InternalServerError';
    const message = err instanceof Error ? err.message : String(err);
    log.error('request failed', err, { code });
    send({ t: 'error', id, code, message });
  };

  /**
   * Перевести соединение на локальный кошелёк — и уже не возвращать обратно.
   *
   * Раундовые RPC демо-сессии платформа отвергает все до одной, поэтому
   * переключение обязано пережить действие, на котором случилось: иначе
   * КАЖДЫЙ следующий спин снова стучался бы в платформу, снова получал бы
   * отказ и снова переключался — лишний round trip на каждое действие игрока
   * вместо одного на соединение.
   *
   * Дальше соединения оно не живёт: `demo`, `ctx` и раунд — состояние
   * соединения, пода они не переживают и не должны. Реконнект перечитает
   * SessionInfo и, если валюты там снова нет, потратит на переоткрытие ровно
   * один отказ — цена, которую эта асимметрия и покупает.
   */
  const switchToDemoWallet = (): DemoApi => {
    demo = true;
    demoApi = createDemoApi(demoSeedBalance, (index) => ctx.allowedBets[index] ?? 0);
    roundDeps.api = demoApi;
    return demoApi;
  };

  /**
   * Вход в раунд — с единственной попыткой понять, что сессия всё-таки демо.
   *
   * `currency` эту разницу не различает: отсутствие поля одинаково объясняется
   * и демо-сессией, и реальной сессией на валюте, которую сериализатор
   * выбросил как дефолтную (см. `classifyCurrency`). Поэтому мы идём в
   * платформу как за реальные деньги — и слушаем её ответ. `OperationNotAllowed`
   * с «demo user» и есть её вердикт о сессии: однозначный, в отличие от поля.
   *
   * Почему это безопасно повторить и почему только здесь:
   *
   *  - Отказ пришёл на `PlayRound`/`OpenRound` — единственные RPC, которые
   *    делает `startRound`. Обе отвергнуты, значит на платформе не открыт ни
   *    раунд, ни транзакция: двойного списания повтору взяться неоткуда.
   *  - `advanceRound` этой обёртки НЕ получает намеренно. Там раунд уже открыт
   *    платформой (ставка списана по-настоящему), и досчитать его локальным
   *    кошельком значило бы зачислить выигрыш в бутафорию, оставив реальный
   *    раунд висеть открытым. Такой отказ обязан дойти до игрока ошибкой.
   *  - `platformSettled` закрывает и второй случай: если платформа хоть раз
   *    приняла нашу раундовую RPC, «демо» от неё — противоречие ей же, а не
   *    описание сессии.
   *
   * Повтор идёт заново через `startRound`, не через `resync`: тот чинит раунд,
   * который платформа ЕЩЁ считает своим, возвращая движок к его `round_state`.
   * Здесь у платформы нет ничего, и повтор строит свежий `RoundStateV1` — новый
   * `eid`, новый сид, пустой лог действий. Инвариант позиции держится сам
   * собой: `spins_played` = 1 = `1 + actions.length`. Раунд, сыгранный в
   * движке до отказа, остаётся под старым `eid` брошенным мусором до TTL
   * сессии — ровно как у `replayRound`, и ровно так же ничего не стоит.
   */
  const openRoundWithDemoFallback = async (req: PlayRequest) => {
    try {
      return await startRound(roundDeps, ctx, req);
    } catch (err) {
      if (demo || platformSettled || !isDemoUserRejection(err)) throw err;
      const wallet = switchToDemoWallet();
      log.warn('платформа объявила сессию демо отказом на раундовой RPC; переходим на локальный кошелёк', {
        currency_on_wire: currencyOnWire,
        platform_message: err instanceof Error ? err.message : String(err),
        demo_balance: wallet.balance,
      });
      return startRound(roundDeps, ctx, req);
    }
  };

  /**
   * Раунд, в котором мы были, платформа больше открытым не считает
   * (`RoundAlreadySettled`). Соединение при этом целое, и игрок вправе
   * продолжать играть — но только с чистого листа:
   *
   *  - `current` обязана обнулиться. Иначе КАЖДЫЙ следующий `play`, включая
   *    новый `spin`, пойдёт в `advanceRound` мёртвого раунда и разобьётся о
   *    проверку `nextActions` — соединение навсегда заклинено, игрок не может
   *    играть до перезагрузки страницы.
   *  - вслед за ошибкой шлём свежий `init`. Деньги за тот раунд двигала
   *    платформа, а не мы: баланс у игрока на экране (и в кеше моста, которым
   *    он отвечает на `getBalance`) устарел ровно в этот момент.
   *
   * `resume: null` здесь не догадка: до этой ошибки восстановление уже
   * перечитало SessionInfo и увидело раунд закрытым — открывать нечего.
   */
  const forgetSettledRound = async (): Promise<void> => {
    current = null;
    try {
      const info = await deps.api.sessionInfo({
        session_id: sessionId,
        player_connection_info: connection,
      });
      // Решение игрока о кампании соединение переживает — перечитывание
      // сессии освежает платформенные счётчики, а не спрашивает заново.
      ctx = toSessionContext(sessionId, info, ctx.frc);
      // Баланс демо ведёт кошелёк, а не платформа: её число для демо-сессии
      // статично и переиграло бы всё, что игрок наиграл на этом соединении.
      send({
        t: 'init',
        ...buildInit(info, { wallet: demoApi, frc: ctx.frc }),
        resume: null,
      });
    } catch (err) {
      // Перечитать не вышло — соединение всё равно расклинено, а баланс
      // приедет со следующим `balance`-событием платформы или реконнектом.
      log.warn('failed to refresh session after a settled round', { error: String(err) });
    }
  };

  try {
    const info = await deps.api.sessionInfo({
      session_id: sessionId,
      player_connection_info: connection,
    });
    ctx = toSessionContext(sessionId, info);
    const verdict = classifyCurrency(info);
    demo = verdict.demo;
    currencyOnWire = verdict.wire;
    demoSeedBalance = demoStartingBalance(info, deps.startingDemoBalance);
    if (verdict.deviates) {
      // Не глушим отклонение молчаливым дефолтом: платформа шлёт не то, что
      // обещает её же спека, и следующий человек должен увидеть это в логе, а
      // не выводить заново из `OperationNotAllowed` на каждом спине.
      log.warn(
        'SessionInfoResponse.currency не соответствует доке платформы; сессия обслуживается как реальные деньги',
        {
          currency_on_wire: verdict.wire,
          expected: 'ISO 4217 string, либо null для демо',
          // Обратное предположение молчаливо разорило бы реального игрока;
          // это — один отказ платформы, после которого мы переключимся сами.
          on_demo_rejection: 'сессия перейдёт на локальный кошелёк',
        },
      );
    }
    if (demo) {
      // Games API отвечает OperationNotAllowed на раундовые RPC демо-сессии —
      // подменяем источник раундов локальной заглушкой без сети.
      switchToDemoWallet();
    }
    // В демо кадр обязан называть баланс кошелька: разойдись они, игрок увидел
    // бы одну сумму на загрузке и другую сразу после первого спина.
    //
    // Кампания едет здесь ПРЕДЛОЖЕННОЙ (`toSessionContext` без предыдущего
    // состояния): новое соединение обязано предложить её заново, даже если
    // игрок только что её отыгрывал, — `free-rounds-campaign-backend-integration.md:47`.
    const init = buildInit(info, { wallet: demoApi, frc: ctx.frc });

    // Незакрытый раунд возвращаем игроку туда, где он остановился.
    let resume = null;
    if (!demo && info.last_round && !info.last_round.finished_at) {
      // Открытый раунд у платформы — доказательство денежной сессии само по
      // себе: демо-сессии она раунды не открывает. Переключаться на кошелёк
      // после этого нельзя ни при каком отказе.
      platformSettled = true;
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
      // Ответ игрока анонсеру. Ни одной RPC к платформе: у неё нет поля, в
      // которое это можно было бы записать (см. `session/frc.ts`), — согласие
      // живёт в состоянии соединения и только в нём.
      if (msg.t === 'frc_activate' || msg.t === 'frc_decline') {
        const frc =
          msg.t === 'frc_activate'
            ? activateCampaign(ctx.frc, msg.campaignId)
            : declineCampaign(ctx.frc, msg.campaignId);
        ctx = { ...ctx, frc };
        log.info(`free round campaign ${frc.status}`, {
          campaign_id: frc.campaignId,
          rounds_left: frc.roundsLeft,
          bet_index: frc.betIndex,
        });
        send({ t: 'frc', id: msg.id, ...toFrcInfo(frc) });
        return;
      }
      // Демо: движок крутится, платформу не трогаем — она отвечает
      // OperationNotAllowed на раундовые RPC демо-сессии.
      //
      // `SessionIsNotInitialized` и `InvalidRoundOperation` чинятся
      // перечитыванием состояния, а не слепым ретраем — withSessionRecovery
      // переинициализирует сессию/раунд и повторяет попытку ровно один раз.
      //
      // Вход в раунд отдельно обёрнут `openRoundWithDemoFallback`: только там
      // отказ «это демо-пользователь» безопасно переиграть локально.
      const outcome = await withSessionRecovery(
        {
          sessionInfo: async () => {
            const info = await deps.api.sessionInfo({
              session_id: sessionId, player_connection_info: connection,
            });
            // Смысл перечитывания — синхронизироваться с платформой: ставки
            // и фри-раунд могли поменяться, повтор обязан идти со свежими
            // значениями, а не с теми, что были на коннекте. Решение игрока о
            // кампании при этом переносим: сбросить его здесь значило бы, что
            // первое же восстановление посреди активной кампании отправляет
            // следующий спин платным.
            ctx = toSessionContext(sessionId, info, ctx.frc);
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
          resync: async (activeRound) => {
            // Переигрываем раунд из его же лога действий под НОВЫМ `eid`:
            // движок детерминирован, а старый экземпляр (тот, что успел
            // сыграть лишний сегмент) остаётся брошенным мусором в памяти
            // движка до TTL сессии. Переиспользовать его нельзя — `StartRound`
            // отказывает по существующему `eid`, а доверять его позиции
            // нечему: она и есть то расхождение, которое мы чиним.
            await replayRound(
              deps.engine, deps.gameId, activeRound.state, activeRound.state.actions.length,
            );
            return activeRound;
          },
        },
        (activeRound) =>
          activeRound
            ? advanceRound(roundDeps, ctx, activeRound, msg)
            : openRoundWithDemoFallback(msg),
        current,
      );
      current = outcome.round;
      // Платформа приняла раундовую RPC — сессия денежная, доказано делом.
      if (!demo) platformSettled = true;
      // Остаток кампании платформа называет в ответе на КАЖДЫЙ фри-раунд, и
      // это единственное место, где мы узнаём, что раунды кончились. Не
      // записать его значило слать завершённую кампанию до перезагрузки
      // страницы и получать `FrcAlreadyCompleted` на каждый спин.
      const wasActive = ctx.frc?.status === 'active';
      ctx = applyCampaignProgress(ctx, outcome.delivery.frc);
      const finished = wasActive && ctx.frc?.status === 'completed';
      if (finished) {
        log.info('free round campaign completed', {
          campaign_id: ctx.frc!.campaignId, total_win: ctx.frc!.totalWin,
        });
      }
      send({ t: 'result', id: msg.id, ...outcome.delivery });
      // Итог кампании — отдельным кадром и ПОСЛЕ результата: игрок сначала
      // досматривает последний фри-раунд, и только потом видит попап с общей
      // суммой. `result.frc` того же спина несёт лишь счётчики, а фронту для
      // возврата в обычный режим нужен статус.
      if (finished) send({ t: 'frc', ...toFrcInfo(ctx.frc!) });
    } catch (err) {
      fail(err, msg.t === 'ack' ? undefined : msg.id);
      if (err instanceof RoundNoLongerOpenError) await forgetSettledRound();
    }
  };
  socket.on('message', (raw) => {
    queue = queue.then(() => onMessage(raw.toString()));
  });
}
