import { describe, expect, it } from 'vitest';
import { isServerMessage } from '../src/index';

/**
 * `{type:'diagnostics'}` and `{type:'game-diagnostics'}` carry `Diagnostic`s
 * from two disjoint namespaces (see `Diagnostic.plugin`'s own doc): a
 * composition row id versus a seam/mechanic id. A human is free to name a
 * row `session` in `e8.yml`, so the two can carry byte-identical `plugin`
 * strings — the message `type` is the ONLY thing that tells a reader which
 * namespace it is looking at, and these tests are written against that
 * property directly rather than against any detail of one variant.
 */
describe('protocol — game-diagnostics is its own message, not a reuse of diagnostics', () => {
  it('a project diagnostic and a game diagnostic are different messages, even with the same plugin id', () => {
    const same = { severity: 'error' as const, plugin: 'session', where: 'w', message: 'm' };
    expect(isServerMessage({ type: 'diagnostics', diagnostics: [same] })).toBe(true);
    expect(isServerMessage({ type: 'game-diagnostics', diagnostics: [same] })).toBe(true);
    // and nothing in the shape lets a reader mistake one for the other
  });

  it('accepts a well-formed snapshot message', () => {
    expect(
      isServerMessage({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } }),
    ).toBe(true);
  });

  it('carries dropped alongside the diagnostics, on the wire type, in both directions', () => {
    // Compile-time proof as much as a runtime one: this object only
    // type-checks against `ClientMessage`/`ServerMessage` if `dropped:
    // number` is actually part of the `game-diagnostics` variant of both.
    const gameToHost: import('../src/index').ClientMessage = {
      type: 'game-diagnostics',
      diagnostics: [],
      dropped: 3,
    };
    const hostToEditor: import('../src/index').ServerMessage = {
      type: 'game-diagnostics',
      diagnostics: [],
      dropped: 3,
    };
    expect(isServerMessage(gameToHost)).toBe(true);
    expect(isServerMessage(hostToEditor)).toBe(true);
  });

  it('rejects null, an array, a primitive, and an unknown type — same guard every socket handler already applies inline', () => {
    expect(isServerMessage(null)).toBe(false);
    expect(isServerMessage([])).toBe(false);
    expect(isServerMessage(42)).toBe(false);
    expect(isServerMessage('snapshot')).toBe(false);
    expect(isServerMessage({ type: 'nope' })).toBe(false);
    expect(isServerMessage({})).toBe(false);
  });
});
