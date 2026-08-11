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
  round: StoredRound | null;
  /** Сколько запросов такого типа пришло от сервера. */
  countOf(type: string): number;
  received(type: string): any[];
  /** Отправить событие платформы на коннект сервера. */
  emitEvent(type: string, payload: unknown): void;
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

  const platform: FakePlatform = {
    api: null as unknown as FakeGamesApi,
    url: '',
    balance: opts.balance ?? 100,
    allowedBets: opts.allowedBets ?? [1],
    currency: opts.currency === undefined ? 'USD' : opts.currency,
    round: null,
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
    close: () => platform.api.close(),
  };

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
            last_round: platform.round,
          });

        case 'PlayRoundRequest': {
          const p = env.payload;
          platform.balance +=
            (p.win_multiplier - p.price_multiplier) * bet(p.bet_index);
          platform.round = {
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
          };
          return reply('PlayRoundResponse', {
            round_id: platform.round.round_id,
            balance: platform.balance,
            win: p.win_multiplier * bet(p.bet_index),
            is_platform_max_win_reached: false,
          });
        }

        case 'OpenRoundRequest': {
          const p = env.payload;
          if (platform.round && !platform.round.finished_at) {
            return fail('InvalidRoundOperation', 'Round is already opened.');
          }
          platform.balance -= p.price_multiplier * bet(p.bet_index);
          platform.round = {
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
          };
          return reply('OpenRoundResponse', {
            round_version: 0,
            round_id: platform.round.round_id,
            balance: platform.balance,
          });
        }

        case 'UpdateRoundStateRequest': {
          const p = env.payload;
          const round = platform.round;
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
          const round = platform.round;
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
