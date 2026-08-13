import { describe, expect, it } from 'vitest';
import { describeMatcher, isDefaultMatcher, matches } from '@/resolve/match';
import type { LaunchContext } from '@/resolve/types';
import type { Diagnostic } from '@/diagnostics';

const ctx = (over: Partial<LaunchContext> = {}): LaunchContext => ({
  url: 'https://game.example/play',
  ...over,
});

describe('matches', () => {
  it('matches a url parameter that is present', () => {
    expect(matches({ urlParam: 'sessionId' }, ctx({ url: 'https://g/play?sessionId=abc' }))).toBe(true);
  });

  it('does not match a url parameter that is absent', () => {
    expect(matches({ urlParam: 'sessionId' }, ctx())).toBe(false);
  });

  it('matches an empty url parameter, because presence is the question', () => {
    expect(matches({ urlParam: 'replay' }, ctx({ url: 'https://g/play?replay=' }))).toBe(true);
  });

  it('matches a build target', () => {
    expect(matches({ buildTarget: 'stake' }, ctx({ buildTarget: 'stake' }))).toBe(true);
    expect(matches({ buildTarget: 'stake' }, ctx({ buildTarget: 'artube' }))).toBe(false);
  });

  it('requires every declared condition to hold', () => {
    const m = { urlParam: 'sessionId', buildTarget: 'artube' };
    expect(matches(m, ctx({ url: 'https://g/play?sessionId=1', buildTarget: 'artube' }))).toBe(true);
    expect(matches(m, ctx({ url: 'https://g/play?sessionId=1', buildTarget: 'stake' }))).toBe(false);
  });

  it('consults the escape-hatch predicate', () => {
    expect(matches({ match: (c) => c.env?.MODE === 'demo' }, ctx({ env: { MODE: 'demo' } }))).toBe(true);
    expect(matches({ match: (c) => c.env?.MODE === 'demo' }, ctx())).toBe(false);
  });

  it('treats a pure default matcher as no match, so fallbacks never beat a real rule', () => {
    expect(matches({ default: true }, ctx())).toBe(false);
  });

  it('treats an absent matcher as no match', () => {
    expect(matches(undefined, ctx())).toBe(false);
  });

  it('survives an unparseable url instead of throwing', () => {
    expect(matches({ urlParam: 'sessionId' }, ctx({ url: 'not a url' }))).toBe(false);
  });
});

describe('isDefaultMatcher', () => {
  it('is true only for a matcher whose sole content is default', () => {
    expect(isDefaultMatcher({ default: true })).toBe(true);
    expect(isDefaultMatcher({ default: true, buildTarget: 'stake' })).toBe(false);
    expect(isDefaultMatcher(undefined)).toBe(false);
  });
});

describe('describeMatcher', () => {
  it('describes each condition in words', () => {
    expect(describeMatcher({ urlParam: 'sessionId' })).toBe('when ?sessionId is present');
    expect(describeMatcher({ buildTarget: 'stake' })).toBe('when the build target is "stake"');
    expect(describeMatcher({ default: true })).toBe('when nothing else matches');
    expect(describeMatcher({ match: () => true })).toBe('when a custom rule matches');
    expect(describeMatcher(undefined)).toBe('always');
  });

  it('joins several conditions', () => {
    expect(describeMatcher({ urlParam: 'sessionId', buildTarget: 'artube' })).toBe(
      'when ?sessionId is present and when the build target is "artube"',
    );
  });
});

describe('matchers survive hostile input — null/undefined inputs', () => {
  it('handles null and undefined matchers', () => {
    expect(matches(null as any, ctx())).toBe(false);
    expect(matches(undefined, ctx())).toBe(false);
  });

  it('handles null ctx url', () => {
    expect(matches({ urlParam: 'test' }, { url: null as any, buildTarget: undefined })).toBe(false);
  });
});

describe('matchers survive hostile input — malformed URLs', () => {
  it('handles empty url string', () => {
    expect(matches({ urlParam: 'test' }, ctx({ url: '' }))).toBe(false);
  });

  it('handles non-url string', () => {
    expect(matches({ urlParam: 'test' }, ctx({ url: 'not a url' }))).toBe(false);
  });

  it('handles query-only URL (no path)', () => {
    expect(matches({ urlParam: 'a' }, ctx({ url: '?a=1' }))).toBe(true);
  });

  it('handles trailing ? (no params)', () => {
    expect(matches({ urlParam: 'a' }, ctx({ url: 'https://x/p?' }))).toBe(false);
  });
});

describe('matchers survive hostile input — fragments', () => {
  it('ignores parameters in URL fragment', () => {
    expect(matches({ urlParam: 'fake' }, ctx({ url: 'https://x/p#/route?fake=1' }))).toBe(false);
  });
});

