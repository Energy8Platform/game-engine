# One copy of every stateful module — design (slice 38, paper-duel F14)

Date: 2026-09-25. Branch at `3da3978c`. Source: paper-duel round 6, F14 — a
project that pins a version the engine does not use gets a SILENT second copy
of a module with module-level state (a tween registry, pixi's classes,
cordis's context), and the engine's rows and the project's plugins then talk
to different instances with nothing saying so.

Agreed with the user: the point is to protect the GAME AUTHOR. A real game
lives outside this monorepo and installs `@energy8engine/*` from a registry —
there is no workspace to compare with. The question is "do the project's
plugins and the engine's rows share one instance?", asked where the answer is
visible.

## 1. Runtime marker (engine packages with module state)

- `@energy8engine/contracts` gains `src/module-copies.ts`:
  `markModuleCopy(name: string, url: string): void` and
  `moduleCopies(): ReadonlyMap<string, readonly string[]>`, stored on
  `globalThis[Symbol.for('energy8engine.moduleCopies')]` so every copy of
  `contracts` itself shares one map. The same `(name, url)` twice counts once.
- `@energy8engine/tween` and `@energy8engine/reel-core` mark themselves at
  module top level: `markModuleCopy('@energy8engine/tween', import.meta.url)`.
  (`tween` holds the tween registry; `reel-core`'s classes cross the plugin
  boundary. Other packages are added when they gain module state.) Neither
  depends on `contracts` today if that would create a cycle — the helper is
  copied as a 10-line module into each marker package instead, reading and
  writing the same `Symbol.for` key; the implementer picks the smaller of the
  two and says why.
- `@energy8engine/game-runtime`'s `createGame`, once the composition has
  applied, reads the map: every name with more than one URL is one
  `warning` (plugin `runtime`, where `modules`):
  `<n> copies of <name> are loaded — <url1>, <url2>, …: its module state (tweens, caches, classes) exists more than once`
  fix: `the IDE host's diagnostics name which project location resolves its own copy; declare the package the way the engine does, or remove the project's copy`.
  The marker catches only a second copy loaded under a different URL (a
  different specifier or path); the host check (§2) is the main net, since
  in dev vite pre-bundles a dependency by its bare name, so a nested copy is
  usually served as the same file.

## 2. Host check (stateful packages, resolved)

Checked packages: `pixi.js` and `cordis` (they cannot be marked), plus
`@energy8engine/tween` and `@energy8engine/reel-core`: the build-time net.
`e8 build` merges the engine into one chunk, so the §1 marker's
`import.meta.url` collapses and cannot see a duplicate there. `e8 build`
reads the host's composition diagnostics.

For each project location (the root and every `<project>/plugins/*` with a
`package.json`), the IDE host finds the package with Node's own lookup order
(`require.resolve.paths`, first `node_modules/<pkg>/package.json` that
exists). It does not use `require.resolve('<pkg>/package.json')`, because
pixi.js's `exports` does not list it. It does the same from each composed
`@energy8engine/*` row's package directory, counting a row only when its
`package.json` declares the package (`dependencies`, `peerDependencies` or
`optionalDependencies`): a row that does not walks up to the project's own
copy, which would hide a root pin. A package no row declares is not checked.
Every directory is realpath'd
first, as Node and vite resolve, so a symlinked `plugins/<name>` resolves
from its target. A path that vanishes mid-check is skipped. A copy whose
realpath is not among the rows' copies gets **one `warning` per foreign
copy**, with `where` listing every location that resolves it. A root copy
is not repeated for each plugin that walks up to it. The message names the
first such location:
`plugins/<name> resolves pixi.js@<v1> (<path>) but the engine's rows use pixi.js@<v2> (<path>) — two copies in one page`
(`the project resolves …` for the root)
fix, same version: `the same version is installed twice — delete <location>'s copy (a nested install pulled it in; install plugins with --omit=peer) so the engine's resolves`;
different version: `declare pixi.js as a peerDependency (or a range that includes the engine's <v2>) and reinstall, so one copy resolves`.
Not monorepo-specific: it compares the project against the engine rows,
wherever those are installed.

Plus the user's rule: a project whose root or plugin `package.json` names
`@energy8platform/game-engine`, or that resolves it from a `node_modules`
inside the project (or inside that plugin), gets one `warning`, with `where`
listing every such location. A copy hoisted above the project, like this
repo's own root, is not the project's:
`the engine no longer uses @energy8platform/game-engine — a copy here is a second engine`
fix: `remove it from the project's package.json files and node_modules; the engine's own packages (@energy8engine/*) replace it — tweens: @energy8engine/tween`.

## 3. Tests

- contracts (or the marker modules): mark/read; two copies of the helper
  share the map (simulate with the same `Symbol.for` key); same url once.
- tween, reel-core: importing marks the package.
- game-runtime: a second fake url registered for a name → the warning in
  `createGame`'s diagnostics; one url → none.
- ide-host: fixture project dirs — a plugin with a nested `node_modules/pixi.js`
  (a fake package.json with another version) → the warning; a plugin
  resolving the same pixi as the rows → none; no `node_modules` → none; a
  manifest naming the legacy engine → the warning.

## 4. Not here

- A marker in every `@energy8engine` package; bundler-level dedupe.
