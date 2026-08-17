/** Контракт `/api/ws` — почти 1:1 с протоколом game-sdk, чтобы мост оставался переводчиком. */

import type { FrcInfo, InitPayload } from '../session/init.js';
import type { SegmentDelivery } from '../session/types.js';

export type ClientMessage =
  | { t: 'play'; id: string; action: string; betIndex: number; params?: Record<string, unknown> }
  | { t: 'ack'; roundId: string; cursor: number }
  /**
   * Игрок нажал Start в анонсере кампании. С этого момента (и только с него)
   * `free_round_campaign_id` уезжает на платформу, а ставка фиксируется
   * кампанией.
   *
   * `campaignId` обязателен, хотя кампания на сессии одна: дока требует
   * отдельной проверкой отвергать активацию «не той, которая была в ответе на
   * сессию» (`free-rounds-campaign-backend-integration.md:57`), а без
   * идентификатора в запросе проверять нечего.
   */
  | { t: 'frc_activate'; id: string; campaignId: string }
  /**
   * Игрок выбрал обычную игру. Это ОТВЕТ игрока, а не закрытие окна: до конца
   * соединения кампания не активируется, и предложит её заново только
   * реконнект (`:47`). Игра, у которой анонсер можно открыть повторно, просто
   * не шлёт это на закрытие.
   */
  | { t: 'frc_decline'; id: string; campaignId: string };

export type ServerMessage =
  | ({ t: 'init' } & InitPayload & { resume?: SegmentDelivery | null })
  | ({ t: 'result'; id: string } & SegmentDelivery)
  /**
   * Состояние кампании изменилось. Приезжает ответом на `frc_activate` /
   * `frc_decline` (с их `id`) и без `id` — когда кампания завершилась сама,
   * отыгранная до конца.
   *
   * Счётчик по ходу игры едет НЕ здесь, а в `result.frc`: платформа обновляет
   * его в ответе на каждый фри-раунд, и дублировать это отдельным кадром
   * значило бы слать два числа об одном событии.
   */
  | ({ t: 'frc'; id?: string } & FrcInfo)
  | { t: 'balance'; balance: number; reason: string }
  | { t: 'session_closed'; reason: string }
  | { t: 'error'; id?: string; code: string; message: string };

const CLIENT_TYPES: ReadonlySet<string> = new Set([
  'play',
  'ack',
  'frc_activate',
  'frc_decline',
]);

export function parseClientMessage(raw: string): ClientMessage {
  const parsed = JSON.parse(raw) as ClientMessage;
  if (!CLIENT_TYPES.has(parsed?.t)) {
    throw new Error(`unknown client message: ${String((parsed as { t?: string })?.t)}`);
  }
  return parsed;
}
