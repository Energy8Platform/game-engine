# Declared assets, and a node that says it finished — design (slice 33)

Date: 2026-09-23. Branch: `feat/slot-webide-cordis` at `f23e90d8` (slice 32).
Source: round 4 of the paper-duel port, findings F8 and the `strip` item of
F10. Decided with the user: F9 (a full-board `refill` rebuilds every cell) is
deferred — the rebuild lives in the legacy `SymbolCell.setData`
(`packages/game-engine`, bucket B), and the engine-side workaround (writing
into `ReelSystem.board` in place) was declined; it belongs to a future slice
that brings the reel system into the engine. The rest of F10 needs no code: a
plugin keeps one table of its art and calls `require(Object.values(ART))`;
a second node that wants the same set takes the same `srcOf`.

## 0. Rules

- `packages/*` is not edited.
- Every fix carries a unit test in its package; the browser proof is the e2e
  suite plus §3.

## 1. F8 — a path a declared document names is not "nothing loaded"

### 1.1 The problem

`replace()` mounts every declared document, hidden; `load(id)` runs on
`show(id)`. So an `image` in a document that has not been shown yet calls
`assetLoader.get()` before anything loaded its art. Once the first batch has
settled, the pixi loader (`createPixiLoader`, `scenes/src/runtime.ts`) reports
`nothing loaded "<path>"` for it — a path no batch was asked for YET. In the
paper-duel migration that is eight to twelve false warnings per boot; the art
loads when the scene is shown, and draws.

The warning exists for one case: a path NOTHING names — no document, no
`require` — so nothing will ever load it. "Not loaded yet" is not that case.

### 1.2 The change

`AssetLoader` gains an optional method:

```ts
/** Paths something declared it will load: `get` does not call them "nothing loaded". Loads nothing. */
expect?(urls: string[]): void;
```

- The pixi loader adds them to the set it already keeps (`asked`); `load`
  still adds its own. Nothing else about `get` changes: the warning still waits
  for the first batch to settle, still fires once per path.
- `replace(docs)` calls `expect` with every path every declared document names
  — `assetsOf(id)` per document, which already includes asset props and every
  `srcOf` value — before it remounts.
- `require(paths)` calls `expect(paths)` at once, not when its queued batch
  runs, so a row's art mounted before its batch lands is not reported either.
- `expect` is optional: a loader without it (a test fake, a custom loader)
  behaves as today.

What still warns: a path named only in TypeScript and never `require`d — the
case the warning was built for.

## 2. `scenes.once(ref)` — play a node once and know when it finished

### 2.1 The problem

`strip` already has a `once(view, props, ctx)` on its node type — it plays the
frames once and settles on the last one. Only a symbol state's cell mount can
reach it (`CellMount.once`). A node in an ordinary scene cannot: the migration
shows the knight's attack strip, calls `gotoAndPlay(0)` on the pixi view, and
hides it on a 1400 ms timer that has to match the strip's own length.

### 2.2 The change

`ScenesService` gains:

```ts
/**
 * Plays every mounted copy of the node once through its type's `once` and
 * settles when the last one ends: `true` when the type has a `once` and at
 * least one copy played, `false` otherwise. A node nothing mounted is
 * `false` with an error at `<scene>/<node>` (`setProps`' diagnostic, "nothing
 * to play"). A copy whose `once`
 * throws is reported at its `where` and the others still play.
 */
once(ref: SceneRef): Promise<boolean>;
```

- Every copy, the way `setProps` patches every copy: nesting is by copy, and
  only one of them is on screen.
- It does not touch `visible`: the caller shows and hides.
- No flow kind: nothing asks for one yet.

The migration's knight becomes `setProps(ref, { visible: true })`,
`await scenes.once(ref)`, `setProps(ref, { visible: false })`.

## 3. Tests

- scenes: two declared documents with an `image` each, only one shown, the
  loader's first batch settled — `get` on the hidden one's path reports
  nothing; a path no document names still reports once; `require`'s paths are
  expected before its batch runs; a loader without `expect` still works.
  `once`: a node type with a `once` (a fake that settles on demand) — `true`,
  settles only after it settles, every copy of a nested document plays; a type
  without `once` — `false`; an unknown node — `false` with the diagnostic; a
  throwing copy is reported and the others play.
- scenes, through the real row (`runtime.test.ts`, the pixi loader and
  `replace` wired as the game wires them): after the first batch settled, a
  hidden document's path is not reported, an undeclared one still is. This
  stands in for a browser case: the false warning needs a `get` AFTER the
  first batch settles (a remount, a re-apply), which a browser run cannot
  schedule without the IDE — the integration test can, deterministically.

## 4. Not here

- F9 — diffing a `refill` (bucket B; a future slice brings the reel system
  into the engine).
- A flow kind for `once`.
- i18n, a mobile asset tier, a bitmap glyph-map font (round 3/4 leftovers).
