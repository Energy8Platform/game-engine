# Slice 44 — sidebars per tab: what was left behind

Slice: `docs/superpowers/plans/2026-09-28-sidebars-per-tab.md`, spec
`2026-09-28-sidebars-per-tab-design.md` (§3–§4 amended by the final review's
rulings). Commits `0364081b..36b8302a` on `feat/slot-webide-cordis` plus
this note's. Run without the user after the spec ("как обычно без меня").

Source: the user's feedback of 2026-09-28, items 5–7 — Symbols' list on the
left, Reels' settings on the right, and "the left sidebar should depend
strongly on the tab; if the tab passes nothing, nothing should be in it;
the same for the right — it confuses".

What shipped:
- **A tab declares its sidebars.** `shell.document` / file viewers carry
  `sidebar` / `sideRight` keys; a `shell.sidebar` entry may carry the
  `sideRight` that goes with it (the Scenes list → scene Properties).
- **Left**: an activity view (Explorer / Projects / Scenes) shows over the
  tab's until a tab with its own left sidebar becomes active, or the button
  is pressed again; otherwise the tab's own; otherwise the column is 0 wide.
  At boot the Explorer (Projects with no project) fills an empty left — a
  deep link to Symbols/Flow keeps their own.
- **Right**: the first of [the tab's `sideRight`, the picked view's] whose
  plugin says it has content (`ctx.shell.setSideRight(key, on)`); else
  collapsed. A Flow node selected no longer hangs over the Preview. Scenes,
  Flow and Symbols selections no longer clear each other. The right sidebar
  resizes from its own left edge (width remembered).
- **Sidebars shown once stay mounted** (hidden otherwise), like the panes.
- **Symbols**: the symbol list is the tab's left sidebar; the canvas fills
  the document and takes Explorer file drops (with a symbol selected: its
  selected state; with none: a new symbol named from the file).
- **Flow**: the node palette is the tab's left sidebar ("Nodes"); click-add
  still centres the node on the canvas; with no `flow.yml` it says so.
- **Reels**: the settings are the tab's right sidebar; the canvas follows
  the composition's rows itself and re-applies only a reel row that changed
  (from anywhere — the Composition screen included).
- Fixed on the way: the Reels plugin did not inject `symbols` (opening Reels
  crashed the shell in a real browser); the Explorer refetches its tree
  when shown again; Explorer drops were refused by Chromium (`dropEffect
  'copy'` against an effect of `move` — a synthetic-drop e2e hid it).

Unit gate: ide-client 880, ide-web 39, ide-host (alone) 554; typecheck 0.
Full Playwright alone (`E8_E2E_HOST_PORT=5779`): 178/178 (11.3 min).

## Debts

1. **Mount-once keys are never pruned**, and `setSideRight` flags are not
   cleared when a plugin disposes — a project switch that re-registers a
   shown key mounts the new component hidden at once. Harmless today.
2. **The symbol canvas iframe takes no pointer input** (`pointer-events:
   none`, so Explorer drags reach the document): a future pointer feature in
   symbol mode must lift it.
3. **The list's own chip/row drop targets remain** but cannot be reached
   while the Explorer is shown (they share the left column); the canvas is
   the reachable drop target.
4. **Small**: a picked activity view does not come back after a tab with
   its own sidebar cleared it; closing a tab can clear a pick when its
   neighbour declares a sidebar; the always-on Reels right sidebar cannot be
   collapsed by hand; the Reels layout below 1000 px is now just the
   sidebar's width; the resize handles have no keyboard support (as before).
5. **Not here**: the scene tree and the Composition's row list stay in their
   documents; undo/redo is slice 45.

## Method

- **Layout bugs live where jsdom does not**: an absolute handle in an
  unpositioned aside, a drag an iframe swallows, a drop Chromium refuses —
  every one passed the unit suite; only a real-browser e2e with a real
  drag (not a synthetic `drop`) or a bounding box catches them.
- **A test harness more lenient than production hides wiring bugs**: the
  Reels harness provided `symbols` directly, so a missing `inject` only
  crashed in the browser. Compose the harness the way the app does.
- **A rule stated for the common tabs needs checking on the odd one**: the
  "picked view's right sidebar wins" order was written for Scenes and broke
  Reels, the one tab with a right sidebar and no left one.
