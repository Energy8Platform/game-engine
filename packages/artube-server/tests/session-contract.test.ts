/**
 * Сверка `SessionInfoResponse` с докой платформы (F11 аудита).
 *
 * Провод этого API уже трижды расходился со своей спекой, и каждый раз
 * расхождение всплывало не там, где произошло. Проверяется не «валидатор
 * что-то вернул», а то, что видит игра: непригодный ответ называет поле, а
 * ответ, разошедшийся с докой в НЕ смертельном поле, соединение не роняет.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { handleConnection } from '../src/http/ws';
import { checkSessionInfo, SessionInfoContractError } from '../src/session/contract';
import type { SessionInfoResponse } from '../src/games-api/types';
import type { Logger, LogContext } from '../src/http/log';

const GAME_SETTINGS = {
  default_bet_index: 0,
  currency_minimal_unit: 0.01,
  allowed_bets: [1, 2, 5],
  available_auto_spin_counts: [10],
  rtp_options: [],
  rtp_settings: { is_visible: false },
  locales: ['EN'],
};

/** `Partial`, потому что смысл этих тестов — поля, которых в JSON нет. */
function info(settings: Record<string, unknown> = {}, top: Record<string, unknown> = {}): SessionInfoResponse {
  return {
    security_hash: 'h',
    currency: 'USD',
    balance: 100,
    game_settings: { ...GAME_SETTINGS, ...settings },
    ...top,
  } as SessionInfoResponse;
}

/** То же, но с УДАЛЁННЫМ полем настроек — `undefined` в объекте это не то же самое. */
function without(field: string): SessionInfoResponse {
  const session = info();
  delete (session.game_settings as Record<string, unknown>)[field];
  return session;
}

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

async function openSession(session: SessionInfoResponse) {
  const socket = new FakeSocket();
  const warnings: Array<{ message: string; context?: LogContext }> = [];
  const log: Logger = {
    info: () => {},
    warn: (message, context) => warnings.push({ message, context }),
    error: () => {},
    child: () => log,
  };
  const api = {
    sessionInfo: vi.fn(async () => session),
    playRound: vi.fn(async () => ({
      round_id: 'r', balance: 142, win: 2, is_platform_max_win_reached: false,
    })),
    on: () => {},
    off: () => {},
  };
  await handleConnection(socket as unknown as WebSocket, 'sess', {
    api: api as any,
    engine: engine as any,
    gameId: 'g',
    costMultipliers: { spin: 1 },
    startingDemoBalance: 1000,
    log,
  });
  const play = async () => {
    socket.emit('message', JSON.stringify({ t: 'play', id: 'p1', action: 'spin', betIndex: 0 }));
    for (let i = 0; i < 100; i++) {
      if (socket.sent.some((m) => (m.t === 'result' || m.t === 'error') && m.id === 'p1')) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    return socket.sent.find((m) => m.id === 'p1');
  };
  return {
    warnings,
    sent: socket.sent,
    init: socket.sent.find((m) => m.t === 'init'),
    error: socket.sent.find((m) => m.t === 'error'),
    play,
  };
}

describe('checkSessionInfo', () => {
  it('ответ по доке не даёт ни одного отклонения', () => {
    expect(checkSessionInfo(info())).toEqual([]);
  });

  it('пример payload’а из самой доки (platform_max_win без base_currency) — отклонение, не отказ', () => {
    // session-info.md объявляет `base_currency` обязательным, а её же пример
    // payload'а его не содержит. Ровно та форма дефекта, что была у `currency`.
    const deviations = checkSessionInfo(
      info({ platform_max_win: { is_visible: true, base_currency_value: 5000, player_currency_value: 5000 } }),
    );
    expect(deviations.map((d) => d.field)).toEqual(['platform_max_win.base_currency']);
  });

  it('без allowed_bets обслуживать нечего — бросает с именем поля', () => {
    expect(() => checkSessionInfo(without('allowed_bets'))).toThrow(SessionInfoContractError);
    expect(() => checkSessionInfo(without('allowed_bets'))).toThrow(/allowed_bets/);
    expect(() => checkSessionInfo(info({ allowed_bets: [] }))).toThrow(/пустой массив/);
  });

  it('поля показа отклонение, а не отказ', () => {
    const fields = checkSessionInfo(
      info({ rtp_settings: undefined, locales: undefined, available_auto_spin_counts: undefined }),
    ).map((d) => d.field);
    expect(fields).toContain('game_settings.rtp_settings');
    expect(fields).toContain('game_settings.locales');
    expect(fields).toContain('game_settings.available_auto_spin_counts');
  });

  it('default_bet_index вне лестницы ставок замечается', () => {
    const deviations = checkSessionInfo(info({ default_bet_index: 9 }));
    expect(deviations.map((d) => d.field)).toContain('game_settings.default_bet_index');
  });

  it('незакрытый раунд без round_state замечается, закрытый — нет', () => {
    const open = { round_id: 'r1', round_version: 0, finished_at: null };
    const closed = { round_id: 'r1', finished_at: '2026-08-14T00:00:00Z' };
    expect(checkSessionInfo(info({}, { last_round: open })).map((d) => d.field))
      .toContain('last_round.round_state');
    expect(checkSessionInfo(info({}, { last_round: closed }))).toEqual([]);
  });

  it('о полях, которых мы не читаем, не сообщается', () => {
    // `security_hash`, `history`, `rtp_options` тоже обязательны по доке, но
    // мы их не используем: строки о них приучали бы пролистывать этот лог.
    const stripped = info();
    delete (stripped as any).security_hash;
    delete (stripped as any).game_settings.rtp_options;
    expect(checkSessionInfo(stripped)).toEqual([]);
  });
});

describe('что видит игра при расхождении провода с докой', () => {
  it('без allowed_bets игра получает ошибку, называющую поле, а не чтение undefined', async () => {
    const s = await openSession(without('allowed_bets'));
    expect(s.init).toBeUndefined();
    expect(s.error).toBeDefined();
    expect(s.error.code).toBe('InvalidSessionInfo');
    expect(s.error.message).toMatch(/game_settings\.allowed_bets/);
    expect(s.error.message).not.toMatch(/Cannot read/);
  });

  it('без rtp_settings сессия ЖИВЁТ: приезжает init и спин играется', async () => {
    // До этого `buildInit` читал `rtp_settings.is_visible` без оглядки и ронял
    // соединение TypeError'ом. Галочка «показывать RTP в правилах» не стоит
    // живой денежной сессии.
    const s = await openSession(without('rtp_settings'));
    expect(s.error).toBeUndefined();
    expect(s.init).toBeDefined();
    expect(s.init.config.rtp).toEqual({ isVisible: false, shownRtp: undefined });

    const answer = await s.play();
    expect(answer.t).toBe('result');
  });

  it('отклонение названо в логе полем и следствием', async () => {
    const s = await openSession(without('locales'));
    const warning = s.warnings.find((w) => w.message.includes('SessionInfoResponse'));
    expect(warning).toBeDefined();
    const deviations = warning!.context!.deviations as Array<{ field: string; effect: string }>;
    expect(deviations.map((d) => d.field)).toContain('game_settings.locales');
    expect(deviations[0].effect).toBeTruthy();
  });
});
