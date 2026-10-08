/**
 * Перевод SessionInfoResponse в то, что нужно фронту при старте.
 *
 * Ничего не вычисляем: баланс, валюта, набор ставок и лимит максвина — всё
 * платформенное, мы только переименовываем поля в camelCase.
 */

import type { CampaignProgress, SessionInfoResponse } from '../games-api/types.js';
import { applyProgress, frcFromSession, type FrcState, type FrcStatus } from './frc.js';
import type { SessionContext } from './types.js';

/**
 * Кампания в том виде, в каком её видит фронт, — и в `init`, и в отдельном
 * кадре `frc`. Одна форма на оба, чтобы у игры был один код отрисовки анонсера
 * и счётчика, а не два слегка разных.
 */
export interface FrcInfo {
  campaignId: string;
  /**
   * Состояние кампании на ЭТОМ соединении — то самое `is_frc_active` из доки
   * фронта, только полем со всеми четырьмя значениями: у платформы такого
   * поля нет, его ведёт игровой бэкенд (`frontend:82-84`).
   */
  status: FrcStatus;
  roundsLeft: number;
  roundsTotal: number;
  totalWin: number;
  isComplete: boolean;
  /**
   * Ставка, НА КОТОРОЙ идут фри-раунды, — она задана кампанией, а не игроком
   * (`free-rounds-campaign.md`: «Параметры ставки и количество спинов уже
   * определены»). Пока её здесь не было, посчитать сумму выигрыша фри-раунда
   * было не из чего: фронт умножает множитель на выбранную игроком ставку, и
   * при несовпадении показывает не то число, которым платформа двигает баланс.
   */
  bet?: number;
  /**
   * Индекс `bet` в `betLevels`; `null` — ставки кампании в лестнице нет, и
   * активировать её нельзя (`frontend:101`). Фронту это тот самый шаг «найти
   * индекс ставки в `allowed_bets`», который дока вменяет ему (`:91`), —
   * посчитанный там, где лестница и кампания уже лежат рядом.
   */
  betIndex: number | null;
  /** Окно, в котором кампанию можно отыграть; после `validTo` она сгорает. */
  validFrom?: string;
  validTo?: string;
}

/** Кампания наружу. `isComplete` оставлен ради совместимости с 0.5.0. */
export function toFrcInfo(frc: FrcState): FrcInfo {
  return {
    campaignId: frc.campaignId,
    status: frc.status,
    roundsLeft: frc.roundsLeft,
    roundsTotal: frc.roundsTotal,
    totalWin: frc.totalWin,
    isComplete: frc.status === 'completed',
    bet: frc.bet,
    betIndex: frc.betIndex,
    validFrom: frc.validFrom,
    validTo: frc.validTo,
  };
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
   * Сессия демо по самому SessionInfo — `currency: null` или ключа нет вовсе.
   * Не путать с итоговым режимом соединения: платформа может объявить сессию
   * демо и позже, отказом на раундовой RPC (см. `isDemoUserRejection`), и
   * тогда режим переключается уже на ходу.
   */
  demo: boolean;
  wire: CurrencyOnWire;
  /** Канонический ISO-код, либо `null` — кода нет (это только демо-сессия). */
  code: string | null;
  /** Провод разошёлся с докой платформы; вызывающий обязан сказать это вслух. */
  deviates: boolean;
}

/**
 * Валюта сессии, у которой платформа прислала в `currency` мусор (`""`, не
 * строку): деньги реальные, а форматировать их игре чем-то надо.
 */
export const DEFAULT_CURRENCY = 'USD';

/**
 * Что означает `currency` из SessionInfo.
 *
 * | на проводе | `wire` | `demo` | `deviates` |
 * | --- | --- | --- | --- |
 * | `"USD"` | `code` | `false` | нет |
 * | `null` | `null` | **`true`** | нет — это обещает `demo-mode.md:42` |
 * | ключа нет | `absent` | **`true`** | да |
 * | `""`, не строка | `invalid` | `false` (код → `USD`) | да |
 *
 * Отсутствующий ключ — тоже демо. Так демо и приезжает с живой платформы:
 * `SessionInfoResponse` без `currency`, а на первом спине — её же отказ
 * `Operation Latest is not allowed for demo user.` Узнай мы о демо только по
 * отказу, `init` к тому моменту уже ушёл бы в игру с реальной валютой, и метки
 * DEMO игрок не увидел бы за всю сессию: шелл читает валюту один раз, на
 * загрузке.
 *
 * Цена этого решения — владелец интеграции её принял: если платформа так же
 * выбросит `currency` у РЕАЛЬНОЙ сессии (сериализатор, опускающий дефолтное
 * значение, — protobuf JSON, `.NET` `DefaultIgnoreCondition`), такой игрок
 * будет играть на локальном кошельке, а платформа не увидит ни одной его
 * транзакции. `deviates` остаётся `true`, чтобы каждая такая сессия попадала в
 * лог и её можно было найти.
 */
