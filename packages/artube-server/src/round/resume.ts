/**
 * Восстановление незакрытого раунда и автозакрытие.
 *
 * Оба сценария начинаются одинаково: берём `round_state` из платформы и
 * поднимаем раунд в движке холодным путём. Если поднять нельзя — скрипт
 * разъехался после деплоя — закрываем раунд накопленным множителем: игрок
 * получает деньги, хоть и не досматривает фичу.
 */

import { ROUND_STATE_VERSION, decodeRoundState, encodeRoundState, type RoundStateV1 } from './roundState.js';
import { playToEnd, replayRound, stepRound, ScriptMismatchError, type Segment } from './engineRound.js';
import { roundBetAmount, toDelivery, type ActiveRound, type RoundDeps } from './orchestrator.js';
import type { SegmentDelivery, SessionContext } from '../session/types.js';
import type { LastRound } from '../games-api/types.js';

export interface ResumeOutcome {
  delivery: SegmentDelivery;
  /** `null` — раунд закрыт, продолжать нечего. */
  round: ActiveRound | null;
  /** true — раунд не удалось воспроизвести и он был закрыт аварийно. */
  recovered: boolean;
}

/** Синтетический сегмент для случая, когда раунд поднять не удалось. */
function recoveredSegment(state: RoundStateV1): Segment {
  return {
    action: state.action,
    data: { stage: 'recovered' },
    winX: state.totalWinX,
    totalWinX: state.totalWinX,
    nextActions: ['spin'],
    spinsRemaining: 0,
    spinsPlayed: state.cursor,
    isFinal: true,
  };
}

/**
 * `state.cursor` на входе уже обязан быть верным — эта функция лишь
 * проставляет `totalWinX` поверх. Каждая ветка `resumeRound` сама решает,
 * каким курсором закрывать, до вызова сюда.
 */
async function closeWith(
  deps: RoundDeps,
  ctx: SessionContext,
  lastRound: LastRound,
  state: RoundStateV1,
  winX: number,
): Promise<number> {
  const res = await deps.api.closeRound({
    session_id: ctx.sessionId,
    round_id: lastRound.round_id,
    win_multiplier: winX,
    status: 'completed',
    round_version: lastRound.round_version,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState({ ...state, totalWinX: winX }),
  });
  return res.balance;
}

/**
 * Вернуть игрока туда, где он остановился. `null` — восстанавливать нечего:
 * раунд уже закрыт платформой.
 *
 * Раунд поднимаем ПЕРЕИГРЫВАНИЕМ из `round_state` под новым `eid`, а не
 * продолжением того, что лежит в кэше движка. Кэш на этом пути доверия не
 * заслуживает: обрыв связи почти всегда случается посреди анимации сегмента,
 * то есть тогда, когда движок на шаг впереди подтверждённого курсора. Движок
 * детерминирован, поэтому переигрывание отдаёт ровно тот же сегмент — и на
 * горячем поде, и на холодном, без единой ветки "а вдруг он уже сыгран".
 *
 * Что именно отдать, решает `round_state`:
 *  - `cursor` меньше числа сыгранных сегментов → игрок не досмотрел сегмент
 *    `cursor`, и он же отдаётся заново;
 *  - всё сыгранное подтверждено → играем следующий сегмент.
 */
