# Slice 29 — presentation steps, value expressions, small debts: what was left behind

Slice: `docs/superpowers/plans/2026-09-21-presentation-steps.md`, spec
`2026-09-21-presentation-steps-design.md` (round 2 of the paper-duel port:
N2, N3, N6, N7; N1/N4/N5 are slice 30). Commits `ff0bb2d0..3e765803` on
`feat/slot-webide-cordis` plus this note's. Designed with the user (B for
the beat mechanism, the value syntax, the small ones); run per the standing
method, three waves of parallel implementers on disjoint packages. What
shipped: the `emit` presentation step (a beat on the flow bus a mechanic
may put in its plan, served by the play loop, `wait: true` holding the
plan), a promise-returning bus, `fire` that settles when a run drains,
`on { busy: parallel }`, the flow `emit` kind's `wait`; one value resolver
(`resolveValue`: `$`-expressions with arithmetic, `{…}` templates,
`| currency/int/fixed:N/multiplier`), used by every kind that took a
`$path`, plus `shell`'s `freeSpinsCurrent`/`freeSpinsTotalWin`/
`bonusTotalWin`; the dev wallet charging an action's cost
(`SessionInit.actions`, `/api/session`), `e8 spin`'s `cost`, `GET /api/spec`
frozen by `e8 build` and the default-target `info` line, `reels.origin:
center`, a paytable derived from `game/spec.json` in the shell row, the
example's win text as a currency template, an e2e for a parallel branch
held by `emit`. Unit gate: contracts 102, flow 186, flow-fx 46, play-loop
64, session-host 16, reels 52, shell-pixi 29, e8 6, ide-host 501; typecheck
0 errors everywhere incl. `ide-web`. Full Playwright alone: 149/149 in
9.4 min, first pass (148 + the new parallel-branch case).

## Amendments made while running the plan

- **`||`/`&&` return the operand** (JS semantics, both sides evaluated) —
  the brief's own `$result.win || 0 | int → '13'` was unsatisfiable under
  boolean coercion. Inside a parenthesised group feeding a comparison it is
  the operand that is compared. A `-` inside a `$path` is therefore
  subtraction (`$my-var`); no document in the repo carries one.
- **A missing value renders `NaN` through a format** (`$missing | currency`
  → `$NaN`): the plan's `format()` used a bare `Number()` and a typo'd path
  rendered `$0.00`. The spec says NaN propagates; it does now, in formats
  too.
- **`prop` refuses a `NaN` dynamic value into a number prop** — the one kind
  that let it through (schemastery's `Schema.number()` accepts `NaN`, the
  node vanished silently). Same message as the literal branch.
- **`present` opts out of the 30 s cap** (`timeout: false`, as `wait` and
  `emit`): a beat chain (`emit { wait }` × cascade rounds) can outlast it,
  and the failure mode was a shell stuck `busy: true` with no spin-log
  entry. `ui.skip`/`stop()` are the escapes; a board step that never
  resolves now holds the flow until one of them.
- **The reels `origin` mount/unmount pair the plan wrote was wrong**:
  `remountNode` mounts the fresh entry BEFORE unmounting the old one, and
  `board.view` is one persistent singleton — both toggle directions tore it
  out of the new wrapper. Superseded: always a wrapper, an `update` that
  re-places in the same wrapper (so an own-prop change never remounts), an
  `unmount` that touches `board.view` only when still its child; the
  ordering hazard is pinned in both directions. Also `-(g?.centerX ?? 0)`
  produced `-0`; `g ? -g.centerX : 0`.
- **The paytable fetch happens before `createPixiShell`** (the shell has no
  game-info setter), once, only for an empty `sections`; the row's `apply`
  is async like `session-host`'s.
- **A template span reading `null` renders `''`**, not `'null'` (the spec
  said `String()`ed; the e2e asserts `'after '`).
- **`emit { wait }` to a same-flow `on { busy: ignore }` holds nothing**:
  the fire is dropped while `present` is live. `busy: parallel` is what
  gives `wait` something to wait for. Documented on the kind.
- `freeSpinsCurrent`/`freeSpinsTotalWin` reach `setFreeSpins`, which the
  real shell answers by clearing a `bonus` readout — in bonus mode
  `bonusTotalWin` is the sibling to use; the two free-spins siblings are
  applied together (one refused refuses both). `ShellLike.state.bonus` is
  `{ label, value } | null` — `totalWin` lives in `state.freeSpins`.
- `e8 spin`'s division guard: a `cost` of `0`/non-finite divides by 1 and
  is still reported as read; the dev wallet, by contrast, charges `0` for a
  declared free action (`?? 1` covers a MISSING action only).
