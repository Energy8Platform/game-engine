/** Контракт между HTTP-слоем и оркестратором. Ничего из этого не переживает запрос. */

import type { CampaignProgress } from '../games-api/types.js';
import type { FrcState } from './frc.js';

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
  /**
   * Кампания фри-раундов И решение игрока о ней на этом соединении.
   *
   * Одним полем, а не «кампания» + «активна ли»: наружу уезжает
   * `free_round_campaign_id`, и держать признак активности отдельно от самой
   * кампании значило бы завести два поля, которые обязаны сходиться. Что
   * именно вправе уехать, отвечает `activeCampaignId(ctx.frc)`.
   */
  frc?: FrcState;
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
  /**
   * Платформа усекла выигрыш своим лимитом максвина.
   *
   * Приезжает и с простого раунда (PlayRound), и с закрытия сложного
   * (CloseRound) — второе важнее: слот срывает максвин в конце фри-спинов, а
   * не на одиночном спине.
   */
  maxWinReached: boolean;
  /**
   * Сумма выигрыша В ВАЛЮТЕ СЕССИИ, посчитанная платформой, — уже усечённая
   * максвином; `null` — платформа её в этом ответе не называла.
   *
   * Не то же самое, что `totalWinX * betAmount`: наш множитель — это то, что
   * насчитала математика, а это — то, что реально зачислено. Разойтись они
   * могут ровно в одном случае, и `max-win.md` требует показать игроку именно
   * второе число.
   */
  winAmount: number | null;
  frc?: CampaignProgress | null;
}
