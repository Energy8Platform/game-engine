# Game Rows Editable, Hot Fork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Composition screen a game row (`reels1`, `renderer1`, `stage1`, `mechanics1`) shows a form built from the runtime half's schema; a change lands in `e8.patch.yml`, reaches the running game, and — for a hot row — re-applies that row's fiber without a reload, so the spin log and session survive; a cold row (or a `restart` field) reloads the preview.

**Architecture:** Runtime packages export a pure schemastery `Config` from `./schema` (manifest `e8.runtime.schema`); the host reads it into `GameCompositionRow.schema`/`.hot`. `PUT /api/composition/rows/:id` writes the patch atomically, reloads the project, decides `reload` from `hot` + changed `applies: 'restart'` fields, and broadcasts `{ type: 'game-composition', rows, reload, changed }` to every `/ide` socket. The client's `gameComposition` plugin follows the frame; `PreviewWall` reloads on `reload: true`. `createGame` keeps a fiber per row and provides `gameRows.update(id, config)`; `ide-bridge` applies `changed` rows on `reload: false` frames.

**Tech Stack:** schemastery 3.18, cordis `Fiber.update`, js-yaml, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-game-rows-editable-hot-fork-design.md`

## Global Constraints

- Schema modules under `./schema` import ONLY `schemastery` (a test greps their imports).
- `hot`: `mechanics1` and `reels1` true; `renderer1`, `stage1` false. `applies: 'restart'` on: `renderer` `width`/`height`/`background`, `stage` `design.*` (cold rows anyway — still marked, so the badge shows), none on reels/mechanics.
- `reload` decided on the host only: `!row.hot || changedTopLevelKeys.some(k => schema says applies === 'restart')`.
- Patch write is atomic (temp file + `rename`), replaces the row's `config` wholesale, appends a row `{ id, config }` when absent; comments are not preserved (stated in the writer's doc and in `first-slot`'s patch header comment — move the header's prose into `engine/examples/first-slot/README.md` in Task 2).
- `PUT`s serialize on one chain.
- The game never reloads itself; only the IDE reloads the iframe.
- `first-slot/src/main.ts` and `engine/templates/slot-basic/src/main.ts` stay byte-identical (template test) — change both.
- Every assertion with a mutation confirmed LANDED by before/after count on the ORIGINAL file.
- Playwright ALONE; `pgrep -fl e8-server | grep -v pantheon` before/after; `engine/examples` = three shipped; no `.e8/`, no `e8-compose-*`.
- Shell zsh; no trailing `#`; nothing under `packages/`; prettier clean.

---

## File map

| Task | Files |
|---|---|
| 1 | `engine/core/contracts/src/{manifest,project,protocol}.ts`; `engine/game/{reels,renderer-pixi,stage,runtime}/src/schema.ts` + `package.json` (exports, `e8.runtime.schema`, `hot`, `schemastery` dep); `engine/ide/host/src/plugins/runtime-assets.ts` (schema + hot on rows); tests |
| 2 | `engine/ide/host/src/plugins/project.ts` (`writePatchRow`), `runtime-assets.ts` (`PUT`, `reload`, broadcast), `rpc.ts` (`broadcastGameComposition`); `first-slot/README.md`; tests |
| 3 | `engine/ide/client/src/plugins/game-composition.tsx` (socket, `update`), `src/screens/CompositionScreen.tsx` (forms for game rows), `src/screens/PreviewWall.tsx` (`reload`); tests |
| 4 | `engine/game/runtime/src/index.ts` (fibers, `gameRows`), `engine/game/loader/src/index.ts` (return fibers), `engine/game/ide-bridge/src/index.ts` (frame → update), `engine/examples/first-slot/src/main.ts` + template (`board` read lazily); tests |
| 5 | `engine/apps/web/tests/e2e/hot-fork.spec.ts` |

---

### Task 1: Runtime halves have a schema, and the host serves it

**Files:** contracts: `E8RuntimeHalf.schema?: string`, `GameCompositionRow.schema: unknown | null`, `GameCompositionRow.hot: boolean`; `engine/game/reels/src/schema.ts`: `Config = Schema.object({ config: Schema.object({ grid: Schema.object({ cols: Schema.natural().default(5), rows: Schema.natural().default(3) }) }).description('reel grid') })` — plus every other key `first-slot`'s patch or `main.ts` passes to `createReelSystem` as `Schema.any()` fields named after them (measure `CreateReelSystemOptions` keys used by the patch: `config.grid` at minimum; the resolver is a service, not config); `renderer-pixi/src/schema.ts`: `width`, `height` (`Schema.natural()`), `background` (`Schema.string()`), each `.extra('applies', 'restart')` — measure how the client half's schema-form reads `applies` (`SchemaForm.tsx`/`fields.ts` `needsRestart`) and produce the same shape; `stage/src/schema.ts`: `design: { width, height }` restart; `runtime/src/schema.ts` (for `mechanics1`, package `@energy8engine/game-runtime`): `stages: Schema.dict(Schema.string())`. Each package: `"exports": { …, "./schema": "./src/schema.ts" }`, `"e8": { "runtime": { "entry", "schema": "./src/schema.ts" }, "hot": <per constraints> }`, `schemastery` dependency. `runtime-assets.ts`: for each row with a runtime half, if `manifest.e8.runtime.schema` → `import(pathToFileURL(resolved).href)` (the host runs under tsx, `.ts` imports work — measure), `Config.toJSON()` → `schema`; failure → `schema: null` + a row diagnostic (`plugin: row.name`, `where: 'schema'`); `hot: manifest.e8.hot === true`.

