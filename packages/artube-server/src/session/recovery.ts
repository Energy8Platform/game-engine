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
    return resumed.settled ? resumed.outcome : run(resumed.round);
  }
}
