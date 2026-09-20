# Text, Live Props and Taps Implementation Plan (slice 24)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Numbers reach the canvas — a `text` node type, a `prop` flow kind that patches a mounted node's props live through `scenes.setProps`, `$cell.<field>` bindings in symbol states applied when the reels land, and `ui.tap` from the stage — with `first-slot` showing its win.

**Architecture:** `text` is a scenes builtin over pixi `Text`/`BitmapText`. `scenes.setProps(ref, patch)` keeps a per-entry live patch merged over the document props, re-validated by the type schema, applied through `update` + `applyCommon`, dropped on remount; the `prop` kind resolves `$path` values and coerces literals by the target's schema. The symbols runtime resolves `$cell.*` props on `bind(data)`; the reels board binds every landed cell. The scenes runtime emits `ui.tap` on the flow bus from a stage `pointerdown`.

**Tech Stack:** cordis 4.0.0-rc.8, pixi.js 8.20.1 (`Text`, `BitmapText`, `BitmapFont`), schemastery, `@energy8engine/*`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-text-and-props-design.md`

## Global Constraints

- `text` props EXACTLY: `text ''`, `size 24`, `family 'sans-serif'`, `fill '#ffffff'`, `weight normal|bold`, `align left|center|right`, `stroke ''`, `strokeWidth 0`, `wrap 0`, `font ''` (asset fnt/xml → `BitmapText`); `assetProps: ['font']`, no `accept`, no `once`.
- `scenes.setProps(ref, patch): boolean` — merge over doc props + earlier patches, type schema re-validates (failure → diagnostic `<scene>/<node>` `prop <k>: <error>`, `false`), `type.update` + `applyCommon(view, merged, type)`; `refresh()` uses the merged props; a remount clears; unknown node → `false`.
- `prop` kind: `target` (required, pick `node`), `prop` (required), `value` (string default `''`; `$path` or literal coerced by the target prop's schema type: number → `Number`, boolean → `'true'`/`'false'`, else string); missing node/refusal → `report` + `next`; `outs: ['next']`; `validateFlow` WARNING on a literal `target` no scene document has (the host passes `<scene>/<node>` ids; `null` skips).
- Symbols: `'$cell.<field>'` strings in a state's props; `SymbolView.bind(data)` resolves them (missing → schema-typed empty: `''`/`0`/`false`) and re-runs `update`; unbound → the defaults; the host's `checkNode` and the symbols schema pass accept a `$cell.` string for any prop type.
- Reels: after `spinTo`/`refill`/`repaint` settle, `grid.getCell(c, r).view?.bind?.(cell.data)` for every cell (`GridLike` gains `cols`/`rows`; `CellLike` gains `readonly view`, `readonly data`).
- `ui.tap`: scenes runtime, `stage.eventMode = 'static'`, `hitArea = app.screen`, `pointerdown` → `events.emit('ui.tap', { x, y })` in design units, lenient.
- Example ≡ template: `base_game.scene.yml` `win` text node after `coin` (`text '' size 28 fill '#ffd166' x 240 y 260 anchor 0.5 align center`); `flow.yml` `show_win` (`prop`, `target base_game/win`, `prop text`, `value $result.win`, ui 940/240) between `draw` and `done` (`draw → show_win → done`); `main.ts` gains `__e8.nodeText(scene, node): string | null`; pins hold.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, nor the user's untracked `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`; the root lockfile is gitignored; no `git checkout`/`git stash` on files you did not create; never kill a process you did not start (the user's `e8 dev` holds 5681/5682); Playwright runs ALONE (one file per task; the full run is the controller's).
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Commands from the REPO ROOT: `npm test -w @energy8engine/<pkg>`; `npm run typecheck -w <pkg>`; e2e `cd engine/apps/web && npx playwright test tests/e2e/<file>`.

---

## File map

| Path | Responsibility |
|---|---|
| `engine/game/scenes/src/{builtin,scenes,runtime,node-types}.ts` | `text`, `setProps`, `ui.tap`, `$cell` acceptance in the schema pass (symbols only — see T3) |
| `engine/game/flow/src/{kinds,graph}.ts`; `engine/ide/host/src/plugins/flow.ts` | `prop`, node-target warning |
| `engine/game/symbols/src/{view,runtime}.ts` | `bind`, `$cell` resolution |
| `engine/game/reels/src/index.ts` | bind after landing |
| `engine/ide/host/src/plugins/scenes.ts` (`checkNode`) | `$cell.` strings valid |
| `engine/examples/first-slot/{scenes/base_game.scene.yml,flow.yml,src/main.ts,README.md}` ≡ `engine/templates/slot-basic/{same}` | fixture |
| `engine/apps/web/tests/e2e/text.spec.ts` | proof |

---

### Task 1: `text` node type, `scenes.setProps`, `ui.tap`

**Files:**
- Modify: `engine/game/scenes/src/builtin.ts` (`text`; registered by `runtime.ts` beside `container/image/scene/shape`; `OWN` in `scenes.ts` gains `text`), `engine/game/scenes/src/scenes.ts` (`setProps` on `ScenesService`; `live` patches; `refresh()` merged props; `remount`/`unmountTop` clear), `engine/game/scenes/src/runtime.ts` (the tap: after `createScenes`, `app.stage.eventMode/hitArea` and `app.stage.on('pointerdown', …)` → `ctx.reflect.get('events', false)?.emit('ui.tap', { x, y })` with `x/y` = `scenes.container.toLocal(event.global)`; `off` on dispose; guard a fake `app` without `stage.on`)
- Test: `engine/game/scenes/tests/text.test.ts` (new: mount/update/style/anchor; `font` branch with `BitmapFont.install` of a tiny font or a fake loader — measure what pixi 8 needs headlessly; if `BitmapText` cannot construct headless, test the branch selection only and say so), `tests/mount.test.ts` (extend: `setProps` cases per spec §9), `tests/runtime.test.ts` (extend: the tap on a fake stage emitter with a fake `events`; none without one)

**Produces:** `export const text: NodeType<TextProps>`; `ScenesService.setProps(ref, patch): boolean`; `ui.tap` on the flow bus.

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/scenes -w @energy8engine/symbols -w @energy8engine/scene-edit` green (symbols' `fit` reads `applyCommon`; scene-edit's stage handlers coexist with the tap); typecheck. Commit `A text node, live props on a mounted node, a tap on the stage`.

