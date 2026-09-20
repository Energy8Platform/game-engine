# Slice 24 — text, live props and taps: what was left behind

Slice: `docs/superpowers/plans/2026-09-20-text-and-props.md`, spec
`2026-09-20-text-and-props-design.md` (answers R4 and two R14 items of
`2026-09-19-paper-duel-port-feasibility.md`). Commits `99c0b0f..7448c1b`
on `feat/slot-webide-cordis` plus this note's. Run autonomously. Numbers
reach the canvas: a `text` node type (`Text`/`BitmapText`),
`scenes.setProps` (a live, unsaved, atomic patch of a mounted node's
props) driven by a `prop` flow kind, `$cell.<field>` bindings in symbol
states applied when the reels land, `ui.tap` from the stage. `first-slot`
shows its win. Full Playwright alone: 132/132.

## Amendments made while running the plan

- **`setProps` is atomic on refusal.** `applyCommon` used to mutate
  position/scale/width/height before `Color` parsed `tint`; `text.update`
  set `text` before the style could throw. Now both schemas (COMMON and
  the type's) validate before any mutation; colour props carry a
  JSON-surviving `pattern(COLOUR)` (a `Color` transform would die on the
  wire and render read-only in the IDE); `applyCommon` is split into
  `commonProps` (validate + parse) and apply; `text`/`shape` parse into
  locals first.
- **`setProps` reaches every mounted copy of a node.** `replace()` mounts
  every document top-level and `show(big_win)` with a visible host flips
  the EMBEDDED copy; the first-match lookup patched the off-screen
  standalone and answered `true`. `entriesOf(ref)` validates all copies,
  then applies to each; `view()`/`nodeSchema()` keep first-match.
- **`ui.tap` is suppressed on the scene-editor page.** The spec claimed the
  editor runs no `wait`; `editor.ts` composes the whole bundle, flow row
  included, so a click to select a node would advance a `wait { event:
  ui.tap }`. `scene-edit` provides `sceneEdit`; the runtime's listener
  reads it at click time.
- `prop.value` defaults to `''` (an omitted value on a number prop was
  `Number(undefined)`), `prop` awaits `scenes.ready` (a `boot → prop`
  raced the boot GET), an unknown prop name reports (`Object.hasOwn` —
  schemastery passes unknown keys through, prototype names slipped `in`),
  a `$path` number/boolean into a string prop is stringified (schemastery
  throws on a non-string — the win text could never update; the e2e
  found it, the unit tests fed strings only). One exported `parseTarget()`
  serves `prop` and flow-fx's `tween`.
- `$cell.*` bindings substitute the schema-typed empty before the type
  schema runs (stripping a `required()` prop throws); the host's
  `checkNode` accepts them only for symbol documents (`cellBindings`).
- `nodeSchema(ref)` (COMMON ∪ the type's dict) landed with `setProps`.
- `engine/apps/web/tests/App.test.tsx` pinned the activity bar without
  `Symbols` since slice 21 — root `npm test` was red; fixed here.
- **An empty OPTIONAL asset prop is not an error.** Slice 20's `<type> has
  no <prop>` rule assumed the prop is required (`image.src`); the example's
  `win` text node (`font: ''`) made every project boot with a red row —
  three full-suite e2e tests said so, none of the task-scoped ones did.
  `checkNode` reports it only when the type's schema marks the prop
  required.

## Debts

1. **`$cell` bindings go stale on any seating path other than
   `spinTo`/`refill`/`repaint`** (a project plugin's own step — `reel-step`
   seats cells itself). Name it in the symbols docs before a second
   mechanic ships.
2. **An asset prop bound to `$cell.*`** (`image.src: '$cell.symbol'`) is
   refused by the `assetProps` check with "is not in the project" — the
   ruling stands (such an asset cannot be preloaded); the message should
   say "an asset prop cannot be bound".
3. **`COLOUR` accepts malformed function forms** (`rgb(a,b,c)`) that the
   host waves through and the runtime refuses atomically.
4. **`emptyProp` for a `union` prop yields `''`**, which the union refuses
   with a confusing message.
5. **A `prop` on a `scene` node's `scene` prop** desyncs show/hide
   bookkeeping (`scene` has no `update`); reachable through the picker.
6. **Empty `text` nodes are unpickable on the canvas** (zero bounds) — the
   tree selects them; a README line.
7. `setProps` across copies is "validate all, apply all"; a `type.update`
   throwing mid-loop can leave earlier copies patched (the single-copy
   caveat, now spanning copies). `applyCommon` `width`/`height` on a
   `text` node throws headless only (measuring needs a canvas).
8. `prop` sets one prop per node; a `props` map and a `format` come with
   the first real HUD. Bitmap fonts ship no example asset. The symbol
   form types `$cell.*` by hand; no bind-before-load-then-refresh test.
9. `ide-web`'s typecheck still fails on six TS7016 (`monaco-editor`
   subpath typings) — since slice 12; its tests DO run.

## Method

- **A spec sentence that asserts a fact about another module is a claim to
  verify.** "The editor page runs no `wait`" was the whole safety argument
  for `ui.tap`; one `grep createGame editor.ts` disproved it. Such claims
  belong in the preflight scan.
- **Extracting a helper inherits its bugs silently.** `entryOf` came out
  of `view()` verbatim, so the diff read as a refactor — while a new
  caller that reports success (`setProps`) sat on it. Flag "existing body
  moved to a shared helper + new caller" as its own review prompt.
- **Two clean task reviews can miss the seam between them.** Both
  Importants lived where a task met a page or a rule no task owned. For
  each new service method, list its siblings and inherit their known
  limits.
- **Validate everything that can throw before the first mutation** — the
  first caller that hands `applyCommon` unvalidated values against a live
  view exposed an order that was safe for every earlier caller.
- **A validator must survive the wire.** A schemastery transform dies in
  JSON and the IDE form renders the field read-only; `meta.pattern`
  survives and keeps `type: 'string'`.
- **Unit tests that feed only the happy type miss the wire's shape.** The
  `prop` tests passed strings; the flow passes numbers; the e2e was the
  only test that fed `$result.win`.
- **A fixture change is a product change.** Adding one node to the
  reference example turned a latent host rule into a red diagnostic on
  every project; only the full suite's "panel is empty" tests saw it. When
  a slice edits the example, run the specs that assert an empty panel.
- **A deferred item's stated reason for being harmless must be
  re-measured at triage** — "ide-web's tests never run" was false; root
  `npm test` was red.
- The scratch vitest harness (a config in the scratchpad with `root` at
  the package and `include` outside it) turns "I think this is wrong" into
  a measured output in minutes.
