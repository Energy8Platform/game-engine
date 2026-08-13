import { describe, expect, it } from 'vitest';
import { describeMatcher, isDefaultMatcher, matches } from '@/resolve/match';
import type { LaunchContext } from '@/resolve/types';

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

describe('matchers survive hostile input', () => {
  it('never throws on any combination of junk', () => {
    // matches with null and undefined matcher
    expect(matches(null as any, ctx())).toBe(false);
    expect(matches(undefined, ctx())).toBe(false);

    // matches with null ctx url
    expect(matches({ urlParam: 'test' }, { url: null as any, buildTarget: undefined })).toBe(false);

    // matches with empty url string
    expect(matches({ urlParam: 'test' }, ctx({ url: '' }))).toBe(false);

    // matches with non-url string
    expect(matches({ urlParam: 'test' }, ctx({ url: 'not a url' }))).toBe(false);

    // matches with query only (no path)
    expect(matches({ urlParam: 'a' }, ctx({ url: '?a=1' }))).toBe(true);

    // matches with trailing ? (no params)
    expect(matches({ urlParam: 'a' }, ctx({ url: 'https://x/p?' }))).toBe(false);

    // matcher with throwing match predicate
    expect(matches(
      { match: () => { throw new Error('kaboom'); } },
      ctx()
    )).toBe(false);

    // matcher match returns truthy non-boolean (1)
    expect(matches({ match: () => 1 as any }, ctx())).toBe(true);

    // matcher match returns truthy non-boolean ('yes')
    expect(matches({ match: () => 'yes' as any }, ctx())).toBe(true);

    // matcher match returns undefined
    expect(matches({ match: () => undefined }, ctx())).toBe(false);

    // urlParam matching must be exact, not prefix: 'ses' should not match 'sessionId'
    expect(matches({ urlParam: 'ses' }, ctx({ url: 'https://g/play?sessionId=1' }))).toBe(false);

    // urlParam matching exact match when substring appears
    expect(matches({ urlParam: 'sessionId' }, ctx({ url: 'https://g/play?sessionId=1' }))).toBe(true);

    // URL-encoded params
    expect(matches({ urlParam: 'a b' }, ctx({ url: 'https://x/p?a%20b=1' }))).toBe(false);

    // repeated params
    expect(matches({ urlParam: 'a' }, ctx({ url: 'https://x/p?a=1&a=2' }))).toBe(true);

    // fragment containing a ? must not count as param
    expect(matches({ urlParam: 'fake' }, ctx({ url: 'https://x/p#/route?fake=1' }))).toBe(false);

    // isDefaultMatcher with null, undefined, {}
    expect(isDefaultMatcher(null as any)).toBe(false);
    expect(isDefaultMatcher(undefined)).toBe(false);
    expect(isDefaultMatcher({})).toBe(false);

    // isDefaultMatcher with every condition at once
    expect(isDefaultMatcher({
      default: true,
      urlParam: 'a',
      buildTarget: 'stake',
      match: () => true,
    })).toBe(false);

    // describeMatcher with null, undefined, {}
    expect(describeMatcher(null as any)).toBe('always');
    expect(describeMatcher(undefined)).toBe('always');
    expect(describeMatcher({})).toBe('always');

    // describeMatcher with every condition at once
    expect(describeMatcher({
      urlParam: 'a',
      buildTarget: 'stake',
      match: () => true,
      default: true,
    })).toContain('when ?a is present');
    expect(describeMatcher({
      urlParam: 'a',
      buildTarget: 'stake',
      match: () => true,
      default: true,
    })).toContain('when the build target is "stake"');
    expect(describeMatcher({
      urlParam: 'a',
      buildTarget: 'stake',
      match: () => true,
      default: true,
    })).toContain('when a custom rule matches');
  });
});
