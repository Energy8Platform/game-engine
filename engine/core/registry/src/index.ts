/**
 * A name→value collection with an explicit collision policy.
 *
 * **What this package holds, precisely.** Two things, and they are the two
 * where all three adopters had bugs: the collision POLICY (what `add`
 * does to the incumbent, and what disposer a rejected registration gets
 * back), and the disposer's IDENTITY GUARD (a disposer removes the slot it
 * created or nothing at all). Both were hand-rolled three times over — in
 * play-loop's step registry, game-runtime's mechanic registry and the
 * IDE's slot registry — and each copy shipped the same silent-overwrite
 * defect independently before being fixed.
 *
 * **What each adopter still owns.** Everything about SAYING so. Each one
 * reads `get(key)` on the line before `add()` to learn whether this call
 * collided, writes its own `Diagnostic` in its own words (a step kind, a
 * mechanic id, a slot key are three different sentences with three
 * different `plugin`/`where` addresses), keeps that in its own array, and
 * delivers it its own way — a local list `createGame` reads at compose
 * time, `ctx.diagnostics`, a leniently-read optional `connection` service.
 * That split was deliberate and reviewed; this package deliberately has no
 * cordis, no contracts and no diagnostics import, so it could not deliver
 * any of it even if it wanted to.
 *
 * It briefly ALSO offered `collisions()`, a `Collision` record type and a
 * mandatory `describe` option to render one — the structured half of a
 * report the adopters were then expected to word themselves. Nothing
 * outside this package's own tests ever read any of the three, because
 * each adopter already knew it had collided one line earlier and had the
 * two values in hand. They are gone rather than documented: a dead API in
 * a package whose whole purpose is removing duplication is its own small
 * joke.
 *
 * **The fourth collection, and why it is not here.**
 * `@energy8engine/spin-parser`'s `NamedCollection` is name-keyed with the
 * same first-wins-and-diagnose rule, and two of the three adopters cite it
 * as the precedent. It was considered and left alone: it has no disposal
 * at all — a parsed `record` block is never unregistered, so the identity
 * guard, which is half of what this package exists for, has nothing to
 * guard. Its `insert()` also takes the source LINE and pushes the
 * diagnostic itself, which is the shape a one-pass parser wants and the
 * opposite of the read-then-add dance a live registry does. Adopting would
 * hand it a disposer per entry that nobody can call and cost it the line
 * number. If it ever grows removal, revisit this paragraph first.
 */

export type CollisionPolicy = 'first-wins' | 'last-wins';

export interface NamedRegistry<T> {
  /** Adds under `key`. Returns a disposer that removes ONLY what it added. */
  add(key: string, value: T): () => void;
  get(key: string): T | undefined;
  keys(): readonly string[];
}

export interface RegistryOptions {
  policy: CollisionPolicy;
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
export function createRegistry<T>(options: RegistryOptions): NamedRegistry<T> {
  const { policy } = options;
  const entries = new Map<string, Slot<T>>();

  return {
    add(key, value) {
      const incumbent = entries.get(key);

      if (incumbent !== undefined && policy === 'first-wins') {
        // The incumbent keeps the key: never touch `entries`, and never
        // hand this caller a disposer with any power over the winner — a
        // rejected registration must not be able to delete what beat it.
        // Whether anyone is TOLD is the caller's business; it already
        // knows, having read `get(key)` on the line before this one.
        return () => {};
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
  };
}
