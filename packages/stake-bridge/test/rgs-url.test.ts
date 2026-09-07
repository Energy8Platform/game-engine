import { describe, it, expect } from 'vitest';
import { isValidRgsUrl, parseStakeUrl } from '../src/rgs-client';

describe('isValidRgsUrl (open-redirect guard)', () => {
  it('accepts the bare Stake hostname forms Stake actually sends', () => {
    expect(isValidRgsUrl('rgsd.stake-engine.com')).toBe(true);
    expect(isValidRgsUrl('stake-engine.com')).toBe(true);
    expect(isValidRgsUrl('https://x.stake-engine.com')).toBe(true);
  });

  it('accepts the engine.io RGS hosts', () => {
    expect(isValidRgsUrl('engine.io')).toBe(true);
    expect(isValidRgsUrl('rgs.engine.io')).toBe(true);
    expect(isValidRgsUrl('https://x.engine.io')).toBe(true);
    expect(isValidRgsUrl('rgs.engine.io:8443/api')).toBe(true);
  });

  it('rejects hosts that merely END in the allowed names', () => {
    // The whole guard turns on the leading dot. Without it `endsWith('engine.io')` hands the
    // session to anyone who registers a name ending in those characters — and `stake-engine.io`
    // is a plausible enough typo-domain that it would not look wrong in a log.
    expect(isValidRgsUrl('evilengine.io')).toBe(false);
    expect(isValidRgsUrl('stake-engine.io')).toBe(false);
    expect(isValidRgsUrl('engine.io.evil.com')).toBe(false);
    expect(isValidRgsUrl('notstake-engine.com')).toBe(false);
  });

  it('accepts localhost / 127.0.0.1 (with port + path) for the dev harness', () => {
    expect(isValidRgsUrl('localhost:5173/__rgs')).toBe(true);
    expect(isValidRgsUrl('127.0.0.1:4173/__rgs')).toBe(true);
  });

  it('rejects any non-Stake host (open-redirect / exfiltration)', () => {
    expect(isValidRgsUrl('evil.com')).toBe(false);
    expect(isValidRgsUrl('https://evil.com/x')).toBe(false);
    expect(isValidRgsUrl('stake-engine.com.evil.com')).toBe(false); // suffix-spoof
    expect(isValidRgsUrl('not a host/with/slashes')).toBe(false);
    expect(isValidRgsUrl('')).toBe(false);
  });

  it('parseStakeUrl throws on a tampered rgs_url (routes to the host fatal path)', () => {
    expect(() =>
      parseStakeUrl('https://game/?rgs_url=evil.com&sessionID=s1'),
    ).toThrow(/rejected rgs_url/);
    // a valid Stake host passes
    expect(() =>
      parseStakeUrl('https://game/?rgs_url=rgsd.stake-engine.com&sessionID=s1'),
    ).not.toThrow();
  });
});
