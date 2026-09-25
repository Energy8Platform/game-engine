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
 *
 * Not the main net: the IDE host's static check of what the project
 * resolves is (its composition diagnostics reach the IDE and `e8 build`).
 * Identity is the module url, so this catches a second copy loaded under a
 * different URL — a different specifier or path — and nothing else. In dev,
 * vite pre-bundles a dependency by its bare name, so a nested copy is
 * usually served as the same file and this map cannot see it; `e8 build`'s
 * `manualChunks` (ide-host `compute/build.ts`) merges every engine package
 * into one `game` chunk, so a duplicate there shares the chunk's url too. A
 * content key instead would misfire the other way: vite re-evaluating an
 * edited module is a real second instance under a new url.
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
