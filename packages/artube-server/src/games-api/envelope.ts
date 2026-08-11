/**
 * Кодек конверта Artube Games API.
 *
 * Все сообщения — и наши запросы, и ответы/события платформы — упакованы в
 * один и тот же конверт с метаданными версионирования, трейсинга и
 * упорядочивания. Модуль намеренно не знает ни про WebSocket, ни про
 * конкретные контракты: он только собирает и разбирает оболочку.
 */

import { randomUUID } from 'node:crypto';

export type Channel = 'rpc' | 'events' | 'control';

export interface Envelope<P = unknown> {
  proto: 1;
  schema: 1;
  chan: Channel;
  type: string;
  id: string;
  corr_id?: string | null;
  op_seq: number;
  timestamp: string;
  trace?: Record<string, string>;
  payload: P;
}

/** Лимит из доки: WebSocket-сообщение не может быть больше 128 KB. */
export const MAX_MESSAGE_BYTES = 128 * 1024;

export class EnvelopeError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'EnvelopeError';
  }
}

/**
 * Порядковый номер операции. Дока требует монотонного роста в рамках
 * соединения, поэтому счётчик живёт ровно столько же, сколько коннект, и
 * сбрасывается при переподключении.
 */
export class OpSeq {
  private value = 0;

  next(): number {
    this.value += 1;
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

/**
 * GUID v7 — монотонный по времени, как требует дока. `randomUUID` даёт v4,
 * поэтому переписываем метку времени и версию вручную.
 */
export function newMessageId(): string {
  const hex = randomUUID().replace(/-/g, '');
  const ts = Date.now().toString(16).padStart(12, '0');
  const rest = hex.slice(12);
  const v7 = ts + '7' + rest.slice(1);
  return [
    v7.slice(0, 8),
    v7.slice(8, 12),
    v7.slice(12, 16),
    v7.slice(16, 20),
    v7.slice(20, 32),
  ].join('-');
}

export function buildEnvelope<P>(
  chan: Channel,
  type: string,
  payload: P,
  opSeq: number,
  corrId?: string,
): Envelope<P> {
  return {
    proto: 1,
    schema: 1,
    chan,
    type,
    id: newMessageId(),
    corr_id: corrId ?? null,
    op_seq: opSeq,
    timestamp: new Date().toISOString(),
    payload,
  };
}

const CHANNELS = new Set<string>(['rpc', 'events', 'control']);

export function parseEnvelope(raw: string | Buffer): Envelope {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new EnvelopeError(`message too large: ${Buffer.byteLength(text, 'utf8')} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EnvelopeError('invalid json');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new EnvelopeError('envelope must be an object');
  }
  const env = parsed as Partial<Envelope>;
  if (typeof env.type !== 'string' || env.type === '') {
    throw new EnvelopeError('missing type');
  }
  if (typeof env.chan !== 'string' || !CHANNELS.has(env.chan)) {
    throw new EnvelopeError(`unknown chan: ${String(env.chan)}`);
  }
  if (typeof env.id !== 'string' || env.id === '') {
    throw new EnvelopeError('missing id');
  }
  if (env.payload === undefined || env.payload === null) {
    throw new EnvelopeError('missing payload');
  }
  return env as Envelope;
}
