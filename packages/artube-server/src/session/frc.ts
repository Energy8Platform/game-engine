/**
 * Кампания фри-раундов: что она такое НА ОДНОМ СОЕДИНЕНИИ.
 *
 * Платформа рассказывает только о своей половине — сколько раундов осталось,
 * на какой ставке они идут, до какого числа кампания живёт. Половина, которой
 * у неё нет вовсе, — согласие игрока: в её payload'ах нет поля, означающего
 * «игрок нажал Start». Дока фронта называет этот флаг `is_frc_active` и прямо
 * говорит, что он НАШ (`free-rounds-campaign-frontend-integration.md:82-84`), а
 * дока бэкенда вменяет нам и сам вопрос: «логика по активации кампании
 * (предложение пользователю отыграть раунды за счёт FRC) должна быть
 * реализована на стороне бэкенда самой игры» (`:47`).
 *
 * Отсюда состояние ниже. Кампания, о которой платформа рассказала, начинает
 * жизнь ПРЕДЛОЖЕННОЙ, а не активной: до этого модуля активной считалась любая
 * живая кампания, и игрок, который ни разу её не просил, молча сжигал свои
 * бесплатные раунды на собственных спинах.
 *
 * Решение живёт ровно столько, сколько соединение, и это не компромисс, а то,
 * что дока предписывает прямым текстом: «При переподключениях пользователь
 * снова должен иметь возможность повторно активировать кампанию либо
 * отказаться и играть в обычном режиме» (`:47`). Реконнект обязан ПРЕДЛОЖИТЬ
 * заново — значит межсоединенческого хранилища выбора быть не должно.
 */

import type { CampaignProgress, SessionInfoResponse } from '../games-api/types.js';

/**
 * Что игрок сделал с кампанией на этом соединении.
 *
 * `offered` — платформа её вернула, игрок ещё не ответил. Наружу не уезжает
 *   ничего: спины обычные, платные, покупка фичи разрешена.
 * `active` — игрок нажал Start. Только в этом состоянии
 *   `free_round_campaign_id` едет в PlayRound/OpenRound.
 * `declined` — игрок выбрал обычную игру. До конца соединения кампания не
 *   предлагается и не активируется; реконнект предложит её снова.
 * `completed` — раунды кончились (или платформа отдала уже завершённую
 *   кампанию). Возврат к обычной игре.
 */
export type FrcStatus = 'offered' | 'active' | 'declined' | 'completed';

export interface FrcState {
  status: FrcStatus;
  campaignId: string;
  /** Ставка, на которой идут фри-раунды. Её задаёт кампания, не игрок. */
  bet: number;
  /**
   * Индекс `bet` в `allowed_bets`; `null` — такой ставки в списке нет.
   *
   * `null` означает «кампанию активировать нельзя»: дока называет это
   * ошибочной ситуацией (`:101`), а наружу всё равно уезжает ИНДЕКС — сумму
   * считает платформа, — так что без индекса фри-раунд просто нечем сыграть.
   */
  betIndex: number | null;
  roundsLeft: number;
  roundsTotal: number;
  totalWin: number;
  /** Окно, в котором кампанию можно отыграть; после `validTo` она сгорает. */
  validFrom?: string;
  validTo?: string;
}

/**
 * Отказ, относящийся к кампании. Код — код НАШЕГО протокола, он доезжает до
 * фронта в кадре `error` и различает причины отказа между собой.
 *
 * Два кода намеренно совпадают с платформенными (`FrcNotFound`,
 * `FrcAlreadyCompleted`): для фронта это буквально то же самое утверждение о
 * той же кампании, и разводить их на «наш» и «их» значило бы заставить игру
 * обрабатывать два кода на одну ситуацию.
 */
export class FrcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FrcError';
    this.code = code;
  }
}

/**
 * Покупка фичи во время АКТИВНОЙ кампании фри-раундов.
 *
 * Дока называет это отдельной проверкой на стороне бэкенда игры: «Попытка
 * сделать покупку фичи в рамках FRC, так как они не разрешены»
 * (`free-rounds-campaign-backend-integration.md`). Платформа её не делает —
 * значит делаем мы, и делаем отказом, а не догадкой про цену: см. `startRound`.
 *
 * «В рамках FRC» — это активная кампания, а не любая. До этого модуля отказ
 * срабатывал от одного лишь СУЩЕСТВОВАНИЯ кампании: игроку, который свои
 * фри-раунды даже не просил, покупка бонуса была запрещена, и объяснить это
 * было нечем — интерфейс о кампании не говорил ни слова.
 */
