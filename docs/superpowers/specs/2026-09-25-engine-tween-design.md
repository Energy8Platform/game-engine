# No `@energy8platform/game-engine` in the engine — design (slice 37)

Date: 2026-09-25. Branch: `feat/slot-webide-cordis` at `18bee13a` (slice 36).
Source: the user — "the engine and games must not reference
`@energy8platform/game-engine`; what they need becomes `@energy8engine`
packages." Decided with the user: this slice removes `game-engine` only; the
other `@energy8platform` packages the engine uses (`game-sdk`, `shell`,
`platform-core`, `harness`) stay.

## 0. What the engine takes from it today

Only `@energy8platform/game-engine/animation`, and from it two things:
`Tween` (`to`, `fromTo`, `delay`, `killTweensOf`, `activeTweens`) and `Easing`
(~15 curves) — imported by `@energy8engine/reel-core`,
`@energy8engine/reels-features` and `@energy8engine/flow-fx`. `game-runtime`,
`first-slot` and the `slot-basic` template declare the dependency and import
nothing from it. Every other legacy module (scenes, audio, assets, viewport,
loading, host, slot) already has an engine package. `Timeline` and
`SpineHelper` are used by nobody; `SpriteAnimation` is used by
`@energy8engine/reel-core`'s `AnimatedSymbol`.

Because the dependency is declared `^0.41.0` against a 0.44.1 workspace
(0.x semver: `<0.42`), npm nested a registry copy of 0.41.0 under `flow-fx`,
`game-runtime`, `first-slot` and the template — so today `flow-fx`'s `tween`
and `count` nodes run a different, older `Tween` module than the reels.

## 1. Rules

- `packages/*` is not edited.
- No string `@energy8platform/game-engine` anywhere under `engine/` — code,
  package.json, comments, READMEs, specs, tests — except the user's
  `engine/examples/paper-duel` tree (theirs to move) and `node_modules`.
  Fork provenance headers that name the legacy PATH
  (`// Forked from packages/game-engine/src/…`) stay: they record history,
  not a dependency.
- Every change carries a test in its package.

## 2. `@energy8engine/tween`

A library package (no cordis, like `reel-core`) at `engine/game/tween`:

- `src/Tween.ts`, `src/Easing.ts` forked from the 0.44.1 workspace source
  (`packages/game-engine/src/animation/`), `EasingFunction` defined locally
  (`(t: number) => number`); API identical, so moving to it is an
  import-path change. Driven by pixi's `Ticker.shared`, as today.
- Not forked into `@energy8engine/tween`: `Timeline`, `SpineHelper`.
  `SpriteAnimation` is forked into `reel-core/src/anim/` (its only
  consumer), not into tween — a sprite-frame helper, not a tween.
- Tests: the legacy `Easing.test.ts` forked; new `Tween` tests (a `to`
  reaches its target and resolves; `fromTo` starts from its `from`;
  `killTweensOf` resolves the pending promise and stops the target;
  `delay` resolves after its time; `activeTweens` counts).

A cordis row (`tween1` on the renderer's ticker) is not this slice: the
reels' controllers call `Tween` statically; a global pause or speed would
be its own slice.

## 3. The move

- `reel-core`, `reels-features`, `flow-fx`: every
  `@energy8platform/game-engine/animation` import → `@energy8engine/tween`;
  their package.json depends on `@energy8engine/tween: "*"` instead.
- `game-runtime`, `first-slot`, `slot-basic`: the dead dependency goes.
- The nested registry copies go: their entries purged from the gitignored
  `package-lock.json`, `npm install`, and no
  `engine/*/*/node_modules/@energy8platform/game-engine` remains outside
  `paper-duel`.
- Comments, READMEs, e2e specs and host tests that name the package are
  reworded to name the engine's own pieces (`@energy8engine/reel-core`'s
  `SymbolCell`, `TumbleController`, …) or `@energy8engine/tween`.

## 4. The guard

A test in `@energy8engine/ide-host` (it already reads the example and
template trees) walks `engine/*/*` — every `package.json` and every source,
test, README and yml file, skipping `node_modules`, `dist` and
`engine/examples/paper-duel` — and fails naming each file that contains
`@energy8platform/game-engine`. The guard builds that string from parts
(`['@energy8platform', 'game-engine'].join('/')`) so it does not match
itself.

## 5. Tests

- `tween`: §2's cases.
- `reel-core`, `reels-features`, `flow-fx`, `game-runtime`: their suites
  unchanged in assertions, green on the new import.
- `ide-host` (alone): the guard, and the template pins with the new
  package.json.
- Full Playwright alone.

## 6. Not here

- `game-sdk`, `shell`, `platform-core`, `harness`.
- A tween row, `Timeline`.
- `paper-duel`.
