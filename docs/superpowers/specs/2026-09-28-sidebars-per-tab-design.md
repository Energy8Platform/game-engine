# Sidebars per tab — design (slice 44)

Date: 2026-09-28. Branch: `feat/slot-webide-cordis` at `e18d2946` (slice 43).
Source: the user's feedback of 2026-09-28, items 5–7 — "Symbols should
open with its symbols in the left sidebar", "Reels settings in the right
sidebar", "the left sidebar should depend strongly on the tab: if the tab
passes nothing, nothing should be in it; smarter management; the same for
the right — it confuses". Decided with the user: an activity button shows
its view over the tab's until the tab changes or the button is pressed
again; the right sidebar hides when there is nothing to show; the Flow
palette moves to the left sidebar too (the scene tree and the Composition
stay where they are).

## 0. What is there today

- **Left sidebar** (`shell.sidebar`): shows the entry whose key is the
  shell's `sidebarKey`, set only by an activity click (`showSidebar`,
  a toggle) and one boot default (`App.tsx`: Explorer, or Projects with no
  project). Entries: `explorer`, `workspace` (Projects), `scenes` (the
  scene list). No document ever touches it.
- **Right sidebar** (`shell.sideRight`): shows the key passed to
  `showSideRight(key)`; `hideSideRight()` collapses it. Three entries —
  `scenes` (PropertiesSidebar), `flow` (FlowProperties), `symbols`
  (SymbolsProperties) — each shown by its plugin's SELECTION, not by the
  active tab; flow and symbols deselect each other because they share the
  one slot. A Flow node selected stays over the Preview.
- **In-document side panes**: Symbols draws its symbol list at its own left
  (`SymbolsDocument.tsx`); Flow its node palette (`FlowDocument.tsx`, drag
  into the canvas with `dataTransfer`); Reels its settings sections at its
  left and the canvas at its right (`ReelsDocument.tsx`, a section write
  sends `rows` to the canvas itself).
- The right sidebar is a fixed 280 px; the left one is resizable
  (`--e8-sidebar-w`, remembered).

## 1. Rules

- `packages/*` is not edited. Every change carries a test in its package.
- Open tabs keep their state across tab switches (panes stay mounted);
  sidebars shown once do too.

## 2. A tab declares its sidebars

- `DocumentMeta` (a contributed document) and `ViewerDef` (a file viewer)
  gain optional `sidebar?: string` and `sideRight?: string` — keys of
  `shell.sidebar` / `shell.sideRight` entries. `OpenDocument` carries them
  from whichever registration opened the tab.
- `SidebarMeta` (a `shell.sidebar` entry) gains an optional `sideRight`
  too: the right sidebar that goes with that left view (the Scenes list →
  the scene Properties).

## 3. The left sidebar

- The left sidebar shows, in order: the activity view the person picked
  (an override), else the active tab's `sidebar`, else nothing (the
  column collapses to 0).
- An activity button (`opens: 'sidebar'`) sets the override to its key;
  pressing it again while shown clears it. Activating another tab (a tab
  click, opening a document, Back/Forward) clears it. The boot default
  (Explorer / Projects) is that same override.
- The activity button is highlighted while its view is the one shown.

## 4. The right sidebar

- The right sidebar's key comes from what the left shows: the override's
  `sideRight`, else the active tab's `sideRight`.
- It is shown only while that key's plugin says it has something to show:
  `ctx.shell.setSideRight(key, on)` replaces `showSideRight`/
  `hideSideRight` (Scenes and Flow: a node selected; Symbols: a symbol or
  state selected; Reels: while `reels1` is composed). Each key keeps its
  own flag, so a Flow selection and a Symbols selection coexist; the
  flow ↔ symbols mutual deselect goes.
- A Flow node selected, then the Preview tab: the right sidebar hides;
  back to Flow: it shows again with the same node.
- The right sidebar is resizable like the left (a handle on its left
  edge), its width remembered (`--e8-side-right-w`, localStorage), default
  280 px.

## 5. What moves

- **Symbols**: the symbol list (with its add/rename/drag and its local
  state) becomes the `shell.sidebar` entry `symbols`; the Symbols document
  declares `sidebar: 'symbols'`, `sideRight: 'symbols'`; its canvas and
  toolbar fill the document.
- **Flow**: the node palette becomes the `shell.sidebar` entry `flow`
  (dragging a kind onto the canvas works as before — `dataTransfer`); the
  Flow document declares `sidebar: 'flow'`, `sideRight: 'flow'`.
- **Reels**: the settings sections become the `shell.sideRight` entry
  `reels`; the Reels document declares `sideRight: 'reels'` and is the
  canvas with its toolbar. The canvas re-applies a reel row on the canvas
  itself whenever that row's config changes in `gameComposition` (it
  keeps the last config it sent per row) — the form no longer sends
  `rows`. `ready` still re-applies every reel row.
- **Scene files**: the scene viewer declares `sideRight: 'scenes'`; the
  Scenes list entry declares `sideRight: 'scenes'`.
- The Composition, code files, Preview: nothing declared — both sidebars
  collapse unless an activity view is picked.

## 6. Mounting

- A sidebar entry, once shown, stays mounted and is hidden while another
  shows (like the document panes); a half-typed field or an open menu in
  it survives a tab switch.

## 7. Tests

- `ide-client` shell: a tab's declared `sidebar`/`sideRight` show; none
  declared → both collapse; an activity click overrides, a second click
  or another tab clears the override; the override's `sideRight` wins over
  the tab's; `setSideRight(key, false)` hides, `true` shows only when the
  current right key is `key`; a sidebar shown once stays mounted.
- Symbols / Flow / Reels documents: the list / palette / sections render
  in their sidebars (not in the document); a palette drag onto the Flow
  canvas still adds a node; a Reels section write re-applies that row on
  the canvas (from the composition change, not a direct send).
- Right sidebar resize: dragging changes the width, remembered across a
  remount.
- e2e (alone): Flow with a node selected → Preview: the right sidebar is
  collapsed; back to Flow: Properties with the node; Symbols: the symbol
  list is in the left sidebar; Reels: the settings are in the right
  sidebar and a `cols` edit rebuilds the canvas board; Explorer over a
  Symbols tab, then the Flow tab: the Flow palette shows. Full Playwright
  alone (existing specs that look for these panes in the document follow
  them into the sidebars).

## 8. Not here

- The scene tree and the Composition's row list stay in their documents.
- Undo/redo (slice 45).
