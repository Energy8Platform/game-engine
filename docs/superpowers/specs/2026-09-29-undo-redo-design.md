# Undo and redo — design (slice 45)

Date: 2026-09-29. Branch: `feat/slot-webide-cordis` at `5bdcb2be` (slice 44).
Source: the user's feedback of 2026-09-28, item 4 — "the IDE has no
undo/redo at all". Decided with the user: every tab undoes its own edits
(like VS Code); scenes, Flow, Symbols, Reels, the Composition forms and the
Explorer's file operations are undoable (code files keep Monaco's own);
keys only (Mod+Z, Mod+Shift+Z, Mod+Y), with a short status-bar line.

## 0. What is there today

- No undo anywhere, except Monaco's own per-editor history.
- Every structured edit is one whole-object write through one service
  method: `ctx.scenes.update(doc)` (PUT one scene), `ctx.flow.update(doc)`,
  `ctx.symbols.update(doc | reducer)` (queued), `ctx.gameComposition
  .update(id, config)` (PUT one row). The writes are already one per
  gesture: a gizmo drag writes once, a Flow drag is debounced into one
  write, a SchemaForm field commits on blur.
- The host echoes every write back as a frame (`scenes`, `flow`,
  `symbols`, `game-composition`) to every IDE client, the writer included.
- The Explorer's verbs go through `ctx.files`: `create`, `mkdir`, `move`
  (rename and drag), `remove` (after a confirm), `write` (an upload).
- The only global key handler is the Mod+S swallow in `Shell.tsx`; keys
  pressed inside a canvas iframe never reach the IDE (scene-edit ignores
  Ctrl/Meta keys).

## 1. Rules

- `packages/*` is not edited. Every change carries a test in its package.
- History lives in memory only; a reload starts empty.
- An undo or redo writes through the same service method a person's edit
  does (the host, the running game and every other client follow as they
  do today); it is never recorded as a new step itself.

## 2. The history

- A new client service `history` keeps steps under data keys:
  `scene:<id>`, `flow`, `symbols`, `row:<id>` (one composition row) and
  `files` (the Explorer's operations). A step holds a label, the value
  before and after, and how to read the current value and write one.
- A step is recorded when a write the person made is accepted by the host
  (an answer with no error diagnostic). One service call is one step.
- Up to 100 steps per key; the oldest drops. A new step on a key clears
  that key's redo branch.
- Each step carries a sequence number, so "the latest step among several
  keys" is well defined.

## 3. What a tab undoes

- A tab's keys: a scene file tab → `scene:<id>`; Flow → `flow`; Symbols →
  `symbols`; Reels → the rows it edits (`row:reels1`, `row:motion1`,
  `row:anticipation1`, `row:cascade1`, `row:features1`); Composition → every
  `row:<id>`. Plugins declare the keys for their tabs.
- Undo takes the latest step among the tab's keys; redo the latest undone
  one. So a `reels1` edit made in Reels can be undone from the Composition
  and the other way round, and a Scenes-list Properties edit of a scene is
  undone from that scene's tab.
- **Diverged data**: before applying, the current value is compared with
  the step's "after" (undo) or "before" (redo). If it differs — changed
  since in another tab, by Monaco, by another client — nothing is written,
  the step is dropped, and the status line says why. The echo of the
  person's own write is not a change (it equals "after").

## 4. The Explorer

- With focus inside the Explorer, undo/redo act on `files`:
  - create / new folder → undo removes it (a created file only while it is
    still empty and unchanged; a folder only while empty); redo creates it
    again;
  - move / rename → undo moves it back, redo moves it again (refused when
    the old path is taken);
  - remove → the removed file's bytes (a folder: every file under it,
    with its tree) are read before the remove; undo writes them back, redo
    removes again. Over 20 MB in total the remove is not undoable, and the
    confirm says so before removing;
  - upload (`write`) → undo restores the previous bytes, or removes a file
    that did not exist; redo writes the upload again.

## 5. Keys

- Mod+Z undoes; Mod+Shift+Z and Mod+Y redo.
- Who handles them: focus in an `input`, a `textarea`, a `contenteditable`
  or a Monaco editor → nothing here (their own undo); focus inside the
  Explorer → `files`; otherwise → the active tab's keys.
- The canvas pages (scene-edit in scene, symbol and reels mode) forward
  these keys to the IDE as `undo` / `redo` events; the Scene, Symbols and
  Reels documents hand them to the same router (the canvas's document is
  the active tab).
- After an undo or redo the status bar shows `Undo: <label>` / `Redo:
  <label>` or the refusal (`nothing to undo`, `changed elsewhere since —
  can't undo`) for 4 s.

## 6. Tests

- `ide-client` history: record/undo/redo; redo cleared by a new step; the
  100 cap; "latest among keys"; a diverged value refuses and drops the
  step; an undo is not recorded; a refused write is not recorded; the echo
  frame of an accepted write does not diverge.
- Each service records its writes under its key (scenes, flow, symbols —
  the reducer form records the reduced doc — composition rows).
- Keys: the router skips inputs/textarea/contenteditable/Monaco; Explorer
  focus → `files`; otherwise the active tab; Mod+Y and Mod+Shift+Z redo.
- Explorer: create / mkdir / move / remove (file and folder) / upload each
  undo and redo; a remove over 20 MB is refused as undoable and the confirm
  says so; a changed created file refuses the undo.
- scene-edit: Mod+Z / Mod+Shift+Z / Mod+Y emit `undo` / `redo` in every
  mode; the documents route them.
- e2e (alone): move a scene node on the canvas, Mod+Z (focus on the canvas)
  puts it back, Mod+Shift+Z moves it again; a Reels `cols` edit undone
  from the Composition tab; a Flow node added then undone; a file removed
  in the Explorer then Mod+Z restores it with its content; the status line
  shows `Undo: …`. Full Playwright alone.

## 7. Not here

- Code files (Monaco keeps its own history).
- Adding or removing scenes from the Scenes list; the Projects list.
- History across reloads; an Edit menu or toolbar buttons.
