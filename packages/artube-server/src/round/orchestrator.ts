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
import { openEntry, type Segment } from './engineRound.js';
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

/** Заглушка на время Task 7 — многосегментный путь приходит в Task 8. */
async function openComplex(
  _deps: RoundDeps,
  _ctx: SessionContext,
  _state: RoundStateV1,
  _first: Segment,
  _betAmount: number,
): Promise<{ delivery: SegmentDelivery; round: ActiveRound | null }> {
  throw new Error('complex round not implemented yet');
}
