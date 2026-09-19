# Contract Holes Implementation Plan (slice 22)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen six contracts a real game's port ran into — symbol ids as names/records on the board, `spin { action, betLevel }`, the scenes runtime fitting its design in the game page, `width/height/tint/anchorX/anchorY/mask` common props, a `strip` node for grid-strip sheets, a `shape` node and `.avif` — with `first-slot` unchanged.

**Architecture:** `Board` becomes `(number | string | BoardCell)[][]` with one `cellData()` helper every consumer (reels, project plugins) goes through; the value/type checks widen the same way. `spin` carries two optional props the host route forwards to `session.play`. The scenes runtime owns `resize` (boot + renderer `resize`). `COMMON` gains the six props, `applyCommon` applies them, the runtime applies `mask` after `addChild`; the gizmo maps a scale drag onto `width`/`height` when present. `strip` lives beside `spritesheet`; `shape` beside `image`.

**Tech Stack:** cordis 4.0.0-rc.8, pixi.js 8.20.1, schemastery, `@energy8engine/*`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-contract-holes-design.md`

## Global Constraints

- `BoardCell { symbol: string | number | null; [extra: string]: unknown }`; `Board = (number | string | BoardCell)[][]`; `cellData(cell)` → `{ symbol: string | null } & Record<string, unknown>` (`String(n)` for a number; extras spread); `RevealedLine.symbol: number | string`; `isBoard`/`isGrid` accept the three leaf shapes; `matchesFieldKind('grid')` accepts a leaf of `int | float | str | record`.
- `spin` schema `{ action: string default 'spin', betLevel?: number }`, both `$path`-resolvable; POST body omits undefined keys; the host route `body.action ?? config.action ?? 'spin'`, `body.betLevel ?? config.betLevel`; `validateFlow(doc, kinds, sceneIds, actions: string[] | null)` WARNING `action "<x>" is not in game/spec.json` for a literal not in the list (never for a `$path`, never when `null`).
- Scenes runtime: `scenes.resize(app.screen.width, app.screen.height)` after `createScenes` and on `app.renderer.on('resize')`; off on dispose.
- `COMMON` gains `width?`, `height?` (applied after `scale`), `tint` (`'#rrggbb'`, default `'#ffffff'`), `anchorX?`, `anchorY?` (default `anchor`), `mask` (default `false` — runtime sets `parent.mask = view` after `addChild`, clears on unmount); the gizmo's scale drag emits `width`/`height` × factor on a node that has them (each only when set) instead of `scale`.
- `strip` (node-media): `src` (asset png/jpg/jpeg/webp/avif, required), `cols`/`rows` natural default 1, `frames?`, `fps=12`, `loop=true`, `playing=true`; row-major slices; `once`; `assetProps: ['src']`; NO `accept`. `shape` (scenes builtin): `kind rect|roundRect|circle|ellipse` default `rect`, `width`/`height` default 100, `radius` default 8, `fill` default `'#ffffff'` (`''` none), `fillAlpha` 1, `stroke` `''`, `strokeWidth` 0. `image` accepts `avif`.
- `first-slot` ≡ `slot-basic` stay byte-identical on the pinned files; `main.ts` gains `__e8.stageScale()` and `nodeProps` gains `width/height/tint` (pinned, so both copies).
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`; the root lockfile is gitignored; no `git checkout`/`git stash` on files you did not create; never kill a process you did not start; Playwright runs ALONE (one file per task at most; the full run is the controller's). Branch stays `feat/slot-webide-cordis`.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Commands from the REPO ROOT: `npm test -w @energy8engine/<pkg>`; typecheck `npm run typecheck -w <pkg>`; e2e `cd engine/apps/web && npx playwright test tests/e2e/<file>`.

---

## File map

| Path | Responsibility |
|---|---|
| `engine/core/contracts/src/{presentation,mechanic}.ts` | `BoardCell`, `Board`, `cellData`, `isBoard`, `isGrid`, `RevealedLine.symbol` |
| `engine/game/runtime/src/plugins/mechanics.ts` | `matchesFieldKind('grid')` leaf |
| `engine/game/reels/src/index.ts`, `engine/examples/first-slot/plugins/reel-step/src/step.ts` | `cellData` consumers |
| `engine/ide/client/src/shell/symbols-doc.ts` + `SymbolsDocument.tsx` | drop-new accepts any stem |
| `engine/game/flow/src/{kinds,graph}.ts`, `engine/ide/host/src/plugins/{dev-game,flow}.ts` | `spin` props, route, actions warning |
| `engine/game/scenes/src/{runtime,common-schema,node-types,scenes,builtin}.ts` | resize, common props, mask, `shape`, avif |
| `engine/game/scene-edit/src/{gizmo,index}.ts` | width/height drag mapping |
| `engine/ide/host/src/plugins/scenes.ts` | `COMMON_PROPS` (derived — verify) |
| `engine/ide/client/src/plugins/viewers-media.tsx` | `.avif` |
| `engine/game/node-media/src/{strip,runtime,index}.ts` | `strip` |
| `engine/examples/first-slot/src/main.ts` ≡ `engine/templates/slot-basic/src/main.ts` | `__e8.stageScale`, `nodeProps` fields |
| `engine/apps/web/tests/e2e/contract.spec.ts` | proof |

---

### Task 1: Symbol ids as names and records on the board

**Files:**
- Modify: `engine/core/contracts/src/presentation.ts` (`BoardCell`, `Board`, `cellData`, `isBoard`, `RevealedLine.symbol`), `engine/core/contracts/src/mechanic.ts:133` (`isGrid`), `engine/game/runtime/src/plugins/mechanics.ts:450` (`matchesFieldKind` grid leaf — read `engine/core/spin-parser/src` for the record `FieldType`, `{ kind: 'record', name }`), `engine/game/reels/src/index.ts:106,158` (`toCellBoard` → `cellData`; `remove`'s `{ symbol: null }` stays; the re-sync snapshot spreads cells), `engine/examples/first-slot/plugins/reel-step/src/step.ts:68` (`toCellBoard` → `cellData` from contracts), `engine/ide/client/src/shell/SymbolsDocument.tsx` (drop-new: any non-empty stem; the "already a symbol" refusal stays)
- Test: `engine/core/contracts/tests/presentation.test.ts` (extend), `tests/mechanic.test.ts` (extend), `engine/game/runtime/tests/mechanics*.test.ts` (extend: a `[[str]]` grid type passes `grid`), `engine/game/reels/tests/board.test.ts` (extend: a name board → `setData({ symbol: 'ROCK' })`; a record cell → extras reach `setData`; `remove` keeps extras), `engine/examples/first-slot/plugins/reel-step/tests/*` (green), `engine/ide/client/tests/symbols-document.test.tsx` (drop `ROCK.png` onto the empty area → `addSymbol('ROCK')`)

**Produces:** the contract in Global Constraints; `export function cellData(...)` from `@energy8engine/contracts`.

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/contracts -w @energy8engine/game-runtime -w @energy8engine/reels -w @energy8engine/ide-client -w e8-example-reel-step` (check the reel-step package name in its `package.json`) green; typecheck. Commit `Let a board carry symbol names and per-cell data`.

---

### Task 2: `spin { action, betLevel }`

**Files:**
- Modify: `engine/game/flow/src/kinds.ts:149-168` (schema + body), `engine/game/flow/src/graph.ts:106` (`validateFlow` 4th param `actions: readonly string[] | null = null`; the warning), `engine/ide/host/src/plugins/dev-game.ts:464-477` (body `{ action?, betLevel? }`), `engine/ide/host/src/plugins/flow.ts` (`actions()` reads `game/spec.json` `actions` keys through `ctx.files.read`, `null` when absent; passed to `validateFlow`; refresh on `game/spec.json` writes), `engine/game/flow/src/interpreter.ts` (its own `validateFlow(doc, kinds.list(), null)` call — pass `null` for actions; unchanged behaviour)
- Test: `engine/game/flow/tests/kinds.test.ts` (extend: literal + `$path` action/betLevel in the POST body; `betLevel` omitted when unset), `engine/game/flow/tests/graph.test.ts` (extend: warning on a literal not in `actions`; none for `$path`; none for `null`), `engine/ide/host/tests/dev-game.test.ts` (extend: the route forwards `action`/`betLevel` to `session.play` — find how the existing spin-route test fakes `session`), `engine/ide/host/tests/flow.test.ts` (extend: a `spin { action: 'buy' }` against the fixture's `spec.json` → the warning)

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/flow -w @energy8engine/ide-host` green; typecheck. Commit `A spin names its action and bet`.

---

### Task 3: Scenes — design fit in the game page, common props, mask, avif

**Files:**
- Modify: `engine/game/scenes/src/runtime.ts:70-85` (resize after `createScenes`; `app.renderer.on('resize', …)` with `ctx.effect` off — the fake in tests may lack `renderer`: guard with `?.`), `engine/game/scenes/src/common-schema.ts` (six props), `engine/game/scenes/src/node-types.ts:73` (`applyCommon`: order `position → scale → width/height → rotation → alpha → visible → tint → anchor(X/Y)`; `tint` only when `'tint' in view`), `engine/game/scenes/src/scenes.ts` (`mountNode`: after `parent.addChild(view)`, `if (props.mask) parent.mask = view`; `unmountTop`/child unmount: `if (parent.mask === view) parent.mask = null`), `engine/game/scenes/src/builtin.ts` (`IMAGE_EXTENSIONS` + `'avif'`), `engine/game/scene-edit/src/gizmo.ts:112-169` (`baseOf` reads `width`/`height` presence from the node's props — the gizmo gets `props` today; on a scale drag emit `{ width: w * f }` and/or `{ height: h * f }` when set, else `{ scale }`), `engine/ide/client/src/plugins/viewers-media.tsx:7` (`.avif`), `engine/ide/host/src/plugins/scenes.ts:67` (derived from `COMMON.dict` — verify nothing else lists the names; `engine/ide/client` may have its own list for the Properties form — grep `'anchor'`)
- Test: `engine/game/scenes/tests/runtime.test.ts` (extend: fake app `screen` 640×360, design 480×288 → `scenes.container.scale.x` = 4/3; a `resize` event re-fits), `tests/node-types.test.ts` (extend: `applyCommon` each new prop; `width` alone leaves `scale.y`), `tests/mount.test.ts` (extend: `mask: true` child → `parent.mask === view`; unmount clears), `engine/game/scene-edit/tests/gizmo.test.ts` (extend: a scale drag on `{ width: 100 }` emits `width`), `engine/ide/host/tests/scenes.test.ts` (extend: a node with `width`/`tint`/`mask` passes the check), `engine/ide/client/tests/*` (the Properties common form renders the new fields — extend `properties-sidebar.test.tsx`)

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/scenes -w @energy8engine/scene-edit -w @energy8engine/ide-host -w @energy8engine/ide-client` green; typecheck. Commit `Scenes fit their design in the game page; width, height, tint, anchors, mask`.

---

### Task 4: `strip` and `shape` node types

**Files:**
- Create: `engine/game/node-media/src/strip.ts`; Modify: `engine/game/node-media/src/{runtime,index}.ts` (register; export), `engine/game/scenes/src/builtin.ts` (`shape`; registered by the runtime beside `container/image/scene`)
- Test: `engine/game/node-media/tests/strip.test.ts` (a fake loader answering a 64×16 `Texture` → `cols: 4` gives four 16×16 frames with the right `frame.x`; `frames: 3` of a 2×2 → three; `playing: false` stops; `once` resolves on completion and on destroy; placeholder before load; `update` re-slices when `cols` changes), `engine/game/scenes/tests/node-types.test.ts` or a new `shape.test.ts` (each kind's local bounds; `fill: ''` draws stroke only; `update` redraws to new size)

Implementation notes: `strip.update` keeps the last `(source, cols, rows, frames)` on the view (a `WeakMap` or a symbol property) to skip re-slicing; frames are `new Texture({ source: base.source, frame: new Rectangle(c * w, r * h, w, h) })` with `w = Math.floor(base.width / cols)`, `h = Math.floor(base.height / rows)`; destroy old sliced textures (`texture.destroy(false)`) on re-slice and unmount. `shape.mount` returns a `Graphics`; `update` calls `clear()` then draws: `rect(0,0,w,h)` / `roundRect(0,0,w,h,r)` / `circle(0,0,r)` / `ellipse(0,0,w/2,h/2)`; `fill({ color, alpha })` when `fill`; `stroke({ color, width })` when `stroke && strokeWidth > 0`. Colours parsed with pixi `Color`.

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/node-media -w @energy8engine/scenes` green; typecheck. Commit `strip and shape nodes`.

---

### Task 5: Prove it in a browser

**Files:**
- Modify: `engine/examples/first-slot/src/main.ts` ≡ `engine/templates/slot-basic/src/main.ts` (`__e8.stageScale(): number | null` = `scenes.container.scale.x` — read `scenes` leniently; `nodeProps` gains `width`, `height`, `tint` (the view's `tint` as a number)); `engine/ide/host/tests/template.test.ts` stays green
- Create: `engine/apps/web/tests/e2e/contract.spec.ts` (harness from `fx.spec.ts`: write the project copy's files BEFORE `startDevHost`): (1) `flow.yml` with `spin { betLevel: 5 }` → `__e8.spin()` then `__e8.spinLog()`'s last entry `request` has `betLevel: 5` (check what `present` records as `request` — slice 19 records `{}`; extend `present` to record `vars.request` set by `spin` (`spin` returns `vars: { result, request }`) — a one-line change in `kinds.ts`, with a unit test in Task 2's file); (2) `e8.patch.yml` `renderer1` 640×360 → `__e8.stageScale()` → `1.3333` (±0.01) and `nodeProps('base_game','logo').x === 240`; (3) `base_game.scene.yml` with a `shape` node `{ kind: circle, radius: 20, fill: '#00ff00' }` and `logo` with `width: 100, height: 50, tint: '#ff0000'` → `nodeProps` reports `{ width: 100, height: 50, tint: 0xff0000 }` and `nodeVisible('base_game','disc')` true.
- Modify: premises in existing specs if any read `nodeProps`' shape or the common form's field count.

- [ ] **Step 1:** the hooks + specs. **Step 2:** `cd engine/apps/web && npx playwright test tests/e2e/contract.spec.ts` green (ports free). **Step 3:** commit `Prove the widened contracts in a browser`.

---

## Self-review

- Spec coverage: §3 T1; §4 T2 (+T5's `request` record); §5, §6, §8 avif T3; §7, §8 shape T4; §9 all.
- Types: `cellData` name in T1 and T5; `validateFlow` 4th param in T2 only; `nodeProps` fields T5 ↔ spec §9.
