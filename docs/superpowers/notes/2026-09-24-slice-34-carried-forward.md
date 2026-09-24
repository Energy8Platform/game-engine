# Slice 34 — a skip that lands before its plan: what was left behind

Slice: `docs/superpowers/plans/2026-09-24-armed-skip.md`, spec
`2026-09-24-armed-skip-design.md` (slice 32's debt 10). Commits
`2d7c5bf5..7b8f427f` on `feat/slot-webide-cordis` plus this note's. Designed
with the user: option A — the flow's network nodes ARM the play row; option B
(keep any skip while `flow.busy()`) was declined because a tap that closes a
win overlay mid-bonus would have skipped the next free spin.

What shipped:
- **`PlayService.arm(): () => void`** (`play-loop`). While any arm is live
  and no `execute` runs, `skip()` is KEPT (`pending`); the next `execute`
  starts latched — collapsed from its first step, the ordinary latch after
  that — and spends every arm. The last release with no `execute` clears a
  kept skip (a failed request does not hurry the next round), and a NEW
  `arm()` drops one kept before it (a leaked arm does not carry a stray tap
  into the next round). With no arm, the idle guard stands: dropped.
- **The flow's `spin`/`step` arm it** (`playThrough`): before
  `session.play`; released at once on `failed`, on `result` when the run goes
  idle (normally long after `present`'s `execute` spent it). A composition
  without a play row still spins.
- **`tempo.spec` case 3b**: `/api/spin` held 800 ms by `page.route`, the skip
  sent once the held request is seen — the round resolves within 1800 ms of
  the skip. With the arm line disabled it failed at 2620 ms. Case 3's doc no
  longer claims the POST beats its 100 ms wait.

Unit gate: play-loop 87, flow 138, flow-fx 61, reels 58, ide-bridge 77,
ide-web 33; typecheck 0 in all six.
Full Playwright alone (`E8_E2E_HOST_PORT=5779`, load average ~4.5): 154/154
in 10.4 min — the first fully green run since slice 31; the load-budget specs
passed too on a quieter machine, which is slice 33's A/B from the other side.

## Amendments made while running the plan

- **A new `arm()` clears `pending`** (final wave): the whole-slice review
  found that an arm can leak — `present` failing on mechanics diagnostics
  never calls `execute`, `flow.stop()` aborts mid-request — and a tap while
  it was live (an error card's dismiss) would have hurried the next round.
- The e2e skip waits for the route to SEE the held request rather than a
  fixed 100 ms: a skip before `spin` arms is still dropped (by design), so a
  timed skip would race the arm the way case 3 raced the POST.

## Debts

1. **A flow that waits before `spin`** (a `wait`, an `emit { wait }` between
   the `on` trigger and `spin`) leaves a window where a skip is still
   dropped — not armed yet. The shipped flows reach `spin` in microtasks.
2. **Two overlapping plans (`busy: parallel`)** — a second `execute` resets
   the first's latch (`skipped = pending`). The `finally` already did that
   before this slice.
3. **A skip kept for a plan collapses from its FIRST step** — the reels'
   spin never visibly starts. That is what "skip" means for a round whose
   plan had not begun; noted in case someone wants a minimum spin.
4. Carried: F9 (bucket B, reel system into the engine); the load-budget
   specs fail on a loaded machine (slice 33's A/B); i18n, mobile tier, glyph
   font; slice 30's cell-copy `refresh`/orientation; slice 29's
   `emit { wait }` vs abort.

## Method

- **A timed trigger in an e2e is a race by another name**: case 3 raced the
  POST with 100 ms; 3b rendezvous with the request through `page.route`.
- **A latch needs its un-latch named for every path that skips its
  consumer**: `execute` spends the arm, but a round with no `execute`
  (diagnostics, stop) had nothing to spend it — found only by tracing the
  paths where the consumer never runs.
