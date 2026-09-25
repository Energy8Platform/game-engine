/**
 * Which copies of a stateful engine module this page has loaded. A package
 * whose module-level state must exist once (the tween registry, classes that
 * cross the plugin boundary) calls `markModuleCopy(name, import.meta.url)` at
 * top level; `createGame` reads the result after composing and warns about
 * any name loaded from two urls — a project pin that nested a second copy.
 *
 * Kept on `globalThis` under a `Symbol.for` key, never in a module variable:
 * a second copy of THIS file must see the same map, so the shape stored
 * there (name → Set of urls) is shared by every version and never changes.
 */
const KEY = Symbol.for('energy8engine.moduleCopies');

function registry(): Map<string, Set<string>> {
  const g = globalThis as Record<symbol, Map<string, Set<string>> | undefined>;
  return (g[KEY] ??= new Map());
}

/** Records one loaded copy. The same `(name, url)` twice — a page composing twice — counts once. */
export function markModuleCopy(name: string, url: string): void {
  const copies = registry();
  copies.set(name, (copies.get(name) ?? new Set()).add(url));
}

/** Every marked name and the urls it was loaded from, in marking order. */
export function moduleCopies(): ReadonlyMap<string, readonly string[]> {
  return new Map([...registry()].map(([name, urls]) => [name, [...urls]]));
}
