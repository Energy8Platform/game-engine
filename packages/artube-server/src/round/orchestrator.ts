/**
 * Оркестратор раунда — чистые функции поверх Games API и движка.
 *
 * Ни одного поля, переживающего запрос: всё, что нужно для продолжения раунда,
 * возвращается наружу и уезжает в `round_state` платформы.
 *
 * Entry-действие — один шаг движка; `isFinal` в ответе решает, простой это
 * раунд (PlayRound) или сложный (Open/Update/Close).
 */

import type { EngineClient } from '../engine/index.js';
import { openEntry, ensureOpen, stepRound, type Segment } from './engineRound.js';
import {
  encodeRoundState, newEngineRoundId, newSeed, ROUND_STATE_VERSION, type RoundStateV1,
} from './roundState.js';
import type {
  PlayRoundRequest, PlayRoundResponse,
  OpenRoundRequest, OpenRoundResponse,
  UpdateRoundStateRequest, UpdateRoundStateResponse,
  CloseRoundRequest, CloseRoundResponse,
  AutocloseRoundRequest,
} from '../games-api/types.js';
import type { PlayRequest, SegmentDelivery, SessionContext } from '../session/types.js';

/** Узкий структурный интерфейс: в тестах подменяется заглушкой. */
export interface RoundApi {
  playRound(req: PlayRoundRequest): Promise<PlayRoundResponse>;
  openRound(req: OpenRoundRequest): Promise<OpenRoundResponse>;
  updateRoundState(req: UpdateRoundStateRequest): Promise<UpdateRoundStateResponse>;
  closeRound(req: CloseRoundRequest): Promise<CloseRoundResponse>;
  autocloseRound(req: AutocloseRoundRequest): Promise<CloseRoundResponse>;
}

export interface RoundDeps {
  api: RoundApi;
  engine: EngineClient;
  gameId: string;
  /**
   * `actions[action].cost_multiplier` из GetConfig движка. Читается один раз
   * на старте: `RoundResponse.bet` — это эхо переданной ставки, а не цена.
   */
  costMultipliers: Record<string, number>;
}

/** Незакрытый раунд: всё, что нужно, чтобы отдать следующий сегмент. */
export interface ActiveRound {
  roundId: string;
  /** Версия раунда, которую считает Games API. */
  roundVersion: number;
  state: RoundStateV1;
  /** Последний выданный сегмент, ещё не подтверждённый игроком. */
  delivered: Segment | null;
}

export function resolvePriceMultiplier(
  deps: RoundDeps,
  action: string,
  frcActive: boolean,
): number {
  // Фри-раунд игрок не оплачивает — дока требует ровно 0.
  if (frcActive) return 0;
  return deps.costMultipliers[action] ?? 1;
}

/**
 * Ставка раунда для показа игроку.
 *
 * Источник правды — сам раунд: `allowed_bets` платформа вправе поменять
 * посреди раунда (и `ctx` перечитывается из свежего SessionInfo на каждом
 * восстановлении), после чего индекс раунда в новом списке может ничего не
 * значить или указывать на чужую сумму. Без этого `betAmount` уезжал бы
 * наружу как `undefined`, `JSON.stringify` выбрасывал бы поле, а фронт
 * считал бы `totalWinX * undefined` — NaN в балансе и в выигрыше.
 *
 * Резервные ветки нужны только для состояний, записанных сборкой без поля
 * `bet`: сначала пробуем платформенный список, и лишь потом сдаёмся в ноль —
 * показать ноль честнее, чем показать NaN.
 */
export function roundBetAmount(state: RoundStateV1, ctx: SessionContext): number {
  if (Number.isFinite(state.bet)) return state.bet;
  const fromSession = ctx.allowedBets[state.betIndex];
  return Number.isFinite(fromSession) ? fromSession : 0;
}

