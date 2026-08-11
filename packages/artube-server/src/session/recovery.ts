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

const RECOVERABLE = new Set(['SessionIsNotInitialized', 'InvalidRoundOperation']);

export async function withSessionRecovery(
  deps: RecoveryDeps,
  run: (round: ActiveRound | null) => Promise<PlayOutcome>,
  round: ActiveRound | null,
): Promise<PlayOutcome> {
  try {
    return await run(round);
  } catch (err) {
    if (!(err instanceof GamesApiError) || !RECOVERABLE.has(err.code)) throw err;
    const info = await deps.sessionInfo();
    // SessionIsNotInitialized: платформа лишь ждала SessionInfo — раунд, с
    // которым мы уже были, не мог от этого протухнуть, повторяем как есть.
    if (err.code === 'SessionIsNotInitialized') return run(round);
    // InvalidRoundOperation: курсор/версия раунда — платформенные, идём с ними.
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
