/**
 * Активация кампании фри-раундов: что уезжает НА ПЛАТФОРМУ до ответа игрока,
 * после «Start» и после отказа.
 *
 * Проверяем исходящие кадры, а не наше внутреннее состояние. Ровно этот класс
 * бага здесь уже жил: контекст сходился сам с собой, а на проводе каждый спин
 * нёс идентификатор кампании, которую игрок не просил.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const CAMPAIGN = 'camp-1';
/** Ставка кампании — 1, то есть индекс 1 в лестнице. Не нулевой намеренно: */
const BETS = [0.5, 1, 2];
const CAMPAIGN_BET_INDEX = 1;

interface CampaignSetup {
  /** Ставка кампании; `9.99` (вне `BETS`) — та самая ошибочная ситуация. */
  bet: number;
  roundsTotal: number;
  isComplete?: boolean;
}

/**
 * Games API с кампанией, настраиваемой ПОСЕССИОННО: один сервер обслуживает и
 * обычную кампанию, и ту, чьей ставки нет в `allowed_bets`.
 */
function campaignApi() {
  const setup = new Map<string, CampaignSetup>();
  const left = new Map<string, number>();
  let rounds = 0;

  const state = {
    /** Объявить кампанию для сессии. */
    give(sessionId: string, s: CampaignSetup) {
      setup.set(sessionId, s);
      left.set(sessionId, s.isComplete ? 0 : s.roundsTotal);
    },
    /** Сессия без кампании вовсе. */
    none(sessionId: string) {
      setup.delete(sessionId);
      left.delete(sessionId);
    },
    roundsLeft(sessionId: string) {
      return left.get(sessionId) ?? 0;
    },
    reset() {
      setup.clear();
      left.clear();
      rounds = 0;
    },
  };

  const responder = (env: any, socket: any, self: FakeGamesApi) => {
    const reply = (type: string, payload: unknown) =>
      self.send(socket, {
        proto: 1, schema: 1, chan: 'rpc', type,
        id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
        timestamp: new Date().toISOString(), payload,
      });
    const fail = (code: string, message: string) => reply('Error', { code, message, details: {} });
    const sessionId: string = env.payload?.session_id;
    const s = setup.get(sessionId);

    if (env.type === 'SessionInfoRequest') {
      const roundsLeft = left.get(sessionId) ?? 0;
      return reply('SessionInfoResponse', {
        security_hash: 'h', currency: 'USD', balance: 100,
        game_settings: {
          default_bet_index: 0, currency_minimal_unit: 0.01, allowed_bets: BETS,
          available_auto_spin_counts: [10], rtp_options: [],
          rtp_settings: { is_visible: false }, locales: ['EN'],
        },
        free_round_campaign: s
          ? {
              campaign_id: CAMPAIGN,
              rounds_total: s.roundsTotal,
              // Реконнект обязан увидеть остаток ТАКИМ, каким его сейчас
              // считает платформа, а не таким, каким он был на выдаче.
              rounds_left: roundsLeft,
              bet: s.bet,
              total_win: (s.roundsTotal - roundsLeft) * 2,
              valid_from: '2026-01-01T00:00:00Z',
              valid_to: '2036-01-01T00:00:00Z',
              is_complete: roundsLeft <= 0,
            }
          : null,
      });
    }

    if (env.type === 'PlayRoundRequest') {
      const frcId = env.payload.free_round_campaign_id;
      const roundsLeft = left.get(sessionId) ?? 0;
      if (frcId && roundsLeft <= 0) {
        return fail('FrcAlreadyCompleted', 'Campaign was already completed.');
      }
      const next = frcId ? roundsLeft - 1 : roundsLeft;
      if (frcId) left.set(sessionId, next);
      return reply('PlayRoundResponse', {
        round_id: `round-${++rounds}`,
        balance: 100,
        win: 2,
        is_platform_max_win_reached: false,
        free_round_campaign: frcId
          ? {
              rounds_left: next,
              total_win: ((s?.roundsTotal ?? 0) - next) * 2,
              is_complete: next <= 0,
            }
          : null,
      });
    }
    return undefined;
  };

  return { state, responder };
}

