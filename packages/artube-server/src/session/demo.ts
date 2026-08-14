/**
 * Демо-режим: Games API его не поддерживает и отвечает OperationNotAllowed
 * на любые раундовые RPC. Поэтому демо обслуживает локальная заглушка с тем
 * же интерфейсом — она не ходит в сеть и живёт ровно столько, сколько
 * WS-соединение игрока.
 */

import { randomUUID } from 'node:crypto';
import type { RoundApi } from '../round/orchestrator.js';

/**
 * Локальная заглушка раундов + её кошелёк. `balance` торчит наружу, потому что
 * кошелёк — единственный источник правды о деньгах демо-сессии: init обязан
 * назвать ровно то число, с которого кошелёк стартует, иначе игрок видит одну
 * сумму на загрузке и другую после первого спина.
 */
export interface DemoApi extends RoundApi {
  readonly balance: number;
}

export function createDemoApi(startingBalance: number, betAmountOf: (index: number) => number): DemoApi {
  let balance = startingBalance;
  // Ставку открытого раунда помним до закрытия: CloseRoundRequest несёт
  // только множитель выигрыша, без индекса ставки.
  let openBet = 0;

  return {
    get balance() {
      return balance;
    },
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
      const win = req.win_multiplier * openBet;
      balance += win;
      return {
        balance, win, free_round_campaign: null, is_platform_max_win_reached: false,
      };
    },
    async autocloseRound(req) {
      const win = req.win_multiplier * openBet;
      balance += win;
      return { balance, win, is_platform_max_win_reached: false };
    },
  };
}
