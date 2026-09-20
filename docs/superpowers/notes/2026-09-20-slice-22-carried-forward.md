# Slice 22 — contract holes: what was left behind

Slice: `docs/superpowers/plans/2026-09-19-contract-holes.md`, spec
`2026-09-19-contract-holes-design.md` (answers R2, R3, R5, R6, R7 and two
R14 items of `2026-09-19-paper-duel-port-feasibility.md`). Commits
`7c72f5a..f11db17` on `feat/slot-webide-cordis` plus this note's. Run
autonomously (the user delegated slices 22–25). The board carries symbol
names and per-cell records (`Board = (number | string | BoardCell)[][]`,
`cellData()`); `spin { action, betLevel }` reaches the session and the spin
log; the scenes runtime fits its design in the game page; common
`width`/`height`/`tint`/`anchorX`/`anchorY`/`mask`; `strip` and `shape`
node types; `.avif`. `first-slot` is unchanged. Full Playwright alone: 127/127 —
with the user's own `e8 dev` running on the same machine.

## Amendments made while running the plan

- **`spin.betLevel` is a string prop** (a numeric literal or a `$path`;
  `run` converts with `Number()`). `Schema.number()` cannot hold a `$path`
  and `Schema.any()` renders read-only in the IDE and loses the `'spin'`
  default the interpreter fills before `run`.
- **`tint` is optional** — unset leaves the view's own tint, so a node
  type's `mount` may set one (the spec's `'#ffffff'` default was dropped).
- **Common `width`/`height` are re-applied after the children mount**:
  `applyCommon` ran before a container had children, so pixi's bounds-based
  `width` setter saw 0 and set scale 1, silently; a gizmo resize on a
  container snapped back while the file's `width` grew.
- **A type that declares its own `width`/`height` (`shape`) keeps them**:
  the common pass strips names the type's schema owns (`applyCommon(view,
  props, type)` returns the dict it applied; `mask` is read off that dict,
  not the unstripped props); the host's common-vs-own split rehydrates the
  type's schema and routes such a name to the type; the client's merged
  form already let the type's field win.
- The action warning reads `props.action ?? 'spin'` — the interpreter fills
  the default, so a bare `spin` in a game that declares only `buy` warns.
- The spec's fit arithmetic was wrong (480×288 in 640×360 `contain` = 1.25,
  not 4/3); the e2e uses 960×576 → exactly 2.
- `strip.cols`/`rows` are `natural` (a negative count reached `textures =
  []`, which pixi throws on); `shape.radius` defaults to 8; `fillAlpha`
  exists.
- A second sibling with `mask: true` is a diagnostic (first wins).
- `.avif` also gained a MIME entry in the host's file server.
- **The game page no longer loads vite's HMR client.** vite injects
  `import { injectQuery } from '/@vite/client'` into any module with a
  non-literal dynamic `import()` (the loader's `composeFromProject`), so
  the client always loaded and dialled its baked port 24678; vite's own
  ping listener answered it — until a second `e8 dev` on the machine held
  the port and every page load logged a failed handshake (ten "console
  stays clean" e2e tests red). `dev-game`'s vite now serves a stub for
  `/@vite/client` (`enforce: 'pre'`; vite's `injectQuery` copied, inert HMR
  context/style/overlay exports) beside `hmr: false` + `ws: false`; the
  IDE's own vite pins `hmr.port: 5690`. The e2e helpers stopped depending
  on the machine: `serverPids()` counts only children of the test worker,
  `new-project.spec` snapshots the examples dir instead of a hard list.

## Debts

1. **`config.action` in `dev-game` is unreachable** — the flow always posts
   an action now; the option is documented as such, not removed.
2. **The `renderer 'resize'` event has no producer** (no `resizeTo`); the
   boot fit is what closes R5. Slice 26's responsive layout is the consumer.
3. **A mask node is unpickable on the canvas** (pixi sets `measurable =
   false` on a stencil mask; bounds collapse) — reachable from the tree and
   Properties only; a masked container whose only content is the mask
   reports empty bounds.
4. **Two rounding tables for one edit**: `scene-edit`'s `applyEdit` rounds
   to 1/100, the IDE's `DECIMALS` to whole px; a `width` echo usually fails
   to ack and the node snaps by <0.5 px. Same mechanism as x/y; a single
   table is the fix.
5. **A corner drag on a rotated node with `width` does not round-trip**
   (AABB); the Properties form gives no hint that `width` overrides
   `scale.x`.
6. **The host rebuilds each node type's schema per node** in `checkNode`
   (`new Schema(info.schema)`) — memoise by `NodeTypeInfo` identity when
   scene documents grow.
7. **Concurrent `once()` on one `strip`/`spritesheet` view** overwrites
   `onComplete` (the first promise never settles); sequential use is fine.
8. `strip.frames` uses a `0` sentinel for "all cells" (schemastery cannot
   express `cols × rows`); `matchesFieldKind('grid')` accepts ANY record
   leaf (`checkShape` backstops with the value check).
9. No test for the flow host's `game/spec.json`-write re-read; the
   `betLevel` guard reports on any non-string/number `$path` value.
10. An `image` `width`-scaled before its texture lands is right for
    `Sprite` (pixi re-applies the cached `_width` on a texture swap) — but
    nothing re-runs `applyCommon` after an async fill for other view kinds.

## Method

- **A schema `default` turns "optional prop" into "always sent."**
  `spin.action`'s default made `dev-game`'s `config.action` unreachable and
  the new warning blind to the commonest node. When a fix adds a
  `.default`, re-walk every `??` chain and every "is the prop present?"
  check downstream.
- **`Schema.any()` is never the IDE's answer.** The form renders it
  read-only; the interpreter fills no default. A `$path` is a string — a
  string schema carries both.
- **Common props that read a view's own bounds only work on views that
  carry their bounds at mount** (`Sprite`, `Graphics`), not on `container`
  /`scene` — unless applied again after the children. Written down now.
- **Pixi asymmetries are worth measuring, not reasoning about.** `Sprite`
  caches `_width` and self-heals across a texture swap; `Container` does
  not. One scratch assertion would have caught the container no-op before
  the final review did.
- **An e2e assertion on a frozen snapshot cannot fail.** `__e8.diagnostics`
  is captured at boot; the mask smoke needed the live list and a hook that
  reads the view (`nodeMasked`). Flip the fixture to prove an assertion
  goes red.
- **Two value checks and one type check for the same leaf** need a truth
  table in the review; the record-without-`symbol` row is where they
  legitimately differ.
- **A green suite proves the machine, not the code.** Fourteen failures
  came from the user's live `e8 dev` (a held port, a second `e8-server`,
  an untracked example dir) — three of the four fixes made the tests and
  the product robust to a second dev session; the fourth was a real premise
  (`request` recorded). Two sub-agents called the vite-client class
  "pre-existing" against two earlier 124/124 runs — the history is the
  evidence, not the current machine.
- A sub-agent ran `git checkout --` on a file it had edited to undo a
  sabotage probe and silently reverted its own fix — re-applied. The rule
  ("never on files you did not create") is not enough: probe on a copy.
