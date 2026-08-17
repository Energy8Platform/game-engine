/**
 * Контракт `/api/ws`. Продублирован из `@energy8platform/artube-server`
 * намеренно: фронтовый бандл не должен зависеть от серверного пакета.
 */

export interface ServerInitConfig {
  betLevels: number[];
  defaultBetIndex: number;
  currencyMinimalUnit: number;
  autoSpinCounts: number[];
  locales: string[];
  rtp: { isVisible: boolean; shownRtp?: number };
  platformMaxWin: { isVisible: boolean; playerCurrencyValue: number; baseCurrency: string } | null;
}

export interface ServerResult {
  id?: string;
  roundId: string;
  action: string;
  data: Record<string, unknown>;
  winX: number;
  totalWinX: number;
  betAmount: number;
  nextActions: string[];
  spinsRemaining: number;
  spinsPlayed: number;
  balanceAfter: number | null;
  creditPending: boolean;
  maxWinReached: boolean;
  frc?: { rounds_left: number; total_win: number; is_complete: boolean } | null;
}

/**
 * Состояние кампании фри-раундов на ЭТОМ соединении.
 *
 * `offered` — платформа выдала кампанию, игрок ещё не ответил: показать
 *   анонсер. Ставка при этом своя, спины платные, покупка фичи разрешена.
 * `active` — игрок нажал Start: ставка заблокирована на `bet`/`betIndex`,
 *   показывается счётчик `roundsLeft`/`roundsTotal`, Buy Bonus недоступен.
 * `declined` — игрок выбрал обычную игру; до реконнекта кампания не
 *   предлагается и не активируется.
 * `completed` — раунды кончились: показать итог `totalWin` и вернуть игрока к
 *   его ставке.
 */
export type ServerFrcStatus = 'offered' | 'active' | 'declined' | 'completed';

/** Кампания в том виде, в каком её видит игра — и в `init`, и в кадре `frc`. */
export interface ServerFrc {
  campaignId: string;
  status: ServerFrcStatus;
  roundsLeft: number;
  roundsTotal: number;
  totalWin: number;
  isComplete: boolean;
  /** Ставка кампании; фри-раунды идут на ней, а не на выбранной игроком. */
  bet?: number;
  /**
   * Индекс `bet` в `config.betLevels` — им и надо ставить ставку при
   * активации. `null` означает, что ставки кампании в лестнице нет: такую
   * кампанию сервер активировать откажется (`FrcBetNotAllowed`), анонсер
   * показывать не нужно.
   */
  betIndex: number | null;
  /** Окно кампании; `validTo` — то самое «Успейте сыграть до…». */
  validFrom?: string;
  validTo?: string;
}

export interface ServerInit {
  currency: string | null;
  balance: number;
  demo: boolean;
  config: ServerInitConfig;
  frc: ServerFrc | null;
  gamificationToken?: string;
  /** Сегмент незакрытого раунда, если игрок вернулся в середину фичи. */
  resume?: ServerResult | null;
}

/**
 * Контракт `/api/ws` со стороны клиента — зеркало серверного `ClientMessage`
 * (`packages/artube-server/src/http/wire.ts`), продублировано по той же
 * причине: фронтовый бандл не должен зависеть от серверного пакета.
 */
export type ClientMessage =
  | { t: 'play'; id: string; action: string; betIndex: number; params?: Record<string, unknown> }
  | { t: 'ack'; roundId: string; cursor: number }
  | { t: 'frc_activate'; id: string; campaignId: string }
  | { t: 'frc_decline'; id: string; campaignId: string };

export type ServerMessage =
  | ({ t: 'init' } & ServerInit)
  | ({ t: 'result'; id?: string } & ServerResult)
  | ({ t: 'frc'; id?: string } & ServerFrc)
  | { t: 'balance'; balance: number; reason: string }
  | { t: 'session_closed'; reason: string }
  | { t: 'error'; id?: string; code: string; message: string };

export interface ArtubeBridgeOptions {
  /** Мост живёт в одном бандле с игрой и общается через MemoryChannel. */
  devMode?: boolean;
  /**
   * База адресов бэкенда (мост дописывает `/api/ws`); по умолчанию — путь
   * страницы запуска, перевешенный под `/api`, см. `ArtubeUrlParams.apiBase`.
   *
   * Полностью перебивает вывод из URL: локальная разработка против бэкенда на
   * другом порту — и запасной ход, если деплой окажется смонтирован иначе,
   * чем описано. После двух неверных выводов подряд возможность назвать адрес
   * прямо стоит дороже любой договорённости.
   */
  apiBase?: string;
  /** Переопределение URL запуска; по умолчанию `window.location.href`. */
  url?: string | URL | Location;
  gameId?: string;
  /** Стартовый виртуальный баланс демо-режима. */
  demoBalance?: number;
  debug?: boolean;
}
