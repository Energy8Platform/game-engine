/**
 * Кампания фри-раундов: то, что уезжает НА ПЛАТФОРМУ.
 *
 * Проверяем именно исходящие кадры, а не наше внутреннее состояние. `frcId`
 * прожил в контексте всю сессию именно потому, что тесты смотрели на
 * бухгалтерию сервера: там всё сходилось, а на проводе после последнего
 * фри-раунда каждый спин продолжал нести идентификатор завершённой кампании.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';
import { startEngine, type EngineClient } from '../src/engine';
import { startRound, resolvePriceMultiplier, type RoundDeps } from '../src/round/orchestrator';
import { applyCampaignProgress } from '../src/session/init';
import { activeCampaignId, type FrcState } from '../src/session/frc';
import type { SessionContext } from '../src/session/types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const CAMPAIGN = 'camp-1';

/**
 * Games API, знающий про кампанию: считает оставшиеся фри-раунды и, как
 * настоящая платформа, отвергает завершённую кампанию `FrcAlreadyCompleted`.
 */
function campaignResponder(roundsTotal: number) {
  let roundsLeft = roundsTotal;
  let rounds = 0;
  return (env: any, socket: any, self: FakeGamesApi) => {
    const reply = (type: string, payload: unknown) =>
      self.send(socket, {
        proto: 1, schema: 1, chan: 'rpc', type,
        id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
        timestamp: new Date().toISOString(), payload,
      });
    const fail = (code: string, message: string) => reply('Error', { code, message, details: {} });

    if (env.type === 'SessionInfoRequest') {
      return reply('SessionInfoResponse', {
        security_hash: 'h', currency: 'USD', balance: 100,
        game_settings: {
          default_bet_index: 0, currency_minimal_unit: 0.01, allowed_bets: [1],
          available_auto_spin_counts: [10], rtp_options: [],
          rtp_settings: { is_visible: false }, locales: ['EN'],
        },
        free_round_campaign: {
          campaign_id: CAMPAIGN,
          rounds_total: roundsTotal,
          rounds_left: roundsLeft,
          bet: 1,
          total_win: 0,
          valid_from: '2026-01-01T00:00:00Z',
          valid_to: '2036-01-01T00:00:00Z',
          is_complete: roundsLeft <= 0,
        },
      });
    }

    if (env.type === 'PlayRoundRequest') {
      const frcId = env.payload.free_round_campaign_id;
      if (frcId && roundsLeft <= 0) {
        return fail('FrcAlreadyCompleted', 'Campaign was already completed.');
      }
      if (frcId) roundsLeft -= 1;
      return reply('PlayRoundResponse', {
        round_id: `round-${++rounds}`,
        balance: 100,
        win: 0,
        is_platform_max_win_reached: false,
        free_round_campaign: frcId
          ? { rounds_left: roundsLeft, total_win: 0, is_complete: roundsLeft <= 0 }
          : null,
      });
    }
    return undefined;
  };
}

function connect(url: string) {
  const socket = new WebSocket(url);
  const messages: any[] = [];
  socket.on('message', (d) => messages.push(JSON.parse(d.toString())));
  const next = (t: string, after = 0, timeoutMs = 5000) =>
    new Promise<any>((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        const found = messages.filter((m) => m.t === t || m.t === 'error');
        if (found.length > after) { clearInterval(tick); resolve(found[after]); }
        else if (Date.now() - started > timeoutMs) { clearInterval(tick); reject(new Error(`no ${t}`)); }
      }, 10);
    });
  return { socket, messages, next };
}