function connect(url: string) {
  const socket = new WebSocket(url);
  const messages: any[] = [];
  socket.on('message', (d) => messages.push(JSON.parse(d.toString())));
  /**
   * Дождаться СЛЕДУЮЩЕГО кадра типа `t`. Кадр `error` тоже разрешает ожидание —
   * иначе тест на отказ висел бы до таймаута вместо внятного сравнения.
   *
   * Курсор — не удобство, а условие корректности. Раньше выбиралось
   * `found[after]` из ВСЕХ подходящих кадров с начала соединения, то есть
   * каждый вызов должен был знать, сколько кадров (включая `error`) тест уже
   * прочитал, и передать это числом. Стоило сбиться — и ожидание
   * возвращалось мгновенно, отдавая старый кадр: `next('result')` после
   * проверки отказа отдавал тот самый `error`, и следующая строка читала
   * `plays()[0]` раньше, чем на платформу вообще ушёл `PlayRoundRequest`.
   * Успевал он уйти к этому моменту или нет, решала загрузка машины.
   */
  let cursor = 0;
  const next = (t: string, timeoutMs = 5000) =>
    new Promise<any>((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        const at = messages.findIndex((m, i) => i >= cursor && (m.t === t || m.t === 'error'));
        if (at !== -1) {
          cursor = at + 1;
          clearInterval(tick);
          resolve(messages[at]);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(tick);
          reject(new Error(`no ${t} after frame #${cursor}; got ${JSON.stringify(messages)}`));
        }
      }, 10);
    });
  const open = new Promise<void>((r) => socket.on('open', () => r()));
  const send = (msg: unknown) => socket.send(JSON.stringify(msg));
  return { socket, messages, next, open, send };
}

