/**
 * `code` в `error`-фрейме — это код НАШЕГО протокола, а не любое поле `code`,
 * какое окажется на выброшенной ошибке.
 *
 * Системные ошибки Node несут строковый `code` (`ECONNRESET`, `ABORT_ERR`,
 * `ENOENT`), и утиная проверка `typeof err.code === 'string'` отправляла их во
 * фронт как коды платформы: игра, разбирающая коды (`RoundAlreadySettled`,
 * `InsufficientFunds`, ...), получала бы мусор, который ни один её обработчик
 * не знает.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import { handleConnection } from '../src/http/ws';
import { GamesApiError } from '../src/games-api/errors';
import type { Logger } from '../src/http/log';

const SESSION_INFO = {
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
};

const silentLog: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
};

class FakeSocket extends EventEmitter {
  readonly sent: any[] = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  close(): void {}
}

/** Движок, который валится на любом вызове заданной ошибкой. */
function throwingEngine(err: unknown) {
  const boom = () => Promise.reject(err);
  return new Proxy({}, { get: () => boom });
}

async function playAgainst(err: unknown): Promise<any> {
  const socket = new FakeSocket();
  await handleConnection(socket as unknown as WebSocket, 'sess', {
    api: {
      sessionInfo: async () => SESSION_INFO,
      on: () => {},
      off: () => {},
    } as any,
    engine: throwingEngine(err) as any,
    gameId: 'g',
    costMultipliers: { spin: 1 },
    startingDemoBalance: 1000,
    log: silentLog,
  });
  socket.emit('message', JSON.stringify({ t: 'play', id: 'p1', action: 'spin', betIndex: 0 }));
  for (let i = 0; i < 50 && !socket.sent.some((m) => m.t === 'error'); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return socket.sent.find((m) => m.t === 'error');
}

describe('коды в error-фрейме', () => {
  it('системная ошибка Node не притворяется кодом платформы', async () => {
    const econnreset = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
      errno: -54,
      syscall: 'read',
    });
    const frame = await playAgainst(econnreset);
    expect(frame).toBeDefined();
    expect(frame.code).toBe('InternalServerError');
    expect(frame.message).toBe('read ECONNRESET');
    expect(frame.id).toBe('p1');
  });

  it('код платформы по-прежнему доезжает до игры как есть', async () => {
    const frame = await playAgainst(
      new GamesApiError({ code: 'InsufficientFunds', message: 'no money' }),
    );
    expect(frame.code).toBe('InsufficientFunds');
  });
});