describe('кампания фри-раундов — исходящие кадры', () => {
  let api: FakeGamesApi;
  let server: ArtubeServer;

  beforeAll(async () => {
    api = await startFakeGamesApi({ onMessage: campaignResponder(2) });
    server = createArtubeServer({
      gameId: 'one-shot-game', gamesApiUrl: api.url, apiKey: 'k', spinPath: fixtures,
    });
    await server.listen(0);
  }, 40_000);

  afterAll(async () => {
    await server?.close();
    await api?.close();
  });

  it('отыгранная кампания перестаёт уезжать на платформу, и следующий спин проходит', async () => {
    const client = connect(`ws://127.0.0.1:${server.port}/api/ws?sessionId=sess-frc`);
    await new Promise<void>((r) => client.socket.on('open', () => r()));
    const init = await client.next('init');

    // Кампания приезжает предложенной; фри-раунды начинаются с ответа игрока.
    expect(init.frc.status).toBe('offered');
    client.socket.send(JSON.stringify({ t: 'frc_activate', id: 'a1', campaignId: CAMPAIGN }));
    expect((await client.next('frc')).status).toBe('active');

    for (let i = 0; i < 3; i += 1) {
      client.socket.send(JSON.stringify({ t: 'play', id: `p${i}`, action: 'one_shot', betIndex: 0 }));
      await client.next('result', i);
    }
    client.socket.close();

    const plays = api.received.filter((e) => e.type === 'PlayRoundRequest').map((e) => e.payload);
    expect(plays).toHaveLength(3);

    // Два фри-раунда кампании: идентификатор уезжает, цена нулевая.
    expect(plays[0].free_round_campaign_id).toBe(CAMPAIGN);
    expect(plays[0].price_multiplier).toBe(0);
    expect(plays[1].free_round_campaign_id).toBe(CAMPAIGN);
    expect(plays[1].price_multiplier).toBe(0);

    // Кампания кончилась на втором — третий спин обязан уйти БЕЗ неё. Именно
    // это ломалось: `frcId` не снимался, и платформа отвечала
    // `FrcAlreadyCompleted` на каждый спин до перезагрузки страницы.
    expect(plays[2].free_round_campaign_id).toBeUndefined();
    expect(plays[2].price_multiplier).toBe(1);

    // И игрок получил результат, а не ошибку.
    const results = client.messages.filter((m) => m.t === 'result');
    expect(results).toHaveLength(3);
    expect(client.messages.filter((m) => m.t === 'error')).toHaveLength(0);
  }, 20_000);
});

describe('кампания фри-раундов — цена действия', () => {
  let engine: EngineClient;

  beforeAll(async () => {
    engine = await startEngine({ gamesDir: fixtures });
  }, 30_000);

  afterAll(() => engine?.close());

  const active: FrcState = {
    status: 'active', campaignId: CAMPAIGN, bet: 1, betIndex: 0,
    roundsLeft: 5, roundsTotal: 5, totalWin: 0,
  };
  const ctx: SessionContext = {
    sessionId: 'sess-1', currency: 'USD', allowedBets: [1], frc: active,
  };

  function fakeApi() {
    return {
      playRound: vi.fn(async () => ({
        round_id: 'r', balance: 0, win: 0, is_platform_max_win_reached: false,
      })),
      openRound: vi.fn(async () => ({ round_version: 0, round_id: 'r', balance: 0 })),
      updateRoundState: vi.fn(async () => ({ round_version: 1 })),
      closeRound: vi.fn(async () => ({
        balance: 0, win: 0, free_round_campaign: null, is_platform_max_win_reached: false,
      })),
      autocloseRound: vi.fn(async () => ({
        balance: 0, win: 0, is_platform_max_win_reached: false,
      })),
    };
  }

  const deps = (api: ReturnType<typeof fakeApi>): RoundDeps => ({
    api, engine, gameId: 'feature-game',
    costMultipliers: { spin: 1, buy_bonus: 5, free_spin: 1 },
  });

  it('фри-раунд кампании уходит с price_multiplier 0', async () => {
    const api = fakeApi();
    await startRound(deps(api), ctx, { id: 'p1', action: 'spin', betIndex: 0 });
    expect(api.openRound).toHaveBeenCalledTimes(1);
    const sent = api.openRound.mock.calls[0][0];
    expect(sent.price_multiplier).toBe(0);
    expect(sent.free_round_campaign_id).toBe(CAMPAIGN);
  });

  it('покупка фичи в кампании не уезжает на платформу вовсе', async () => {
    const api = fakeApi();
    await expect(
      startRound(deps(api), ctx, { id: 'p1', action: 'buy_bonus', betIndex: 0 }),
    ).rejects.toMatchObject({ code: 'FrcFeatureBuyNotAllowed' });

    // Ни одной денежной RPC: раунд не открыт, фри-раунд не сожжён, бонус за 5
    // ставок не подарен. Раньше сюда уезжал OpenRound с price_multiplier 0.
    expect(api.openRound).not.toHaveBeenCalled();
    expect(api.playRound).not.toHaveBeenCalled();
  });

  it('цена платного действия не обнуляется кампанией даже в обход отказа', () => {
    const d = deps(fakeApi());
    // Вторая линия обороны: даже если проверка `startRound` кого-то пропустит,
    // на провод уедет настоящая цена, а не подаренный ноль.
    expect(resolvePriceMultiplier(d, 'buy_bonus', true)).toBe(5);
    expect(resolvePriceMultiplier(d, 'spin', true)).toBe(0);
  });

  /**
   * Покупка запрещена ВО ВРЕМЯ кампании, а не при её наличии. Отказ срабатывал
   * от одного лишь существования кампании: игрок, который свои фри-раунды даже
   * не просил, не мог купить бонус — и узнать, почему, было неоткуда, потому
   * что интерфейс о кампании не говорил ни слова.
   */
  for (const status of ['offered', 'declined', 'completed'] as const) {
    it(`покупка фичи разрешена, пока кампания ${status}`, async () => {
      const api = fakeApi();
      const idle: SessionContext = { ...ctx, frc: { ...active, status } };
      await startRound(deps(api), idle, { id: 'p1', action: 'buy_bonus', betIndex: 0 });

      expect(api.openRound).toHaveBeenCalledTimes(1);
      const sent = api.openRound.mock.calls[0][0];
      // Полная цена и НИ СЛОВА о кампании: игрок платит за бонус сам.
      expect(sent.price_multiplier).toBe(5);
      expect(sent.free_round_campaign_id).toBeUndefined();
    });
  }

  it('не активированная кампания не навязывает свою ставку', async () => {
    const api = fakeApi();
    const offered: SessionContext = {
      ...ctx,
      allowedBets: [0.5, 1, 2],
      frc: { ...active, status: 'offered' },
    };
    // Ставка кампании — индекс 0; игрок крутит на индексе 2 за свои деньги.
    await startRound(deps(api), offered, { id: 'p1', action: 'spin', betIndex: 2 });
    const sent = api.openRound.mock.calls[0][0];
    expect(sent.bet_index).toBe(2);
    expect(sent.price_multiplier).toBe(1);
    expect(sent.free_round_campaign_id).toBeUndefined();
  });

  it('активная кампания с чужой ставкой не уезжает на платформу', async () => {
    const api = fakeApi();
    await expect(
      startRound(deps(api), { ...ctx, allowedBets: [1, 2] }, { id: 'p1', action: 'spin', betIndex: 1 }),
    ).rejects.toMatchObject({ code: 'FrcBetMismatch' });
    expect(api.openRound).not.toHaveBeenCalled();
    expect(api.playRound).not.toHaveBeenCalled();
  });

  it('покупка внутри кампании отвергается покупкой, а не ставкой', async () => {
    const api = fakeApi();
    // Обе проверки срабатывают на этом запросе (ставка тоже чужая). Игроку
    // важна причина, по которой действие невозможно в принципе.
    await expect(
      startRound(
        deps(api),
        { ...ctx, allowedBets: [1, 2] },
        { id: 'p1', action: 'buy_bonus', betIndex: 1 },
      ),
    ).rejects.toMatchObject({ code: 'FrcFeatureBuyNotAllowed' });
  });
});

