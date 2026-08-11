/**
 * Демо-режим: Games API его не поддерживает и отвечает OperationNotAllowed
 * на любые раундовые RPC. Поэтому демо обслуживает локальная заглушка с тем
 * же интерфейсом — она не ходит в сеть и живёт ровно столько, сколько
 * WS-соединение игрока.
 */

import { randomUUID } from 'node:crypto';
import type { RoundApi } from '../round/orchestrator.js';

export function createDemoApi(startingBalance: number, betAmountOf: (index: number) => number): RoundApi {
  let balance = startingBalance;
  // Ставку открытого раунда помним до закрытия: CloseRoundRequest несёт
  // только множитель выигрыша, без индекса ставки.
  let openBet = 0;

  return {
    async playRound(req) {
      const bet = betAmountOf(req.bet_index);
      const win = bet * req.win_multiplier;
      balance = balance - bet * req.price_multiplier + win;
      return {
        round_id: randomUUID(), balance, win, is_platform_max_win_reached: false,
      };
    },
    async openRound(req) {
      openBet = betAmountOf(req.bet_index);
      balance -= openBet * req.price_multiplier;
      return { round_version: 0, round_id: randomUUID(), balance };
    },
    async updateRoundState() {
      return { round_version: 0 };
    },
    async closeRound(req) {
      balance += req.win_multiplier * openBet;
      return { balance, free_round_campaign: null };
    },
    async autocloseRound(req) {
      balance += req.win_multiplier * openBet;
      return { balance };
    },
  };
}
