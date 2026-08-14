/** Контракт между HTTP-слоем и оркестратором. Ничего из этого не переживает запрос. */

import type { CampaignProgress } from '../games-api/types.js';

export interface SessionContext {
  sessionId: string;
  /**
   * ISO-код игрока, либо `null` — кода в SessionInfo не было. Признаком демо
   * НЕ является: платформа шлёт ответы без `currency` и на реальных сессиях
   * (см. `classifyCurrency`), а режим кошелька держит соединение.
   */
  currency: string | null;
  /** Массив допустимых ставок из SessionInfo; индекс в нём — то, что едет наружу. */
  allowedBets: number[];
  /** Активная кампания фри-раундов, если есть. */
  frcId?: string;
}

export interface PlayRequest {
  /** Идентификатор запроса фронта — возвращаем его в ответе. */
  id: string;
  action: string;
  betIndex: number;
  /** Интерактивный выбор игрока: гэмбл, пик бонуса и подобное. */
  params?: Record<string, unknown>;
}

/** Один сегмент, готовый к отправке во фронт. */
export interface SegmentDelivery {
  roundId: string;
  action: string;
  data: Record<string, unknown>;
  /** Выигрыш сегмента в множителях ставки — суммы считает фронт для показа. */
  winX: number;
  totalWinX: number;
  /** allowed_bets[betIndex] — платформенное значение, не наш расчёт. */
  betAmount: number;
  nextActions: string[];
  spinsRemaining: number;
  spinsPlayed: number;
  /**
   * Баланс из ответа платформы; `null` — платформа его в этом ответе не
   * называла (UpdateRoundState баланса не возвращает). НЕ признак незакрытого
   * раунда: у открывающего сегмента баланс есть, ставка уже списана.
   */
  balanceAfter: number | null;
  /** true, пока выигрыш ещё не зачислен (сложный раунд не закрыт). */
  creditPending: boolean;
  maxWinReached: boolean;
  frc?: CampaignProgress | null;
}
