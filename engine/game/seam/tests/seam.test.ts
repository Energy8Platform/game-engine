import { describe, expect, it } from 'vitest';
import { selectProvider, type SeamCandidate } from '../src/index';

// Fixture names are picked so that NO provider name shares a substring with
// ANY matcher value used in these tests (buildTarget/urlParam values, or
// each other's provider names). That is deliberate: a test asserting
// `message.toContain('kiosk')` must only be able to pass because the
// matcher was genuinely rendered, never because some provider's own name
// happens to contain the matcher's value (as `session-stake` /
// `{ buildTarget: 'stake' }` did in an earlier draft of these fixtures —
// caught by mutation-testing the diagnostic renderer, not by inspection).
const alpha: SeamCandidate = {
  seam: 'session',
  provider: 'session-alpha',
  matcher: { buildTarget: 'kiosk' },
};
const beta: SeamCandidate = {
  seam: 'session',
  provider: 'session-beta',
  matcher: { default: true },
};
const gamma: SeamCandidate = {
  seam: 'session',
  provider: 'session-gamma',
  matcher: { urlParam: 'sessionToken' },
};

describe('selectProvider', () => {
  it('picks the single matching provider', () => {
    const { provider, diagnostics } = selectProvider('session', [alpha], { buildTarget: 'kiosk' });
    expect(provider).toBe('session-alpha');
    expect(diagnostics).toEqual([]);
  });

  it('a specific matcher beats { default: true }', () => {
    const { provider, diagnostics } = selectProvider('session', [beta, alpha], {
      buildTarget: 'kiosk',
    });
    expect(provider).toBe('session-alpha');
    expect(diagnostics).toEqual([]);
  });

  it('falls back to the default when nothing specific matches', () => {
    const { provider } = selectProvider('session', [beta, alpha], { buildTarget: 'showroom' });
    expect(provider).toBe('session-beta');
  });

  it('zero candidates lists what was considered, and why each was rejected', () => {
    const { provider, diagnostics } = selectProvider('session', [alpha], {
      buildTarget: 'showroom',
    });
    expect(provider).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('session-alpha');
    // Its matcher's VALUE, not just its name — 'kiosk' appears nowhere in
    // 'session-alpha', so this can only pass if the matcher is rendered.
    expect(diagnostics[0].message).toContain('kiosk');
  });

  it('an empty candidate list still names the seam', () => {
    const { provider, diagnostics } = selectProvider('renderer', [], {});
    expect(provider).toBeNull();
    expect(diagnostics[0].message).toContain('renderer');
  });

  it('two equally-specific candidates is a diagnostic naming BOTH', () => {
    const delta: SeamCandidate = {
      seam: 'session',
      provider: 'session-delta',
      matcher: { buildTarget: 'kiosk' },
    };
    const { provider, diagnostics } = selectProvider('session', [alpha, delta], {
      buildTarget: 'kiosk',
    });
    expect(provider).toBeNull();
    // Neither name is a substring of the other, so each assertion below
    // can only pass if that specific provider is actually listed.
    expect(diagnostics[0].message).toContain('session-alpha');
    expect(diagnostics[0].message).toContain('session-delta');
    // And the matcher they're fighting over, not just the two names.
    expect(diagnostics[0].message).toContain('kiosk');
  });

  it('two defaults are also ambiguous — "default" is not a tiebreak', () => {
    const epsilon: SeamCandidate = {
      seam: 'session',
      provider: 'session-epsilon',
      matcher: { default: true },
    };
    const { provider } = selectProvider('session', [beta, epsilon], {});
    expect(provider).toBeNull();
  });

  it('urlParam matcher reads the passed env, never a global location', () => {
    const { provider } = selectProvider('session', [gamma, beta], {
      urlParams: { sessionToken: 'abc' },
    });
    expect(provider).toBe('session-gamma');
  });

  it('urlParam does not match when the param is absent', () => {
    const { provider } = selectProvider('session', [gamma, beta], { urlParams: {} });
    expect(provider).toBe('session-beta');
  });
});

