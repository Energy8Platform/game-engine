import { describe, it, expect } from 'vitest';
import { buildInit, toSessionContext, isDemoSession } from '../src/session/init.js';
import { activateCampaign, activeCampaignId } from '../src/session/frc.js';
import type { SessionInfoResponse } from '../src/games-api/types.js';

function info(overrides: Partial<SessionInfoResponse> = {}): SessionInfoResponse {
  return {
    security_hash: 'h',
    currency: 'USD',
    balance: 150.75,
    game_settings: {
      default_bet_index: 3,
      currency_minimal_unit: 0.01,
      allowed_bets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      available_auto_spin_counts: [10, 25, 50],
      rtp_options: [],
      rtp_settings: { is_visible: true, shown_rtp: 94.2 },
      locales: ['EN', 'RU'],
      platform_max_win: {
        is_visible: true, base_currency: 'EUR',
        base_currency_value: 1000, player_currency_value: 870,
      },
    },
    ...overrides,
  };
}

describe('инициализация сессии', () => {
  it('allowed_bets становятся betLevels для фронта', () => {
    const init = buildInit(info());
    expect(init.config.betLevels).toEqual([0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
    expect(init.config.defaultBetIndex).toBe(3);
  });

  it('баланс и валюта берутся из платформы как есть', () => {
    const init = buildInit(info());
    expect(init.balance).toBe(150.75);
    expect(init.currency).toBe('USD');
    expect(init.demo).toBe(false);
  });

  it('currency null означает демо-сессию', () => {
    expect(isDemoSession(info({ currency: null }))).toBe(true);
    expect(buildInit(info({ currency: null })).demo).toBe(true);
  });

  it('настройки max-win едят во фронт для экрана правил', () => {
    const init = buildInit(info());
    expect(init.config.platformMaxWin).toEqual({
      isVisible: true, playerCurrencyValue: 870, baseCurrency: 'EUR',
    });
  });

  it('отображаемый RTP берётся из rtp_settings, а не из rtp_options', () => {
    const init = buildInit(info());
    expect(init.config.rtp).toEqual({ isVisible: true, shownRtp: 94.2 });
  });

  it('кампания фри-раундов пробрасывается — предложенной, а не активной', () => {
    const source = info({
      free_round_campaign: {
        campaign_id: 'c1', rounds_total: 10, rounds_left: 5,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 10, is_complete: false,
      },
    });
    const init = buildInit(source, { frc: toSessionContext('s1', source).frc });
    expect(init.frc).toEqual({
      campaignId: 'c1', roundsLeft: 5, roundsTotal: 10, totalWin: 10, isComplete: false,
      // Игрок ещё ничего не выбирал: это ПРЕДЛОЖЕНИЕ, и до его ответа наружу
      // не уезжает ни идентификатор кампании, ни её ставка.
      status: 'offered',
      // Ставка кампании и её срок раньше терялись здесь. Фри-раунды идут на
      // ставке КАМПАНИИ, а не на выбранной игроком, — без этого числа
      // посчитать сумму выигрыша фри-раунда не из чего.
      bet: 1, validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-12-31T00:00:00.000Z',
      // Индекс `bet` в allowed_bets ([0.1, 0.25, 0.5, 1, …]) — то, чем фронт
      // ставит ставку, и то, что уедет на платформу.
      betIndex: 3,
    });
  });

  it('кампания без своей ставки в allowed_bets приезжает без индекса', () => {
    const source = info({
      free_round_campaign: {
        campaign_id: 'c1', rounds_total: 10, rounds_left: 5,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 3.33, total_win: 0, is_complete: false,
      },
    });
    const frc = toSessionContext('s1', source).frc;
    // Не «ближайшая ставка»: подобрать соседнюю значило бы сыграть фри-раунд
    // не на том, что подарил оператор. Дока такую кампанию запрещает
    // активировать вовсе.
    expect(frc!.betIndex).toBeNull();
    expect(buildInit(source, { frc }).frc!.betIndex).toBeNull();
  });

  it('завершённая кампания не предлагается и не активна', () => {
    const source = info({
      free_round_campaign: {
        campaign_id: 'c1', rounds_total: 10, rounds_left: 0,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 10, is_complete: true,
      },
    });
    const ctx = toSessionContext('s1', source);
    expect(ctx.frc!.status).toBe('completed');
    expect(activeCampaignId(ctx.frc)).toBeUndefined();
    expect(buildInit(source, { frc: ctx.frc }).frc!.isComplete).toBe(true);
  });

  it('контекст сессии несёт кампанию и ставки, но не активирует её', () => {
    const ctx = toSessionContext('s1', info({
      free_round_campaign: {
        campaign_id: 'c9', rounds_total: 10, rounds_left: 3,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 0, is_complete: false,
      },
    }));
    expect(ctx.sessionId).toBe('s1');
    expect(ctx.frc!.campaignId).toBe('c9');
    // Раньше здесь стоял `expect(ctx.frcId).toBe('c9')` — то есть кампания
    // считалась активной с момента, когда платформа о ней рассказала, и игрок
    // сжигал свои бесплатные раунды, ни разу их не попросив.
    expect(ctx.frc!.status).toBe('offered');
    expect(activeCampaignId(ctx.frc)).toBeUndefined();
    expect(ctx.allowedBets).toHaveLength(7);
  });

  it('перечитывание сессии внутри соединения сохраняет выбор игрока', () => {
    const source = info({
      free_round_campaign: {
        campaign_id: 'c9', rounds_total: 10, rounds_left: 3,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 0, is_complete: false,
      },
    });
    const active = activateCampaign(toSessionContext('s1', source).frc, 'c9');
    // Восстановление перечитывает SessionInfo посреди раунда: счётчики должны
    // освежиться, а согласие игрока — уцелеть, иначе следующий спин уедет
    // платным посреди кампании.
    const refreshed = toSessionContext('s1', {
      ...source,
      free_round_campaign: { ...source.free_round_campaign!, rounds_left: 2 },
    }, active);
    expect(refreshed.frc!.status).toBe('active');
    expect(refreshed.frc!.roundsLeft).toBe(2);
    expect(activeCampaignId(refreshed.frc)).toBe('c9');

    // А новое соединение (без предыдущего состояния) обязано предложить заново.
    expect(toSessionContext('s1', source).frc!.status).toBe('offered');
  });

  it('токен геймификации пробрасывается без изменений', () => {
    const init = buildInit(info({ gamification_token: 'jwt.token.value' }));
    expect(init.gamificationToken).toBe('jwt.token.value');
  });
});