describe('кампания фри-раундов — активация и отказ', () => {
  let api: FakeGamesApi;
  let server: ArtubeServer;
  let campaign: ReturnType<typeof campaignApi>;

  beforeAll(async () => {
    campaign = campaignApi();
    api = await startFakeGamesApi({ onMessage: (env, socket, self) => campaign.responder(env, socket, self) });
    server = createArtubeServer({
      gameId: 'one-shot-game', gamesApiUrl: api.url, apiKey: 'k', spinPath: fixtures,
    });
    await server.listen(0, '127.0.0.1');
  }, 40_000);

  afterAll(async () => {
    await server?.close();
    await api?.close();
  });

  beforeEach(() => {
    campaign.state.reset();
    api.received.length = 0;
  });

  /** Все `PlayRound`, ушедшие на платформу, в порядке отправки. */
  /**
   * `PlayRoundRequest`, ушедшие на платформу ПО ЭТОЙ сессии.
   *
   * Фильтр по сессии — не косметика: сервер и фейковый Games API на весь
   * файл одни, а `beforeEach` только обнуляет список. Раунд предыдущего
   * теста доводится до денежной RPC уже после того, как игрок закрыл сокет
   * (в этом и смысл `creditPending`), так что запрос чужой сессии успевал
   * лечь в список после обнуления и превращал соседний тест в красный с
   * `expected 2 to be 3`. Сессии у тестов разные — этого достаточно, чтобы
   * каждый смотрел только на свой провод.
   */
  const plays = (sessionId: string) =>
    api.received
      .filter((e) => e.type === 'PlayRoundRequest' && e.payload.session_id === sessionId)
      .map((e) => e.payload);

  const session = (name: string) => `ws://127.0.0.1:${server.port}/api/ws?sessionId=${name}`;

  it('игрок, который не активировал кампанию, играет за свои — на проводе её нет', async () => {
    campaign.state.give('sess-offered', { bet: 1, roundsTotal: 5 });
    const client = connect(session('sess-offered'));
    await client.open;
    const init = await client.next('init');

    // Кампания доехала — но только как предложение анонсеру.
    expect(init.frc).toMatchObject({
      campaignId: CAMPAIGN, status: 'offered', roundsLeft: 5, roundsTotal: 5,
      bet: 1, betIndex: CAMPAIGN_BET_INDEX,
    });
    expect(init.frc.validTo).toBe('2036-01-01T00:00:00Z');

    // Игрок крутит на СВОЕЙ ставке, не спросив про фри-раунды.
    client.send({ t: 'play', id: 'p0', action: 'one_shot', betIndex: 2 });
    await client.next('result');
    client.socket.close();

    // Это и есть та ошибка, из-за которой всё писалось: раньше здесь уезжал
    // `free_round_campaign_id` и `price_multiplier: 0` — игрок молча сжигал
    // подаренный раунд на спине, который заказывал за свои деньги.
    expect(plays('sess-offered')).toHaveLength(1);
    expect(plays('sess-offered')[0].free_round_campaign_id).toBeUndefined();
    expect(plays('sess-offered')[0].price_multiplier).toBe(1);
    expect(plays('sess-offered')[0].bet_index).toBe(2);
    // И раунды кампании не тронуты.
    expect(campaign.state.roundsLeft('sess-offered')).toBe(5);
  }, 20_000);

  it('после Start кампания уезжает на платформу на своей ставке и бесплатно', async () => {
    campaign.state.give('sess-active', { bet: 1, roundsTotal: 3 });
    const client = connect(session('sess-active'));
    await client.open;
    await client.next('init');

    client.send({ t: 'frc_activate', id: 'a1', campaignId: CAMPAIGN });
    const frc = await client.next('frc');
    expect(frc).toMatchObject({ id: 'a1', status: 'active', betIndex: CAMPAIGN_BET_INDEX });

    client.send({ t: 'play', id: 'p0', action: 'one_shot', betIndex: CAMPAIGN_BET_INDEX });
    await client.next('result');
    client.socket.close();

    expect(plays('sess-active')[0].free_round_campaign_id).toBe(CAMPAIGN);
    expect(plays('sess-active')[0].price_multiplier).toBe(0);
    expect(plays('sess-active')[0].bet_index).toBe(CAMPAIGN_BET_INDEX);
  }, 20_000);

  it('спин активной кампании с чужой ставкой отвергается и не уезжает вовсе', async () => {
    campaign.state.give('sess-mismatch', { bet: 1, roundsTotal: 3 });
    const client = connect(session('sess-mismatch'));
    await client.open;
    await client.next('init');
    client.send({ t: 'frc_activate', id: 'a1', campaignId: CAMPAIGN });
    await client.next('frc');

    // Ставка кампании — индекс 1; фронт прислал 2.
    client.send({ t: 'play', id: 'p0', action: 'one_shot', betIndex: 2 });
    const err = await client.next('error');
    client.socket.close();

    expect(err).toMatchObject({ t: 'error', id: 'p0', code: 'FrcBetMismatch' });
    // Ни одной денежной RPC: раунд не открыт, фри-раунд не сожжён. Приведение
    // ставки к `campaign.bet` вместо отказа прошло бы молча — и разошлось бы с
    // тем числом, которым фронт считает выигрыш для показа.
    expect(plays('sess-mismatch')).toHaveLength(0);
    expect(campaign.state.roundsLeft('sess-mismatch')).toBe(3);
  }, 20_000);

  it('кампанию со ставкой вне allowed_bets активировать нельзя', async () => {
    campaign.state.give('sess-badbet', { bet: 9.99, roundsTotal: 5 });
    const client = connect(session('sess-badbet'));
    await client.open;
    const init = await client.next('init');
    // Фронт узнаёт об этом ещё до попытки: индекса нет.
    expect(init.frc).toMatchObject({ status: 'offered', bet: 9.99, betIndex: null });

    client.send({ t: 'frc_activate', id: 'a1', campaignId: CAMPAIGN });
    const err = await client.next('error');
    expect(err).toMatchObject({ id: 'a1', code: 'FrcBetNotAllowed' });

    // И следующий спин — обычный платный, а не фри-раунд по несуществующей ставке.
    client.send({ t: 'play', id: 'p0', action: 'one_shot', betIndex: 0 });
    await client.next('result');
    client.socket.close();
    expect(plays('sess-badbet')[0].free_round_campaign_id).toBeUndefined();
    expect(plays('sess-badbet')[0].price_multiplier).toBe(1);
  }, 20_000);

  it('отказ держится до конца соединения: кампания не уезжает и не активируется', async () => {
    campaign.state.give('sess-declined', { bet: 1, roundsTotal: 5 });
    const client = connect(session('sess-declined'));
    await client.open;
    await client.next('init');

    client.send({ t: 'frc_decline', id: 'd1', campaignId: CAMPAIGN });
    expect(await client.next('frc')).toMatchObject({ id: 'd1', status: 'declined' });

    // Передумать в рамках этого соединения нельзя — предложит реконнект.
    client.send({ t: 'frc_activate', id: 'a1', campaignId: CAMPAIGN });
    expect(await client.next('error')).toMatchObject({ id: 'a1', code: 'FrcDeclined' });

    client.send({ t: 'play', id: 'p0', action: 'one_shot', betIndex: 2 });
    await client.next('result');
    client.socket.close();

    expect(plays('sess-declined')[0].free_round_campaign_id).toBeUndefined();
    expect(plays('sess-declined')[0].price_multiplier).toBe(1);
    expect(campaign.state.roundsLeft('sess-declined')).toBe(5);
  }, 20_000);

  it('повторная активация и чужой campaignId отвергаются', async () => {
    campaign.state.give('sess-dup', { bet: 1, roundsTotal: 5 });
    const client = connect(session('sess-dup'));
    await client.open;
    await client.next('init');

    client.send({ t: 'frc_activate', id: 'a1', campaignId: CAMPAIGN });
    expect(await client.next('frc')).toMatchObject({ status: 'active' });

    client.send({ t: 'frc_activate', id: 'a2', campaignId: CAMPAIGN });
    expect(await client.next('error')).toMatchObject({ id: 'a2', code: 'FrcAlreadyActivated' });

    // Идентификатор приходит из браузера игрока: активировать можно только ту
    // кампанию, которую вернул SessionInfo.
    client.send({ t: 'frc_activate', id: 'a3', campaignId: 'someone-elses-campaign' });
    expect(await client.next('error')).toMatchObject({ id: 'a3', code: 'FrcNotFound' });
    client.socket.close();
  }, 20_000);

  it('активация без кампании на сессии — FrcNotFound', async () => {
    campaign.state.none('sess-nocamp');
    const client = connect(session('sess-nocamp'));
    await client.open;
    expect((await client.next('init')).frc).toBeNull();

    client.send({ t: 'frc_activate', id: 'a1', campaignId: CAMPAIGN });
    expect(await client.next('error')).toMatchObject({ id: 'a1', code: 'FrcNotFound' });
    client.socket.close();
  }, 20_000);

  it('отыграв кампанию, игрок возвращается в обычную игру, а фронт получает итог', async () => {
    campaign.state.give('sess-done', { bet: 1, roundsTotal: 2 });
    const client = connect(session('sess-done'));
    await client.open;
    await client.next('init');
    client.send({ t: 'frc_activate', id: 'a1', campaignId: CAMPAIGN });
    await client.next('frc');

    for (let i = 0; i < 3; i += 1) {
      client.send({ t: 'play', id: `p${i}`, action: 'one_shot', betIndex: CAMPAIGN_BET_INDEX });
      // Курсор двигает сам `next`: индекс здесь означал бы, что тест
      // пересчитывает прочитанное вручную — ровно то, на чём он и мигал.
      await client.next('result');
    }
    client.socket.close();

    const sent = plays('sess-done');
    expect(sent).toHaveLength(3);
    expect(sent[0].free_round_campaign_id).toBe(CAMPAIGN);
    expect(sent[1].free_round_campaign_id).toBe(CAMPAIGN);
    // Кампания кончилась на втором — третий спин обязан уйти БЕЗ неё и по
    // полной цене. Это тот самый брикующий баг: `FrcAlreadyCompleted` на
    // каждый спин до перезагрузки страницы.
    expect(sent[2].free_round_campaign_id).toBeUndefined();
    expect(sent[2].price_multiplier).toBe(1);
    expect(client.messages.filter((m) => m.t === 'error')).toHaveLength(0);

    // Итог кампании — отдельным кадром, ПОСЛЕ последнего результата.
    const done = client.messages.filter((m) => m.t === 'frc').at(-1);
    expect(done).toMatchObject({ status: 'completed', roundsLeft: 0, roundsTotal: 2 });
    expect(done.id).toBeUndefined();
    const resultIndexes = client.messages.map((m, i) => (m.t === 'result' ? i : -1));
    expect(client.messages.indexOf(done)).toBeGreaterThan(Math.max(...resultIndexes.slice(0, 2)));
  }, 20_000);

  it('реконнект предлагает кампанию заново, с остатком по версии платформы', async () => {
    campaign.state.give('sess-recon', { bet: 1, roundsTotal: 4 });
    const first = connect(session('sess-recon'));
    await first.open;
    await first.next('init');
    first.send({ t: 'frc_activate', id: 'a1', campaignId: CAMPAIGN });
    await first.next('frc');
    first.send({ t: 'play', id: 'p0', action: 'one_shot', betIndex: CAMPAIGN_BET_INDEX });
    await first.next('result');
    first.socket.close();
    await new Promise((r) => setTimeout(r, 50));

    const again = connect(session('sess-recon'));
    await again.open;
    const init = await again.next('init');

    // Дока требует именно этого: «При переподключениях пользователь снова
    // должен иметь возможность повторно активировать кампанию либо отказаться
    // и играть в обычном режиме». Молчаливое продолжение сожгло бы остаток за
    // игрока, который об этом соединении ничего не просил.
    expect(init.frc).toMatchObject({ status: 'offered', roundsLeft: 3, roundsTotal: 4 });

    // И до повторной активации спин снова платный.
    again.send({ t: 'play', id: 'p1', action: 'one_shot', betIndex: 0 });
    await again.next('result');
    again.socket.close();

    const sent = plays('sess-recon');
    expect(sent).toHaveLength(2);
    expect(sent[0].free_round_campaign_id).toBe(CAMPAIGN);
    expect(sent[1].free_round_campaign_id).toBeUndefined();
    expect(sent[1].price_multiplier).toBe(1);
    // Остаток не тронут вторым спином.
    expect(campaign.state.roundsLeft('sess-recon')).toBe(3);
  }, 20_000);
});
