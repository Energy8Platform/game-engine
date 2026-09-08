import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/index';

/**
 * `createRegistry` is the one place the "add under a key, handle a
 * collision, hand back a disposer" logic lives. Three call sites
 * (play-loop's step registry, game-runtime's mechanic registry, the IDE's
 * slot registry) each hand-rolled this and each shipped the same
 * silent-overwrite bug before being fixed independently — see
 * `registries-context.md`. These tests measure exactly the guarantees
 * those three call sites depend on, so Task 4 can move onto this without
 * losing any of them.
 *
 * Three properties get their own test on top of the brief's six, because
 * each is easy to satisfy by accident for the wrong reason (a disposer
 * that happens to be inert because the values compared are unequal, not
 * because a guard stops it):
 *  - the loser's disposer is inert under `first-wins`, proven by actually
 *    calling it, not just by checking `get()` never changed;
 *  - identity (not just the key) gates removal under BOTH policies, not
 *    only `last-wins`, which is all the brief's own stale-disposer test
 *    covers;
 *  - `keys()` preserves insertion order, since the slots adopter renders
 *    its contents as a list.
 */
describe('createRegistry', () => {
  it('first-wins keeps the first and reports the collision', () => {
    const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
    r.add('x', 'alpha');
    r.add('x', 'beta');
    expect(r.get('x')).toBe('alpha');
    expect(r.collisions()).toEqual([{ key: 'x', kept: 'alpha', dropped: 'beta' }]);
  });

  it('last-wins keeps the last and reports it too', () => {
    const r = createRegistry<string>({ policy: 'last-wins', describe: (v) => v });
    r.add('x', 'alpha');
    r.add('x', 'beta');
    expect(r.get('x')).toBe('beta');
    expect(r.collisions()).toEqual([{ key: 'x', kept: 'beta', dropped: 'alpha' }]);
  });

  it('a disposer removes only what it added, never a newer entry for the same key', () => {
    // The stale-disposer race MechanicsService already guards against.
    const r = createRegistry<string>({ policy: 'last-wins', describe: (v) => v });
    const off = r.add('x', 'alpha');
    r.add('x', 'beta');
    off();
    expect(r.get('x')).toBe('beta');
  });

  it('double disposal is a no-op, not a throw', () => {
    const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
    const off = r.add('x', 'alpha');
    off();
    expect(() => off()).not.toThrow();
  });

  it('re-adding after disposal works, and the new entry is what get() returns', () => {
    const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
    r.add('x', 'alpha')();
    r.add('x', 'gamma');
    expect(r.get('x')).toBe('gamma');
    expect(r.collisions()).toEqual([]); // a disposed entry is not a collision
  });

  it('collisions() is a copy — a caller cannot edit the record', () => {
    const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
    r.add('x', 'a');
    r.add('x', 'b');
    (r.collisions() as unknown[]).push({});
    expect(r.collisions()).toHaveLength(1);
  });

  // --- The three properties above, each isolated in its own test. ---

  it("the loser's disposer is inert: calling it must not evict the incumbent", () => {
    // Getting this wrong lets a rejected registration delete the winner.
    // Checking `get()` after `add()` (as the first test does) isn't
    // enough to prove this — it would pass even if the loser's disposer
    // were a real, working disposer that nobody happened to call yet.
    // This test calls it.
    const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
    r.add('x', 'alpha');
    const loserOff = r.add('x', 'beta');
    loserOff();
    expect(r.get('x')).toBe('alpha');
    expect(r.keys()).toEqual(['x']);
  });

  it('under first-wins too, a stale disposer must not evict a later registration for the same key', () => {
    // The brief's own stale-disposer test only exercises this under
    // last-wins (a *replace*, where the new entry is a collision winner).
    // Under first-wins a later registration for the same key can only
    // exist after the earlier one disposed itself, freeing the key — so
    // the race is: dispose, someone else takes the now-free key, then
    // the ORIGINAL (already-fired) disposer is called again. A disposer
    // that removes by key alone, instead of by identity, evicts the
    // newcomer here even though it never touches the incumbent in the
    // collision case above.
    const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
    const off = r.add('x', 'alpha');
    off();
    r.add('x', 'beta');
    off();
    expect(r.get('x')).toBe('beta');
  });

  it('keys() preserves insertion order, because one adopter renders its contents as a list', () => {
    const r = createRegistry<string>({ policy: 'last-wins', describe: (v) => v });
    r.add('zebra', 'v1');
    r.add('alpha', 'v2');
    r.add('mu', 'v3');
    expect(r.keys()).toEqual(['zebra', 'alpha', 'mu']);
  });
});
