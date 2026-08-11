import { describe, it, expect } from 'vitest';
import { buildInit, toSessionContext, isDemoSession } from '../src/session/init.js';
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

  it('кампания фри-раундов пробрасывается', () => {
    const init = buildInit(info({
      free_round_campaign: {
        campaign_id: 'c1', rounds_total: 10, rounds_left: 5,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 10, is_complete: false,
      },
    }));
    expect(init.frc).toEqual({
      campaignId: 'c1', roundsLeft: 5, roundsTotal: 10, totalWin: 10, isComplete: false,
    });
  });

  it('завершённая кампания не считается активной', () => {
    const init = buildInit(info({
      free_round_campaign: {
        campaign_id: 'c1', rounds_total: 10, rounds_left: 0,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 10, is_complete: true,
      },
    }));
    expect(init.frc!.isComplete).toBe(true);
    expect(toSessionContext('s1', info({
      free_round_campaign: {
        campaign_id: 'c1', rounds_total: 10, rounds_left: 0,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 10, is_complete: true,
      },
    })).frcId).toBeUndefined();
  });

  it('контекст сессии несёт активную кампанию и ставки', () => {
    const ctx = toSessionContext('s1', info({
      free_round_campaign: {
        campaign_id: 'c9', rounds_total: 10, rounds_left: 3,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 0, is_complete: false,
      },
    }));
    expect(ctx.sessionId).toBe('s1');
    expect(ctx.frcId).toBe('c9');
    expect(ctx.allowedBets).toHaveLength(7);
  });

  it('токен геймификации пробрасывается без изменений', () => {
    const init = buildInit(info({ gamification_token: 'jwt.token.value' }));
    expect(init.gamificationToken).toBe('jwt.token.value');
  });
});