export function classifyCurrency(info: SessionInfoResponse): CurrencyVerdict {
  const currency = info.currency;
  if (typeof currency === 'string' && currency.trim() !== '') {
    return { demo: false, wire: 'code', code: currency, deviates: false };
  }
  // `null` дока обещает (demo-mode.md) — это не отклонение.
  if (currency === null) return { demo: true, wire: 'null', code: null, deviates: false };
  if (currency === undefined) return { demo: true, wire: 'absent', code: null, deviates: true };
  return { demo: false, wire: 'invalid', code: DEFAULT_CURRENCY, deviates: true };
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
 * Зовётся только там, где сессия демо: `currency: null` или нет ключа в
 * SessionInfo (см. `classifyCurrency`), либо отказ `OperationNotAllowed` на
 * раундовой RPC.
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
  /**
   * Кампания вместе с решением игрока — берётся из контекста соединения, а не
   * пересобирается из SessionInfo.
   *
   * Разница видна там, где `init` шлётся ПОВТОРНО посреди живого соединения
   * (`forgetSettledRound`): собери мы кампанию заново из ответа платформы, она
   * приехала бы «предложенной» игроку, который её уже активировал, и фронт
   * показал бы анонсер поверх идущих фри-раундов.
   */
  frc?: FrcState | null;
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
      // Дефолты ровно тех полей, отсутствие которых `checkSessionInfo`
      // называет отклонением, а не поводом уронить сессию: это настройки
      // ПОКАЗА, и до этих строк они роняли соединение обычным `TypeError`
      // («cannot read is_visible of undefined»). Значения совпадают с тем, что
      // обещает `effect` в отклонении, — читать их надо парой.
      autoSpinCounts: s.available_auto_spin_counts ?? [],
      locales: s.locales ?? [],
      // Дока: значение rtp в rtp_options перезаписывается сервером и для
      // показа не годится — показываем только rtp_settings.
      rtp: { isVisible: s.rtp_settings?.is_visible === true, shownRtp: s.rtp_settings?.shown_rtp },
      platformMaxWin: maxWin
        ? {
            isVisible: maxWin.is_visible,
            playerCurrencyValue: maxWin.player_currency_value,
            baseCurrency: maxWin.base_currency,
          }
        : null,
    },
    frc: opts.frc ? toFrcInfo(opts.frc) : null,
    gamificationToken: info.gamification_token,
  };
}

/**
 * Контекст соединения из свежего SessionInfo.
 *
 * `previous` — решение игрока о кампании, если оно на этом соединении уже
 * было; передаётся только при ПЕРЕЧИТЫВАНИИ сессии внутри живого соединения.
 * Новое соединение зовёт это без него и предлагает кампанию заново — ровно
 * так, как требует дока (см. `frcFromSession`).
 */
export function toSessionContext(
  sessionId: string,
  info: SessionInfoResponse,
  previous?: FrcState | null,
): SessionContext {
  return {
    sessionId,
    currency: classifyCurrency(info).code,
    allowedBets: info.game_settings.allowed_bets,
    frc: frcFromSession(info, previous),
  };
}

/**
 * Записать в контекст то, что платформа сказала о кампании В ОТВЕТЕ НА РАУНД.
 *
 * Тонкая обёртка над `applyProgress`: сама логика (и то, почему её отсутствие
 * стоило игроку всей сессии) живёт в `session/frc.ts`. Здесь — только форма
 * возврата: чистая функция, отдающая НОВЫЙ контекст, потому что `ctx` в
 * `ws.ts` переприсваивается целиком и мутация разъехалась бы с ним.
 */
export function applyCampaignProgress(
  ctx: SessionContext,
  progress: CampaignProgress | null | undefined,
): SessionContext {
  const frc = applyProgress(ctx.frc, progress);
  return frc === ctx.frc ? ctx : { ...ctx, frc };
}
