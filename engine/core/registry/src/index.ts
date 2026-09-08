/**
 * A name→value collection with an explicit collision policy.
 *
 * Three call sites in this engine (play-loop's step registry,
 * game-runtime's mechanic registry, the IDE's slot registry) each
 * hand-roll "add under a key, decide what happens on a collision, hand
 * back a disposer that undoes only this registration" — and each shipped
 * the same silent-overwrite bug independently before being fixed. This
 * package gives that guarantee once instead of three times.
 *
 * Deliberately renderer/platform-free: no cordis, no contracts, no
 * diagnostics import. This is a data structure, not a plugin, and it does
 * not own diagnostic delivery — the three adopters report collisions three
 * different ways (a local array, `ctx.diagnostics`, a leniently-read
 * optional service) and word the sentence differently. `collisions()`
 * hands back structured data; turning it into a sentence and delivering it
 * is each adopter's job.
 */

export type CollisionPolicy = 'first-wins' | 'last-wins';

export interface Collision {
  key: string;
  /** What stayed registered under `key`, described via `describe()`. */
  kept: string;
  /** What lost the collision and was never registered, described via `describe()`. */
  dropped: string;
}

export interface NamedRegistry<T> {
  /** Adds under `key`. Returns a disposer that removes ONLY what it added. */
  add(key: string, value: T): () => void;
  get(key: string): T | undefined;
  keys(): readonly string[];
  /** One entry per collision seen, in the order they happened. A copy. */
  collisions(): readonly Collision[];
}

export interface RegistryOptions<T> {
  policy: CollisionPolicy;
  /** How an entry names itself in a collision report. */
  describe: (value: T) => string;
}

/**
 * Wraps every registered value in a fresh object, one per `add()` call.
 * Disposal compares a slot's OWN identity against whatever is currently
 * stored for the key — never the key alone, and never the raw value.
 * Comparing by key alone would let a stale disposer evict whatever
 * currently holds the key, including something that registered long
 * after it. Comparing by raw value would work for the object-shaped
 * registrations every real adopter passes (a `StepHandler`, a
 * `SpinMechanic`, a component), but silently break the moment `T` is a
 * primitive and two unrelated calls happen to pass an equal value — which
 * is exactly what this package's own tests do (`add('x', 'alpha')` twice
 * over). A fresh wrapper object is `===`-unique to its own `add()` call
 * regardless of what `T` is, so identity comparison is always meaningful.
 */
interface Slot<T> {
  value: T;
}

/** A fresh, empty `NamedRegistry` — nothing registered until something calls `add`. */
export function createRegistry<T>(options: RegistryOptions<T>): NamedRegistry<T> {
  const { policy, describe } = options;
  const entries = new Map<string, Slot<T>>();
  const collisions: Collision[] = [];

  return {
    add(key, value) {
      const incumbent = entries.get(key);

      if (incumbent !== undefined && policy === 'first-wins') {
        // The incumbent keeps the key. Record the collision as data, but
        // never touch `entries` and never hand this caller a disposer
        // with any power over the winner — a rejected registration must
        // not be able to delete what beat it.
        collisions.push({ key, kept: describe(incumbent.value), dropped: describe(value) });
        return () => {};
      }
      if (incumbent !== undefined) {
        // last-wins: the new value takes the key; the loss is the
        // incumbent's.
        collisions.push({ key, kept: describe(value), dropped: describe(incumbent.value) });
      }

      const slot: Slot<T> = { value };
      entries.set(key, slot);
      return () => {
        // Only remove the entry if it's still THIS registration. Under
        // last-wins that guards against an earlier (now-replaced)
        // registration's disposer evicting the entry that replaced it;
        // under first-wins it guards against an already-fired disposer
        // evicting whatever re-took the key after it freed it. The same
        // check makes a second call to an already-fired disposer a no-op
        // instead of a throw, for free.
        if (entries.get(key) === slot) {
          entries.delete(key);
        }
      };
    },
    get(key) {
      return entries.get(key)?.value;
    },
    keys() {
      // Map iterates in insertion order, and re-`set`ting an already
      // -present key (the last-wins replace above) keeps its original
      // position rather than moving it to the end.
      return [...entries.keys()];
    },
    collisions() {
      // A copy, down to each row — not a view onto the live array and not
      // a share of its element objects — so a caller can't edit the
      // record by mutating what this returns.
      return collisions.map((c) => ({ ...c }));
    },
  };
}
