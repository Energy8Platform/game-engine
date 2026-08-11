/**
 * Восстановление после ошибок, которые чинятся перечитыванием состояния.
 *
 * Это не ретрай по идемпотентности: платформа прямо говорит, что делать.
 * `SessionIsNotInitialized` — сессию на этом коннекте ещё не инициализировали
 * (обычно после реконнекта); `InvalidRoundOperation` — у нас разъехались
 * `round_version` или курсор, и правду знает только Games API.
 */

import { GamesApiError } from '../games-api/errors.js';
import type { SessionInfoResponse } from '../games-api/types.js';
import type { ActiveRound } from '../round/orchestrator.js';

export interface RecoveryDeps {
  sessionInfo(): Promise<SessionInfoResponse>;
  /** Восстановить незакрытый раунд из свежего SessionInfo. */
  resume(info: SessionInfoResponse): Promise<ActiveRound | null>;
}

const RECOVERABLE = new Set(['SessionIsNotInitialized', 'InvalidRoundOperation']);

export async function withSessionRecovery<T>(
  deps: RecoveryDeps,
  run: (round: ActiveRound | null) => Promise<T>,
  round: ActiveRound | null,
): Promise<T> {
  try {
    return await run(round);
  } catch (err) {
    if (!(err instanceof GamesApiError) || !RECOVERABLE.has(err.code)) throw err;
    const info = await deps.sessionInfo();
    // Курсор и версия раунда — платформенные; после перечитывания идём с ними.
    const repaired = err.code === 'InvalidRoundOperation' ? await deps.resume(info) : round;
    return run(repaired);
  }
}