- The `x6` state of the e2e's parallel branch is unobservable by polling
  (the inner `prop`, the run settling, the `emit` resolving and the outer
  `prop` are one microtask chain after the timer) — the test wraps the
  interpreter's live trace array's `push` and records the win text at each
  entry; `inner:next` must carry `x6`. It boots on the example's own flow,
  installs the observer, then `PUT`s the parallel flow (a new shape
  re-arms and fires `boot` again).
- `game-spec.test`'s "descriptive spec.json" case uses `fixtures/project-flow`
  — `project-simple` has no `spec.json`, and three suites rely on that.

## Debts

1. **Bucket B (`packages/*`)** unchanged from slice 28: `ReelSystem.skip({
   overlays: false })`, `TumbleController.skip()` residue, `PRELUDE_NUMBERS`,
   the SDK transport leak, an `i18n` hook. Plus: the shell's `setFreeSpins`
   clearing `bonus` is the legacy controller's rule, not the flow's.
2. **Bucket C (product)**: `{{`/`}}` brace escapes (a `text` prop cannot
   show a literal brace pair inside a template); numeric props
   (`wait.ms`, `tween.x`, `sound.volume`) as expressions; beats from the
   built-in `classic`/`cascade` mechanics (`present.round`); `present`
   announcing every step on the bus; a mobile asset tier per node; the CLI
   `--base` other than `/`; a fresh clone's dist prerequisite.
3. **N1/N4/N5 — slice 30**: composite symbol states (orb art + `$cell.mv`,
   badges), named states + a `playState { cells, state }` step, a `text`
   count-up tween (`tween { prop: text, from, to, format }`).
4. **`emit { wait }` races no abort signal**: a foreign bus listener
   returning a never-settling promise leaves that one branch pending past
   `stop()` (flow-started runs are settled by `stop()`; the old epoch is
   discarded, `busy()` unaffected). Two lines (`Promise.race` with the
   signal) if it ever bites.
5. **`e8 spin`'s division guard has no test** (a fixture with `cost: 0`
   would need a real-server run).
6. **The e2e observer couples to `trace.push`** (the interpreter's `trace()`
   returns the array by reference and `doReplace` clears it in place —
   both true, neither a documented contract); exposing `onTrace` on
   `window.__e8` (`main.ts`) would make it a subscription.
7. **The `build` info line is pushed before the hard-fail paths** (a failed
   build's diagnostics carry it beside the fatal one) — harmless, only
   `error` flips the exit code.
8. **paper-duel round 3**: the example (`engine/examples/paper-duel`,
   gitignored) was NOT re-measured on these seams in this slice; its
   mechanic can now emit `{ kind: 'emit', event: 'pd.round', … wait: true }`
   per cascade round and its flow can draw meters/plaque/floats from
   `$event` — the round-3 note is the next probe.
9. **Machine hygiene**: the orphaned Playwright `chrome-headless-shell`
   family (PIDs 23248–23253, since 2026-09-19 22:00; PID 82908 since a
   Saturday) is still there — not this session's; the user was told.

## Method

- **A plan's code block is a claim, not a proof**: the reels
  mount/unmount pair read fine and was wrong under the runtime's actual
  call order; the reviewer traced `remountNode` line by line. Rule: for a
  node type with structural own props, check whether the runtime remounts
  or updates BEFORE writing the pair — an `update` is the codebase's own
  precedent.
- **A test that mirrors the brief's sketch can prove nothing**: T2's
  parallel-run test held `res: null` only because the parent was gated
  before `spin`; T6's "free action" case passed a `roundId` and re-proved
  the step rule. Both were caught by reviewers reading the fixture, not the
  assertion. Rule: for "not shared"/"not charged" claims, plant the value
  that WOULD leak.
- **The brief's own test can contradict its own code**: `$result.win || 0
  | int` needed value-returning `||`; the implementer chose right and said
  so. Rule: a deviation flagged in the report with the reason is what a
  fix round is for — ratify or reverse in the ledger, then in the spec.
- **A polling assertion cannot see a state that lives inside one microtask
  chain**; the implementer found the real observation point (the trace
  record) instead of adding a sleep. Rule: when a poll never sees a state,
  ask what tick it lives on before widening the timeout.
- **Parallel implementers, one worktree**: eight implementers and eleven
  reviewers overlapped; the rules that held — commit only your listed
  files, never `git stash`/`checkout`/`restore`, retry on `index.lock`,
  one workspace per test command. One implementer used `git stash` to
  probe before the rule was written into dispatches; nothing broke, the
  rule is in every later dispatch. The controller's own `--amend` on a
  shared HEAD was a risk taken once and not again.
- **Two Importants from the whole-branch review were seam facts no task
  could see** (the NaN path through `prop` into schemastery; `present`'s
  cap against a flow-authored hold). The broad pass earns its place on the
  seams, not on the diffs.
