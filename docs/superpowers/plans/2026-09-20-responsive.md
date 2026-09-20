# Responsive Layout Implementation Plan (slice 27)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The renderer follows its mount, nodes pin to the safe rect's edges and centre, a scene document carries a `portrait` variant the runtime applies and the editor edits — so `first-slot` fills any window and turns to portrait.

**Architecture:** `renderer-pixi` sizes the canvas to `mount` when no fixed size is configured (pixi `resizeTo` + `ResizeObserver`). `@energy8engine/scenes` fits the design into the viewport minus a safe area (an explicit `safeArea` service, else the shell's), exposes the safe rect in design units on `Fit`, recomputes pinned nodes' positions on every resize, and keeps a `portrait` overrides layer under the live `setProps` patches, re-resolved on an orientation flip. `scene-edit` draws the safe rect, writes offsets for pinned nodes and tags edits with the active variant; the IDE sizes the editor iframe to a viewport preset and writes portrait edits into `portrait.nodes`.

**Tech Stack:** pixi.js 8 (`Application.resizeTo`), cordis 4, schemastery, React (`SceneDocument.tsx`), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-responsive-design.md`

## Global Constraints

- `renderer1`: `width`/`height` both absent → the canvas follows `mount` (`resizeTo: mount`, `autoDensity: true`, `resolution: window.devicePixelRatio`, a `ResizeObserver` on `mount` calling `app.resize()`); both present → fixed as today; one present → diagnostic + fixed with the other defaulted to the design's aspect (say which in the report) — simplest legal behaviour, documented in the schema descriptions.
- Safe area: `ctx.reflect.get('safeArea', false)` (a `{ top, right, bottom, left }` service) wins; else `ctx.reflect.get('shell', false)?.safeArea`; else zeros. `Fit { scale, x, y, viewport: { left, top, right, bottom } }` — the safe rect in design units. The scenes row re-fits on the renderer's `resize`, on `shell` provided, and on the shell's own resize (`shell.on?.('resize')` is not a thing — re-fit on the renderer `resize` AFTER the shell handled it: subscribe after `shell` is provided, or read `safeArea` at every fit; either is fine, say which).
- `pin`: COMMON `union(['', 'top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'])` default `''`; `x`/`y` are offsets from the pin point of the safe rect; recomputed on every resize for every mounted entry whose `view.parent` is its document's root container; a pinned nested node → diagnostic `pin on a nested node "<id>" is ignored` (once per mount) and absolute placement.
- `SceneDoc.portrait?: { nodes: Record<string, Record<string, unknown>> }`; `scenes1.config.portrait?: { width, height }` (absent → the design rotated); `portrait = safeHeight > safeWidth` at every resize; on a flip every mounted entry re-resolves `document props ⊕ (portrait ? portrait.nodes[id] : {}) ⊕ live` through the type schema + `commonProps` (a refusal → diagnostic `<scene>/<id>: portrait <prop>: <why>` and the landscape props stay), then `type.update` + `applyCommon`, or `unmount`+`mount` for a type without `update`; `refresh()` and `assets()` use/collect both layers; `portrait.nodes` keys must be top-level ids (host warning, runtime diagnostic).
- Editor: viewport presets `design | 1280×720 | 390×844 | 844×390 | W×H`; the iframe is `width={vw} height={vh}` CSS-scaled to fit; the IDE appends `?safeBottom=<px>` (constants `SAFE_BOTTOM = { wide: <measured>, mobile: <measured> }` in the client, measured once on the example's real shell at 1280×720 and 390×844 through a scratch hook, the numbers noted in a comment); `editor.ts` ×2 provides `safeArea` from the URL; `scene-edit` draws the safe rect + a hatched bar band; gizmo drags on a pinned node emit the offset; every edit RPC carries `variant: 'portrait' | null` (portrait iff the editor page's safe rect is portrait — the page knows, the IDE trusts the payload); the IDE routes `variant: 'portrait'` edits (gizmo and Properties) into `portrait.nodes[id]`, marks overridden nodes `◐` in the tree, offers "clear portrait override".
- Example ≡ template (`template.test.ts` pins: `index.html` modulo `{{id}}` + the select block; `src/main.ts`, `src/editor.ts`, `flow.yml`, `scenes/*.scene.yml` byte-identical; `e8.patch.yml`/README as pinned by `project.test.ts`/`template.test.ts`).
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, the untracked `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`, nor anything under `engine/examples/paper-duel`; no `git checkout`/`git stash`/`git restore` on files you did not create (probe on a copy); never kill a process you did not start (the user's `e8 dev` holds 5681/5682/24678); Playwright runs ALONE (one file per task; the full run is the controller's).
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Commands from the REPO ROOT, ONE workspace per command: `npm test -w @energy8engine/<pkg>`; `npm run typecheck -w <pkg>`; e2e `cd engine/apps/web && npx playwright test tests/e2e/<file>`.

---

## File map

| Path | Responsibility |
|---|---|
| `engine/game/renderer-pixi/src/{index,runtime,schema}.ts` | follow the mount |
| `engine/game/scenes/src/{fit,scenes,runtime,common-schema,node-types}.ts` | safe rect, `Fit.viewport`, `pin`, the portrait layer |
| `engine/core/contracts/src/protocol.ts` | `SceneDoc.portrait` |
| `engine/ide/host/src/plugins/scenes.ts` | `checkNode` on `portrait.nodes`, `pin` on a child |
| `engine/game/scene-edit/src/{index,gizmo,frame?}.ts` | safe-rect frame, pin offsets, `variant` on edits |
| `engine/ide/client/src/shell/{SceneDocument,CanvasToolbar,ScenesSidebar,ScenesProperties}.tsx`, `canvas-rpc.ts` | presets, portrait writes, tree mark |
| `engine/examples/first-slot/{index.html,e8.patch.yml,scenes/base_game.scene.yml,src/main.ts,src/editor.ts,README.md}` ≡ `engine/templates/slot-basic/{same}` | fixture |
| `engine/apps/web/tests/e2e/responsive.spec.ts` | proof |

---

### Task 1: The renderer follows its mount

**Files:**
- Modify: `engine/game/renderer-pixi/src/index.ts` (`createPixiRenderer(options, mount?)`: when `options.width`/`height` are both absent and a `mount` is given → `app.init({ ...options, resizeTo: mount, autoDensity: true, resolution: window.devicePixelRatio ?? 1 })` and a `ResizeObserver` on `mount` → `app.resize()`, disposed with the renderer; the `PixiRenderer` gains `readonly follows: boolean`), `src/runtime.ts` (pass `mount` — it is read after `createPixiRenderer` today; reorder so the renderer is created with it), `src/schema.ts` (descriptions: "leave both empty to fill the mount").
- Test: `engine/game/renderer-pixi/tests/*.test.ts` (extend: with a fake `mount` box and a stubbed `ResizeObserver`, no size → `resizeTo` is the mount and a box change fires `app.renderer`'s `resize`; both sizes → fixed; one size → diagnostic + fixed; the observer disconnects on dispose). Read how the existing tests fake pixi's `Application` (headless — `app.init` may be mocked).

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/renderer-pixi` green; typecheck. Commit `The renderer follows its mount`.

---

### Task 2: The safe rect and `pin`

**Files:**
- Modify: `engine/game/scenes/src/fit.ts` (`Fit.viewport`; `fitStage(viewport, design, mode, insets = zeros)` → fits into `viewport − insets`, offsets by `(left, top)`, and computes the safe rect's edges in design units), `src/scenes.ts` (`resize(w, h, insets?)` stores the last `Fit`; a `positionPinned()` pass over every top-level entry with `pin` (reads the entry's merged props, sets `view.position` = pin point + offset — through `applyCommon`'s position rule so `anchor` still applies: factor the position computation into `node-types.ts` `placeCommon(view, common, fit?)` used by both `applyCommon` and the resize pass); `mountNode` reports a pinned nested node once), `src/runtime.ts` (`fit()` reads the safe area per Global Constraints; `ctx.inject(['shell'], () => fit())`; the resize listener re-reads the shell's `safeArea` each time — the bar height changes with the layout), `src/common-schema.ts` (`pin`), `src/node-types.ts` (`Common.pin`; `applyCommon` takes an optional `fit` and applies the pin when given — the scenes runtime passes its last fit).
- Modify: `engine/ide/host/src/plugins/scenes.ts` (`checkNode`: `pin` on a node that is a child → warning `pin on a nested node "<id>" is ignored`).
- Test: `engine/game/scenes/tests/fit.test.ts` (extend: insets → `viewport` edges for contain and cover; the safe rect's centre; zero insets ≡ today), `tests/scenes.test.ts` (extend: each of the nine pins at 480×288 and 1280×720 with a bar of 100 → expected positions; `anchor: 0.5` on a `pin: bottom` text; `pin` on a child → diagnostic and absolute; `setProps({ pin: '' })` un-pins; a `resize` moves a pinned node and leaves an unpinned one), `tests/runtime.test.ts` (extend: a `safeArea` service wins over a fake `shell.safeArea`; the fit re-runs when `shell` is provided later), `engine/ide/host/tests/scenes.test.ts` (extend: the warning).

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/scenes`, `-w @energy8engine/ide-host -- scenes.test.ts` green; typecheck scenes, scene-edit (it reads `Fit`), ide-host. Commit `A safe rect; nodes pin to its edges`.

---

### Task 3: The `portrait` variant

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts` (`SceneDoc.portrait?`), `engine/game/scenes/src/scenes.ts` (`Entry.variant?: Record<string, unknown>` — the active override; `rawOf(e)` = `{ ...e.node.props, ...(e.variant ?? {}), ...(e.live ?? {}) }`; `orientation` state from the last fit (`viewport` height > width); `resize` flips → `applyVariant()` over every mounted entry of every document: build merged props per the constraints, validate all (one plan like `setProps`), apply all (`update` + common, or remount for a type without `update` — `unmountTop`/`mountTop` is per document; a per-node remount needs `mountNode` on the parent at the same index — read `scenes.ts:351` `addChildAt(wasAt)` for the precedent), diagnostics per refused node; `refresh()`/`assets()` use `rawOf`/both layers), `src/runtime.ts` (`Config.portrait?: { width, height }` — schema; the runtime passes the orientation's design to `resize`: `fitStage(viewport, portrait ? cfg.portrait ?? rotated(design) : design, …)`), `src/schema.ts` (if the row's schema lives there).
- Modify: `engine/ide/host/src/plugins/scenes.ts` (`checkNode`/the document check walks `portrait.nodes`: unknown id → warning `portrait override for unknown node "<id>"`; each override's props through the same asset/`$cell`/`pin` rules with `where` = `<scene>/<id> (portrait)`), `engine/ide/host/src/plugins/scenes.ts` GET/PUT keep the block (probably nothing to do — read the YAML round-trip).
- Test: `engine/game/scenes/tests/scenes.test.ts` (extend: a portrait `resize` applies `portrait.nodes` (`visible: false` hides; `x/y/pin` move; `text` prop changes through `update`); a refused override keeps the landscape props + diagnostic; an `update`-less type remounts at the same z-index; a `setProps` patch survives a flip both ways; back to landscape restores; `assets()` lists both `src`s; unknown id → diagnostic), `tests/runtime.test.ts` (extend: `portrait` design size used on a portrait fit; rotated default), `engine/core/contracts/tests/protocol-scenes.test.ts` (extend: the block round-trips), `engine/ide/host/tests/scenes.test.ts` (extend: the two warnings; PUT keeps the block).

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/scenes`, `-w @energy8engine/contracts`, `-w @energy8engine/ide-host -- scenes.test.ts` green; typecheck. Commit `A scene turns: the portrait variant`.

---

### Task 4: The editor — viewport presets, the safe-rect frame, portrait edits

**Files:**
- Modify: `engine/game/scene-edit/src/index.ts` (config `safeArea?` is NOT needed — the page provides the service; the plugin draws the safe rect from `scenes.resize`'s returned `Fit.viewport` (design units) beside the design frame, the bar band hatched between `viewport.bottom` and the design's/viewport's bottom edge; `scenes.resize(app.screen.width, app.screen.height)` at `:95` stays; gizmo: a drag on a pinned node converts the pointer to design units and emits `x/y` = pointer − pin point (`Fit.viewport` + the pin's point); every `emit('edit', { node, props })` and the `patch()` used for optimistic replace carry `variant: scenes.orientation() === 'portrait' ? 'portrait' : null` — `ScenesService` gains `orientation(): 'landscape' | 'portrait'` and `fit(): Fit | null` (Task 3 landed the state; add the two getters here); the optimistic `patch` writes into `portrait.nodes` when `variant`), `src/gizmo.ts` (the offset math).
- Modify: `engine/examples/first-slot/src/editor.ts` ≡ template (`safeBottom` from `location.search` → `createGame({ mount, without: ['ui.shell'], provide: { safeArea: { top: 0, right: 0, bottom: Number(params.get('safeBottom') ?? 0), left: 0 } } })`).
- Modify: `engine/ide/client/src/shell/CanvasToolbar.tsx` (the viewport preset select + a `W×H` field; `onViewport(preset)`), `SceneDocument.tsx` (state `viewport` — `design` = the design box; the iframe `width/height` = the viewport; the CSS fit uses the viewport size; the editor URL gains `&safeBottom=${SAFE_BOTTOM[vw < vh ? 'mobile' : 'wide']}` for the non-`design` presets and `0` for `design`; the `edit` handler routes `variant === 'portrait'` into `portrait.nodes[node]` via a `patchVariant(doc, node, props)` beside `patchNode`; a "clear portrait override" action → delete the entry), `ScenesSidebar.tsx` (`◐` on overridden nodes + the clear action), `ScenesProperties.tsx` (find it — the Properties form writes through the same `patch` device with the current variant; `x`/`y` labels read "offset x/y" when `pin` is set; `pin` renders as a select — schema-driven already), `canvas-rpc.ts` (the `edit` payload type).
- Test: `engine/game/scene-edit/tests/*.test.ts` (extend: the safe-rect frame drawn from a fit with insets; a pinned node's drag emits the offset; `variant` on the edit payload under a portrait fit; the optimistic patch writes `portrait.nodes`), `engine/ide/client/tests/*.test.tsx` (extend: the preset select sizes the iframe and appends `safeBottom`; an `edit` with `variant: 'portrait'` lands in `portrait.nodes` and leaves `nodes[]` untouched; the tree mark; clear removes; JSON round-trip of a doc with `portrait`).

- [ ] **Step 1:** failing tests. **Step 2:** implement. **Step 3:** `npm test -w @energy8engine/scene-edit`, `-w @energy8engine/ide-web`, `-w @energy8engine/ide-host -- template.test.ts` green; typecheck scene-edit, ide-web (six pre-existing TS7016 allowed). Commit `The editor turns: viewport presets, the safe rect, portrait edits`.

---

### Task 5: `first-slot` fills the window; proof

**Files:**
- Modify: `engine/examples/first-slot/index.html` ≡ template (`#mount { position: fixed; inset: 0 }`, `#controls`/`#log` `position: fixed` (top / bottom), `z-index`, translucent backgrounds; the `#controls[hidden]` rule stays), `e8.patch.yml` ×2 (`renderer1.config` loses `width`/`height`, keeps `background`; `scenes1.config.portrait: { width: 288, height: 480 }`), `scenes/base_game.scene.yml` ×2 (`win`: `pin: bottom, x: 0, y: -24, anchor: 0.5`; `portrait: { nodes: { logo: { pin: top, x: 0, y: 40 }, coin: { visible: false } } }` — keep the file's one-line-per-node style), `src/main.ts` ×2 (hook `fit(): Fit | null` — `scenes.fit()`; `orientation()`), `README.md` ×2 (a paragraph), premises: every e2e/host test that pinned the 480×288 canvas or absolute positions (`canvas.spec`, `screens.spec`, `scenes.spec`, `text.spec` `nodeProps` bounds, `tempo.spec` centre tap, `game-shell.spec` case 5 tap, `headless.spec` `e8 shot` PNG size, `project.test.ts` patch pins, `cli-smoke.test.ts`) — read each, recompute against a window-filling canvas at Playwright's default 1280×720 viewport and `e8 shot`'s default `480×288` viewport.
- Create: `engine/apps/web/tests/e2e/responsive.spec.ts` (spec §9's four cases; (1) `page.setViewportSize` 1280×720 → 800×450: `__e8.stageScale()` changes and `nodeProps('base_game', 'win').y === fit().viewport.bottom − 24` at both; (2) 390×844: `orientation() === 'portrait'`, `logo` y < the board's y, `nodeVisible('base_game','coin') === false`; back → visible; (3) the scene editor with the `390×844` preset: drag `logo` → the file gains `portrait.nodes.logo` and `nodes[logo]` unchanged; with `design`: drag → `nodes[logo]` changes, the override stays; (4) drag the pinned `win` under `design` → the file's `win.x/y` are the OFFSET (small numbers), not the absolute).

- [ ] **Step 1:** fixture + premises + spec. **Step 2:** `npm test -w @energy8engine/ide-host -- template.test.ts project.test.ts cli-smoke.test.ts` green; `cd engine/apps/web && npx playwright test tests/e2e/responsive.spec.ts tests/e2e/canvas.spec.ts tests/e2e/scenes.spec.ts tests/e2e/text.spec.ts tests/e2e/tempo.spec.ts tests/e2e/game-shell.spec.ts tests/e2e/headless.spec.ts` green (ALONE). **Step 3:** commit `first-slot fills the window and turns to portrait`.

---

## Self-review

- Spec coverage: §3 T1; §4 T2 (+ the `safeArea` service, editor side T4); §5 T2 (+ editor T4, host T2); §6 T3 (+ host T3, editor T4); §7 T4; §8 T5; §9 each task's tests + T5's e2e; §10 in the note.
- Types: `Fit.viewport` (T2) consumed by T3's orientation, T4's frame/gizmo, T5's hook; `ScenesService.orientation()/fit()` (T3/T4) consumed by T4's edits and T5's hooks; `variant` on the edit RPC (T4) consumed by the client (T4); `SceneDoc.portrait` (T3) read by T4's client patch and T5's fixture.
- Placeholders: the `SAFE_BOTTOM` constants are measured in T4 (the plan says how); no other open value.