---

### Task 2: The `prop` flow kind

**Files:**
- Modify: `engine/game/flow/src/kinds.ts` (`prop` per Global Constraints; `BUILTIN_KINDS`; coercion reads the target's schema through `ctx.reflect.get('scenes')` — the runtime exposes the node's type schema: add `scenes.nodeSchema(ref): Schema | undefined` in Task 1's `ScenesService` if not present — coordinate: implement it HERE in scenes.ts as a one-liner `mounted.get(scene)?.nodes/all…type.schema` (the merged common+own dict is what coercion needs: `COMMON.dict` ∪ `type.schema.dict`)), `engine/game/flow/src/graph.ts` (`validateFlow`'s `sceneIds` param widens to `{ scenes: string[]; nodes: string[] } | null` OR a 5th param `nodeIds: readonly string[] | null` — pick the 5th param to keep callers untouched; WARNING `node "<target>" is not in any scene`), `engine/ide/host/src/plugins/flow.ts` (`nodeIds()` from the parsed scene trees — `sceneIds()` already parses them; return `<scene>/<node>` for every node, nested included)
- Test: `engine/game/flow/tests/kinds.test.ts` (extend: `$path` resolution; number/boolean/string coercion against a fake `scenes` with `nodeSchema`; missing node → report + next; refused → report + next), `tests/graph.test.ts` (extend: the warning; none for `$path`; none when `null`), `engine/ide/host/tests/flow.test.ts` (extend: the fixture's scene nodes feed the warning), `engine/ide/client/tests/flow-properties.test.tsx` (extend: the REAL `prop` schema renders `target` as the node select and `value` as text; the kinds list length updates in `runtime.test.ts`/host `flow.test.ts` as slice 23 did)

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/flow -w @energy8engine/ide-host -w @energy8engine/ide-client -- flow` green; typecheck. Commit `A flow sets a node's prop`.

---

### Task 3: `$cell` bindings in symbol states; the reels bind landed cells

**Files:**
- Modify: `engine/game/symbols/src/view.ts` (`bind(data)` on the view; `$cell.*` resolution at mount (defaults) and on `bind`; `SymbolHandle.bind`), `engine/game/symbols/src/runtime.ts` (nothing new unless the live set needs it), `engine/game/reels/src/index.ts` (`GridLike.cols/rows`, `CellLike.view/data`; `bindAll()` after `spinTo`/`refill`/`repaint`), `engine/ide/host/src/plugins/scenes.ts` (`checkNode`: a string value starting with `$cell.` passes any prop's schema — strip such keys before the schema call, the way `$path` values are not validated by the flow check), `engine/game/scenes/src/scenes.ts` (the symbols runtime calls the type schema itself — no runtime change; the SYMBOLS schema pass in `view.ts` strips `$cell.` keys before `type.schema`)
- Test: `engine/game/symbols/tests/view.test.ts` (extend per spec §9: text state bound/unbound; number prop missing → 0; bind twice), `engine/game/reels/tests/board.test.ts` (extend: fake grid cells with `view: { bind: vi.fn() }`/`data` → `bind` called per cell after each op; `repaint` mid-op defers the bind with the repaint), `engine/ide/host/tests/scenes.test.ts` (extend: a `$cell.multiplier` on a number prop passes)

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/symbols -w @energy8engine/reels -w @energy8engine/ide-host -- scenes` green; typecheck. Commit `A symbol's state reads its cell`.

---

### Task 4: Example, hooks, proof

**Files:**
- Modify: `engine/examples/first-slot/scenes/base_game.scene.yml` ≡ `engine/templates/slot-basic/scenes/base_game.scene.yml` (the `win` node), `flow.yml` ×2 (`show_win`; edges `draw → show_win`, `show_win → done`, the old `draw → done` removed), `README.md` ×2, `src/main.ts` ×2 (`__e8.nodeText(scene, node): string | null` — the view's `text` when it has one), `engine/apps/web/tests/e2e/flow.spec.ts` (premises: nine nodes; edge counts), `engine/apps/web/tests/e2e/canvas.spec.ts`/`scenes.spec.ts` (node order/count premises: `win` after `coin` — read them)
- Create: `engine/apps/web/tests/e2e/text.spec.ts` (spec §9's three cases; the tap case clicks the preview iframe's canvas centre with `page.mouse`/`frame.locator('canvas').click()`)

- [ ] **Step 1:** fixture + hooks + specs. **Step 2:** `cd engine/apps/web && npx playwright test tests/e2e/text.spec.ts tests/e2e/flow.spec.ts tests/e2e/canvas.spec.ts tests/e2e/scenes.spec.ts` green. **Step 3:** commit `The example shows its win; prove text, props and taps in a browser`.

---

## Self-review

- Spec coverage: §3 T1; §4 T1 (`setProps`) + T2 (`prop`, warning); §5 T3; §6 T1; §7 T2 (form test), T3 (`checkNode`); §8, §9 T4.
- Types: `setProps(ref, patch): boolean` (T1) used by T2; `nodeSchema` (T1/T2 — implemented in T2's scenes edit, one line); `bind(data)` (T3) called by reels (T3); `nodeText` (T4).
