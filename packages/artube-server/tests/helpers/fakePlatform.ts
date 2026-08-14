/**
 * Games API с памятью: настоящий WebSocket-сервер, который ведёт раунд так же,
 * как это делает платформа — round_id, монотонный round_version, `last_round`
 * в SessionInfo, запрет повторных денежных RPC.
 *
 * Нужен там, где тест обязан пройти через настоящий цикл раунда, а не через
 * заглушку, отвечающую "ок" на что угодно: реконнект посреди фичи,
 * автозакрытие брошенного раунда, сквозной тест сервер↔мост.
 */

import type { WebSocket } from 'ws';
import { startFakeGamesApi, type FakeGamesApi } from './fakeGamesApi';

/** Ровно то, что платформа кладёт в `SessionInfoResponse.last_round`. */
export interface StoredRound {
  round_id: string;
  round_version: number;
  round_state: string;
  round_state_version: string;
  started_at: string;
  finished_at: string | null;
  win_multiplier: number;
  win: number;
  bet_index: number;
  price_multiplier: number;
  is_platform_max_win_reached: boolean;
}

export interface FakePlatform {
  api: FakeGamesApi;
  url: string;
  balance: number;
  /** Мутируемо: тест может укоротить список ставок посреди раунда. */
  allowedBets: number[];
  currency: string | null;
  /** Раунд конкретной сессии — раунды у платформы всегда пер-сессионные. */
  roundOf(sessionId: string): StoredRound | null;
  /** Последний тронутый раунд — удобство для тестов с одной сессией. */
  readonly round: StoredRound | null;
  /** Сколько запросов такого типа пришло от сервера. */
  countOf(type: string): number;
  received(type: string): any[];
  /** Отправить событие платформы на коннект сервера. */
  emitEvent(type: string, payload: unknown): void;
  /** Прислать `GoAway` (соединение при этом остаётся открытым — см. fakeGamesApi). */
  goAway(payload: Record<string, unknown>): void;
  /** Закрыть текущий коннект так, как это делает платформа вслед за GoAway. */
  closeCurrent(code?: number): void;
  close(): Promise<void>;
}

export interface ReplyCtl {
  reply(type: string, payload: unknown): void;
  fail(code: string, message?: string): void;
  platform: FakePlatform;
}

export interface FakePlatformOptions {
  currency?: string | null;
  allowedBets?: number[];
  balance?: number;
  /**
   * Перехват до штатной обработки. Вернуть `true` — тест ответил сам
   * (или намеренно промолчал), штатная ветка пропускается.
   */
  intercept?: (env: any, ctl: ReplyCtl) => boolean;
  /**
   * Требовать `SessionInfoRequest` первым RPC на КАЖДОМ коннекте, отвечая на
   * всё остальное `SessionIsNotInitialized` — так ведёт себя платформа
   * (api-overview: «вызвать SessionInfoRequest первым RPC запросом»).
   *
   * По умолчанию выключено: это ужесточение важно ровно там, где тест
   * проверяет переподключение, а не в каждом тесте раунда.
   */
  requireSessionInit?: boolean;
}

const ERROR_MESSAGES: Record<string, string> = {
  InvalidRoundOperation: 'Invalid round version to update.',
};

/** Минимальный ответчик: только SessionInfo, без раундов. */
export function sessionInfoResponder(currency: string | null = 'USD') {
  return (env: any, socket: WebSocket, self: FakeGamesApi) => {
    if (env.type !== 'SessionInfoRequest') return;
    self.send(socket, {
      proto: 1, schema: 1, chan: 'rpc', type: 'SessionInfoResponse',
      id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
      timestamp: new Date().toISOString(),
      payload: {
        security_hash: 'h', currency, balance: 100,
        game_settings: {
          default_bet_index: 0, currency_minimal_unit: 0.01, allowed_bets: [1],
          available_auto_spin_counts: [10], rtp_options: [],
          rtp_settings: { is_visible: false }, locales: ['EN'],
        },
      },
    });
  };
}

