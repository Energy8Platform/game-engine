# Slice 17 — scene editor: what was left behind

Slice: `docs/superpowers/plans/2026-09-17-scene-editor.md`, spec
`2026-09-17-scene-editor-design.md` (§12 holds the plan-time amendments).
Commits `5e0db76..a9a6649` on `feat/slot-webide-cordis` (twenty-two) plus
this note's. A scene is now a tree of typed nodes in
`scenes/<id>.scene.yml`; `@energy8engine/scenes` (row `scenes1`, replacing
the deleted `stage`) mounts it through a registry of node types —
`container`, `image`, `scene` built in, `reels` from the reels row — and
loads a scene's assets before showing it. The host reads, checks and serves
the documents and mirrors the game's node types; the IDE has a Scenes
sidebar, a scene tab (the node tree, the viewer for the file), a right
sidebar with the selected node's properties, and a highlight box in the
preview. `main.ts` shows the scene named after the spin stage until the
flow editor (sub-project C) takes over. Sub-project A of the 2026-09-17
scenes redesign is closed; B (the canvas) is next.

## User feedback that reshapes B

Received while the slice was under final review, from live use:

1. **"The scene editor is a VISUAL editor where I manage images."** The
   node tree is not what was pictured. B must put the game preview inside
   the scene tab with an overlay: click an object to select it, drag to
   move, handles to scale, properties on the right. The tree stays as a
   secondary view, not the main one.
2. **The right sidebar was off-style** — fixed in the final wave (same
   floating card as the left).

## Debts

1. **Boot shows an empty canvas** until the first spin or a sidebar click
   (spec §0/§5.3: nothing loads at boot). Spec-conformant; C's
   `boot → show` closes it. Do not file as a regression.
2. **The pixi `Assets` adapter is unproven** (`scenes/src/runtime.ts`,
   `/${path}` keys): no `image` node exists in `first-slot` or the e2e;
   the only image is a host test fixture. Put one image in the example
   when B lands and poll `Sprite.texture !== EMPTY`.
3. **The `reels` view is a singleton**: the host warns for zero and for
   more than one `reels` node, but a second mount still steals
   `board.view`. A per-node board is a reels-package change.
4. **`scenes.ts` is ~470 lines**; the show/hide/asset-bookkeeping block is
   the seam if B grows it.
5. **Nested-scene edge cases**: hide of a nested scene whose document is
   deleted mid-transition leaves the host node visible; `show` captures
   host views before its transition await (same race class as
   replace-mid-show, untested); an asset edit during a scene's own
   in-flight `show` is not reloaded; one failed batch load reports every
   path in the batch.
6. **A view whose `applyCommon` throws is dropped unparented** (one pixi
   object per bad apply; GC reclaims it).
7. **Host `scenes` plugin**: boot refresh not awaited (`apply` could be
   async); no generation guard on overlapping refreshes; `hasFile` accepts
   a directory path; `parseDoc` exported unused; no PUT→disk→GET round trip
   with `children` in the tests.
8. **Client `scenes` service**: a boot-GET failure is not
   `connection.report`ed (mirrors `game-composition`); no disposer-path
   test; `select` on an identical selection re-POSTs.
9. **Scenes sidebar**: an orphan `scene-add-error` can appear after
   Escape-then-late-refusal; no keyboard path to `open` (double-click
   only); `plugins/scenes.tsx` ↔ `shell/ScenesSidebar.tsx` import each
   other (deferred to call time, works).
10. **Scene tab**: `preview` fires for a deleted document; a no-op drop
    still PUTs; foreign-drag refusal and a `before` drop into a nested
    position are untested; no "to root, at the end" drop zone;
    nestability is the literal type `'container'`; `defaultsFor` casts.
11. **Properties**: `prop-error` (refused props PUT) untested; a one-frame
    "gone node" render during rename; a type's own key can silently shadow
    a `COMMON` key in the merged schema.
12. **Tests**: `fakeOpenableSocket` duplicated in ide-bridge tests; a
    non-array `scenes` frame untested; one reels node-type test never
    disposes its fiber; no schema-level test for the removed `layer`;
    `onFrame` ordering (listeners run BEFORE `service.snapshot` updates; a
    listener added mid-dispatch hears the current frame) undocumented.
13. **`ide-web` typecheck still reports six `TS7016`s** (slice 14 debt).
14. **Four `/ide` sockets, none reconnecting** (slice 12 debt) — the
    scenes service rides `connection.onFrame`, so no fifth.
15. **Two e2e cases flake under the full 8-minute run** and pass alone:
    `diagnostics.spec.ts:440` (stale-module reload) and `shell.spec.ts:150`
    (`ERR_TIMED_OUT` on one resource). Full run alone: 103/105, the two
    green on their own re-run; `scenes.spec.ts` 4/4 every time.

## Method

- **"Deferred until visible" reports need a "was it ever here" bit.** A
  registry with disposers produces a remove→add pair on every hot
  re-apply; code that reacts to "gone" must tell a gap from a departure.
  Cordis unload/reload is a chain of microtasks, so coalescing is not a
  fix — key on the previous mount's fact. Found by the final review with
  a real `fiber.update`, not a hand-called disposer, which hides the gap.
- **Validate at the boundary the runtime trusts.** The host mirrored the
  common-prop LIST but not the SCHEMA; the runtime applied the schema
  outside its error path, so one `x: "abc"` in a hand-edited file poisoned
  every later `show`. A package that exports a pixi-free schema subpath
  is for both sides to import, not to mirror.
- **"Boot never broadcasts" is false inside `project-scope`.** A
  per-project host plugin re-applies while IDE sockets stay up; its first
  read must broadcast, or the client must refetch on the switch. The
  slice-16 debt-2 fix reached transitions and node types and missed the
  scene documents for exactly this reason.
- **Derived visuals need a redraw hook.** The highlight box was drawn once
  and went stale on the first edit of the node it framed. Store the last
  request, redraw after `remount`/`load`. B's gizmos are the same shape.
- **A new region copies the card recipe, not the seam.** The right
  sidebar shipped as a flat panel with a `border-left`; the shell's chrome
  is three rules per region (margin-in-column, border, radius). The user
  saw it in a minute.
- **The plan's "drop the two cases" was read against the spec.** Both
  tests also covered `transitions`, which the spec keeps; the assertions
  were trimmed, not the tests. Ruled, ledgered, approved.
- **A brief's boolean test can be un-failable.** "Concurrent shows run in
  order" passed with the queue disabled because both fake loads took the
  same 5 ms; the fix was asymmetric delays, verified RED.
- **Fixtures should exercise every built-in type.** No `image` anywhere in
  the running example left the real loader unmeasured (debt 2). When D
  adds `spine`/`spritesheet`, put one of each in `first-slot` from the
  start.