export async function resumeRound(
  deps: RoundDeps,
  ctx: SessionContext,
  lastRound: LastRound,
): Promise<ResumeOutcome | null> {
  if (lastRound.finished_at) return null;

  const state = decodeRoundState(lastRound.round_state);
  const betAmount = roundBetAmount(state, ctx);
  // Сегментов подтверждено, считая entry первым. Зажимаем сверху: курсор
  // впереди лога означал бы битое состояние, и играть по нему хуже, чем
  // отдать игроку последний воспроизводимый сегмент.
  const acked = Math.max(0, Math.min(state.cursor, state.actions.length + 1));
  const hasUnacked = acked <= state.actions.length;

  let segment: Segment;
  let actions = state.actions;
  try {
    const replayed = await replayRound(
      deps.engine,
      deps.gameId,
      state,
      hasUnacked ? acked : state.actions.length,
    );
    if (hasUnacked) {
      // Переигранный сегмент — ровно тот, который игрок не досмотрел.
      // Всё, что было сыграно ЗА ним и тоже не подтверждено, из лога
      // выпадает: игрок этого не видел, а раунд отсюда пойдёт заново.
      segment = replayed;
      actions = state.actions.slice(0, acked);
    } else if (replayed.isFinal) {
      // Лог уже покрывает раунд целиком (CloseRound по нему когда-то не
      // прошёл). Это не рассинхрон: раунд воспроизвёлся честно, продолжать в
      // нём нечего — закрываем настоящим итогом из движка.
      segment = replayed;
    } else {
      const action = replayed.nextActions[0];
      if (!action) {
        throw new Error(`round ${state.eid}: сегмент не финальный, но продолжать нечем`);
      }
      segment = await stepRound(deps.engine, state, action);
      actions = [...state.actions, { a: action }];
    }
  } catch (err) {
    if (!(err instanceof ScriptMismatchError)) throw err;
    // Курсор не двигаем: ничего нового не сыграли, отдаём накопленное как
    // есть — то, что уже было подтверждено до разрыва.
    const balance = await closeWith(deps, ctx, lastRound, state, state.totalWinX);
    return {
      delivery: toDelivery(recoveredSegment(state), lastRound.round_id, betAmount, balance, false, false),
      round: null,
      recovered: true,
    };
  }

  const nextState: RoundStateV1 = { ...state, actions };

  if (segment.isFinal) {
    // Раунд доигран: подтверждать в нём больше нечего, курсор встаёт на
    // конец лога (entry + все действия).
    const finalState: RoundStateV1 = { ...nextState, cursor: actions.length + 1 };
    const balance = await closeWith(deps, ctx, lastRound, finalState, segment.totalWinX);
    return {
      delivery: toDelivery(segment, lastRound.round_id, betAmount, balance, false, false),
      round: null,
      recovered: false,
    };
  }

  return {
    delivery: toDelivery(segment, lastRound.round_id, betAmount, null, true, false),
    round: {
      roundId: lastRound.round_id,
      roundVersion: lastRound.round_version,
      state: nextState,
      delivered: segment,
    },
    recovered: false,
  };
}

/**
 * Автозакрытие v2: доигрываем раунд от лица игрока и отдаём платформе честный
 * математический итог. Провал этого пути платформа через минуту добьёт
 * откатом v1, поэтому ошибки наружу не глотаем.
 */
export async function autocloseRound(
  deps: RoundDeps,
  ctx: SessionContext,
  lastRound: LastRound,
): Promise<number> {
  const state = decodeRoundState(lastRound.round_state);
  // Снимок ДО playToEnd: та мутирует переданный объект (actions/cursor/
  // totalWinX) на каждой итерации и может бросить ScriptMismatchError уже
  // после части мутаций. Кодировать в запрос на провальном пути нужно то, что
  // реально лежало в round_state платформы, а не наполовину дописанный лог —
  // отсюда отдельная копия `actions`, а не просто ссылка на state.actions.
  const snapshot: RoundStateV1 = { ...state, actions: [...state.actions] };
  let finalState = snapshot;
  let winX = state.totalWinX;
  try {
    winX = await playToEnd(deps.engine, deps.gameId, state);
    // playToEnd сама держит state.cursor/actions в согласии друг с другом на
    // каждом шаге (иначе следующий шаг внутри неё же посчитал бы request_id
    // неверно) — здесь просто забираем итог, курсор уже верный.
    finalState = state;
  } catch (err) {
    if (!(err instanceof ScriptMismatchError)) throw err;
    // Поднять раунд нечем — отдаём то, что игрок уже накопил, курсор как был.
  }
  const res = await deps.api.autocloseRound({
    session_id: ctx.sessionId,
    round_id: lastRound.round_id,
    win_multiplier: winX,
    status: 'completed',
    round_version: lastRound.round_version,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState({ ...finalState, totalWinX: winX }),
  });
  return res.balance;
}
