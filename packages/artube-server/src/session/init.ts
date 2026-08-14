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

export interface CurrencyVerdict {
  /**
   * Платформа ОБЪЯВИЛА сессию демо (`currency: null`) — единственный признак
   * демо, который можно прочитать из SessionInfo. Не путать с итоговым
   * режимом соединения: платформа может объявить сессию демо и позже, отказом
   * на раундовой RPC (см. `isDemoUserRejection`), и тогда режим переключается
   * уже на ходу.
   */
  demo: boolean;
  wire: CurrencyOnWire;
  /** Канонический ISO-код, либо `null` — кода нет (демо или его не прислали). */
  code: string | null;
  /** Провод разошёлся с докой платформы; вызывающий обязан сказать это вслух. */
  deviates: boolean;
}

/**
 * Что означает `currency` из SessionInfo.
 *
 * | на проводе | `wire` | `demo` | `deviates` |
 * | --- | --- | --- | --- |
 * | `"USD"` | `code` | `false` | нет |
 * | `null` | `null` | **`true`** | нет — это обещает `demo-mode.md:42` |
 * | ключа нет | `absent` | `false` | да |
 * | `""`, не строка | `invalid` | `false` | да |
 *
 * Демо — ТОЛЬКО явный `null`. Отсутствующее поле демо не означает, хотя
 * однажды именно так и было: живая платформа прислала `SessionInfoResponse`
 * без ключа `currency`, и её же отказ `OperationNotAllowed` подтвердил, что
 * сессия была демо. Прочитать из этого правило «нет ключа ⇒ демо» нельзя,
 * потому что ровно та же картина получается у РЕАЛЬНОЙ сессии: сериализатор,
 * выбрасывающий поля с дефолтным значением (protobuf JSON, `.NET`
 * `DefaultIgnoreCondition`), выбросит `currency` и у реального игрока, если
 * валюта — enum, чей нулевой элемент USD. Ровно на это и указал игрок: «с
 * другой любой валютой работает, а с дефолтной USD видимо нет». Один
 * наблюдавшийся ответ одинаково хорошо объясняется обеими гипотезами, так что
 * само поле их и не различает.
 *
 * Поэтому отсутствие поля читаем как реальные деньги — асимметрично и
 * намеренно, по цене ошибки:
 *
 *  - принять реального игрока за демо — молчаливо и непоправимо: он ставит и
 *    выигрывает на бутафорском кошельке, платформа не видит ни одной
 *    транзакции, и никто этого не замечает;
 *  - принять демо-игрока за реального — один отказанный round trip, после
 *    которого платформа сама называет сессию демо, и соединение переключается
 *    на локальный кошелёк (см. `http/ws.ts`). Игрок видит обычный спин.
 *
 * Отклонение от доки при этом реально в обеих гипотезах: `deviates` доводит
 * его до лога.
 */
export function classifyCurrency(info: SessionInfoResponse): CurrencyVerdict {
  const currency = info.currency;
  if (typeof currency === 'string' && currency.trim() !== '') {
    return { demo: false, wire: 'code', code: currency, deviates: false };
  }
  // `null` дока обещает (demo-mode.md) — это не отклонение.
  if (currency === null) return { demo: true, wire: 'null', code: null, deviates: false };
  const wire: CurrencyOnWire = currency === undefined ? 'absent' : 'invalid';
  return { demo: false, wire, code: null, deviates: true };
}

/**
 * Объявила ли платформа сессию демо в самом SessionInfo.
 *
 * Не единственный путь в демо: вердикт платформы может приехать и отказом на
 * раундовой RPC. Это только то, что читается из `currency`.
 */
export function isDemoSession(info: SessionInfoResponse): boolean {
  return classifyCurrency(info).demo;
}

/**
 * Стартовый виртуальный баланс демо-сессии.
 *
 * Зовётся только там, где демо назвала сама платформа — `currency: null` в
 * SessionInfo или отказ `OperationNotAllowed` на раундовой RPC. Для сессии,
 * которую мы лишь ПРЕДПОЛАГАЕМ реальной (валюта не приехала), локальный
 * кошелёк не заводится вовсе, так что подменить деньги реальному игроку этот
 * путь не может.
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
   * Локальный кошелёк, если соединение обслуживает демо. Одно поле на оба
   * следствия — `demo: true` и баланс кошелька — потому что расходиться им
   * нельзя: init обязан назвать то же число, с которого кошелёк стартует,
   * иначе игрок видит одну сумму на загрузке и другую после первого спина.
   */
  wallet?: { readonly balance: number } | null;
}

export function buildInit(info: SessionInfoResponse, opts: BuildInitOptions = {}): InitPayload {
  const s = info.game_settings;
  const maxWin = s.platform_max_win;
  const verdict = classifyCurrency(info);
  return {
    // Нормализуем на границе провода: в СВОЁМ кадре нет разницы «ключа нет /
    // null», на которой сломались мы, — `null` значит ровно «кода валюты нет».
    // Признак демо здесь отдельным полем `demo`, а не формой валюты.
    currency: verdict.code,
    balance: opts.wallet ? opts.wallet.balance : info.balance,
    demo: opts.wallet ? true : verdict.demo,
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
    currency: classifyCurrency(info).code,
    allowedBets: info.game_settings.allowed_bets,
    frcId: active ? campaign!.campaign_id : undefined,
  };
}