// A matcher must declare exactly one discriminator. `SeamMatcher`'s three
// fields are each independently optional, so the type alone can't stop a
// matcher declaring zero of them (never matches), two specific ones at once
// (ambiguous — which one wins?), or a specific one paired with
// `default: true` (the two-phase resolution rule gives that combination no
// coherent meaning: is it "only when buildTarget matches" or "always as the
// fallback"? it can't be both). Naming this now, per the brief, rather than
// leaving it to be discovered when someone writes one of these by accident.
//
// Same non-collision discipline as above: 'foyer'/'ticket'/'lobby'/
// 'sessionRef'/'{}' don't appear in any provider name here, and
// 'session-zeta'/'session-theta'/'session-iota'/'session-kappa' don't
// appear in each other or in 'session-alpha'.
describe('selectProvider — malformed matchers', () => {
  it('a matcher with no discriminator set is illegal, not merely inert', () => {
    const zeta: SeamCandidate = { seam: 'session', provider: 'session-zeta', matcher: {} };
    const { provider, diagnostics } = selectProvider('session', [zeta, alpha], {
      buildTarget: 'kiosk',
    });
    // The well-formed candidate still resolves...
    expect(provider).toBe('session-alpha');
    // ...but the malformed one is named, with its (empty) matcher shown,
    // not silently dropped or folded into some generic message.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('session-zeta');
    expect(diagnostics[0].message).toContain('{}');
    // And it's specifically about the malformed candidate, not a listing
    // that happens to also mention the one that resolved fine.
    expect(diagnostics[0].message).not.toContain('session-alpha');
  });

  it('a matcher with both buildTarget and urlParam set is illegal — no silent "first wins"', () => {
    const theta: SeamCandidate = {
      seam: 'session',
      provider: 'session-theta',
      matcher: { buildTarget: 'foyer', urlParam: 'ticket' },
    };
    const { provider, diagnostics } = selectProvider('session', [theta], { buildTarget: 'foyer' });
    // Not treated as matching on buildTarget alone: it never wins, even
    // though `env.buildTarget` equals the matcher's `buildTarget`.
    expect(provider).toBeNull();
    // Exactly one diagnostic (the "invalid matcher" one) — no redundant
    // second "nothing matched" diagnostic re-listing the same candidate,
    // since it was never a real contender.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('session-theta');
    // BOTH halves of the illegal matcher are shown, not just the one that
    // happened to match `env` — proof this is flagged as "declares two",
    // not silently resolved by picking `buildTarget` and ignoring `urlParam`.
    expect(diagnostics[0].message).toContain('foyer');
    expect(diagnostics[0].message).toContain('ticket');
  });

  it('a malformed candidate does not block resolution among the well-formed ones', () => {
    const theta: SeamCandidate = {
      seam: 'session',
      provider: 'session-theta',
      matcher: { buildTarget: 'foyer', urlParam: 'ticket' },
    };
    const { provider } = selectProvider('session', [theta, beta], { buildTarget: 'showroom' });
    expect(provider).toBe('session-beta');
  });

  it('a matcher with buildTarget and default: true set is illegal — the two phases do not overlap', () => {
    const iota: SeamCandidate = {
      seam: 'session',
      provider: 'session-iota',
      matcher: { buildTarget: 'lobby', default: true },
    };
    // env matches the buildTarget half exactly, so a version of `matches()`
    // that (wrongly) reads buildTarget first and ignores `default` here
    // would report `session-iota` as a clean, unambiguous match.
    const { provider, diagnostics } = selectProvider('session', [iota], { buildTarget: 'lobby' });
    expect(provider).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('session-iota');
    expect(diagnostics[0].message).toContain('lobby');
  });

  it('a matcher with urlParam and default: true set is illegal, symmetrically', () => {
    const kappa: SeamCandidate = {
      seam: 'session',
      provider: 'session-kappa',
      matcher: { urlParam: 'sessionRef', default: true },
    };
    const { provider, diagnostics } = selectProvider('session', [kappa], {
      urlParams: { sessionRef: 'abc' },
    });
    expect(provider).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('session-kappa');
    expect(diagnostics[0].message).toContain('sessionRef');
  });

  it('regression: buildTarget+default does not silently win over a real default candidate', () => {
    // The exact shape reported against this module: a candidate combining
    // a specific discriminator with `default: true`, alongside a proper
    // `default: true` candidate. Before this was closed, `matches()` read
    // only `buildTarget` on the malformed one, so with a matching
    // buildTarget it silently "won" as if it were a clean specific match,
    // and `default: true` on it was discarded without a diagnostic.
    const iota: SeamCandidate = {
      seam: 'session',
      provider: 'session-iota',
      matcher: { buildTarget: 'lobby', default: true },
    };
    const { provider, diagnostics } = selectProvider('session', [iota, beta], {
      buildTarget: 'lobby',
    });
    // The malformed candidate is excluded; the genuine default wins instead.
    expect(provider).toBe('session-beta');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('session-iota');
    expect(diagnostics[0].message).toContain('lobby');
  });
});
