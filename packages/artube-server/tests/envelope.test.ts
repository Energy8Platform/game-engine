import { describe, it, expect } from 'vitest';
import {
  buildEnvelope,
  parseEnvelope,
  newMessageId,
  OpSeq,
  EnvelopeError,
  MAX_MESSAGE_BYTES,
} from '../src/games-api/envelope';

describe('envelope', () => {
  it('строит конверт с обязательными полями', () => {
    const env = buildEnvelope('rpc', 'SessionInfoRequest', { session_id: 's1' }, 2);
    expect(env.proto).toBe(1);
    expect(env.schema).toBe(1);
    expect(env.chan).toBe('rpc');
    expect(env.type).toBe('SessionInfoRequest');
    expect(env.op_seq).toBe(2);
    expect(env.payload).toEqual({ session_id: 's1' });
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(env.corr_id).toBeNull();
  });

  it('проставляет corr_id, когда он передан', () => {
    const env = buildEnvelope('rpc', 'X', {}, 1, 'req-1');
    expect(env.corr_id).toBe('req-1');
  });

  it('генерирует уникальные id в формате GUID', () => {
    const a = newMessageId();
    const b = newMessageId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('op_seq растёт монотонно и сбрасывается', () => {
    const seq = new OpSeq();
    expect(seq.next()).toBe(1);
    expect(seq.next()).toBe(2);
    seq.reset();
    expect(seq.next()).toBe(1);
  });

  it('парсит валидный конверт', () => {
    const raw = JSON.stringify(buildEnvelope('events', 'BalanceChangedEvent', { balance: 10 }, 5));
    const env = parseEnvelope(raw);
    expect(env.type).toBe('BalanceChangedEvent');
    expect(env.payload).toEqual({ balance: 10 });
  });

  it('отвергает битый JSON', () => {
    expect(() => parseEnvelope('{oops')).toThrow(EnvelopeError);
  });

  it('отвергает конверт без обязательных полей', () => {
    expect(() => parseEnvelope(JSON.stringify({ proto: 1, chan: 'rpc' }))).toThrow(/type/);
  });

  it('отвергает неизвестный канал', () => {
    const bad = { ...buildEnvelope('rpc', 'X', {}, 1), chan: 'weird' };
    expect(() => parseEnvelope(JSON.stringify(bad))).toThrow(/chan/);
  });

  it('отвергает сообщение больше 128 KB', () => {
    const huge = JSON.stringify(buildEnvelope('rpc', 'X', { blob: 'x'.repeat(MAX_MESSAGE_BYTES) }, 1));
    expect(() => parseEnvelope(huge)).toThrow(/too large/);
  });
});
