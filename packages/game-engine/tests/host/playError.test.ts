import { describe, it, expect } from 'vitest';
import { resolvePlayError, errorCode } from '@/host/playError';

class FakeSDKError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

describe('resolvePlayError', () => {
  it('ACTIVE_SESSION_EXISTS → reload (round in progress), not a connection message', () => {
    const v = resolvePlayError(new FakeSDKError('ACTIVE_SESSION_EXISTS', 'active round'));
    expect(v.reload).toBe(true);
    expect(v.title).toMatch(/round/i);
    expect(v.body).not.toMatch(/reconnect/i);
  });

  it('INSUFFICIENT_FUNDS → dismissible (no reload)', () => {
    const v = resolvePlayError(new FakeSDKError('INSUFFICIENT_FUNDS', 'low'));
    expect(v.reload).toBe(false);
    expect(v.title).toMatch(/balance/i);
  });

  it('TIMEOUT → dismissible try-again', () => {
    expect(resolvePlayError(new FakeSDKError('TIMEOUT', 't')).reload).toBe(false);
  });

  it('unknown code → generic heading + the server message verbatim + reload', () => {
    const v = resolvePlayError(new FakeSDKError('WEIRD_CODE', 'backend exploded'));
    expect(v.title).toBe('Game error');
    expect(v.body).toBe('backend exploded');
    expect(v.reload).toBe(true);
  });

  // Artube's client rejects a play whose socket died with `ConnectionLost`, Stake's RGS with
  // `ERR_NET`. Both mean "the LINK failed, the round didn't" — the bridge is already reconnecting,
  // so the player must see "Reconnecting…", never a "reload the page" screen.
  it.each(['ConnectionLost', 'ConnectionFailed', 'ERR_NET'])(
    '%s → a connection failure: no modal of its own, no reload',
    (code) => {
      const v = resolvePlayError(new FakeSDKError(code, 'connection lost'));
      expect(v.connection).toBe(true);
      expect(v.reload).toBe(false);
    },
  );

  it('a round error is NOT a connection failure', () => {
    expect(resolvePlayError(new FakeSDKError('ACTIVE_SESSION_EXISTS', 'x')).connection).toBeFalsy();
    expect(resolvePlayError(new FakeSDKError('WEIRD_CODE', 'x')).connection).toBeFalsy();
    expect(resolvePlayError(new FakeSDKError('INSUFFICIENT_FUNDS', 'x')).connection).toBeFalsy();
  });

  it('errorCode pulls a string code, else undefined', () => {
    expect(errorCode(new FakeSDKError('X', 'm'))).toBe('X');
    expect(errorCode(new Error('plain'))).toBeUndefined();
    expect(errorCode('nope')).toBeUndefined();
  });
});
