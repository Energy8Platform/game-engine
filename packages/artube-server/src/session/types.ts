/** Контракт между HTTP-слоем и оркестратором. Ничего из этого не переживает запрос. */

import type { CampaignProgress } from '../games-api/types.js';

export interface SessionContext {
  sessionId: string;
  /** `null` — демо-сессия: раундовые RPC платформе запрещены. */
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
  /** Баланс из ответа платформы; `null`, пока раунд не рассчитан. */
  balanceAfter: number | null;
  /** true, пока выигрыш ещё не зачислен (сложный раунд не закрыт). */
  creditPending: boolean;
  maxWinReached: boolean;
  frc?: CampaignProgress | null;
}
