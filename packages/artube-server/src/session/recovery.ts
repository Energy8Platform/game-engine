/**
 * Восстановление после ошибок, которые чинятся перечитыванием состояния.
 *
 * Это не ретрай по идемпотентности: платформа прямо говорит, что делать.
 * `SessionIsNotInitialized` — сессию на этом коннекте ещё не инициализировали
 * (обычно после реконнекта); `InvalidRoundOperation` — у нас разъехались
 * `round_version` или курсор, и правду знает только Games API.
 *
 * Специализирован под форму ответа `play` (`startRound`/`advanceRound`), а не
 * обобщён генериком: у него ровно одна точка вызова (`ws.ts`), а обобщение
 * потребовало бы придумывать, как "материализовать" уже готовый исход
 * восстановления в произвольный `T` — то есть тот же самый маппер под другим
 * именем.
 */

import { GamesApiError } from '../games-api/errors.js';
import type { SessionInfoResponse } from '../games-api/types.js';
import type { ActiveRound } from '../round/orchestrator.js';
import type { SegmentDelivery } from './types.js';

/** То, что `play` в итоге шлёт во фронт — общий возврат `startRound`/`advanceRound`. */
export interface PlayOutcome {
  delivery: SegmentDelivery;
  round: ActiveRound | null;
}

/**
 * Итог перечитывания раунда при `InvalidRoundOperation`.
 *
 * `settled: false` — раунд либо всё ещё открыт (`round` — свежая версия из
 * платформы), либо его не было вовсе (`round: null`, безопасно стартовать
 * заново клиентским действием).
 *
 * `settled: true` — восстановление само досчитало раунд и закрыло его на
 * платформе (сегмент, который мы переигрывали, оказался финальным). Клиентское
 * сообщение относилось к УЖЕ закрытому раунду — повторять его нельзя: если это
 * было мидраундовое действие вроде `free_spin`, `startRound` примет его как
 * entry для НОВОГО раунда и выставит реальный счёт через `PlayRound` за
 * раунд, который игрок не заказывал. Готовый исход просто отдаётся как есть.
 */
export type ResumeResult =
  | { settled: false; round: ActiveRound | null }
  | { settled: true; outcome: PlayOutcome };

export interface RecoveryDeps {
  sessionInfo(): Promise<SessionInfoResponse>;
  /** Восстановить состояние раунда из свежего SessionInfo. */
  resume(info: SessionInfoResponse): Promise<ResumeResult>;
  /**
   * Вернуть раунд в движке ровно к тому, что описывает его собственный
   * `round_state`, — перед повтором действия.
   *
   * Нужно потому, что `advanceRound` СНАЧАЛА играет сегмент и только потом
   * идёт в платформу: к моменту ошибки движок уже на шаг впереди лога
   * действий (лог уезжает вместе с успешной RPC). Слепой повтор упирается в
   * строгую проверку `ensureOpen` («движок впереди round_state») — и раунд
   * остаётся заклиненным навсегда, потому что впереди движок так и остаётся.
   */
  resync(round: ActiveRound): Promise<ActiveRound>;
}

/**
 * Раунд, в котором игрок был, платформа больше не считает открытым — его
 * успели закрыть автозакрытием, другой вкладкой или ретраем платформы.
 * Клиентское действие относилось к ТОМУ раунду, и повторять его как вход в
 * новый нельзя: это был бы реальный счёт за раунд, которого игрок не заказывал.
 */
export class RoundNoLongerOpenError extends Error {
  readonly code = 'RoundAlreadySettled';

  constructor(roundId: string) {
    super(`round ${roundId} is no longer open on the platform`);
    this.name = 'RoundNoLongerOpenError';
  }
}

