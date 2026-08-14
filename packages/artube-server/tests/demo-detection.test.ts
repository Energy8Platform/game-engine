/**
 * Детект демо-сессии.
 *
 * Живая платформа прислала `SessionInfoResponse` БЕЗ поля `currency` — не
 * `null`, как обещает `demo-mode.md`, и не ISO-строку, как требует
 * `session-info.md` (поле там обязательное, `null` даже не упомянут). Строгое
 * `=== null` такую сессию демо не сочло, игра пошла в PlayRound реальными
 * деньгами и получила `OperationNotAllowed: Operation Latest is not allowed
 * for demo user.` на каждом спине.
 *
 * Проверяем не флаг, а последствие: раундовые RPC платформе не уходят вовсе.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { handleConnection } from '../src/http/ws';
import { detectDemo, isDemoSession, buildInit, demoStartingBalance } from '../src/session/init';
import type { SessionInfoResponse } from '../src/games-api/types';
import type { Logger, LogContext } from '../src/http/log';

const GAME_SETTINGS = {
  default_bet_index: 3,
  currency_minimal_unit: 0.01,
  allowed_bets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  available_auto_spin_counts: [10, 25, 50],
  rtp_options: [],
  rtp_settings: { is_visible: false },
  locales: ['EN'],
};

/**
 * `SessionInfoResponse` в том виде, в каком он приходит по проводу.
 * `Partial` намеренно: смысл теста — поля, которых в JSON нет.
 */
function info(overrides: Partial<SessionInfoResponse> = {}): SessionInfoResponse {
  return { security_hash: 'h', balance: 999999, game_settings: GAME_SETTINGS, ...overrides };
}

class FakeSocket extends EventEmitter {
  readonly sent: any[] = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  close(): void {}
}

/** Движок, который отдаёт один финальный сегмент с выигрышем 2× ставки. */
const engine = {
  startRound: async () => ({
    error: '',
    script_sha256: 'sha',
    data_json: '{}',
    win: 2,
    total_win: 2,
    next_actions: [] as string[],
    spins_remaining: 0,
    spins_played: 1,
    round_complete: true,
  }),
};

/** Заглушка платформы: считает КАЖДУЮ раундовую RPC, которой быть не должно. */
function platformApi(session: SessionInfoResponse) {
  return {
    sessionInfo: vi.fn(async () => session),
    playRound: vi.fn(async () => ({
      round_id: 'r', balance: 42, win: 0, is_platform_max_win_reached: false,
    })),
    openRound: vi.fn(async () => ({ round_version: 0, round_id: 'r', balance: 42 })),
    updateRoundState: vi.fn(async () => ({ round_version: 1 })),
    closeRound: vi.fn(async () => ({ balance: 42 })),
    autocloseRound: vi.fn(async () => ({ balance: 42 })),
    on: () => {},
    off: () => {},
  };
}

function collectingLog(warnings: Array<{ message: string; context?: LogContext }>): Logger {
  const log: Logger = {
    info: () => {},
    warn: (message, context) => warnings.push({ message, context }),
    error: () => {},
    child: () => log,
  };
  return log;
}

