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

export interface ServerInit {
  currency: string | null;
  balance: number;
  demo: boolean;
  config: ServerInitConfig;
  frc: {
    campaignId: string; roundsLeft: number; roundsTotal: number;
    totalWin: number; isComplete: boolean;
  } | null;
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
  | { t: 'ack'; roundId: string; cursor: number };

export type ServerMessage =
  | ({ t: 'init' } & ServerInit)
  | ({ t: 'result'; id?: string } & ServerResult)
  | { t: 'balance'; balance: number; reason: string }
  | { t: 'session_closed'; reason: string }
  | { t: 'error'; id?: string; code: string; message: string };

export interface ArtubeBridgeOptions {
  /** Мост живёт в одном бандле с игрой и общается через MemoryChannel. */
  devMode?: boolean;
  /**
   * База адресов бэкенда (мост дописывает `/api/ws`); по умолчанию — каталог
   * страницы запуска, см. `ArtubeUrlParams.apiBase`. Переопределять только
   * для локальной разработки против бэкенда на другом порту.
   */
  apiBase?: string;
  /** Переопределение URL запуска; по умолчанию `window.location.href`. */
  url?: string | URL | Location;
  gameId?: string;
  /** Стартовый виртуальный баланс демо-режима. */
  demoBalance?: number;
  debug?: boolean;
}
