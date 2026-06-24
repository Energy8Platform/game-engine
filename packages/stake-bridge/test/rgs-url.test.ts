import { describe, it, expect } from 'vitest';
import { isValidRgsUrl, parseStakeUrl } from '../src/rgs-client';

describe('isValidRgsUrl (open-redirect guard)', () => {
  it('accepts the bare Stake hostname forms Stake actually sends', () => {
    expect(isValidRgsUrl('rgsd.stake-engine.com')).toBe(true);
    expect(isValidRgsUrl('stake-engine.com')).toBe(true);
    expect(isValidRgsUrl('https://x.stake-engine.com')).toBe(true);
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
