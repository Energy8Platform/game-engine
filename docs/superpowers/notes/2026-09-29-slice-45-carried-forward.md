# Slice 45 — undo and redo: what was left behind

Slice: `docs/superpowers/plans/2026-09-29-undo-redo.md`, spec
`2026-09-29-undo-redo-design.md`. Commits `5fcab735..7b9f02d9` on
`feat/slot-webide-cordis` plus this note's. Plan and execution ran without
the user after the spec.

Source: the user's feedback of 2026-09-28, item 4 — "the IDE has no
undo/redo at all". Decided with the user: every tab undoes its own edits;
scenes, Flow, Symbols, Reels, the Composition forms and the Explorer's file
operations are undoable (code keeps Monaco's own); keys only.

What shipped:
- **`ctx.history`** keeps steps per data key — `scene:<id>`, `flow`,
  `symbols`, `row:<id>`, `files` — 100 per key, and at most 200 MB of
  bytes on a key (a single step over that is not kept). A tab undoes the
  latest step among its keys, so a `reels1` edit made in Reels undoes from
  the Composition too. Undo/redo run one at a time. A project switch
  empties the history.
- **One step per accepted write** in each service (warnings included);
  the value compared before applying is order-independent (the host
  re-serialises docs). If it changed since — another tab, Monaco, another
  client — the undo refuses with `changed elsewhere since — can't undo`
  and drops the step; if a save is still in flight it answers `a save is
  still in flight — try again` and keeps it. Only an undo's own write goes
  unrecorded (the guard is taken at the call, not over a window).
- **Keys**: Mod+Z undo; Mod+Shift+Z and Mod+Y redo — by the Latin letter,
  or the physical key on a non-Latin layout (Russian works; QWERTZ's Ctrl+Y
  redoes). Text fields, textareas, contenteditable and Monaco keep their
  own undo; checkboxes, sliders, colour pickers and selects reach the IDE
  history. Focus in the Explorer → its file operations; otherwise the
  active tab. The canvases forward the keys. The status bar says `Undo: …`
  / `Redo: …` / why not, for 4 s (a live region).
- **Explorer**: create, new folder, move/rename (with the dirty-tab guard
  and open tabs following), remove (the bytes read before removing; the
  confirm waits for them; over 20 MB or an unreadable file → not undoable,
  said in the confirm), upload. Every undo/redo refuses when the files
  changed since. Focus stays in the Explorer after its verbs.
- **Canvas nudges**: a run of arrow-key nudges is one write and one step.

Unit gate: ide-client 999, scene-edit 124, ide-web 41, ide-host (alone) 554;
typecheck 0. Full Playwright alone (`E8_E2E_HOST_PORT=5779`): 183/183 (12.9 min).

## Debts

1. **A move undo refused for a dirty tab drops the step** — after saving,
   Mod+Z undoes the step below it. Keep it the way BUSY does.
2. **An upload over 200 MB records no step and says nothing.**
3. **A write that never answers blocks every later undo/redo** (they run
   one at a time; no fetch timeout; `clear()` does not reset the chain).
4. **Narrow windows**: Mod+Z on the IDE page within 300 ms of a nudge, or
   within 250 ms of a Flow drag, undoes the step before it; while a nudge
   is held a scenes change can snap the node back until the held write
   lands; a drop does not wait for a held nudge (the nudge's write, built
   before the drop, can overwrite the new node); a folder-restore undo in
   flight across a project switch keeps writing into the new project.
5. **Small**: the editor's own Mod+S reads `e.key` only (Shell's swallow
   uses the layout-aware `chordLetter` — reuse it); `stableStringify`
   renders a Date as `{}` (no Dates in docs today); `pending` is per
   service, so a row A save makes row B's undo BUSY; scenes/flow/rows
   capture `before` at call time (two overlapping writes from one caller
   make one undo revert both); a Symbols write that creates the doc records
   `before = {}`.
6. **Behaviour to know**: after Enter in a SchemaForm number field the
   field keeps focus, so Mod+Z runs the field's own text undo, not the IDE
   history (the write stays); blur first, then Mod+Z.
7. **Not here**: code files (Monaco), adding/removing scenes from the
   Scenes list, the Projects list, history across reloads, an Edit menu.

## Method

- **A history keyed by names outlives the thing named**: `flow`,
  `symbols` and file paths repeat across projects; without a clear on
  project switch an undo writes one project's data into another.
- **Every operation step needs the value step's precondition**: the file
  steps first wrote blindly; "changed elsewhere" applies to bytes too.
- **Focus is part of the key route**: every Explorer verb unmounted the
  focused element, so the next Mod+Z went to the tab.
- **A key test by `e.code` alone is a layout bug**: prefer the Latin
  `e.key`, fall back to the physical key only for non-Latin letters.