/**
 * Ошибки, которые чинятся перечитыванием состояния, а не показом игроку.
 *
 * `SessionInvalid` попал сюда по классификации самой платформы: её
 * `error-handling.md` кладёт его в «🟡 Временные ошибки (восстанавливаемые)»,
 * рядом с `SessionIsNotInitialized` и `BackPressureRejected`, а
 * `error-responses.md` называет действие «переподключиться». Для игрового
 * бэкенда «переподключиться» — это и есть `SessionInfoRequest`: сессия
 * становится живой на коннекте ровно им, ничего другого «переподключить» здесь
 * нельзя. Сообщение платформы («The session is invalid **or cannot be
 * retrieved**») описывает не приговор идентификатору, а неудачу поиска.
 *
 * Что это стоит, если сессия всё-таки мертва: один лишний SessionInfo, который
 * отвергнут тем же кодом, — и тот же `SessionInvalid` уезжает игроку, как
 * уезжал раньше. Что это даёт, если платформа просто не достала сессию: игрок
 * доигрывает вместо ошибки, после которой у него не было ничего, кроме
 * перезагрузки страницы.
 *
 * Повтор безопасен по той же причине, что и у соседей по списку: платформа
 * ОТВЕРГЛА запрос, не найдя сессию, — значит ни раунд не открыт, ни транзакция
 * не проведена, и повторять нечего дважды. Идём при этом ветвью
 * `InvalidRoundOperation`, а не `SessionIsNotInitialized`: она перечитывает
 * раунд у платформы и умеет отказаться доигрывать закрытый (см.
 * `RoundNoLongerOpenError`), то есть из двух восстановлений — денежно
 * осторожное.
 */
const RECOVERABLE = new Set(['SessionIsNotInitialized', 'InvalidRoundOperation', 'SessionInvalid']);

/**
 * Мы послали идентификатор кампании, который платформа больше не признаёт.
 *
 * Штатно этого не бывает: остаток кампании приезжает в ответе на каждый
 * фри-раунд и снимает `frcId` (`applyCampaignProgress`). Но кампанию можно
 * потерять и путём, которого мы не видим, — истёк `valid_to`, оператор её
 * отменил, раунды доиграла соседняя вкладка. Тогда об этом сообщает только
 * отказ, и без реакции на него соединение заклинивало бы навсегда.
 */
const FRC_STALE = new Set(['FrcAlreadyCompleted', 'FrcNotFound']);

export async function withSessionRecovery(
  deps: RecoveryDeps,
  run: (round: ActiveRound | null) => Promise<PlayOutcome>,
  round: ActiveRound | null,
): Promise<PlayOutcome> {
  try {
    return await run(round);
  } catch (err) {
    // Кампании нет — перечитываем сессию, чтобы `frcId` ушёл из контекста, и
    // отдаём ошибку игроку. Повторять НЕ имеем права: спин без кампании стоит
    // денег, а игрок в этот момент считает, что играет бесплатным раундом.
    // Раунд не открылся (RPC отвергнута), так что следующий спин — обычный
    // платный — пройдёт с чистого листа.
    if (err instanceof GamesApiError && FRC_STALE.has(err.code)) {
      await deps.sessionInfo();
      throw err;
    }
    if (!(err instanceof GamesApiError) || !RECOVERABLE.has(err.code)) throw err;
    const info = await deps.sessionInfo();
    // SessionIsNotInitialized: платформа лишь ждала SessionInfo — раунд, с
    // которым мы уже были, не мог от этого протухнуть, повторяем его же.
    // Единственное, что нужно поправить перед повтором, — движок: провалившаяся
    // попытка успела сыграть в нём сегмент, которого нет в `round_state`.
    if (err.code === 'SessionIsNotInitialized') {
      return run(round ? await deps.resync(round) : null);
    }
    // InvalidRoundOperation и SessionInvalid: курсор/версия раунда —
    // платформенные, идём с ними (а после SessionInvalid у нас вообще нет
    // оснований верить своей памяти о раунде).
    const resumed = await deps.resume(info);
    if (resumed.settled) return resumed.outcome;
    // Раунда у платформы больше нет, а мы в нём были: значит клиентское
    // сообщение — мидраундовое действие уже закрытого раунда. `run(null)`
    // сыграл бы его как ВХОД в новый раунд и выставил бы за него настоящий
    // счёт. Единственная безопасная реакция — честно сказать, что раунд
    // закрыт; повторять действие не в чем.
    //
    // Сегодня от этого случайно спасал бы движок (мидраундовое действие
    // обычно не является entry-действием и отвергается до всякой RPC), но
    // ровно до первой игры, где вход и продолжение раунда называются
    // одинаково — respin/tumble, у которых в `next_actions` лежит `spin`.
    if (round && !resumed.round) throw new RoundNoLongerOpenError(round.roundId);
    return run(resumed.round);
  }
}
