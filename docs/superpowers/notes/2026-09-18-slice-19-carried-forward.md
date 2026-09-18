# Slice 19 — flow editor: what was left behind

Slice: `docs/superpowers/plans/2026-09-18-flow-editor.md`, spec
`2026-09-18-flow-editor-design.md`. Commits `c05ba8c..cad50aa` on
`feat/slot-webide-cordis` (seventeen) plus this note's. `flow.yml` — an
n8n-style DAG of trigger and action nodes — is the only driver of the
game. `@energy8engine/flow` (row `flow1`, hot) evaluates expressions,
validates the graph (cycles without a wait, ports, orphans, scenes),
interprets it (triggers `boot`/`on` with `busy: ignore | queue`, branches,
fan-out, `merge`, a 30 s timeout on every kind but `wait`, a trace capped
at 500), and ships eleven kinds. The page emits `ui.spin` and nothing else;
`present` records the spin-log entry with its plan. The host reads,
checks and serves `flow.yml`, mirrors the game's kinds through one
`mirror` helper (transitions, node types, flow kinds), relays traces. The
IDE has a Flow document on React Flow — palette, custom nodes with ports,
the last run painted on, writes chained through one reducer queue, a
refusal re-projects — and a Properties panel with a `scene` picker.
Sub-project C is closed; D (`spine`/`gif`/`video` node types, `tween`/
`sound` kinds) remains. Full Playwright alone: 116/116.

## Amendments made while running the plan

- **`ctx.events` is cordis's own lifecycle emitter** (a plain own property;
  the Proxy never reaches a provided service). The flow bus is reachable
  ONLY as `ctx.get('events')` / `ctx.reflect.get('events', false)`. Both
  READMEs and `RunCtx.ctx`'s doc say so. A rename (`flowEvents`) costs
  three files today and nothing later — do it before a plugin author pays.
- `on.props.busy: 'ignore' | 'queue'` (default `ignore`), `flow.busy()`,
  `RunCtx.report/busy/idle`, and `FlowNodeKind.timeout?: false` (`wait`
  opts out of the 30 s race) were added: without them two clicks meant two
  spins on one board, and a "press to continue" step died after half a
  minute.
- The `wait`/`on`-without-`event`/`ms` check is a WARNING (a fresh node
  from the palette must land so Properties can fill it in); the runtime
  fails such a node at run time; `event: ''` counts as absent.
- `sceneIds` for the host's `show`/`hide` check come from the file tree,
  parsed, not from `scenesHost.state()` — the scenes refresh lands later
  on the same `files/written` tick.
- `replace()` on a structurally equal doc (ignoring `ui`) is a no-op while
  the previous replace armed: a node drag no longer aborts a spin, and the
  `flow-kinds → flow` echo no longer double-boots. The bridge sends the
  boot trace once on socket `open`.
- The client starts a new trace on a DIFFERENT run number, not a greater
  one — the interpreter restarts at run 1 on every structural replace and
  every preview reload.
- `boot` has no target handle; an edge into it (hand-written) is a warning.
- The host answers the eleven built-in kinds before the game reports.

## Debts

1. **Custom-kind window on the host.** While the game's kinds are empty
   (before it boots, and during every preview reload — `mirror.clear()`),
   the host validates against the built-ins, so a flow using a
   project-plugin kind reports `unknown kind` and a PUT landing in that
   window is refused. Fall back to built-ins for `state.kinds` only; keep
   `null` for the check until a game has reported once.
2. **Two runs numbered 1 can concatenate in the client trace** when a
   structural replace resets the counter before any spin (both boot runs
   are "run 1"). Consumers are set-based, so only stale `ran` paint shows.
   A per-replace epoch in the trace entry is the fix.
3. **`present` throws "no 'play' service" on a diagnostics exit** in a
   composition without the play-loop row (it resolves `play` before
   checking); harmless in practice.
4. **`E8NodeData.trigger`** is computed and unused; the global `Delete`
   key (React Flow listens on `document`) can fire from a focused sidebar
   entry — mitigated by the mutual deselect; a pending move is dropped on
   unmount within 250 ms; the reducer `connect` treats implicit and
   explicit `out` as different edges (the UI dedupes on the resolved
   handle); React Flow's attribution badge is on.
5. **Interpreter**: a branch parked at `merge` is not "live" (`busy()` false
   while a run is stuck at a merge — documented); `present` keeps animating
   after `stop()` (`play.execute` has no signal); no test for a queued fire
   landing after `stop()`; schema validated per hop; `set` cannot write a
   literal string starting with `$`; `expr`'s `!` binds looser than a
   comparison (documented) and `1.2.3` tokenises to `NaN`.
6. **Host**: PUT double-refresh (write emits `files/written` → refresh, plus
   the explicit one — same shape as scenes); no host-side trace cap (the
   interpreter caps, the bridge batches).
7. **Page**: `#status` sticks at `spinning…` under a doc with no `present`;
   `'no flow row…'` overwrites the composition-errors status; the timeout
   message always says 20 s; a missing `play`/`mechanics` now names the
   service, not the row (the old `need()` named the row).
8. **IDE**: `flow.select` skips notify on the same id (scenes notifies);
   the scene select's empty option commits `''` (the host refuses; the
   form has no client validation by convention); `Pickers` React context
   is new public surface; the Preview is hidden while the Flow document is
   in front, so "watch the run paint while clicking Spin" needs the
   preview beside the graph — a shell question.
9. **Cycle dedupe by node set** collapses two elementary cycles over the
   same nodes in opposite directions (both are errors anyway).
10. **Tests**: `runtime.spec.ts`'s header still describes the plan debt;
    `flow-kinds` lacks the "provided after apply" bridge test;
    `reel-step`'s `winUnder` retry loop runtime is math-dependent;
    `shell.spec.ts` flaked once in a full run (`ERR_NETWORK_CHANGED`).
11. **Slice 14/12 carry-overs**: six `TS7016` in `ide-web`'s typecheck;
    four `/ide` sockets, none reconnecting.

## Method

- **A counter that crosses a process boundary needs a restart rule.** The
  client pinned "an older run is dropped"; the producer resets on every
  `replace` and every reload. Pair such a test with the producer's reset in
  view — "different" was the rule, not "greater".
- **A broadcast that echoes to its own source is a hidden restart.**
  `flow-kinds → flow → replace` booted the game twice. "`replace` on equal
  input is a no-op" is a property to test for any interpreter driven by a
  broadcast.
- **When a kind test fakes a sibling service, fake its readiness too.** A
  `scenes` fake without `ready` hid the boot race between two parallel
  GETs. Cross-row "awaits ready" chains are asserted, not assumed.
- **When the spec puts a side effect where its data does not yet exist**
  (`spin` "records" a plan `present` produces), flag it at plan time. The
  literal reading shipped with two skipped tests; the fix moved the record.
- **A spec name that collides with the framework is a permanent trap.**
  `ctx.events` was found by the Task 4 reviewer with a script against
  cordis rc.8, not by a type error.
- **A palette must be able to land an unconfigured node.** The error-level
  check refused every fresh `wait`; validation severity and "can the user
  reach the fix" are one decision.
- **A trace the canvas keys on must be a fresh array per frame.** In-place
  `push` painted the first frame of every run and nothing after; the only
  test sent one frame.
- **Serialising writes through one reducer chain** (each write reduces the
  latest doc) is the cheapest answer to "debounced move vs structural
  edit"; the same shape as slice 18's `pending` edits.
