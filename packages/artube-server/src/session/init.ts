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

/** Что реально приехало в `currency` — три из четырёх вариантов дока не обещает. */
export type CurrencyOnWire = 'code' | 'null' | 'absent' | 'invalid';

export interface DemoDetection {
  /** Обслуживать сессию локально: раундовые RPC платформе запрещены. */
  demo: boolean;
  wire: CurrencyOnWire;
  /** Канонический ISO-код или `null` (демо) — дальше по коду валюта уже одна. */
  code: string | null;
  /** Провод разошёлся с докой платформы; вызывающий обязан сказать это вслух. */
  deviates: boolean;
}

/**
 * Демо ли это.
 *
 * Дока платформы противоречит сама себе и живому проводу сразу в двух местах:
 * `session-info.md` объявляет `currency` ОБЯЗАТЕЛЬНОЙ строкой (ISO 4217) и
 * `null` не упоминает вовсе, `demo-mode.md` называет `null` признаком демо, а
 * настоящая платформа прислала `SessionInfoResponse`, в котором поля `currency`
 * НЕТ. Строгое `=== null` такую сессию демо не считало: игра шла в PlayRound
 * реальными деньгами и получала `OperationNotAllowed` на каждом спине.
 *
 * Поэтому реальные деньги — только явный непустой ISO-код. Всё остальное
 * (`null`, отсутствие поля, пустая строка, не-строка) — демо. Направление
 * выбрано не симметрией, а ценой ошибки: демо-игрок, отправленный в денежные
 * RPC, не может сыграть ни одного спина — игра сломана целиком; обратная
 * ошибка (реальный игрок на локальном кошельке) хуже, но требует, чтобы
 * платформа не прислала валюту реальному игроку, а единственный
 * задокументированный не-строковый случай — как раз демо.
 *
 * Ошибка платформы от собственного контракта не молчит: `deviates` доводит её
 * до лога.
 */
export function detectDemo(info: SessionInfoResponse): DemoDetection {
  const currency = info.currency;
  if (typeof currency === 'string' && currency.trim() !== '') {
    return { demo: false, wire: 'code', code: currency, deviates: false };
  }
  const wire: CurrencyOnWire =
    currency === null ? 'null' : currency === undefined ? 'absent' : 'invalid';
  // `null` дока обещает (demo-mode.md) — это не отклонение.
  return { demo: true, wire, code: null, deviates: wire !== 'null' };
}

/** Games API отвечает `OperationNotAllowed` на любые раундовые RPC демо-сессии. */
export function isDemoSession(info: SessionInfoResponse): boolean {
  return detectDemo(info).demo;
}

/**
 * Стартовый виртуальный баланс демо-сессии.
 *
 * Платформа присылает демо-игроку баланс наравне с реальным (в живом кадре —
 * 999999), и он единственный, кто соразмерен её же `allowed_bets`: настроенный
 * у нас `DEMO_BALANCE` — константа, ничего не знающая ни о валюте игрока, ни о
 * масштабе ставок (дефолтная тысяча против ставок под миллионный баланс — это
 * один-два спина). Поэтому за основу берём платформенное число, а к своему
 * откатываемся, только когда играть на присланном нельзя: демо с нулём — это
 * демо, в котором нельзя нажать «спин».
 *
 * Проверка на `Number.isFinite`, а не только на `> 0`: `balance` объявлен
 * обязательным ровно так же, как `currency`, — то есть может не приехать.
 */
export function demoStartingBalance(info: SessionInfoResponse, fallback: number): number {
  const reported = info.balance;
  return typeof reported === 'number' && Number.isFinite(reported) && reported > 0
    ? reported
    : fallback;
}

export interface BuildInitOptions {
  /**
   * Баланс, которым РЕАЛЬНО стартует локальный демо-кошелёк. Передаётся в
   * демо и только в демо: init обязан назвать то же число, что и кошелёк,
   * иначе игрок видит одну сумму на загрузке и другую после первого спина.
   */
  demoBalance?: number;
}

export function buildInit(info: SessionInfoResponse, opts: BuildInitOptions = {}): InitPayload {
  const s = info.game_settings;
  const maxWin = s.platform_max_win;
  const detection = detectDemo(info);
  return {
    // Нормализуем на границе провода: в СВОЁМ кадре демо — всегда явный
    // `null`, а не выброшенное `JSON.stringify`-ем поле. Иначе фронт получал бы
    // ту же неразличимость «нет ключа / null», на которой сломались мы.
    currency: detection.code,
    balance: opts.demoBalance ?? info.balance,
    demo: detection.demo,
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
    currency: detectDemo(info).code,
    allowedBets: info.game_settings.allowed_bets,
    frcId: active ? campaign!.campaign_id : undefined,
  };
}
