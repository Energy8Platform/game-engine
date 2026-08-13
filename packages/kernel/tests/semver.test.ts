import { describe, expect, it } from 'vitest';
import { isValidRange, parseVersion, satisfies } from '@/resolve/semver';

describe('parseVersion', () => {
  it('parses a plain version', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  it('rejects anything that is not major.minor.patch', () => {
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('v1.2.3')).toBeNull();
    expect(parseVersion('1.2.3-beta.1')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
  });
});

describe('isValidRange', () => {
  it('accepts the four supported forms and the wildcard', () => {
    for (const r of ['*', '1.2.3', '^1.2.3', '~1.2.3', '>=1.2.3']) {
      expect(isValidRange(r)).toBe(true);
    }
  });

  it('rejects unsupported syntax', () => {
    for (const r of ['1.x', '>1.2.3 <2.0.0', '^1.2', '']) {
      expect(isValidRange(r)).toBe(false);
    }
  });
});

describe('satisfies', () => {
  it('matches anything against the wildcard', () => {
    expect(satisfies('0.0.1', '*')).toBe(true);
  });

  it('matches an exact range only on equality', () => {
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '1.2.3')).toBe(false);
  });

  it('caret allows patch and minor, not major', () => {
    expect(satisfies('1.2.3', '^1.2.3')).toBe(true);
    expect(satisfies('1.9.0', '^1.2.3')).toBe(true);
    expect(satisfies('1.2.2', '^1.2.3')).toBe(false);
    expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
  });

  it('caret on a 0.x major pins the minor, as npm does', () => {
    expect(satisfies('0.1.5', '^0.1.0')).toBe(true);
    expect(satisfies('0.2.0', '^0.1.0')).toBe(false);
  });

  it('caret below 0.1.0 pins the patch too, as npm does', () => {
    expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
    expect(satisfies('0.0.2', '^0.0.3')).toBe(false);
    expect(satisfies('0.1.0', '^0.0.3')).toBe(false);
  });

  it('tilde allows patch only', () => {
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
  });

  it('>= compares in version order, not lexically', () => {
    expect(satisfies('1.10.0', '>=1.9.0')).toBe(true);
    expect(satisfies('1.8.0', '>=1.9.0')).toBe(false);
  });

  it('returns false rather than throwing on unparseable input', () => {
    expect(satisfies('nope', '^1.0.0')).toBe(false);
    expect(satisfies('1.0.0', 'garbage')).toBe(false);
  });
});

describe('semver survives hostile input', () => {
  it('never throws, whatever it is handed', () => {
    const junk: unknown[] = [
      null, undefined, '', ' ', '1', '1.2', '1.2.3.4', 'v1.2.3', '1.2.3-beta.1',
      '01.02.03', '-1.0.0', '1.2.x', 'latest', '^^1.0.0', '>=', '*', 0, 1.5, {}, [],
      Symbol('v') as unknown, () => '1.0.0',
    ];
    for (const a of junk) {
      for (const b of junk) {
        expect(() => satisfies(a as string, b as string)).not.toThrow();
        expect(() => isValidRange(b as string)).not.toThrow();
        expect(() => parseVersion(a as string)).not.toThrow();
      }
    }
  });

  it('rejects leading-zero versions as per SemVer 2.0.0', () => {
    expect(parseVersion('01.02.03')).toBeNull();
    expect(satisfies('01.02.03', '^1.0.0')).toBe(false);
  });

  it('does not accept a version with extra segments', () => {
    expect(parseVersion('1.2.3.4')).toBeNull();
    expect(satisfies('1.2.3.4', '1.2.3')).toBe(false);
  });

  it('does not throw on a huge version, though precision is silently lost', () => {
    const huge = '999999999999999999999.0.0';
    const parsed = parseVersion(huge);
    expect(parsed).not.toBeNull();
    expect(parsed![0]).toBe(1e21);
  });
});
