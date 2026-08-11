import { describe, it, expect } from 'vitest';
import {
  encodeRoundState, decodeRoundState, newSeed, newEngineRoundId, ROUND_STATE_VERSION,
  type RoundStateV1,
} from '../src/round/roundState';
import { MAX_MESSAGE_BYTES } from '../src/games-api/envelope';

const sample: RoundStateV1 = {
  v: 1,
  seed: { server: 'srv', client: 'cli', nonce: 7 },
  eid: 'e-1',
  script: 'sha-1',
  action: 'spin',
  betIndex: 2,
  priceMultiplier: 1,
  cursor: 0,
  totalWinX: 0,
  actions: [],
};

describe('round_state', () => {
  it('версия формата — строка "1"', () => {
    expect(ROUND_STATE_VERSION).toBe('1');
  });

  it('кодирование и декодирование — round-trip', () => {
    expect(decodeRoundState(encodeRoundState(sample))).toEqual(sample);
  });

  it('кодируется в строку, а не в объект — так требует дока', () => {
    expect(typeof encodeRoundState(sample)).toBe('string');
  });

  it('состояние остаётся крошечным даже с полным логом фичи', () => {
    const withActions: RoundStateV1 = {
      ...sample,
      cursor: 50,
      actions: Array.from({ length: 50 }, () => ({ a: 'free_spin' })),
    };
    expect(encodeRoundState(withActions).length).toBeLessThan(MAX_MESSAGE_BYTES / 10);
  });

  it('интерактивный выбор игрока сохраняется в логе', () => {
    const withGamble: RoundStateV1 = {
      ...sample,
      actions: [{ a: 'gamble', p: { choice: 'red' } }],
    };
    expect(decodeRoundState(encodeRoundState(withGamble)).actions[0].p).toEqual({ choice: 'red' });
  });

  it('отвергает чужую версию формата', () => {
    expect(() => decodeRoundState(JSON.stringify({ ...sample, v: 2 }))).toThrow(/version/);
  });

  it('отвергает битую строку', () => {
    expect(() => decodeRoundState('not json')).toThrow();
  });

  it('newSeed даёт разные сиды, newEngineRoundId — разные id', () => {
    expect(newSeed().server).not.toBe(newSeed().server);
    expect(newSeed().server).toMatch(/^[0-9a-f]{32}$/);
    expect(newEngineRoundId()).not.toBe(newEngineRoundId());
  });
});
