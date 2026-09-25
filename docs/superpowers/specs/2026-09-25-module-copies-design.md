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
  `two copies of <name> are loaded — <url1>, <url2>: its module state (tweens, caches, classes) exists twice`
  fix: `make the project resolve the engine's copy: declare it "*" or match the engine's version`.

## 2. Host check (third-party stateful packages)

`pixi.js` and `cordis` cannot be marked, so the IDE host checks resolution:
for each project plugin directory (`<project>/plugins/*` with a
`package.json`) and the project root, resolve `<pkg>/package.json` from that
directory; resolve it from each composed engine row's package directory;
different realpaths → one `warning` per project location:
`plugins/<name> resolves pixi.js@<v1> (<path>) but the engine's rows use pixi.js@<v2> (<path>) — two copies in one page`
fix: `declare pixi.js the way the engine does (or drop it) so one copy resolves`.
Not monorepo-specific: it compares the project against the engine rows,
wherever those are installed.

Plus the user's rule: a project whose root or plugin `package.json` names
`@energy8platform/game-engine`, or that resolves it, gets a `warning`:
`the engine no longer uses @energy8platform/game-engine — a copy here is a second engine`
fix: `remove it; use @energy8engine/tween for tweens`.

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
