# Slice 42 — what paper-duel round 7 found: what was left behind

Slice: `docs/superpowers/plans/2026-09-28-paper-duel-round7.md`, spec
`2026-09-28-paper-duel-round7-design.md` (its §10 records the amendments).
Commits `8f0e44aa..d4b3eff3` on `feat/slot-webide-cordis` plus this note's.

Source: the paper-duel port's round 7 (F15–F20 in
`docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`), each
measured on the running game.

What shipped:
- **F15 — `view()` answers the copy on screen.** A document nested in a
  shown host answers the copy inside that host (the latest shown host
  first); `views()` lists every copy. flow-fx `tween`, `__e8.nodeProps`,
  the scene-edit highlight and gizmo follow with no change of their own.
- **F16 — load, pose, show.** Public `scenes.load(id)` and a flow `load {
  scene }` node. A loaded host is a *pending host*: until something is
  shown, `view()` answers the copy inside the latest loaded host, so a pose
  set through the view between `load` and `show` is on screen in the first
  frame — nested documents included. A load or a `hide` re-runs `update`
  only on nodes that use one of its paths (types without `assets()` stay in
  every sweep), and a `hide` keeps the art a pending load readied.
  `load('typo')` is `show`'s own `notDeclared`.
- **F17 — `emit { wait: true }` waits for a plugin's promise.** It always
  did; its description and doc comment now say so, and a flow test pins it.
- **F18 — text `letterSpacing`, `lineHeight`, `fitWidth`.** `fitWidth` is
  the node's own px before its `scale`: the font shrinks (never grows) to a
  0.5 px step; a wrapped text shrinks its wrap width, line height and
  letter spacing by the same factor, so the authored line breaks stay.
- **F19 — `scenes1.fonts`.** Each entry is a `FontFace` added to
  `document.fonts`, loaded alongside the boot GET and before the first
  mount; a failed one is one diagnostic naming its `src`; the faces leave
  on dispose.
- **F20 — the bar can be hidden and gives its height back.** Flow `shell {
  visible }`; shell-pixi provides a `Proxy` of the Pixi shell (methods bound
  to the real one) whose `barHeight`/`safeArea.bottom` answer 0 while
  hidden; the scenes' per-tick inset check re-fits by itself.

Unit gate: scenes 247, flow 146, flow-fx 62, shell-pixi 34, game-runtime 109,
scene-edit 99, ide-client 826, ide-host (alone) 554; typecheck 0.
Full Playwright alone (`E8_E2E_HOST_PORT=5779`): 171/171 (14.4 min). A first
run lost `runtime.spec:84`'s load budget (4.4 s > 2.5 s) with the machine at
load average ~21–26; alone it passed 3/3, and the rerun was clean.

## Debts

1. **A view-set pose on a pinned node is re-placed by a re-fit** — the one
   `shell { visible }` triggers, as any resize does. Order an intro as:
   hide the bar, one tick, then pose.
2. **A `replace` that lands before the boot GET mounts text before the
   fonts load** (the editor's first `tell('replace')`, an ide-bridge
   `scenes` frame during boot): that text stays in the fallback face until
   its document remounts. The game's own boot path waits for the fonts.
3. **Small**: a caller that does not await `load()` sees the own mount
   until the queued load starts (the pending host is recorded in queue
   order with `hide`); the 0.5 px floor can land one step under the exact
   ratio; `setVisible` hides the whole Pixi shell (popovers, modals too) —
   `packages/shell` behaviour; no warning for a font `src` outside
   `assets/` (it will not ship); the `fontSet` test seam is named unlike
   the brief's `fonts`; a text updated at `scale: 0` skips the fit
   (`bounds.width` would measure it exactly); flow's `kinds.test.ts`
   imports `pixi.js` without declaring it (hoisted via scenes); no test
   pins `view()` for a copy of a copy (the host is `chain[0]`, correct by
   trace).
4. **Not here** (round 7's "still not the original"): a `rope`/`mesh` node
   type, i18n hooks, a mobile asset tier, pulsing text.

## Method

- **An e2e that reads back through the same lookup the action used proves
  nothing**: the nested tween's readback went through `view()`, like the
  tween — a wrong copy was invisible. Read every copy independently.
- **A pose set through props is not a pose set through the view**: `prop`
  writes the document's props, which every re-apply re-derives, so it
  survives anything and tests nothing. Pose the way the game does.
- **`document.fonts.check` is true for a family with no face**: prove a
  font with a loaded `FontFace` and a width unlike a fallback control.
- **A new field measured on a view must say what it measures before the
  view's own transform** (`fitWidth` read a scaled width after the first
  update).