export async function startFakePlatform(
  opts: FakePlatformOptions = {},
): Promise<FakePlatform> {
  let socket: WebSocket | null = null;
  let rounds = 0;
  /** Раунды по сессиям: у платформы нет одного глобального раунда. */
  const bySession = new Map<string, StoredRound>();
  let lastTouched: string | null = null;

  const platform: FakePlatform = {
    api: null as unknown as FakeGamesApi,
    url: '',
    balance: opts.balance ?? 100,
    allowedBets: opts.allowedBets ?? [1],
    currency: opts.currency === undefined ? 'USD' : opts.currency,
    roundOf: (sessionId) => bySession.get(sessionId) ?? null,
    get round() {
      return lastTouched ? (bySession.get(lastTouched) ?? null) : null;
    },
    countOf: (type) => platform.api.received.filter((e) => e.type === type).length,
    received: (type) => platform.api.received.filter((e) => e.type === type),
    emitEvent(type, payload) {
      if (!socket) throw new Error('fake platform: сервер ещё не подключился');
      platform.api.send(socket, {
        proto: 1, schema: 1, chan: 'events', type,
        id: `ev-${Math.random().toString(16).slice(2)}`, corr_id: null, op_seq: 0,
        timestamp: new Date().toISOString(), payload,
      });
    },
    goAway: (payload) => platform.api.goAway(payload),
    closeCurrent: (code) => platform.api.closeCurrent(code),
    close: () => platform.api.close(),
  };

  /** Сессии, инициализированные на конкретном коннекте: у платформы это пер-коннектное состояние. */
  const initialised = new Map<WebSocket, Set<string>>();

  const api = await startFakeGamesApi({
    onMessage: (env, sock) => {
      socket = sock;
      const reply = (type: string, payload: unknown) =>
        api.send(sock, {
          proto: 1, schema: 1, chan: 'rpc', type,
          id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
          timestamp: new Date().toISOString(), payload,
        });
      const fail = (code: string, message?: string) =>
        reply('Error', {
          code, message: message ?? ERROR_MESSAGES[code] ?? code, details: {},
        });

      if (opts.intercept?.(env, { reply, fail, platform })) return;

      const bet = (index: number) => platform.allowedBets[index] ?? 0;
      const session: string = env.payload?.session_id;

      if (opts.requireSessionInit && env.chan === 'rpc' && session) {
        let known = initialised.get(sock);
        if (!known) initialised.set(sock, (known = new Set()));
        if (env.type === 'SessionInfoRequest') known.add(session);
        else if (!known.has(session)) {
          return fail('SessionIsNotInitialized', 'Call SessionInfoRequest first.');
        }
      }

      const openRound = () => bySession.get(session) ?? null;
      const store = (round: StoredRound) => {
        bySession.set(session, round);
        lastTouched = session;
        return round;
      };

      switch (env.type) {
        case 'SessionInfoRequest':
          return reply('SessionInfoResponse', {
            security_hash: 'h',
            currency: platform.currency,
            balance: platform.balance,
            game_settings: {
              default_bet_index: 0,
              currency_minimal_unit: 0.01,
              allowed_bets: platform.allowedBets,
              available_auto_spin_counts: [10],
              rtp_options: [],
              rtp_settings: { is_visible: false },
              locales: ['EN'],
            },
            last_round: openRound(),
          });

        case 'PlayRoundRequest': {
          const p = env.payload;
          platform.balance +=
            (p.win_multiplier - p.price_multiplier) * bet(p.bet_index);
          const played = store({
            round_id: `round-${++rounds}`,
            round_version: 0,
            round_state: p.round_state,
            round_state_version: p.round_state_version,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            win_multiplier: p.win_multiplier,
            win: p.win_multiplier * bet(p.bet_index),
            bet_index: p.bet_index,
            price_multiplier: p.price_multiplier,
            is_platform_max_win_reached: false,
          });
          return reply('PlayRoundResponse', {
            round_id: played.round_id,
            balance: platform.balance,
            win: p.win_multiplier * bet(p.bet_index),
            is_platform_max_win_reached: false,
          });
        }

        case 'OpenRoundRequest': {
          const p = env.payload;
          const previous = openRound();
          if (previous && !previous.finished_at) {
            return fail('InvalidRoundOperation', 'Round is already opened.');
          }
          platform.balance -= p.price_multiplier * bet(p.bet_index);
          const opened = store({
            round_id: `round-${++rounds}`,
            round_version: 0,
            round_state: p.round_state,
            round_state_version: p.round_state_version,
            started_at: new Date().toISOString(),
            finished_at: null,
            win_multiplier: 0,
            win: 0,
            bet_index: p.bet_index,
            price_multiplier: p.price_multiplier,
            is_platform_max_win_reached: false,
          });
          return reply('OpenRoundResponse', {
            round_version: 0,
            round_id: opened.round_id,
            balance: platform.balance,
          });
        }

        case 'UpdateRoundStateRequest': {
          const p = env.payload;
          const round = openRound();
          if (!round || round.round_id !== p.round_id || round.finished_at) {
            return fail('InvalidRoundOperation', 'Round is not open.');
          }
          if (round.round_version !== p.round_version) return fail('InvalidRoundOperation');
          round.round_version += 1;
          round.round_state = p.round_state;
          return reply('UpdateRoundStateResponse', { round_version: round.round_version });
        }

        case 'CloseRoundRequest':
        case 'AutocloseRoundRequest': {
          const p = env.payload;
          const round = openRound();
          // Дока: ответ на AutocloseRoundRequest приходит типом CloseRoundResponse.
          const responseType = 'CloseRoundResponse';
          if (!round || round.round_id !== p.round_id || round.finished_at) {
            return fail('InvalidRoundOperation', 'Round is already closed.');
          }
          if (round.round_version !== p.round_version) return fail('InvalidRoundOperation');
          round.finished_at = new Date().toISOString();
          round.round_state = p.round_state;
          round.win_multiplier = p.win_multiplier;
          round.win = p.win_multiplier * bet(round.bet_index);
          platform.balance += round.win;
          return reply(responseType, {
            balance: platform.balance,
            free_round_campaign: null,
          });
        }
        default:
          return;
      }
    },
  });

  platform.api = api;
  platform.url = api.url;
  return platform;
}