export function toDelivery(
  segment: Segment,
  roundId: string,
  betAmount: number,
  balanceAfter: number | null,
  creditPending: boolean,
  maxWinReached: boolean,
): SegmentDelivery {
  return {
    roundId,
    action: segment.action,
    data: segment.data,
    winX: segment.winX,
    totalWinX: segment.totalWinX,
    betAmount,
    nextActions: segment.nextActions,
    spinsRemaining: segment.spinsRemaining,
    spinsPlayed: segment.spinsPlayed,
    balanceAfter,
    creditPending,
    maxWinReached,
  };
}

/**
 * Начать раунд: один шаг движка, затем одна RPC платформе. Для одиночного
 * сегмента `round` равен `null` — продолжения не будет.
 */
export async function startRound(
  deps: RoundDeps,
  ctx: SessionContext,
  req: PlayRequest,
): Promise<{ delivery: SegmentDelivery; round: ActiveRound | null }> {
  const betAmount = ctx.allowedBets[req.betIndex];
  if (betAmount === undefined) {
    throw new Error(`bet_index ${req.betIndex} вне allowed_bets`);
  }

  const state: RoundStateV1 = {
    v: 1,
    seed: newSeed(),
    eid: newEngineRoundId(),
    script: '',
    action: req.action,
    betIndex: req.betIndex,
    // Фиксируем сумму ставки на всё время раунда: список allowed_bets
    // платформа вправе поменять, пока раунд идёт.
    bet: betAmount,
    priceMultiplier: resolvePriceMultiplier(deps, req.action, Boolean(ctx.frcId)),
    cursor: 0,
    totalWinX: 0,
    actions: [],
    frcId: ctx.frcId,
  };

  const first = await openEntry(deps.engine, deps.gameId, state);
  return first.isFinal
    ? finishSimple(deps, ctx, state, first, betAmount)
    : openComplex(deps, ctx, state, first, betAmount);
}

/** Раунд из одного сегмента: ставка и выигрыш одной транзакцией. */
async function finishSimple(
  deps: RoundDeps,
  ctx: SessionContext,
  state: RoundStateV1,
  segment: Segment,
  betAmount: number,
): Promise<{ delivery: SegmentDelivery; round: null }> {
  const settled: RoundStateV1 = { ...state, cursor: 1, totalWinX: segment.totalWinX };
  const res = await deps.api.playRound({
    session_id: ctx.sessionId,
    price_multiplier: state.priceMultiplier,
    bet_index: state.betIndex,
    win_multiplier: segment.totalWinX,
    free_round_campaign_id: ctx.frcId,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState(settled),
  });
  const delivery = toDelivery(
    segment, res.round_id, betAmount, res.balance, false, res.is_platform_max_win_reached,
  );
  delivery.frc = res.free_round_campaign ?? null;
  return { delivery, round: null };
}

/**
 * Раунд из нескольких сегментов: OpenRound списывает ставку и ОБЯЗАН вернуть
 * новый баланс после списания (`open-round.md`) — его и отдаём.
 *
 * `creditPending` и «баланс неизвестен» — разные утверждения, и путать их
 * дорого: выигрыш действительно зачислится только на CloseRound, но ставка
 * списана уже здесь, и платформа только что назвала результат. Отдавая
 * `null`, мы заставляли фронт показывать баланс ДО списания весь бонус —
 * игрок покупал фичу и не видел, что за неё заплатил.
 */
async function openComplex(
  deps: RoundDeps,
  ctx: SessionContext,
  state: RoundStateV1,
  first: Segment,
  betAmount: number,
): Promise<{ delivery: SegmentDelivery; round: ActiveRound }> {
  const res = await deps.api.openRound({
    session_id: ctx.sessionId,
    price_multiplier: state.priceMultiplier,
    bet_index: state.betIndex,
    free_round_campaign_id: ctx.frcId,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState(state),
  });
  return {
    delivery: toDelivery(first, res.round_id, betAmount, res.balance, true, false),
    round: {
      roundId: res.round_id,
      roundVersion: res.round_version,
      state,
      delivered: first,
    },
  };
}

/**
 * Игрок увидел сегмент — двигаем курсор в состоянии платформы.
 *
 * Курсор двигает только подтверждение: пока `ack` не пришёл, сегмент считается
 * недосмотренным, и реконнект обязан вернуть именно его. Сам факт того, что
 * сегмент сыгран, в `round_state` уже записан — это делает `advanceRound` в
 * момент игры, отдельным UpdateRoundState.
 */