describe('matchers survive hostile input — parameter matching exactness', () => {
  it('must not match by prefix (ses does not match sessionId)', () => {
    expect(matches({ urlParam: 'ses' }, ctx({ url: 'https://g/play?sessionId=1' }))).toBe(false);
  });

  it('matches exact parameter name', () => {
    expect(matches({ urlParam: 'sessionId' }, ctx({ url: 'https://g/play?sessionId=1' }))).toBe(true);
  });

  it('handles repeated params', () => {
    expect(matches({ urlParam: 'a' }, ctx({ url: 'https://x/p?a=1&a=2' }))).toBe(true);
  });
});

describe('matchers survive hostile input — percent encoding', () => {
  it('matches a percent-encoded param by its logical name or its raw one', () => {
    const testCtx = ctx({ url: 'https://x/p?a%20b=1' });
    expect(matches({ urlParam: 'a b' }, testCtx)).toBe(true);
    expect(matches({ urlParam: 'a%20b' }, testCtx)).toBe(true);
  });

  it('survives a malformed escape rather than throwing', () => {
    const testCtx = ctx({ url: 'https://x/p?a%ZZ=1' });
    expect(() => matches({ urlParam: 'a%ZZ' }, testCtx)).not.toThrow();
    expect(matches({ urlParam: 'a%ZZ' }, testCtx)).toBe(true);
  });

  it('leaves a plus sign literal (not as space)', () => {
    const testCtx = ctx({ url: 'https://x/p?a+b=1' });
    expect(matches({ urlParam: 'a+b' }, testCtx)).toBe(true);
    expect(matches({ urlParam: 'a b' }, testCtx)).toBe(false);
  });
});

describe('matchers survive hostile input — throwing predicate', () => {
  it('reports a throwing predicate when given a sink', () => {
    const out: Diagnostic[] = [];
    const result = matches({ match: () => { throw new Error('typo'); } }, ctx({ url: 'https://x/p' }), out);
    expect(result).toBe(false);
    expect(out[0]).toMatchObject({ severity: 'error', code: 'match/predicate-threw' });
    expect(out[0].message).toContain('typo');
  });

  it('still returns false with no sink, and does not throw', () => {
    expect(() => matches({ match: () => { throw new Error('x'); } }, ctx({ url: 'https://x/p' }))).not.toThrow();
    expect(matches({ match: () => { throw new Error('x'); } }, ctx({ url: 'https://x/p' }))).toBe(false);
  });
});

describe('matchers survive hostile input — truthy non-booleans', () => {
  it('treats match returning truthy non-boolean (1) as true', () => {
    expect(matches({ match: () => 1 as any }, ctx())).toBe(true);
  });

  it('treats match returning truthy non-boolean ("yes") as true', () => {
    expect(matches({ match: () => 'yes' as any }, ctx())).toBe(true);
  });

  it('treats match returning undefined as false', () => {
    expect(matches({ match: () => undefined }, ctx())).toBe(false);
  });
});

describe('matchers survive hostile input — AND semantics', () => {
  it('requires all conditions to hold when multiple declared', () => {
    const m = { urlParam: 'sessionId', buildTarget: 'artube' };
    expect(matches(m, ctx({ url: 'https://g/play?sessionId=1', buildTarget: 'artube' }))).toBe(true);
    expect(matches(m, ctx({ url: 'https://g/play?sessionId=1', buildTarget: 'stake' }))).toBe(false);
  });
});

describe('matchers survive hostile input — describeMatcher edge cases', () => {
  it('handles null, undefined, and empty object', () => {
    expect(describeMatcher(null as any)).toBe('always');
    expect(describeMatcher(undefined)).toBe('always');
    expect(describeMatcher({})).toBe('always');
  });

  it('handles matcher with all conditions at once', () => {
    const allConditions = {
      urlParam: 'a',
      buildTarget: 'stake',
      match: () => true,
      default: true,
    };
    const desc = describeMatcher(allConditions);
    expect(desc).toContain('when ?a is present');
    expect(desc).toContain('when the build target is "stake"');
    expect(desc).toContain('when a custom rule matches');
  });

  it('handles isDefaultMatcher with null, undefined, and {}', () => {
    expect(isDefaultMatcher(null as any)).toBe(false);
    expect(isDefaultMatcher(undefined)).toBe(false);
    expect(isDefaultMatcher({})).toBe(false);
  });

  it('handles isDefaultMatcher with all conditions at once', () => {
    expect(isDefaultMatcher({
      default: true,
      urlParam: 'a',
      buildTarget: 'stake',
      match: () => true,
    })).toBe(false);
  });
});
