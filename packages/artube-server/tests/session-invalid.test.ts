/**
 * `SessionInvalid` — восстанавливаемая ошибка, а не приговор соединению (F8).
 *
 * Классификацию даёт сама платформа: `error-handling.md` кладёт этот код в
 * «🟡 Временные ошибки (восстанавливаемые)» рядом с `SessionIsNotInitialized`,
 * а `error-responses.md` называет действие «переподключиться» — для игрового
 * бэкенда это и есть `SessionInfoRequest`. До этого код уезжал во фронт
 * обычной ошибкой, и у игрока не оставалось ничего, кроме перезагрузки
 * страницы.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { handleConnection } from '../src/http/ws';
import { GamesApiError } from '../src/games-api/errors';
import type { SessionInfoResponse } from '../src/games-api/types';
import type { Logger } from '../src/http/log';

const SESSION: SessionInfoResponse = {
  security_hash: 'h',
  currency: 'USD',
  balance: 100,
  game_settings: {
    default_bet_index: 0,
    currency_minimal_unit: 0.01,
    allowed_bets: [1],
    available_auto_spin_counts: [10],
    rtp_options: [],
    rtp_settings: { is_visible: false },
    locales: ['EN'],
  },
} as SessionInfoResponse;

const silentLog: Logger = {
  info: () => {}, warn: () => {}, error: () => {}, child: () => silentLog,
};

class FakeSocket extends EventEmitter {
  readonly sent: any[] = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  close(): void {}
}

const engine = {
  startRound: async () => ({
    error: '', script_sha256: 'sha', data_json: '{}',
    win: 2, total_win: 2, next_actions: [] as string[],
    spins_remaining: 0, spins_played: 1, round_complete: true,
  }),
};

const sessionInvalid = () =>
  new GamesApiError({ code: 'SessionInvalid', message: 'The session is invalid or cannot be retrieved' });

/**
 * @param failSessionInfoAfter сколько ответов на SessionInfo платформа отдаёт,
 *   прежде чем начать отвергать и его тоже (сессия мертва по-настоящему).
 */
async function openSession(opts: { failSessionInfoAfter?: number } = {}) {
  const socket = new FakeSocket();
  let infoCalls = 0;
  let plays = 0;
  const api = {
    sessionInfo: vi.fn(async () => {
      if (opts.failSessionInfoAfter !== undefined && ++infoCalls > opts.failSessionInfoAfter) {
        throw sessionInvalid();
      }
      return SESSION;
    }),
    // Первая денежная RPC отвергнута — платформа не нашла сессию.
    playRound: vi.fn(async () => {
      if (++plays === 1) throw sessionInvalid();
      return { round_id: 'r', balance: 142, win: 2, is_platform_max_win_reached: false };
    }),
    on: () => {}, off: () => {},
  };
  await handleConnection(socket as unknown as WebSocket, 'sess', {
    api: api as any,
    engine: engine as any,
    gameId: 'g',
    costMultipliers: { spin: 1 },
    startingDemoBalance: 1000,
    log: silentLog,
  });
  socket.emit('message', JSON.stringify({ t: 'play', id: 'p1', action: 'spin', betIndex: 0 }));
  for (let i = 0; i < 200; i++) {
    if (socket.sent.some((m) => (m.t === 'result' || m.t === 'error') && m.id === 'p1')) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  return { api, answer: socket.sent.find((m) => m.id === 'p1') };
}

describe('SessionInvalid на денежной RPC', () => {
  it('сессия перечитывается, спин доигрывается — игрок видит результат, а не ошибку', async () => {
    const s = await openSession();

    expect(s.answer.t).toBe('result');
    expect(s.answer.balanceAfter).toBe(142);
    // На платформу ушло ровно то, что предписывает дока: SessionInfo (коннект),
    // отвергнутый PlayRound, ещё один SessionInfo («переподключиться») и повтор.
    expect(s.api.sessionInfo).toHaveBeenCalledTimes(2);
    expect(s.api.playRound).toHaveBeenCalledTimes(2);
  });

  it('сессия мертва по-настоящему: код доезжает до игры, и повтор ровно один', async () => {
    // Перечитывание отвергнуто тем же кодом — восстанавливать нечего. Игрок
    // получает тот же `SessionInvalid`, что и раньше, а не бесконечный цикл.
    const s = await openSession({ failSessionInfoAfter: 1 });

    expect(s.answer.t).toBe('error');
    expect(s.answer.code).toBe('SessionInvalid');
    expect(s.api.sessionInfo).toHaveBeenCalledTimes(2);
    expect(s.api.playRound).toHaveBeenCalledTimes(1);
  });
});
