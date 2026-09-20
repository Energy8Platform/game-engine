/**
 * `virtual:e8-rows` — the composition's runtime halves as STATIC import
 * specifiers, so `vite build` bundles every one of them (into the `game`
 * chunk `compute/build.ts` lays out — see its `manualChunks` for why the
 * rows are not split per row).
 *
 * A composed page never names its rows: `composeFromProject` fetches
 * `/api/composition` and `import()`s each row's `runtimeUrl` — a string
 * computed at runtime, which a bundler cannot follow. In `e8 dev` that is
 * fine (vite serves `/@fs/<realpath>` on demand); in a built `dist/`
 * there is nothing to serve it from. This plugin is the bridge: `e8 build`
 * hands it row id → real entry path, the page imports `rows` from this
 * module and passes `importModule: (url) => rows[url]?.() ?? import(url)`
 * to `createGame`, and the frozen `dist/api/composition` carries the row
 * ID as each row's `runtimeUrl`. `dev-game`'s vite gets the same plugin
 * with an empty map, so the page's import resolves there too and the `??`
 * falls through to the URL the dev host handed out.
 *
 * Entry paths are absolute filesystem paths, as `runtimeEntryMap` yields
 * them. Measured on vite 6.4.3: a build resolves `import('/abs/path.ts')`
 * inside a virtual module straight off disk (`resolvePlugin`'s absolute-
 * path branch), no `/@fs/` prefix and no root-relative rewrite needed.
 */
import type { Plugin } from 'vite';

const ID = 'virtual:e8-rows';
const RESOLVED = '\0' + ID;

export function viteRows(map: ReadonlyMap<string, string>): Plugin {
  return {
    name: 'e8:rows',
    resolveId(id) {
      return id === ID ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      const entries = [...map]
        .map(([rowId, entry]) => `${JSON.stringify(rowId)}: () => import(${JSON.stringify(entry)})`)
        .join(', ');
      return entries ? `export const rows = { ${entries} };` : 'export const rows = {};';
    },
  };
}