export class FeatureBuyDuringCampaignError extends FrcError {
  constructor(action: string, campaignId: string) {
    super(
      'FrcFeatureBuyNotAllowed',
      `action "${action}" is a feature buy and is not allowed while free round campaign ${campaignId} is active`,
    );
    this.name = 'FeatureBuyDuringCampaignError';
  }
}

/**
 * Спин активной кампании приехал с чужой ставкой.
 *
 * Дока перечисляет это первым среди наших валидаций и называет своим именем:
 * «Не поменялась ли ставка в запросе, так как это не валидное состояние».
 * Не «поправь», а «состояние невалидно» — поэтому отказ, а не приведение к
 * `campaign.bet`:
 *
 *  - молчаливое приведение прячет расхождение фронта и бэкенда ровно там, где
 *    оно стоит денег. Игрок видит на экране одну ставку, платформа считает
 *    выигрыш от другой, а сумму для показа фронт получает умножением
 *    множителя на ТУ ставку, которую видит сам (`bridge.ts`), — то есть
 *    расходится не только UI и кошелёк, а два числа на одном экране;
 *  - отказ стоит одного кадра `error`, ничего не двигает и делает расхождение
 *    видимым в первую же секунду, а не после разбора жалобы;
 *  - приведение вдобавок нечем сделать честно в единственном случае, ради
 *    которого оно и понадобилось бы: ставки кампании может не быть в
 *    `allowed_bets` вовсе (тогда `betIndex` — `null`).
 */
export class FrcBetMismatchError extends FrcError {
  constructor(campaignId: string, expected: number, got: number) {
    super(
      'FrcBetMismatch',
      `free round campaign ${campaignId} runs at bet index ${expected}; the round asked for ${got}`,
    );
    this.name = 'FrcBetMismatchError';
  }
}

/**
 * Индекс ставки кампании в `allowed_bets` — точным совпадением, без «ближайшей».
 *
 * Наружу уезжает индекс, а сумму по нему считает платформа: ошибиться на один
 * шаг лестницы — это сыграть фри-раунд не на той ставке, которую подарил
 * оператор. Дока на этот случай не предлагает ничего подобрать, она запрещает
 * активацию (`:101`), и `null` здесь — ровно это «нечего выбрать».
 */
export function campaignBetIndex(allowedBets: number[], bet: number): number | null {
  if (!Number.isFinite(bet)) return null;
  const index = allowedBets.indexOf(bet);
  return index >= 0 ? index : null;
}

/** Кампания отыграна до конца — по счётчику или по флагу платформы. */
export function isCampaignExhausted(progress: CampaignProgress): boolean {
  return progress.is_complete || progress.rounds_left <= 0;
}

/** Идентификатор, который вправе уехать на платформу. Только у активной. */
export function activeCampaignId(frc: FrcState | undefined): string | undefined {
  return frc?.status === 'active' ? frc.campaignId : undefined;
}

/**
 * Кампания из SessionInfo плюс решение игрока, если оно на этом соединении уже
 * было.
 *
 * `previous` передаётся только при ПЕРЕЧИТЫВАНИИ сессии внутри живого
 * соединения (восстановление, `RoundAlreadySettled`): там смысл перечитывания —
 * освежить платформенные счётчики, а не спросить игрока заново. Без этого
 * первое же восстановление посреди активной кампании сбрасывало бы её в
 * «предложена» и следующий спин уехал бы платным.
 *
 * Новое соединение зовёт это БЕЗ `previous` — и получает `offered` даже для
 * кампании, которую игрок только что отыгрывал: реконнект обязан предложить
 * заново (`free-rounds-campaign-backend-integration.md:47`).
 */
export function frcFromSession(
  info: SessionInfoResponse,
  previous?: FrcState | null,
): FrcState | undefined {
  const campaign = info.free_round_campaign;
  if (!campaign) return undefined;

  const exhausted = isCampaignExhausted(campaign);
  // Решение переносим только на ТУ ЖЕ кампанию: платформа вправе вернуть
  // другую (оператор выдал новую, пока игрок играл), и унаследованное «активна»
  // означало бы, что мы шлём id, которого игрок не подтверждал.
  const carried =
    previous && previous.campaignId === campaign.campaign_id && previous.status !== 'completed'
      ? previous.status
      : 'offered';

  return {
    status: exhausted ? 'completed' : carried,
    campaignId: campaign.campaign_id,
    bet: campaign.bet,
    betIndex: campaignBetIndex(info.game_settings.allowed_bets, campaign.bet),
    roundsLeft: campaign.rounds_left,
    roundsTotal: campaign.rounds_total,
    totalWin: campaign.total_win,
    validFrom: campaign.valid_from,
    validTo: campaign.valid_to,
  };
}

