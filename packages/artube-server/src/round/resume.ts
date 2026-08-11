/**
 * Восстановление незакрытого раунда и автозакрытие.
 *
 * Оба сценария начинаются одинаково: берём `round_state` из платформы и
 * поднимаем раунд в движке холодным путём. Если поднять нельзя — скрипт
 * разъехался после деплоя — закрываем раунд накопленным множителем: игрок
 * получает деньги, хоть и не досматривает фичу.
 */

import { ROUND_STATE_VERSION, decodeRoundState, encodeRoundState, type RoundStateV1 } from './roundState.js';
import { ensureOpen, playToEnd, stepRound, ScriptMismatchError, type Segment } from './engineRound.js';
import { toDelivery, type ActiveRound, type RoundDeps } from './orchestrator.js';
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
 */
export async function resumeRound(
  deps: RoundDeps,
  ctx: SessionContext,
  lastRound: LastRound,
): Promise<ResumeOutcome | null> {
  if (lastRound.finished_at) return null;

  const state = decodeRoundState(lastRound.round_state);
  const betAmount = ctx.allowedBets[state.betIndex] ?? 0;

  let segment: Segment;
  try {
    await ensureOpen(deps.engine, deps.gameId, state);
    const known = await deps.engine.getRound(state.eid);
    if (known.round_complete) {
      // Лог уже покрывает весь раунд целиком: ensureOpen догнало движок ровно
      // до конца, а неподтверждённого сегмента, который можно было бы
      // переиграть, за логом больше нет. Это НЕ ScriptMismatch — раунд
      // воспроизвёлся честно, просто CloseRound по нему раньше не прошёл.
      // Курсор не двигаем: лог уже отражает все подтверждённые сегменты, а
      // дальше степать по завершённому раунду нечем — next_actions здесь
      // означает "чем стартовать новый раунд", а не продолжение этого.
      const balance = await closeWith(deps, ctx, lastRound, state, state.totalWinX);
      return {
        delivery: toDelivery(
          finalSegment(state, known.next_actions),
          lastRound.round_id,
          betAmount,
          balance,
          false,
          false,
        ),
        round: null,
        recovered: false,
      };
    }
    // Неподтверждённый сегмент переигрываем заново: игрок его не досмотрел.
    segment = await stepRound(deps.engine, state, known.next_actions[0]);
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

  const nextState: RoundStateV1 = { ...state, actions: [...state.actions, { a: segment.action }] };

  if (segment.isFinal) {
    // Сегмент, который мы только что переиграли, впервые попадает в лог
    // здесь — курсор обязан вырасти вместе с ним, иначе actions.length и
    // cursor разъедутся на единицу (тот самый разрыв, из-за которого
    // acknowledgeSegment нельзя доверять курсору без проверки). Тот же приём,
    // что и в advanceRound: finalState = ...state + cursor+1.
    const finalState: RoundStateV1 = { ...nextState, cursor: nextState.cursor + 1 };
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

/** Синтетический сегмент для раунда, чей лог уже полностью доигран. */
function finalSegment(state: RoundStateV1, nextActions: string[]): Segment {
  return {
    action: state.action,
    data: { stage: 'closed' },
    winX: 0,
    totalWinX: state.totalWinX,
    nextActions,
    spinsRemaining: 0,
    spinsPlayed: state.cursor,
    isFinal: true,
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
