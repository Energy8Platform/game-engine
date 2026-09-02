import { describe, expect, it } from 'vitest';
import { selectProvider, type SeamCandidate } from '../src/index';

const stake: SeamCandidate = { seam: 'session', provider: 'session-stake', matcher: { buildTarget: 'stake' } };
const dev: SeamCandidate = { seam: 'session', provider: 'session-dev', matcher: { default: true } };
const byParam: SeamCandidate = { seam: 'session', provider: 'session-url', matcher: { urlParam: 'sessionId' } };

describe('selectProvider', () => {
  it('picks the single matching provider', () => {
    const { provider, diagnostics } = selectProvider('session', [stake], { buildTarget: 'stake' });
    expect(provider).toBe('session-stake');
    expect(diagnostics).toEqual([]);
  });

  it('a specific matcher beats { default: true }', () => {
    const { provider, diagnostics } = selectProvider('session', [dev, stake], { buildTarget: 'stake' });
    expect(provider).toBe('session-stake');
    expect(diagnostics).toEqual([]);
  });

  it('falls back to the default when nothing specific matches', () => {
    const { provider } = selectProvider('session', [dev, stake], { buildTarget: 'e8platform' });
    expect(provider).toBe('session-dev');
  });

  it('zero candidates lists what was considered, and why each was rejected', () => {
    const { provider, diagnostics } = selectProvider('session', [stake], { buildTarget: 'e8platform' });
    expect(provider).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('session-stake');
    expect(diagnostics[0].message).toContain('stake');        // its matcher, not just its name
  });

  it('an empty candidate list still names the seam', () => {
    const { provider, diagnostics } = selectProvider('renderer', [], {});
    expect(provider).toBeNull();
    expect(diagnostics[0].message).toContain('renderer');
  });

  it('two equally-specific candidates is a diagnostic naming BOTH', () => {
    const other: SeamCandidate = { seam: 'session', provider: 'session-two', matcher: { buildTarget: 'stake' } };
    const { provider, diagnostics } = selectProvider('session', [stake, other], { buildTarget: 'stake' });
    expect(provider).toBeNull();
    expect(diagnostics[0].message).toContain('session-stake');
    expect(diagnostics[0].message).toContain('session-two');
  });

  it('two defaults are also ambiguous — "default" is not a tiebreak', () => {
    const other: SeamCandidate = { seam: 'session', provider: 'session-two', matcher: { default: true } };
    const { provider } = selectProvider('session', [dev, other], {});
    expect(provider).toBeNull();
  });

  it('urlParam matcher reads the passed env, never a global location', () => {
    const { provider } = selectProvider('session', [byParam, dev], { urlParams: { sessionId: 'abc' } });
    expect(provider).toBe('session-url');
  });

  it('urlParam does not match when the param is absent', () => {
    const { provider } = selectProvider('session', [byParam, dev], { urlParams: {} });
    expect(provider).toBe('session-dev');
  });
});

// A matcher must declare exactly one discriminator. `SeamMatcher`'s three
// fields are each independently optional, so the type alone can't stop a
// matcher declaring zero of them (never matches) or two at once (ambiguous
// — which one wins?). Naming this now, per the brief, rather than leaving
// it to be discovered when someone writes one of these by accident.
describe('selectProvider — malformed matchers', () => {
  it('a matcher with no discriminator set is illegal, not merely inert', () => {
    const empty: SeamCandidate = { seam: 'session', provider: 'session-empty', matcher: {} };
    const { provider, diagnostics } = selectProvider('session', [empty, stake], { buildTarget: 'stake' });
    // The well-formed candidate still resolves...
    expect(provider).toBe('session-stake');
    // ...but the malformed one is named, not silently dropped.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('session-empty');
  });

  it('a matcher with both buildTarget and urlParam set is illegal — no silent "first wins"', () => {
    const both: SeamCandidate = {
      seam: 'session',
      provider: 'session-both',
      matcher: { buildTarget: 'stake', urlParam: 'sessionId' },
    };
    const { provider, diagnostics } = selectProvider('session', [both], { buildTarget: 'stake' });
    // Not treated as matching on buildTarget alone: it never wins.
    expect(provider).toBeNull();
    expect(diagnostics.some((d) => d.message.includes('session-both'))).toBe(true);
  });

  it('a malformed candidate does not block resolution among the well-formed ones', () => {
    const both: SeamCandidate = {
      seam: 'session',
      provider: 'session-both',
      matcher: { buildTarget: 'stake', urlParam: 'sessionId' },
    };
    const { provider } = selectProvider('session', [both, dev], { buildTarget: 'e8platform' });
    expect(provider).toBe('session-dev');
  });
});