- [ ] Tests (red first): contracts typecheck; a test per schema module: `import { Config } from '@energy8engine/reels/schema'` → `new Schema(Config.toJSON())` accepts `first-slot`'s patch config for that row (`Config(patchConfig)` does not throw) and rejects a wrong type; a grep test that each `schema.ts` imports only `schemastery`; `runtime-assets.test.ts`: `/api/composition` rows carry `schema` (non-null for the four, `null` for `spinlog1`) and `hot` (true for `reels1`/`mechanics1`, false for `renderer1`/`stage1`); a package whose `schema` path is missing → `schema: null` + diagnostic; the `applies: 'restart'` meta survives `toJSON` → `new Schema(json)` (assert on `.dict.width.meta.extra.applies` or wherever `needsRestart` looks).
- [ ] Mutations: `hot` read dropped → red; schema import path wrong → diagnostic test red; restart meta dropped → red.
- [ ] Suites: contracts, each game package, ide-host; typecheck; commit — "Let a runtime half say what its config is, and whether it is hot"

---

### Task 2: A row's config is written to the patch, and everyone hears

**Files:** `project.ts`: `writePatchRow(id, config): Promise<Diagnostic[]>` (load `e8.patch.yml` via js-yaml — empty/missing → `{ rows: [] }`; find row by `id` → replace `config`; absent → push `{ id, config }`; `yaml.dump({ rows }, { lineWidth: -1 })`; write `<file>.tmp` + `rename`; parse failure → diagnostic, file untouched); `runtime-assets.ts`: `PUT /api/composition/rows/:id` on the ROOT server (IDE origin; serialize with a promise chain): body `{ config }` object else 400; row not in `ctx.project.composition.rows` → 400; `writePatchRow` → 500 on diagnostics; `await ctx.project.reload(); await ctx.spinSchema.reload();` recompute rows (the existing `composition` handler's row builder — extract `buildRows()`); `reload` = `!row.hot || changed(prevConfig, nextConfig).some(k => restartKeys(schema).has(k))` where `changed` = top-level keys whose JSON differs and `restartKeys` reads the schema JSON's per-field `applies` (same reader `needsRestart` uses — put a tiny shared helper in contracts or duplicate 6 lines, say which); respond `{ rows, reload, diagnostics }`; `ctx.ideRpc.broadcastGameComposition({ rows, reload, changed: [id] })` → frame to every socket (root + preview, `attach`ed servers share the client set). Contracts: `ServerMessage += { type: 'game-composition'; rows: GameCompositionRow[]; reload: boolean; changed: string[] }`. `first-slot/README.md`: the patch header's prose (the "two things have no home here" note) moves there; the patch keeps a one-line comment "rewritten by the IDE; comments do not survive".
- [ ] Tests: `project.test.ts` `writePatchRow` (replace, insert, missing file, atomicity — a `.tmp` never left behind on failure, parse failure → untouched bytes); `runtime-assets.test.ts` `PUT`: 200 with the new config in `rows`, disk updated, `reload` for the three cases (cold row; hot row non-restart field; hot row restart field — use `renderer1` width for cold, `reels1` grid for hot/no-restart; for "hot + restart" craft a fixture package with `hot: true` and one restart field), 400 unknown/bad body, 500 on write failure (patch dir read-only — `skipIf` root); two concurrent `PUT`s → both applied, second sees first (chain); `rpc.test.ts`: the frame reaches a root socket AND a preview socket.
- [ ] Mutations: `reload` always false → red; wholesale replace → merge → red; `rename` skipped → atomicity red; frame not sent to preview → red.
- [ ] Commit — "Write a row's config to the patch, and tell the IDE and the game"

---

### Task 3: The IDE edits game rows and follows the frame

**Files:** `game-composition.tsx`: own `/ide` socket (pattern of `workspace`), `game-composition` frames replace `rows` + notify; `update(id, config): Promise<{ reload: boolean; diagnostics }>` → `PUT`; refusals reported. `CompositionScreen.tsx` `GameComposition`: each row with `schema` renders `<SchemaForm schema={new Schema(row.schema)} value={row.config} onChange={(next) => ctx.gameComposition.update(row.id, next)} />` (the same component the IDE rows use; `needsRestart` badge appears automatically); a row without schema stays name + layer; a `hot: false` row shows a muted `cold` badge next to the name (`data-testid="row-<id>-cold"`). `PreviewWall.tsx`: drop `coldSignature`; subscribe to `gameComposition`; a frame with `reload: true` → `reloadNonce++` (remount); `false` → nothing.
- [ ] Tests: `game-composition.test.ts` (socket frame → rows; `update` PUT + refusal report); `composition-screen.test.tsx` (form for a row with schema, none without, cold badge, restart badge on `width`, `onChange` → `update`); `preview.test.tsx` (frame `reload: true` remounts; `false` keeps the element; the old `coldSignature` tests rewritten — list-or-property: the property "cold change reloads" now lives on the host's `reload`; the client test pins "follows `reload`").
- [ ] Mutations per assertion. Commit — "Edit a game row from the Composition screen, and reload only when the host says so"

---

### Task 4: The game keeps its rows' fibers and updates the hot ones

**Files:** `engine/game/loader/src/index.ts` `composeFromProject`: return `{ diagnostics, fibers: Map<rowId, Fiber> }` (or accept an `onApplied(rowId, fiber)` callback — pick the smaller change; the loader's return type is used by `createGame` and tests — measure); `engine/game/runtime/src/index.ts`: keep the map; `ctx.provide('gameRows', { update(id, config) { const f = fibers.get(id); if (!f) return 'unknown'; f.update(config); return 'updated'; } })`; `ide-bridge/src/index.ts`: on `{ type: 'game-composition', reload: false, changed, rows }` → for each `changed` id → `gameRows.update(id, rows.find(r => r.id === id).config)`; `reload: true` → ignore; the existing `snapshot` handling untouched. `reels/src/runtime.ts`: nothing to change if `fiber.update` re-runs `apply` after the effect disposer (`board.destroy()`), and `ctx.provide('board')` twice on the same ctx across a restart is allowed (measure with a unit test: `fiber.update({config:{grid:{cols:6,rows:3}}})` → `ctx.board` is a NEW object with 6 cols, old destroyed). `first-slot/src/main.ts` + template: `board` read at spin time (`game.ctx.board` inside the spin handler, via the same `need()` shape — keep the boot-time `need` for the diagnostic, but call `execute(plan, currentBoard())`); `stage`'s `addChild(board.view)` — the new board's view is added by the re-run `ctx.inject(['stage'])`; the old view removed by `board.destroy()`? measure (`destroy` detaches from parent in Pixi if `removeChildren`… assert `stage.container.children.length` stays 1 after an update).
- [ ] Tests: runtime `gameRows.update` (`updated`/`unknown`; `fiber.update` called with the config); `ide-bridge` frame handling (fake socket; `reload: true` → no update; `changed` order); `reels` hot re-apply (new board, old destroyed, stage children count 1); `main.ts` change pinned by the template byte-identity test (both files change together).
- [ ] Mutations: `gameRows` uses the stale first fiber map → red; `ide-bridge` ignores `changed` → red; main.ts captured board → the e2e in Task 5 (unit: a fake `board` swap test in `first-slot` is heavy — the e2e carries it).
- [ ] Commit — "Keep every row's fiber, and re-apply the hot ones in place"

---

### Task 5: Prove it in a browser

**Files:** `engine/apps/web/tests/e2e/hot-fork.spec.ts`.
1. Composition: `row-reels1` has a form (an input for `cols`), `row-renderer1` has the `restart` badge on width and the `cold` badge; `row-spinlog1` has no form.
2. Hot: open the preview, spin once (`frame.locator('#spin').click()`, wait `done`), read `window.__e8` spin-log length N; change `reels1` grid `cols` 5 → 4 in the form (blur to commit); wait for the frame's board to report 4 columns via RPC (`window.__e8` — measure what it exposes; if nothing exposes the grid, expose `boardSize()` in `main.ts` next to the existing replay hook); assert the iframe element is the SAME (handle identity via `evaluateHandle` before/after, or a `data-nonce` attribute PreviewWall sets from `reloadNonce`); spin-log length still N; spin again → N+1; `e8.patch.yml` on disk has `cols: 4`.
3. Cold: change `renderer1.width` → the iframe remounts (nonce changes), `#status` returns to `ready`, spin-log length 0 (a fresh page).
4. Regression: `bridge1` mechanic switch still rebinds live (`runtime.spec.ts` covers; do not duplicate — reference).
Mutations landed by count: host `reload` forced false → test 3 red; `ide-bridge` frame handling dropped → test 2 (4 columns never) red; `main.ts` board captured (revert the lazy read) → test 2's second spin fails/`presentation failed` red.
Then the whole suite → 87 + 3 = 90/90.

---

## Self-review
- Spec §2 rows → T1 (schema location, who, hot flags), T2 (edit → write → reload decision → frame), T3 (client), T4 (game, reels hot, board lazy), T5 (session survives). §3 wire → T1/T2 contracts. §4 refusals → T1 (schema null), T2 (400/500/atomic), T4 (`unknown`). §6 risks → T4 measurement steps, T2 README move, T1 `Schema.any()` fields.
- Type consistency: `GameCompositionRow.schema/hot` (T1) read by T2's `reload` and T3's form; frame shape (T2) consumed by T3 and T4 verbatim.
