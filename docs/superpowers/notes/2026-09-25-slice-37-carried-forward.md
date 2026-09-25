# Slice 37 — no legacy game engine in the engine: what was left behind

Slice: `docs/superpowers/plans/2026-09-25-engine-tween.md`, spec
`2026-09-25-engine-tween-design.md`. Commits `75d7dec1..c83ed540` on
`feat/slot-webide-cordis` plus this note's. Asked by the user: the engine and
its games must not reference the legacy game engine package; what they need
becomes `@energy8engine` packages. Decided with the user: this slice removes
that one package; the other `@energy8platform` packages the engine uses
(`game-sdk`, `shell`, `platform-core`, `harness`) stay.

What the engine took from the legacy engine turned out to be one module —
`animation` — and from it `Tween` and `Easing` (plus `SpriteAnimation`, for
`reel-core`'s `AnimatedSymbol`). Everything else already had an engine
package.

What shipped:
- **`@energy8engine/tween`** (`engine/game/tween`, a library): `Tween` and
  `Easing` forked from the workspace's animation module, API unchanged,
  driven by pixi's `Ticker.shared` as before. Tests: the legacy easing suite
  plus five `Tween` cases (`to`, `fromTo`, `killTweensOf` resolving,
  `delay`, `activeTweens`).
- **`reel-core`, `reels-features`, `flow-fx`** import it (`"*"`);
  `SpriteAnimation` forked into `reel-core/src/anim/` (its only consumer).
- **The dead dependency left** `game-runtime`, `first-slot`, `slot-basic`;
  the registry copies of 0.41.0 nested under them and `flow-fx` were purged
  (their `Tween`/`Easing` were byte-identical to 0.44.1 — no behaviour change
  for `flow-fx`).
- **No file under `engine/` names the package** (the user's `paper-duel`
  aside); fork headers keep their `packages/game-engine/src/…` provenance
  path. The README notes "build the legacy engine first" are gone —
  `reel-core` no longer needs a built `dist`.
- **A guard** — `engine/ide/host/tests/no-legacy-engine.test.ts` walks
  `engine/` (every `.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts/.json/.md/.yml/
  .html/.css`, skipping `node_modules`, `dist`, build caches and
  `paper-duel`), builds the needle from parts, and tolerates a file
  vanishing mid-walk.

Gate: tween 84, reel-core 86, reels-features 95, flow-fx 61, game-runtime
106, reels 66, reels-motion 11, reels-cascade 21, symbols 57; first-slot
typecheck 0; ide-host (alone) 525; full Playwright alone 156/156 (10.9 min).

## Amendments made while running the plan

- **`SpriteAnimation` was not "used by nobody"** (the spec's §0):
  `reel-core`'s `AnimatedSymbol` imports it. Forked into `reel-core`; the
  spec amended.
- Transitive check (whole-slice review): none of `platform-core`,
  `game-sdk`, `shell`, `harness` depends on or imports the legacy engine.

## Debts

1. **`paper-duel`** still declares the legacy engine and carries its nested
   0.41.0 copy — the user's tree.
2. **`SpriteAnimation`'s other five static methods** are dead (~150 lines);
   only `create` is used — kept byte-identical to its source.
3. **Still `@energy8platform`**: `game-sdk` (platform protocol),
   `shell/pixi` (`shell-pixi` row), `platform-core` (`session-sdk`,
   `session-dev`, `ide-host`), `harness` (`ide-client`) — a later slice if
   wanted.
4. Carried: `tempo.spec`'s dead `cascade.enabled` line; slice 36's giant
   README note; i18n, mobile tier, glyph font.

## Method

- **Grep what a module is used for before saying it is unused** — the spec
  listed `SpriteAnimation` as dead from a grep of the wrong importers.
- **A guard that searches for a string must not contain it** — build the
  needle from parts.
