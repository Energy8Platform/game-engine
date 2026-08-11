/**
 * Перевод SessionInfoResponse в то, что нужно фронту при старте.
 *
 * Ничего не вычисляем: баланс, валюта, набор ставок и лимит максвина — всё
 * платформенное, мы только переименовываем поля в camelCase.
 */

import type { SessionInfoResponse } from '../games-api/types.js';
import type { SessionContext } from './types.js';

export interface FrcInfo {
  campaignId: string;
  roundsLeft: number;
  roundsTotal: number;
  totalWin: number;
  isComplete: boolean;
}

export interface InitConfig {
  betLevels: number[];
  defaultBetIndex: number;
  currencyMinimalUnit: number;
  autoSpinCounts: number[];
  locales: string[];
  rtp: { isVisible: boolean; shownRtp?: number };
  platformMaxWin: { isVisible: boolean; playerCurrencyValue: number; baseCurrency: string } | null;
}

export interface InitPayload {
  currency: string | null;
  balance: number;
  demo: boolean;
  config: InitConfig;
  frc: FrcInfo | null;
  gamificationToken?: string;
}

/**
 * Демо-сессия по доке — та, у которой `currency` равна `null`. Games API
 * отвечает `OperationNotAllowed` на любые раундовые RPC такой сессии.
 */
export function isDemoSession(info: SessionInfoResponse): boolean {
  return info.currency === null;
}

export function buildInit(info: SessionInfoResponse): InitPayload {
  const s = info.game_settings;
  const maxWin = s.platform_max_win;
  return {
    currency: info.currency,
    balance: info.balance,
    demo: isDemoSession(info),
    config: {
      betLevels: s.allowed_bets,
      defaultBetIndex: s.default_bet_index,
      currencyMinimalUnit: s.currency_minimal_unit,
      autoSpinCounts: s.available_auto_spin_counts,
      locales: s.locales,
      // Дока: значение rtp в rtp_options перезаписывается сервером и для
      // показа не годится — показываем только rtp_settings.
      rtp: { isVisible: s.rtp_settings.is_visible, shownRtp: s.rtp_settings.shown_rtp },
      platformMaxWin: maxWin
        ? {
            isVisible: maxWin.is_visible,
            playerCurrencyValue: maxWin.player_currency_value,
            baseCurrency: maxWin.base_currency,
          }
        : null,
    },
    frc: info.free_round_campaign
      ? {
          campaignId: info.free_round_campaign.campaign_id,
          roundsLeft: info.free_round_campaign.rounds_left,
          roundsTotal: info.free_round_campaign.rounds_total,
          totalWin: info.free_round_campaign.total_win,
          isComplete: info.free_round_campaign.is_complete,
        }
      : null,
    gamificationToken: info.gamification_token,
  };
}

export function toSessionContext(sessionId: string, info: SessionInfoResponse): SessionContext {
  const campaign = info.free_round_campaign;
  // Кампанию считаем активной только пока есть неизрасходованные раунды:
  // иначе платформа ответит FrcAlreadyCompleted на первый же спин.
  const active = campaign && !campaign.is_complete && campaign.rounds_left > 0;
  return {
    sessionId,
    currency: info.currency,
    allowedBets: info.game_settings.allowed_bets,
    frcId: active ? campaign!.campaign_id : undefined,
  };
}
