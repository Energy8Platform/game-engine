/** Контракт `/api/ws` — почти 1:1 с протоколом game-sdk, чтобы мост оставался переводчиком. */

import type { InitPayload } from '../session/init.js';
import type { SegmentDelivery } from '../session/types.js';

export type ClientMessage =
  | { t: 'play'; id: string; action: string; betIndex: number; params?: Record<string, unknown> }
  | { t: 'ack'; roundId: string; cursor: number };

export type ServerMessage =
  | ({ t: 'init' } & InitPayload & { resume?: SegmentDelivery | null })
  | ({ t: 'result'; id: string } & SegmentDelivery)
  | { t: 'balance'; balance: number; reason: string }
  | { t: 'session_closed'; reason: string }
  | { t: 'error'; id?: string; code: string; message: string };

export function parseClientMessage(raw: string): ClientMessage {
  const parsed = JSON.parse(raw) as ClientMessage;
  if (parsed?.t !== 'play' && parsed?.t !== 'ack') {
    throw new Error(`unknown client message: ${String((parsed as { t?: string })?.t)}`);
  }
  return parsed;
}