/** Поднять соединение, сыграть один спин, вернуть кадры и шпиона платформы. */
async function playOneSpin(session: SessionInfoResponse, startingDemoBalance = 1000) {
  const socket = new FakeSocket();
  const api = platformApi(session);
  const warnings: Array<{ message: string; context?: LogContext }> = [];
  await handleConnection(socket as unknown as WebSocket, 'sess', {
    api: api as any,
    engine: engine as any,
    gameId: 'g',
    costMultipliers: { spin: 1 },
    startingDemoBalance,
    log: collectingLog(warnings),
  });
  socket.emit('message', JSON.stringify({ t: 'play', id: 'p1', action: 'spin', betIndex: 3 }));
  for (let i = 0; i < 50 && !socket.sent.some((m) => m.t === 'result' || m.t === 'error'); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  return {
    api,
    warnings,
    init: socket.sent.find((m) => m.t === 'init'),
    result: socket.sent.find((m) => m.t === 'result'),
    error: socket.sent.find((m) => m.t === 'error'),
  };
}

/** Ни одна из четырёх раундовых RPC доки не должна была уйти на платформу. */
function expectNoRoundRpcs(api: ReturnType<typeof platformApi>): void {
  expect(api.playRound).not.toHaveBeenCalled();
  expect(api.openRound).not.toHaveBeenCalled();
  expect(api.updateRoundState).not.toHaveBeenCalled();
  expect(api.closeRound).not.toHaveBeenCalled();
  expect(api.autocloseRound).not.toHaveBeenCalled();
}

describe('детект демо-сессии', () => {
  it('сессия БЕЗ поля currency играется локально, без единой раундовой RPC', async () => {
    const { api, init, result, error } = await playOneSpin(info());

    expect(init.demo).toBe(true);
    expect(error).toBeUndefined();
    expect(result).toBeDefined();
    expectNoRoundRpcs(api);
  });

  it('отсутствие currency попадает в лог: платформа расходится со своей докой', async () => {
    const { warnings } = await playOneSpin(info());
    const deviation = warnings.find((w) => w.message.includes('currency'));

    expect(deviation).toBeDefined();
    expect(deviation!.context?.currency_on_wire).toBe('absent');
  });

  it('явный currency: null — задокументированное демо, без предупреждения', async () => {
    const { api, init, result, warnings } = await playOneSpin(info({ currency: null }));

    expect(init.demo).toBe(true);
    expect(result).toBeDefined();
    expectNoRoundRpcs(api);
    expect(warnings.find((w) => w.message.includes('currency'))).toBeUndefined();
  });

  it('настоящая валюта — это реальные деньги: раунд уходит на платформу', async () => {
    const { api, init, result } = await playOneSpin(info({ currency: 'USD' }));

    expect(init.demo).toBe(false);
    expect(init.currency).toBe('USD');
    expect(api.playRound).toHaveBeenCalledTimes(1);
    expect(result.balanceAfter).toBe(42); // баланс платформы, не локальный
  });

  it('в собственном кадре демо-валюта — явный null, а не выброшенное поле', async () => {
    const { init } = await playOneSpin(info());

    expect(init).toHaveProperty('currency');
    expect(init.currency).toBeNull();
  });

  it('пустая строка вместо ISO-кода — тоже не реальные деньги', () => {
    expect(isDemoSession(info({ currency: '' }))).toBe(true);
    expect(detectDemo(info({ currency: '' })).deviates).toBe(true);
  });

  it('классификация провода различает код, null и отсутствие', () => {
    expect(detectDemo(info({ currency: 'USD' }))).toMatchObject({
      demo: false, wire: 'code', code: 'USD', deviates: false,
    });
    expect(detectDemo(info({ currency: null }))).toMatchObject({
      demo: true, wire: 'null', code: null, deviates: false,
    });
    expect(detectDemo(info())).toMatchObject({
      demo: true, wire: 'absent', code: null, deviates: true,
    });
  });
});

describe('баланс демо-сессии', () => {
  it('init называет то же число, с которого стартует демо-кошелёк', async () => {
    // Платформа сообщила 999999, DEMO_BALANCE = 1000. Игрок обязан увидеть
    // одно и то же до и после первого спина.
    const { init, result } = await playOneSpin(info(), 1000);

    expect(init.balance).toBe(999999);
    // Ставка allowed_bets[3] = 1, выигрыш 2× → 999999 - 1 + 2.
    expect(result.balanceAfter).toBe(1000000);
  });

  it('непригодный платформенный баланс уступает настроенному DEMO_BALANCE', async () => {
    const { init, result } = await playOneSpin(info({ balance: 0 }), 500);

    expect(init.balance).toBe(500);
    expect(result.balanceAfter).toBe(501);
  });

  it('стартовый баланс демо: платформенный, если он пригоден', () => {
    expect(demoStartingBalance(info(), 1000)).toBe(999999);
    expect(demoStartingBalance(info({ balance: 0 }), 1000)).toBe(1000);
    expect(demoStartingBalance(info({ balance: -5 }), 1000)).toBe(1000);
    expect(demoStartingBalance(info({ balance: undefined }), 1000)).toBe(1000);
    expect(demoStartingBalance(info({ balance: NaN }), 1000)).toBe(1000);
  });

  it('реальной сессии баланс никто не подменяет', () => {
    expect(buildInit(info({ currency: 'USD', balance: 150.75 })).balance).toBe(150.75);
  });
});