export async function acknowledgeSegment(
  deps: RoundDeps,
  ctx: SessionContext,
  round: ActiveRound,
  cursor: number,
): Promise<ActiveRound> {
  const state: RoundStateV1 = {
    ...round.state,
    cursor,
    totalWinX: round.delivered?.totalWinX ?? round.state.totalWinX,
  };
  const res = await deps.api.updateRoundState({
    session_id: ctx.sessionId,
    round_id: round.roundId,
    round_version: round.roundVersion,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState(state),
  });
  return { ...round, roundVersion: res.round_version, state };
}

/**
 * Следующий сегмент открытого раунда — ровно один шаг движка. Промежуточный
 * едет без баланса не потому, что тот неизвестен, а потому, что
 * UpdateRoundState его не возвращает вовсе: денег на этом шаге не двигают.
 * На финальном шлём CloseRound — он и приносит баланс с зачисленным выигрышем.
 */
export async function advanceRound(
  deps: RoundDeps,
  ctx: SessionContext,
  round: ActiveRound,
  req: PlayRequest,
): Promise<{ delivery: SegmentDelivery; round: ActiveRound | null }> {
  const allowed = round.delivered?.nextActions ?? [];
  if (allowed.length > 0 && !allowed.includes(req.action)) {
    throw new Error(`action "${req.action}" is not allowed here, expected one of ${allowed.join(', ')}`);
  }

  // Горячий путь ничего не стоит; холодный поднимет раунд из лога действий.
  await ensureOpen(deps.engine, deps.gameId, round.state);
  const segment = await stepRound(deps.engine, round.state, req.action, req.params);

  // Действие обязано попасть в лог до того, как состояние уедет к Artube:
  // без него холодный подъём воспроизведёт другой раунд.
  const logged = req.params ? { a: req.action, p: req.params } : { a: req.action };
  const state: RoundStateV1 = { ...round.state, actions: [...round.state.actions, logged] };
  const betAmount = roundBetAmount(state, ctx);

  if (!segment.isFinal) {
    // Сегмент сыгран — платформа обязана узнать об этом СЕЙЧАС, а не на
    // подтверждении. Между выдачей сегмента и `ack` живёт вся анимация фичи,
    // и обрыв связи в этом окне — обычное дело: без этой записи сыгранный
    // сегмент существовал бы только в памяти пода, а `round_state` описывал бы
    // раунд короче, чем он есть. Курсор не двигаем — его двигает только `ack`.
    // UpdateRoundState идемпотентен и потому дёшев и безопасен.
    const res = await deps.api.updateRoundState({
      session_id: ctx.sessionId,
      round_id: round.roundId,
      round_version: round.roundVersion,
      round_state_version: ROUND_STATE_VERSION,
      round_state: encodeRoundState(state),
    });
    return {
      delivery: toDelivery(segment, round.roundId, betAmount, null, true, false),
      round: { ...round, roundVersion: res.round_version, state, delivered: segment },
    };
  }

  // Финальный сегмент везёт своё действие в самом CloseRound — лишней RPC
  // перед денежной не делаем. Если CloseRound не пройдёт, лог у платформы
  // останется на шаг короче реально сыгранного, и восстановление (которое
  // переигрывает раунд из лога и доигрывает вперёд) воспроизведёт этот же
  // сегмент заново — движок детерминирован.
  const finalState: RoundStateV1 = {
    ...state,
    cursor: state.cursor + 1,
    totalWinX: segment.totalWinX,
  };
  const res = await deps.api.closeRound({
    session_id: ctx.sessionId,
    round_id: round.roundId,
    win_multiplier: segment.totalWinX,
    status: 'completed',
    round_version: round.roundVersion,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState(finalState),
  });
  const delivery = toDelivery(segment, round.roundId, betAmount, res.balance, false, false);
  delivery.frc = res.free_round_campaign ?? null;
  return { delivery, round: null };
}
