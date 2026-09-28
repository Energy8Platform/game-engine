# Sidebars per tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each tab decides what the left and right sidebars show; an activity view shows over it until a tab with its own sidebar takes over; Symbols' list and Flow's palette move to the left sidebar, Reels' settings to the right.

**Architecture:** The shell service computes the effective left key (an activity override that yields to a tab declaring its own `sidebar`, else the active tab's `sidebar`) and the effective right key (the override's `sideRight`, else the tab's), shown only while its plugin flags it as having content (`setSideRight`). `Shell.tsx` keeps every sidebar entry it has shown mounted and hides the inactive ones; the right sidebar gets the same resize hook as the left. The three documents move their side panes into `shell.sidebar`/`shell.sideRight` entries; the Reels canvas follows `gameComposition` rows itself.

**Tech Stack:** React 18, cordis 4 (`ctx.slots`, `ctx.shell`), vitest + testing-library (`engine/ide/client`), Playwright (`engine/apps/web`).

**Spec:** `docs/superpowers/specs/2026-09-28-sidebars-per-tab-design.md`

## Global Constraints

- `packages/*` is not edited. No `@energy8platform/game-engine` under `engine/`. Every change carries a test in its package.
- Open tabs keep their state across tab switches; a sidebar entry once shown stays mounted (hidden when inactive).
- The override yields only to a tab that declares a `sidebar`; a tab that declares none keeps the override showing. The boot default (Explorer / Projects) is set only while no document is active.
- Right sidebar: key = override's `sideRight` ?? active tab's `sideRight`; shown only while `setSideRight(key, true)`; resizable, `localStorage` key `e8.side-right-w`, default 280 px (the stylesheet token).
- One workspace per test command; `@energy8engine/ide-host` ALONE. Playwright ALONE from `engine/apps/web`: `E8_E2E_HOST_PORT=5779 npx playwright test <files>`.
- NEVER `git stash`/`checkout`/`restore`/`reset` — baseline via `git show HEAD:<path> > <scratch file>`. Never kill a process you did not start. Never touch `engine/examples/paper-duel`.
- Comments describe the code as it is — never task numbers or review rounds.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.

## Review Focus

1. **Explorer, then double-click a code file, then another**: Explorer stays (code tabs declare no sidebar); opening Symbols replaces it with the symbol list; pressing Explorer again over Symbols shows Explorer; pressing it again returns the symbol list. Pinned in Task 1.
2. **A Flow node selected, then Preview, then Flow**: the right sidebar collapses on Preview and comes back with the node on Flow (the Flow selection is not cleared by leaving the tab). Pinned in Task 1 (service) and Task 6 (e2e).
3. **A half-typed symbol rename in the left list, then a tab switch and back**: the draft is still there (the sidebar entry stayed mounted). Pinned in Task 2 (generic) and Task 3.
4. **A Reels section edited while the Reels tab is hidden behind another tab** (the edit from the Composition screen): the canvas re-applies the row when the composition changes, and does not re-apply rows whose config did not change. Pinned in Task 5.
5. **Two tabs of the same kind are impossible for contributed docs, but two scene-file tabs share `sideRight: 'scenes'`**: the right sidebar shows the Properties for the scene selection whichever scene tab is active (the scenes service's selection is one). Pinned in Task 1.

---

### Task 1: The shell decides the sidebars from the active tab

**Files:**
- Modify: `engine/ide/client/src/plugins/shell.tsx` (types ~9-50, state ~251-252, `openInternal`/`openFoundContributed`/background branch ~305-341 and ~508-521, `sidebar()`/`showSidebar`/`sideRight()`/`showSideRight`/`hideSideRight` ~587-641, `useShell`)
- Modify: `engine/ide/client/src/plugins/viewers.ts` (`ViewerDef` ~21-24)
- Modify: `engine/ide/client/src/shell/Explorer.tsx` (`openPath` ~100-114: copy the viewer's `sidebar`/`sideRight` into the tab)
- Modify: `engine/ide/client/src/plugins/scenes.tsx` (~315-355), `plugins/flow.tsx` (~130-150, ~215-256), `plugins/symbols.tsx` (~211-224, ~280-318)
- Modify: `engine/apps/web/src/App.tsx` (~254-259: the boot default)
- Test: `engine/ide/client/tests/shell.test.tsx`, and the tests that call `showSideRight`/`hideSideRight` (`properties-sidebar.test.tsx`, `flow-properties.test.tsx`, `symbols-service.test.tsx`)

**Interfaces:**
- Produces:
  - `DocumentMeta`, `OpenDocument`, `ViewerDef` gain `sidebar?: string; sideRight?: string`. `SidebarMeta` gains `sideRight?: string`.
  - `ShellService.sidebar(): string | undefined` — the EFFECTIVE left key: the override while it stands, else `active()?.sidebar`.
  - `ShellService.showSidebar(key: string | undefined)` — `undefined` clears the override; the key already overriding clears it; any other key becomes the override.
  - `ShellService.sideRight(): string | undefined` — the effective right key (`overrideEntry?.sideRight ?? active()?.sideRight`) when its flag is on, else `undefined`.
  - `ShellService.setSideRight(key: string, on: boolean): void` — per-key flag; notifies only on a change. `showSideRight`/`hideSideRight` are removed.
  - Declarations: scene viewer `sideRight: 'scenes'`; `shell.sidebar` `scenes` entry `sideRight: 'scenes'`; `shell.document` `flow` `sideRight: 'flow'`; `shell.document` `symbols` `sideRight: 'symbols'` (Tasks 3–5 add the left keys and Reels).

- [ ] **Step 1: Failing tests** in `shell.test.tsx` (read how it builds a shell with `slots` and registers entries; `location.hash` drives `active()`):
  - A contributed document with `sidebar: 'a'`, `sideRight: 'r'` active → `sidebar() === 'a'`; `sideRight()` is `undefined` until `setSideRight('r', true)`, then `'r'`; `setSideRight('r', false)` → `undefined`.
  - A document declaring nothing active → `sidebar()` and `sideRight()` `undefined`.
  - Review Focus 1: `showSidebar('explorer')` over a no-sidebar doc → `'explorer'`; open a second no-sidebar doc → still `'explorer'`; open a doc with `sidebar: 'a'` → `'a'` (override cleared); `showSidebar('explorer')` → `'explorer'`; `showSidebar('explorer')` again → `'a'`.
  - An override whose `shell.sidebar` entry declares `sideRight: 's'` (flag on) wins over the tab's `sideRight`; an override without one leaves the tab's.
  - Review Focus 2: doc A (`sideRight: 'flow'`) with `setSideRight('flow', true)`, activate doc B (none) → `sideRight()` `undefined`; back to A → `'flow'`.
  - A viewer with `sidebar`/`sideRight` → the tab opened through `openPath` carries them (Explorer's opener; read `explorer.test.tsx`'s harness if easier).
  - `setSideRight` with the same value twice notifies once.
  - Update the existing tests that used `showSideRight`/`hideSideRight` to the new API.
- [ ] **Step 2:** `npm test -w @energy8engine/ide-client -- shell` — FAIL.
- [ ] **Step 3: Implement** in `shell.tsx`:

```ts
// The activity view picked over the tab's own (spec §3). It yields to a
// tab that declares its own `sidebar`: `activeSeen` is the tab key the
// override was last checked against.
let override: string | undefined;
let activeSeen: string | undefined;
const rightOn = new Map<string, boolean>();

function effectiveLeft(): string | undefined {
  const active = service.active();
  if (active?.key !== activeSeen) {
    activeSeen = active?.key;
    if (active?.sidebar !== undefined) override = undefined;
  }
  return override ?? active?.sidebar;
}
```

`sidebar()` returns `effectiveLeft()`. `showSidebar(key)`: `activeSeen = service.active()?.key; override = key === undefined || override === key ? undefined : key; notify();`. `sideRight()`:

```ts
const left = effectiveLeft();
const entry = override === undefined ? undefined
  : ctx.slots.list<SlotMeta & SidebarMeta>(SLOT_NAMES.sidebar).find((e) => e.key === override);
const key = entry?.sideRight ?? service.active()?.sideRight;
return key !== undefined && rightOn.get(key) ? key : undefined;
```

(`left` is read first so the override lapses before the right key is chosen.) `setSideRight(key, on)`: set the flag, notify when it changed. Copy `sidebar`/`sideRight` from `DocumentMeta` in `openFoundContributed` and the background branch, and from the viewer in `Explorer.tsx`'s `openPath` (it builds the `OpenDocument`). Doc comments on the new API.

Plugins: replace each `service.subscribe(() => { … showSideRight / hideSideRight … })` with `service.subscribe(() => ctx.shell.setSideRight('<key>', selected !== null))` (scenes: `!!selected`). Remove the cross-plugin deselects: `flow.select`'s `ctx.scenes.select(null)`, `'flow:scenes-deselect'`, `symbols.select`'s `ctx.scenes.select(null)` / `ctx.flow.select(null)`, `'symbols:scenes-deselect'`, `'symbols:flow-deselect'`. Add the declarations listed under Produces.

`App.tsx`: the boot default runs only when no document is active — `if (ctx.shell.sidebar() === undefined && ctx.shell.active() === undefined) ctx.shell.showSidebar(…)`.
- [ ] **Step 4:** `npm test -w @energy8engine/ide-client`, typecheck `@energy8engine/ide-client` and `@energy8engine/ide-web` — PASS / 0.
- [ ] **Step 5: Commit** — `Shell: the active tab declares its sidebars; an activity view shows over it until a tab with its own takes over; the right one shows while its plugin has something`.

---

### Task 2: Shell.tsx keeps shown sidebars mounted, and the right one resizes

**Files:**
- Modify: `engine/ide/client/src/shell/Shell.tsx` (~92 `SIZE_KEYS`, ~294-300, ~386-445, ~514-520)
- Modify: `engine/ide/client/src/styles.css` (the right sidebar's resize handle — reuse `.e8-resize-x`'s rules, placed on the right sidebar's left edge)
- Test: `engine/ide/client/tests/shell.test.tsx`

**Interfaces:**
- Consumes: Task 1's `useShell` (`sidebar`, `sideRight` are the effective keys).
- Produces: `data-testid="sidebar-<key>"` / `side-right-<key>` wrappers stay (now one per mounted entry, `hidden` when inactive); `data-testid="resize-side-right"`; `SIZE_KEYS.sideRight = 'e8.side-right-w'`; the inline `--e8-side-right-w` when a size is stored/dragged.

- [ ] **Step 1: Failing tests:**
  - Two `shell.sidebar` entries `a` and `b` whose components hold local state (an `<input>`): show `a`, type `x`, show `b`, show `a` again → the input still reads `x`; while `b` shows, `sidebar-a` is in the DOM with `hidden`.
  - Same for `shell.sideRight`.
  - An entry never shown is not mounted.
  - Dragging `resize-side-right` leftwards widens the right sidebar (`--e8-side-right-w` grows) and the width is in `localStorage['e8.side-right-w']`; a remount reads it back (mirror the existing left-resize test).
  - The activity button of the override is highlighted; a tab's own sidebar highlights no activity button.
- [ ] **Step 2:** `npm test -w @energy8engine/ide-client -- shell` — FAIL.
- [ ] **Step 3: Implement.** A `useState<Set<string>>` of keys shown so far per side (add the current key in render or an effect); render every `shell.sidebar` entry in that set, `hidden={key !== sidebar}`; same for `shell.sideRight`. `const sideRightSize = useResize(SIZE_KEYS.sideRight, 'x', -1);` with its handle as the right aside's first child and `'--e8-side-right-w'` in `sizes`. The collapsed classes stay keyed on the effective keys (`sidebar === undefined`, `sideRight === undefined`). Keep the `nothing registered for the "<key>" sidebar` note for an effective key with no entry.
- [ ] **Step 4:** `npm test -w @energy8engine/ide-client`, typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Shell: sidebars shown once stay mounted, and the right sidebar resizes like the left`.

---

### Task 3: The symbol list is the Symbols tab's left sidebar

**Files:**
- Create: `engine/ide/client/src/shell/SymbolsList.tsx` (the list pane moved out of `SymbolsDocument.tsx` ~355-491, with its local state: draft, menu, dropTarget, status as they belong to the list)
- Modify: `engine/ide/client/src/shell/SymbolsDocument.tsx`, `engine/ide/client/src/plugins/symbols.tsx` (register `shell.sidebar` `symbols`; the document declares `sidebar: 'symbols'`)
- Test: `engine/ide/client/tests/symbols-document.test.tsx` (and a new `symbols-list.test.tsx` if the list's tests read better alone)

**Interfaces:**
- Consumes: Task 1 (`DocumentMeta.sidebar`), Task 2 (mounted sidebars).
- Produces: `SymbolsList({ ctx })`; the `shell.sidebar` entry `{ key: 'symbols', title: 'Symbols' }`; every `data-testid` the list had keeps its value (e2e selectors follow the list into the sidebar).

- [ ] **Step 1: Failing tests:** rendering `SymbolsDocument` alone no longer renders the list (its testids absent); rendering `SymbolsList` renders it, and selecting/adding/renaming/removing a symbol works through `ctx.symbols` exactly as the moved tests asserted (move those tests, do not duplicate them); the plugin registers `shell.sidebar` `symbols` and the `symbols` document declares `sidebar: 'symbols'`.
- [ ] **Step 2:** `npm test -w @energy8engine/ide-client -- symbols` — FAIL.
- [ ] **Step 3: Implement** the move. Anything the list and the canvas share goes through `ctx.symbols` (selection already does); a status the list set that the document showed moves with the list (its own status line in the sidebar). The document keeps the canvas, its toolbar, zoom and help.
- [ ] **Step 4:** `npm test -w @energy8engine/ide-client`, typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Symbols: the symbol list is the tab's left sidebar; the canvas fills the document`.

---

### Task 4: The Flow palette is the Flow tab's left sidebar

**Files:**
- Create: `engine/ide/client/src/shell/FlowPalette.tsx` (the palette moved out of `FlowDocument.tsx` ~321-355)
- Modify: `engine/ide/client/src/shell/FlowDocument.tsx`, `engine/ide/client/src/plugins/flow.tsx` (register `shell.sidebar` `flow`; the document declares `sidebar: 'flow'`)
- Test: `engine/ide/client/tests/flow-document.test.tsx` (palette tests move to a `flow-palette.test.tsx`)

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces: `FlowPalette({ ctx })` reading kinds from `ctx.flow.kinds()`; the drag payload `KIND_MIME` exported from one place both sides import; the `shell.sidebar` entry `{ key: 'flow', title: 'Nodes' }`; palette testids unchanged.

- [ ] **Step 1: Failing tests:** `FlowDocument` alone renders no palette; `FlowPalette` lists the kinds and sets `KIND_MIME` on drag start; a drop of that payload on the Flow canvas still adds a node (the existing drop test, fed a `dataTransfer` built as the palette builds it); the plugin registers `shell.sidebar` `flow` and the document declares `sidebar: 'flow'`.
- [ ] **Step 2:** `npm test -w @energy8engine/ide-client -- flow` — FAIL.
- [ ] **Step 3: Implement** the move; the palette reads what it needs from `ctx.flow` (kinds, and any grouping the document computed — move that helper with it).
- [ ] **Step 4:** `npm test -w @energy8engine/ide-client`, typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Flow: the node palette is the tab's left sidebar`.

---

### Task 5: Reels settings are the Reels tab's right sidebar; the canvas follows the rows

**Files:**
- Create: `engine/ide/client/src/shell/ReelsSettings.tsx` (the sections moved out of `ReelsDocument.tsx` ~265-358)
- Modify: `engine/ide/client/src/shell/ReelsDocument.tsx` (the canvas + toolbar; `sendRows` driven by `gameComposition`), `engine/ide/client/src/plugins/reels.tsx` (register `shell.sideRight` `reels`; the document declares `sideRight: 'reels'`; `setSideRight('reels', true)` while the `reels1` row exists)
- Test: `engine/ide/client/tests/reels-document.test.tsx` (section tests move to `reels-settings.test.tsx`)

**Interfaces:**
- Consumes: Task 1 (`setSideRight`), Task 2.
- Produces: `ReelsSettings({ ctx })` writing through `ctx.gameComposition.update` (the `reels-<row>` id prefix stays); the canvas keeps `sent: Map<rowId, string>` (the JSON of the config last sent per reel row) and, on every `gameComposition` change, sends `rows` for the reel rows whose JSON differs; `ready` sends all and resets `sent`.

- [ ] **Step 1: Failing tests:**
  - `ReelsDocument` alone renders no sections; `ReelsSettings` renders them and a write goes through `gameComposition.update` with the row's whole object (moved tests).
  - Review Focus 4: a composition change of `reels1`'s config (pushed as a `game-composition` frame, not through the form) → the canvas gets one `rows` call with only `reels1`; a frame where no reel row changed → no call; a non-reel row change → no call; after `ready`, every reel row is sent once.
  - A failed apply still names the row in the canvas status line.
  - The plugin registers `shell.sideRight` `reels`, the document declares `sideRight: 'reels'`, and `setSideRight('reels', …)` follows the `reels1` row's presence.
- [ ] **Step 2:** `npm test -w @energy8engine/ide-client -- reels` — FAIL.
- [ ] **Step 3: Implement** the move and the row-following effect (an effect on the rows from `useGameComposition`, comparing JSON per reel row id against `sent`). The settings component no longer references the canvas rpc.
- [ ] **Step 4:** `npm test -w @energy8engine/ide-client`, typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Reels: the settings are the tab's right sidebar, and the canvas re-applies whichever reel row changed`.

---

### Task 6: e2e — sidebars follow the tab

**Files:**
- Create: `engine/apps/web/tests/e2e/sidebars.spec.ts`
- Modify: existing specs that looked for the moved panes inside a document or relied on the old sidebar/right-sidebar behaviour (grep `sidebar-`, `side-right-`, the symbol list / palette / reels section testids, `activity-`): `symbols.spec.ts`, `flow.spec.ts`, `reels.spec.ts`, `explorer.spec.ts`, `scenes.spec.ts`, `canvas.spec.ts`, others the grep finds.

**Interfaces:**
- Consumes: Tasks 1–5; `project-fixture.ts` (`projectCopy`, `startDevHost`); the IDE page.

- [ ] **Step 1: Write the scenarios** (`sidebars.spec.ts`):
  - Flow: select a node → `side-right-flow` visible; open the Preview tab → the right sidebar is collapsed (`side-right` has no visible entry, the shell has `e8-side-right-collapsed`); back to Flow → `side-right-flow` visible with the same node's properties.
  - Symbols: open the Symbols document → the symbol list is inside `sidebar-symbols` (left), not inside the document pane.
  - Reels: open the Reels document → its settings are inside `side-right-reels`; setting `cols` 5 → 6 there rebuilds the canvas board (6 reels, as `reels.spec.ts` reads it).
  - Explorer over Symbols: press the Explorer activity → Explorer shows; open the Flow tab → the Flow palette shows (`sidebar-flow`); open a code file from … (press Explorer, double-click `game/script.spin`) → Explorer stays.
  - Update the existing specs the grep finds so they open the right tab and find the moved panes where they now live; never weaken an assertion.
- [ ] **Step 2:** `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test tests/e2e/sidebars.spec.ts <every changed spec>` ALONE — PASS; `npm run typecheck -w @energy8engine/ide-web` — 0.
- [ ] **Step 3: Commit** — `E2E: the sidebars follow the tab — Flow's properties leave with it, Symbols' list and Reels' settings sit beside their canvases`.

---

## After the tasks

Unit gate (each alone): `ide-client`, `ide-web`, `ide-host` (ALONE); typecheck each. Rebuild the IDE's dist: `npm run build -w @energy8engine/ide-web` (never staged). Full Playwright ALONE: `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test`.
