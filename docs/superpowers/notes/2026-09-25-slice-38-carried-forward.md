# Slice 38 — one copy of every stateful module (paper-duel F14): what was left behind

Slice: `docs/superpowers/plans/2026-09-25-module-copies.md`, spec
`2026-09-25-module-copies-design.md` (amended in the slice). Commits
`394d2c6c..a152e2ad` on `feat/slot-webide-cordis` plus this note's.

Agreed with the user: the point is to protect the GAME AUTHOR. A real game
lives outside this monorepo and installs `@energy8engine/*` from a registry;
when the project's plugins and the engine's rows end up with different
instances of a module with module-level state (the tween registry, pixi's
classes, cordis's context), things fail silently. The engine is the only
place that can see it.

What shipped:
- **The IDE host's check — the main net** (`foreignCopies` in
  `engine/ide/host/src/plugins/project.ts`): `pixi.js`, `cordis`,
  `@energy8engine/tween`, `@energy8engine/reel-core` resolved from the project
  root and every `plugins/*` (realpathed, so a symlinked plugin resolves from
  its target) against the copy the engine's rows use — only rows that DECLARE
  the package (dependencies/peer/optional, not dev) count. One `warning` per
  foreign copy, every resolving location in `where`; the fix hint branches on
  the version (same version twice → delete the nested copy / install with
  `--omit=peer`; different → declare it as a peer or a range including the
  engine's version). A project naming or installing the legacy game engine
  gets its own warning (the name built from parts). `e8 build` surfaces these
  (it reads the host's composition diagnostics). Quiet on first-slot and the
  template — pinned by a test.
- **A runtime marker — the second net**: `markModuleCopy`/`moduleCopies` in
  `@energy8engine/contracts` on `globalThis[Symbol.for(…)]`; `tween` and
  `reel-core` mark themselves; `createGame` warns when a name has more than
  one URL. It catches a copy loaded under a different URL; in dev Vite
  pre-bundles by bare name and under `e8 build` everything is one chunk, so
  the host check carries the common case.

Gate: contracts 168, tween 85, reel-core 87, reels-features 99, game-runtime
109, ide-host (alone) 539; typecheck 0. Full Playwright alone 156/156 before
the final wave; after it `contract.spec` 3/3 and `composition.spec` 9/9
alone (the wave changed only the host's row filter and message texts).

## Amendments made while running the plan

- **The build hole** (Task 1's review): `e8 build`'s single chunk collapses
  `import.meta.url`, so the marker cannot see a duplicate in a built game.
  The host check grew `tween`/`reel-core` to cover it.
- **Symlinked plugins** (Task 2's review): resolve from the realpath.
- **One warning per foreign copy**, not per location (a root copy no longer
  repeats on every plugin).
- **Rows that do not declare a package no longer count as the engine's copy**
  (the whole-slice review): they fell through to the project's own root
  copy, so a root pin — F14's own scenario — was silent.
- **`pixi.js` is resolved via `resolve.paths`**, not `resolve('pixi.js/package.json')`
  (pixi's `exports` hides it).
- **The legacy engine counts only when installed inside the project** — a
  monorepo hoisting it above the game is not the game's doing.

## Debts

1. **Two declaring rows on different copies** — the first is compared; the
   engine's own split is not reported.
2. **Unchecked layouts**: scoped `plugins/@scope/x`; npm-installed
   third-party rows; packages no row declares.
3. **No test that the host warning reaches `e8 build`'s output** (the wire is
   read, not pinned).
4. A marker only in `tween` and `reel-core`; other packages when they gain
   module state.
5. Carried: `paper-duel` (the user's tree) — move to `@energy8engine/tween`;
   `@energy8platform` game-sdk/shell/platform-core/harness stay by choice.

## Method

- **Ask what the check is FOR before choosing where it looks** — the first
  design compared against the monorepo's workspace; a game lives elsewhere.
- **A net for a class of bug needs the scenario that motivated it as a
  fixture** — the root-pin case was the story in F14 and the one the first
  cut missed.
