# Asset sets, and the debts slice 31 left — implementation plan (slice 32)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `image`/`strip` can pick its art from a declared, preloaded set by a cell expression; and six debts close — a `$cell` with no cell, a required path outside `assets/`, a never-settling `wait: false` step, a non-blocking failure that failed the round, the `$cell` widening's sharp edges, and one source for the e2e host port.

**Architecture:** F4 is two ordinary props (`srcOf` a dict of asset paths, `srcKey` a string) plus one contract field (`assetMapProps`) for the host's check. It rides entirely on machinery that exists: `cellProps` already resolves `srcKey`, `assets()` already feeds the preload, `update` already runs on `bind`. The debts are local: two diagnostics in scenes, a cap and a severity rule in play-loop, one branch in flow's `present`, and one shared ports module in the web app.

**Tech Stack:** TypeScript, cordis 4, schemastery, pixi.js v8, vitest per package, Playwright (`engine/apps/web/tests/e2e`).

**Spec:** `docs/superpowers/specs/2026-09-23-asset-sets-and-debts-design.md`

## Global Constraints

- `packages/*` is never edited or staged. Never stage `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel` (the user's own working tree), `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.
- `@energy8engine/contracts` imports NOTHING foreign (`tests/purity.test.ts`).
- A string prop refuses an unquoted YAML scalar; `''` means "untouched". A value that cannot be resolved is a diagnostic on the node that owns it; the render continues with the prop's empty value.
- Every document written before this slice must behave exactly as it did (no `srcOf` → `src`, as today).
- Tests: one workspace per command. The `ide-host` suite spawns its own headless Chromium (`compute-shot`) — run nothing alongside it. The Playwright suite runs ALONE, on `E8_E2E_HOST_PORT=5779` (the user's `e8 dev` holds 5679).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never `git stash`/`checkout`/`restore`; commit only your own listed files; retry a commit that hits `index.lock` after 2 s.

---

## File map

| Area | File | Change |
|---|---|---|
| scenes | `engine/game/scenes/src/node-types.ts` | `NodeType.assetMapProps?` |
| scenes | `engine/game/scenes/src/builtin.ts` | `image`: `srcOf`, `srcKey`, the pick, `assets()` |
| node-media | `engine/game/node-media/src/strip.ts` | the same on `strip` |
| scenes | `engine/game/scenes/src/common-schema.ts` | `cellProps`: the object/NaN warnings |
| scenes | `engine/game/scenes/src/scenes.ts` | the no-cell warning at mount; `require`'s outside-`assets/` warning |
| ide-host | `engine/ide/host/src/plugins/scenes.ts` | check `assetMapProps` values |
| contracts | `engine/core/contracts/src/protocol.ts` | `NodeTypeInfo.assetMapProps?` (what the game reports to the host) |
| play-loop | `engine/game/play-loop/src/{index,runtime,schema}.ts` | `pendingMs` cap; non-blocking failure → `warning` |
| flow | `engine/game/flow/src/kinds.ts` | `present` fails only on an `error` |
| web | `engine/apps/web/e2e-ports.ts` (new), `vite.config.ts`, `tests/e2e/project-fixture.ts` | one source for the ports |
| example | `engine/examples/first-slot/**`, `engine/templates/slot-basic/**` | the orb as one document with a set |
| e2e | `engine/apps/web/tests/e2e/symbols.spec.ts` | the art swaps with the key |

---

### Task 1: The asset set — `srcOf` / `srcKey` on `image` and `strip`

**Files:**
- Modify: `engine/game/scenes/src/node-types.ts`, `engine/game/scenes/src/builtin.ts`, `engine/game/node-media/src/strip.ts`, `engine/core/contracts/src/protocol.ts`
- Test: `engine/game/scenes/tests/node-types.test.ts` (or a new `asset-set.test.ts`), `engine/game/node-media/tests/strip.test.ts`

**Interfaces:**
- Produces: `NodeType.assetMapProps?: string[]`; `NodeTypeInfo.assetMapProps?` (the report the game sends the host — find where `assetProps` travels in `protocol.ts` and add it beside); `image`/`strip` with `srcOf: Record<string, string>` (default `{}`) and `srcKey: string` (default `''`).

- [ ] **Step 1: Failing tests.** For `image` (use `builtin.ts`'s type directly with a fake `assetLoader` in `ctx`, as the existing image tests do — read them):
  - `assets({ src: 'a.png', srcOf: { g: 'g.png', b: 'b.png' }, srcKey: '' })` → `['a.png', 'g.png', 'b.png']` (order: `src` first, then the map's values in insertion order; `src: ''` omitted as today);
  - `mount` with `srcKey: 'b'` shows `b.png`'s texture; an unknown key and an empty key show `src`'s; no `srcOf` at all shows `src`'s;
  - `update` with a changed `srcKey` swaps the texture on the SAME view (no remount);
  - a map value equal to `src` is not listed twice by `assets()`.
  - `strip`: the same four for its `src` (its `update` slices frames per texture — read `framesOf`/`destroySliced` first; a key change must re-slice and play from frame 0, exactly as a `src` change does today).
- [ ] **Step 2: Run** `npm test -w @energy8engine/scenes`, `npm test -w @energy8engine/node-media` → FAIL.
- [ ] **Step 3: Implement.** One shared helper in `builtin.ts`, exported for `strip`:

```ts
/**
 * The path an asset-set node shows: the set's entry for the key, or the
 * plain prop. `srcKey` is an ordinary string prop — a `$cell` expression in a
 * symbol's state resolves before this runs — so an unknown key, an empty one
 * or no set at all falls back to what every document before the set had.
 */
export const pickFromSet = (src: string, srcOf: Record<string, string> | undefined, key: string): string =>
  (key && srcOf && Object.hasOwn(srcOf, key) ? srcOf[key] : '') || src;
```

`image`'s schema gains:

```ts
    srcOf: Schema.dict(Schema.string().extra('asset', IMAGE_EXTENSIONS))
      .default({})
      .description('alternative images by key — every one preloaded with the document'),
    srcKey: Schema.string()
      .default('')
      .description('which `srcOf` entry to show: a literal, or a `$cell` expression; unknown or empty → `src`'),
```

`mount`/`update` read `pickFromSet(props.src, props.srcOf, props.srcKey)`; `assets` returns `[...new Set([props.src, ...Object.values(props.srcOf ?? {})].filter(Boolean))]`; `assetMapProps: ['srcOf']`. `strip` the same (its extensions constant). `NodeType` in `node-types.ts` gains the field with the one-line doc from the spec §1.3; `NodeTypeInfo` in `protocol.ts` carries it to the host the way `assetProps` travels (find the serializer that builds `NodeTypeInfo` from a `NodeType` — it lives in `scenes` or `ide-bridge`; add the field there too).

- [ ] **Step 4: Run** scenes, node-media, contracts (purity), ide-bridge if you touched it; typecheck each.
- [ ] **Step 5: Commit** `git add <the files> && git commit -m "Scenes: an image or a strip can pick its art from a declared, preloaded set"`

---

### Task 2: The host checks the set

**Files:**
- Modify: `engine/ide/host/src/plugins/scenes.ts` (and `symbols.ts` if a symbol state's node goes through its own check — read it)
- Test: `engine/ide/host/tests/scenes.test.ts`

**Interfaces:**
- Consumes: `NodeTypeInfo.assetMapProps` (Task 1).

- [ ] **Step 1: Failing tests:** a `srcOf` value naming a file not in the project → `image.srcOf.<key> "<path>" is not in the project`; a value mentioning `$cell` → the existing asset-prop refusal message, naming `srcOf.<key>`; a non-string value → refused; a good map → clean; `srcKey: '$cell.band'` in a CELL scene → clean, in an ordinary scene → the existing cell-scene refusal (it is an ordinary bound prop).
- [ ] **Step 2: Run** `npm test -w @energy8engine/ide-host -- scenes` → FAIL.
- [ ] **Step 3: Implement.** Beside the `for (const prop of info?.assetProps ?? [])` loop, a second loop over `info?.assetMapProps ?? []`: the prop must be a plain object (else refuse), and each entry goes through the same three checks the asset-prop loop applies (string, not `$cell`, `hasFile`). Factor the per-value check into one local so both loops share it — do not copy the three branches.
- [ ] **Step 4: Run** the scenes file, then the full `npm test -w @energy8engine/ide-host` ALONE; typecheck.
- [ ] **Step 5: Commit** `git add engine/ide/host && git commit -m "Host: every entry of an asset set is checked like an asset prop"`

---

### Task 3: The scenes-side debts — no cell, the sharp edges, a path outside `assets/`

**Files:**
- Modify: `engine/game/scenes/src/scenes.ts`, `engine/game/scenes/src/common-schema.ts`
- Test: `engine/game/scenes/tests/cell.test.ts`, `engine/game/scenes/tests/require.test.ts`, `engine/game/scenes/tests/mount.test.ts`

- [ ] **Step 1: Failing tests:**
  - (§2.1) an ordinary `show()` of a document with `text: 'x{$cell.mv}'` reports ONE `warning` at `<scene>/<node>` (`"text" reads $cell, but this document was not mounted for a cell`, fix `only a symbol state's own document is mounted per cell`); a second `show` after a `hide` does not report again for the same node+prop (read how the diagnostics service collapses — assert what the service stores, not the raw `report` calls); a `mountCell` never reports it; a `bind` never reports it.
  - (§2.5) with data, a bound `string` prop resolving to an object → `warning` `"text" resolved to an object; name a field` and the empty; a bound `number` prop resolving to `NaN` → `warning` naming the prop and, in the fix, the non-identifier-field cause; a bound `string` prop resolving to `NaN` → no report, renders `'NaN'`.
  - (§2.2) `require(['plugins/x/art.png'])` → one `warning` at `assetLoader`, `"plugins/x/art.png" is outside assets/ — a built dist will not carry it`; the path is still requested (dev must keep working); `require(['assets/ok.png'])` → silent; the same offending path required twice → one warning.
- [ ] **Step 2: Run** `npm test -w @energy8engine/scenes -- cell require mount` → FAIL.
- [ ] **Step 3: Implement.** §2.1 in `mountNode` (the place `resolveCell` runs without a cell): when `bound` is non-empty and there is no cell, report once per `where`+prop (a `Set` on the scenes instance keyed `${where}:${prop}`). §2.5 in `cellProps`, after `resolveValue` and before the coercion, through its `report` parameter. §2.2 in `requireAssets`, before enqueuing: `!p.startsWith('assets/')` → report once per path (a `Set`).
- [ ] **Step 4: Run** scenes, symbols (it consumes `cellProps`); typecheck both.
- [ ] **Step 5: Commit** `git add engine/game/scenes && git commit -m "Scenes: a \$cell with no cell, an object or a NaN, and a path outside assets/ all say so"`

---

### Task 4: The play-loop debts — the cap, and a non-blocking failure is a warning

**Files:**
- Modify: `engine/game/play-loop/src/index.ts`, `engine/game/play-loop/src/runtime.ts`, `engine/game/play-loop/src/schema.ts`, `engine/game/flow/src/kinds.ts`
- Test: `engine/game/play-loop/tests/execute.test.ts`, `engine/game/play-loop/tests/runtime.test.ts`, `engine/game/flow/tests/kinds.test.ts`

**Interfaces:**
- Produces: `executePlan(plan, board, registry?, opts?, hooks?, limits?: { pendingMs?: number })` — or fold `pendingMs` into an existing options object if `executePlan` already takes one that fits; say which. `Config.pendingMs` (default 30000, 0 disables).

- [ ] **Step 1: Failing tests** (fake timers):
  - a `wait: false` step that never settles: with `pendingMs: 1000`, `executePlan` resolves after 1000 ms with one `error` `step "<kind>" did not settle in 1 s` at the index it started at; with `pendingMs: 0` it stays pending (assert not settled after a long advance);
  - two pending steps, one settles in time → only the other reported;
  - a step that rejects AFTER the cap fired → nothing new lands and no unhandled rejection (vitest fails on one);
  - a `wait: false` step that REJECTS in time → a `warning` (not `error`) `step "<kind>" failed: …`; a BLOCKING step's failure stays an `error`;
  - the row reads `pendingMs` from its config (a composed row with `{ pendingMs: 50 }`).
  - flow's `present`: a plan whose only problems are warnings leaves by `next` and `play.record` gets the PLAN (not `[]`); an `error` still leaves by `failed` with `[]`.
- [ ] **Step 2: Run** `npm test -w @energy8engine/play-loop`, `npm test -w @energy8engine/flow -- kinds` → FAIL.
- [ ] **Step 3: Implement.** In `executePlan`: the non-blocking `failed(...)` path pushes a `warning` (the blocking path keeps `error`) — the existing `failed` helper takes a severity; the end-of-plan `await Promise.all(pending)` becomes a race against `setTimeout(pendingMs)` when `pendingMs > 0`, tracking which entries settled so the timeout names only the rest; clear the timer on the fast path. `runtime.ts` passes the row's `pendingMs` through `PlayService.execute`. `schema.ts` gains `pendingMs: Schema.natural().default(30000).description(...)`. In `flow`'s `present`: `const fatal = problems.some((d) => d.severity === 'error')` drives both `failed` and the `[]` in `play.record`; the warnings are still reported (they already are, through `reportAll`).
- [ ] **Step 4: Run** play-loop, flow, flow-fx (it composes flow); typecheck all three.
- [ ] **Step 5: Commit** `git add engine/game/play-loop engine/game/flow && git commit -m "Play loop: a plan releases after a step that never settles, and a non-blocking failure does not fail the round"`

---

### Task 5: One source for the e2e ports

**Files:**
- Create: `engine/apps/web/e2e-ports.ts`
- Modify: `engine/apps/web/vite.config.ts`, `engine/apps/web/tests/e2e/project-fixture.ts`, and every spec that imports the port from the fixture (keep their import working — the fixture may re-export it)
- Test: `engine/apps/web/tests/e2e-ports.test.ts` (a vitest unit test in the web app — check the app runs vitest; if it does not, a `tsc`-checked type assertion plus a one-line node script is acceptable, say which)

- [ ] **Step 1:** `e2e-ports.ts` exports `IDE_HOST_PORT = Number(process.env.E8_E2E_HOST_PORT ?? 5679)`, `IDE_WEB_PORT = 5680`, `IDE_HMR_PORT = 5690`, each with a one-line doc. No imports.
- [ ] **Step 2:** `vite.config.ts` and `project-fixture.ts` import from it; the fixture re-exports `IDE_HOST_PORT` so the specs that import it from the fixture need no edit.
- [ ] **Step 3:** The test: both resolve the same number with and without the env var set (spawn a child `node` with `E8_E2E_HOST_PORT=6123` if the module is evaluated at import time — or export a `resolveHostPort(env)` and test that; pick the one that stays honest and say which).
- [ ] **Step 4:** `npm run typecheck -w @energy8engine/ide-web`, the web app's own unit tests if it has them.
- [ ] **Step 5: Commit** `git add engine/apps/web/e2e-ports.ts engine/apps/web/vite.config.ts engine/apps/web/tests && git commit -m "Web: the e2e ports have one source"`

---

### Task 6: The example and the browser proof

**Files:**
- Modify: `engine/examples/first-slot/scenes/orb.scene.yml` + the template twin; whatever makes a cell carry a band (see Step 1); `engine/apps/web/tests/e2e/symbols.spec.ts`
- Test: `npm test -w @energy8engine/ide-host -- template`; `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test symbols.spec.ts` (ALONE)

- [ ] **Step 1: Where the band comes from.** `first-slot`'s math hands the board as `[[int]]`, so no cell carries a `band`. Honest options, pick one and say why: (a) the `reel-step` project plugin's mechanic (`engine/examples/first-slot/plugins/reel-step/src/mechanic.ts`) wraps symbol `'6'` as a `BoardCell` `{ symbol: '6', band: <derived from its position, e.g. ['green','blue','purple','red'][row % 4]> }` — a deterministic, testable band with no math change; or (b) the orb's `srcKey` is a literal and the e2e flips it through the IDE (weaker: it proves the pick, not the binding). Prefer (a).
- [ ] **Step 2: The orb.** `orb.scene.yml` (both trees, byte-identical): the `art` node gains `srcOf` with four entries and `srcKey: '$cell.band'`. The four images: use four DISTINCT existing files under `assets/symbols/` (e.g. `1.png`…`4.png`) — the point is that the texture differs by band, not that the art is pretty. Keep `src` as the fallback.
- [ ] **Step 3: The e2e case.** After a spin, two `'6'` cells in different rows report DIFFERENT textures (add or reuse an `__e8` hook returning the cell view's first sprite's texture `label`/source URL — read `cellArt`/`cellText`/`loaded` in `main.ts`, both trees), and each matches the band the mechanic assigned its row. Say in the report how you verified the case fails without the `srcOf` pick.
- [ ] **Step 4: Run** the byte-pin; the reel-step plugin's own tests; `symbols.spec.ts` ALONE on 5779; remove any leaked `engine/examples/e8-compose-*`.
- [ ] **Step 5: Commit** `git add engine/examples/first-slot engine/templates/slot-basic engine/apps/web/tests/e2e && git commit -m "Example: the orb picks its art by band from one document"`

---

## Self-review (done while writing)

- Spec §1 → Tasks 1, 2, 6; §2.1/§2.2/§2.5 → Task 3; §2.3/§2.4 → Task 4; §2.6 → Task 5.
- Names across tasks: `pickFromSet`, `assetMapProps` (T1 → T2), `pendingMs` (T4), `IDE_HOST_PORT` (T5 → the fixture's re-export).
- Order: T1 first (T2 needs `assetMapProps`, T6 needs the set); T3, T4, T5 are independent of T1 and of each other — but T3 and T1 both touch `engine/game/scenes/src` (`builtin.ts`/`node-types.ts` vs `scenes.ts`/`common-schema.ts`): different files, parallel is fine. T6 last, alone.
- No task edits `packages/*` or `engine/examples/paper-duel`.