/**
 * Игрок нажал Start.
 *
 * Все отказы — из списка «дополнительная валидация на стороне бэкенда игры»
 * (`free-rounds-campaign-backend-integration.md:53-59`) плюс запрет активации
 * при ставке вне `allowed_bets` (`frontend:101`).
 *
 * Срока действия здесь НЕ проверяем, хотя `validTo` у нас есть. Часы пода и
 * часы платформы — разные часы, а решение авторитетно ровно одно: платформа
 * ответит `FrcNotFound`/`FrcAlreadyCompleted` на первый же спин, и этот путь у
 * нас уже разобран (`session/recovery.ts` перечитывает сессию и снимает
 * кампанию). Отказать по своим часам значило бы отобрать живую кампанию у
 * игрока из-за расхождения в пару минут — ошибка того же класса, что и вся эта
 * задача, только в другую сторону.
 */
export function activateCampaign(frc: FrcState | undefined, campaignId: string): FrcState {
  if (!frc) {
    throw new FrcError('FrcNotFound', 'there is no free round campaign on this session');
  }
  // Не та кампания, которую вернул SessionInfo, — дока перечисляет это
  // отдельной проверкой (`:57`). Идентификатор приходит от фронта, то есть в
  // конечном счёте из браузера игрока.
  if (frc.campaignId !== campaignId) {
    throw new FrcError(
      'FrcNotFound',
      `campaign ${campaignId} is not the campaign this session was offered (${frc.campaignId})`,
    );
  }
  if (frc.status === 'completed' || frc.roundsLeft <= 0) {
    throw new FrcError('FrcAlreadyCompleted', `campaign ${campaignId} has no rounds left`);
  }
  // «Повторный вызов активации Кампании в текущем соединении» (`:56`).
  // Отдельным кодом, а не молча: фронту дока разрешает повтор игнорировать
  // (`frontend:108`), и с отдельным кодом он именно это и может сделать — а с
  // молчаливым «ок» не отличил бы повтор от первой активации.
  if (frc.status === 'active') {
    throw new FrcError('FrcAlreadyActivated', `campaign ${campaignId} is already active`);
  }
  // Отказ игрока — ответ, а не закрытие окна: заново кампанию предложит
  // реконнект, как и требует дока.
  if (frc.status === 'declined') {
    throw new FrcError(
      'FrcDeclined',
      `campaign ${campaignId} was declined on this connection; reconnect to be offered it again`,
    );
  }
  if (frc.betIndex === null) {
    throw new FrcError(
      'FrcBetNotAllowed',
      `campaign ${campaignId} runs at bet ${frc.bet}, which is not in allowed_bets`,
    );
  }
  return { ...frc, status: 'active' };
}

/** Игрок выбрал обычную игру. */
export function declineCampaign(frc: FrcState | undefined, campaignId: string): FrcState {
  if (!frc) {
    throw new FrcError('FrcNotFound', 'there is no free round campaign on this session');
  }
  if (frc.campaignId !== campaignId) {
    throw new FrcError(
      'FrcNotFound',
      `campaign ${campaignId} is not the campaign this session was offered (${frc.campaignId})`,
    );
  }
  // Отыгранные раунды не вернуть: отказаться можно от предложения, а не от
  // кампании, в которой игрок уже сжёг раунд.
  if (frc.status === 'active') {
    throw new FrcError('FrcAlreadyActivated', `campaign ${campaignId} is already active`);
  }
  return { ...frc, status: 'declined' };
}

/**
 * Записать то, что платформа сказала о кампании В ОТВЕТЕ НА РАУНД.
 *
 * Единственный момент, когда мы узнаём, что раунды кончились: остаток приезжает
 * в ответе на КАЖДЫЙ фри-раунд (`PlayRoundResponse.free_round_campaign`,
 * `CloseRoundResponse.free_round_campaign`), а SessionInfo перечитывается
 * только на новом соединении.
 *
 * Не записать его стоило игроку всей сессии: идентификатор ставился один раз на
 * коннекте и не снимался никогда, поэтому после последнего фри-раунда мы
 * продолжали слать `free_round_campaign_id` завершённой кампании на каждом
 * спине; платформа отвечала `FrcAlreadyCompleted`, и следующий спин делал ровно
 * то же самое — каждый спин до перезагрузки страницы.
 */
export function applyProgress(
  frc: FrcState | undefined,
  progress: CampaignProgress | null | undefined,
): FrcState | undefined {
  if (!frc || frc.status !== 'active' || !progress) return frc;
  return {
    ...frc,
    status: isCampaignExhausted(progress) ? 'completed' : 'active',
    roundsLeft: progress.rounds_left,
    totalWin: progress.total_win,
  };
}
