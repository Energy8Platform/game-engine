# Slice 15 — the explorer grows up: what was left behind

Slice: `docs/superpowers/plans/2026-09-16-explorer-grows-up.md`, spec
`2026-09-16-explorer-grows-up-design.md`. Commits `dda1a14..51fabc0` on
`feat/slot-webide-cordis` (fifteen) plus this note's. The Explorer can make
a file or a folder, rename, move by drag, delete a folder, take a file
dropped from the desktop into a folder, and open images, sound and video
in native players; every verb is a host route guarded by the one
`describeRefusal`, which now also protects `node_modules`, `.e8`, and —
found by the final review — the project directory itself. Viewers are a
contribution (`ctx.viewers`); a project plugin can add one. User stories
2 and 3 of the 2026-09-16 list are closed.

## Debts

1. **A case-only rename is refused on APFS.** `move('e8.yml', 'E8.yml')`
   answers `exists` because `existsSync` is case-insensitive there.
   `moveOne` could treat "target exists and shares the source's inode" as
   free; nothing else needs it.
2. **"Never overwrites" is a pre-check.** Node has no `RENAME_NOREPLACE`;
   an external writer racing between `refuseExisting` and `renameSync`
   could be overwritten. The host is single-threaded and synchronous here;
   documented on `FilesService.move`.
3. **`into-self` misses a case-folded spelling** — moving `game` to
   `GAME/inner` — the OS answers `EINVAL`, reported as `io-error`.
   Wording only.
4. **The folder-delete count excludes what `tree()` skips** (`node_modules`,
   `.git` under it). Say "(plus anything not listed)", or count from disk.
5. **The context menu is not clamped to the viewport**; a right-click on
   the bottom rows overflows. Right-click inside the rename input opens
   the row menu instead of the native paste menu.
6. **`<li role="button">` holds an `<input>` and `<button>`s** — nested
   interactive content under `role=button`. The right shape is
   `role="tree"`/`treeitem` with `aria-expanded`, which is what the
   component is; a slice of its own.
7. **A multi-file desktop drop uploads the first and warns.** Looping needs
   a queue for the single-slot overwrite confirm.
8. **Drop-target highlight lights on a directory dragged over itself or its
   subtree** (the drop is refused client-side); `dragleave` flickers
   between a row and its child spans.
9. **A `.spin` rename inside `game/` restarts `e8-server` twice** (`removed`
   then `written` both match); `session-dev` serialises the two — wasteful,
   not unsafe. `mkdir('game')` on a project without one now restarts too.
10. **`finish()` refreshes the tree unless an `error` is present.** Every
    host refusal is an `error` today; the rule exists for the Explorer's
    own multi-drop `warning`. A host warning on a writing verb would ride
    a refresh.
11. **`--e8-accent` is spent on `.e8-drop-target` and `.e8-explorer-input`**;
    `DESIGN.md` §3 reserves it for `:focus-visible` and primary buttons.
    Both are focus-like states — amend the rule, or paint with
    `--e8-border`.
12. **The ancestor-delete branch of clearing `selected` is untested**; the
    `into-self`/`not-found` move tests assert the code, not the disk.
13. **Five near-identical fetch/try/catch blocks** in the client `files`
    service; a `send(method, path, body?)` would fold them.
14. **The `offs` maps in `languages.ts` and `viewers.ts` never drop a
    retracted id** — one inert closure per id, bounded.
15. **The e2e does not observe the restart itself** — too fast for a poll;
    `files.test.ts` (emit order) and `dev-game.test.ts` (restart on
    written/removed) prove the chain, `explorer.spec.ts` proves a rename
    inside `game/` leaves a live engine.

## Method

- **Making a refusal narrower opens what it refused.** `remove` refused
  every directory; making it recursive made `DELETE /api/files/.` remove
  the project. The old refusal was doing containment work nobody had
  named. Found by the final review measuring raw requests, not by any
  task's tests — the guard now names the root explicitly.
- **A spec's premise is measured, not carried.** "Moving the maths out of
  `game/` restarts the engine" was written from the event name; the
  listener only ever heard `written` inside `game/`, and `e8-server` reads
  its games directory recursively, so the planned e2e asserted a
  transient that never came. The e2e was rewritten to what a browser can
  see; the listener was fixed to what the spec meant.
- **`force` is a decision, not a convenience.** The rename path closed
  tabs with `force` because the tab key is the path; the reviewer read it
  as "discard unsaved edits silently". The refusal now comes before the
  request — the same shape as every other refusal in the slice.
- **Silence is the defect, again.** One of five dropped files uploaded
  with no words was ledgered as minor by a task review and raised to
  merge-blocking by the final one; the rule "a refusal is data" also
  covers a partial success.
- **A hidden `<input type=file>` clicked programmatically bubbles through
  its `<label>`.** Resetting the upload folder on the label's click undid
  "Upload here" in the same batch until the handler skipped clicks whose
  target is the input. Found by the existing test, not by reasoning.
- **A test harness shared by two files lives in one module.** The DnD
  tests would have copied forty lines of fake-`fetch`; the move was done
  before the second file existed and verified as a pure relocation.