describe('applyCampaignProgress', () => {
  const ctx: SessionContext = {
    sessionId: 's', currency: 'USD', allowedBets: [1],
    frc: {
      status: 'active', campaignId: CAMPAIGN, bet: 1, betIndex: 0,
      roundsLeft: 5, roundsTotal: 5, totalWin: 0,
    },
  };

  it('снимает кампанию по флагу платформы', () => {
    const next = applyCampaignProgress(ctx, { rounds_left: 3, total_win: 5, is_complete: true });
    expect(activeCampaignId(next.frc)).toBeUndefined();
    expect(next.frc!.status).toBe('completed');
  });

  it('снимает кампанию и по обнулившемуся счётчику — флаг может отстать', () => {
    const next = applyCampaignProgress(ctx, { rounds_left: 0, total_win: 5, is_complete: false });
    expect(activeCampaignId(next.frc)).toBeUndefined();
    expect(next.frc!.status).toBe('completed');
  });

  it('пока раунды остались, кампания активна, а счётчики освежаются', () => {
    const next = applyCampaignProgress(ctx, { rounds_left: 2, total_win: 5, is_complete: false });
    expect(activeCampaignId(next.frc)).toBe(CAMPAIGN);
    // Счётчики платформы — то, чем фронт рисует «осталось 2 из 5»; держать их
    // устаревшими значило бы врать в повторном `init` того же соединения.
    expect(next.frc!.roundsLeft).toBe(2);
    expect(next.frc!.totalWin).toBe(5);
  });

  it('ответ без блока кампании ничего не меняет', () => {
    expect(applyCampaignProgress(ctx, null)).toBe(ctx);
    expect(applyCampaignProgress(ctx, undefined)).toBe(ctx);
  });

  it('не активированная кампания прогрессом не двигается', () => {
    // Спин игрока, который кампанию не активировал, не относится к ней вовсе:
    // платформа и не пришлёт блок, но если пришлёт — трогать нечего.
    const offered: SessionContext = { ...ctx, frc: { ...ctx.frc!, status: 'offered' } };
    expect(applyCampaignProgress(offered, { rounds_left: 4, total_win: 0, is_complete: false }))
      .toBe(offered);
  });
});
