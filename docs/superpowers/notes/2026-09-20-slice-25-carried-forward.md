# Slice 25 — tumble, turbo, skip, sound categories: what was left behind

Slice: `docs/superpowers/plans/2026-09-20-tempo.md`, spec
`2026-09-20-tempo-design.md` (answers R8, R9 and R12 of
`2026-09-19-paper-duel-port-feasibility.md`). Commits `7ba2aac..4facdca`
on `feat/slot-webide-cordis` plus this note's. Run autonomously. A
`tumble` step in the vocabulary, played by the reels board through the
legacy `TumbleController`; `mechanic-cascade` emits it under
`mechanics1.config.tumble`; `StepOpts { turbo }` threaded from the page's
checkbox through `present.turbo` to every board method; `play.skip()`
collapses a run and latches for its remaining steps; `sound` gains
`category`/`fade`, an `audio` kind ducks a category on an injectable clock;
`first-slot` has a turbo checkbox and a skip on a second click. Full
Playwright alone: 137/137.

## Amendments made while running the plan

- **`$event` IS the payload.** The spec wrote `set turbo = $event.payload.turbo`;
  `on` fires `{ event: <payload> }` and `emit` sends `resolve(p.payload)`
  bare, so the wrapper existed nowhere. The first page build wrapped its
  emit to satisfy the flow; rejected — `flow.yml` reads `$event.turbo`,
  the page emits `{ turbo }`, the spec is amended in place.
- **`tumble` lives on `mechanics1.config.tumble`.** The built-in `cascade`
  mechanic is a plain `{ id, requires, present }` with no per-mechanic
  config channel; the mechanics row reads the flag once and passes it as
  `mechanic.present(data, { tumble })` — `SpinMechanic.present` gained an
  optional second parameter in contracts. No `mechanic-cascade/schema.ts`.
- **`ui.skip` arms through `ctx.inject(['events'])`**, not a lenient read
  at apply time: `playloop1` precedes `flow1`, so the read was `undefined`,
  and a hot `flow1` re-apply would have stranded the old bus. Verified
  against cordis rc.8: the old effect is torn down, one subscription.
- **A skipped `tumble` re-seats `settled`.** A Task-1 ruling dropped the
  spec's "re-sync after" because `ReelSystem.cascade` assigns its `board`
  closure itself — true, and silent about the GRID: `TumbleController.step`
  returns early on every `_dead` path before its own `setGrid(settled)`,
  so a skip left the canvas one round behind `ctx.board`. The board now
  calls `reelSystem.setBoard(settled)` after the cascade, before
  `bindAll()` (idempotent on the clean path).
- **A skip latches for the rest of the run.** `TumbleController.step`
  re-arms `_killed = false` on entry and the board issues one `cascade`
  per vocabulary step, so a one-shot `skip()` collapsed the step in flight
  and an N-round chain played the rest in full. `executePlan` gained
  `hooks?: { onStepStarted }` (called synchronously after each step is
  invoked, before the await); the runtime re-fans `board.skip?.()` and
  the handlers' `skip` while latched; the latch and `lastBoard` clear in
  `execute`'s `finally`, so an idle `ui.skip` no longer destroys the `fx`
  overlay layer.
- **`revealWins` is not hurried under turbo** — the legacy `playWin` has
  no hold to halve; spec §4 amended.
- **`rafClock.tick` leaked a frame loop per completed fade**: `fn` cancels
  the ramp from inside the frame, `cancelAnimationFrame` on the executing
  frame is a no-op, and the loop rescheduled anyway — `dispose()` could
  not stop it, and pixi's instance pool would hand the pinned object to
  the next unrelated sound. A `stopped` latch; a rAF-shaped fake clock
  (call, then requeue) in the tests beside the subscription-shaped one.
- `track()`'s `remove` (end/stop) cancels an in-flight ramp on that
  instance (a hard stop mid fade-in, a one-shot ending mid-duck);
  `resolveWait` resolves a faded stop's `wait` because pixi's `complete`
  never fires on a manual `stop()`; `createAudio(state)` takes no deps;
  `dispose` clears `live` (the per-instance listeners stay — harmless).
- **`index.html` is pinned modulo `{{id}}` and the `<select id="mechanic">`
  block** (commit `1b341dc` gave the example a third `reel-step` option on
  purpose); `main.ts` and `flow.yml` stay byte-pinned.
- **`plugins/reel-step/src/step.ts` forwards `opts`** to `controller.step()`
  and its own `board.refill()` — every `ReelsBoard` method records
  `lastOpts`, so the un-opted refill reset it to `undefined` after every
  winning round (found by `__e8.lastStepOpts()` in the e2e). Turbo now
  reaches reel-step's per-round animation too.
- **`reels1.config.config.cascade.enabled` defaults to `false`** — with it
  off a `tumble` is an instant `setGrid` and a skip has nothing to
  interrupt; the tumble×skip e2e case passed with the re-seat fix reverted
  until the fixture enabled it. Two-round tumble spins are 0.67 % on the
  example math (300 spins), so that case accepts one round; the per-step
  latch is proven by the play-loop unit (spy order `tumble, skip, tumble,
  skip, …`). Case 2 (turbo faster) compares two losing spins so the round
  count is constant — a winning plain spin vs a losing turbo one measured
  turbo SLOWER. Plain 1792 ms, turbo 888 ms (`turboFactor 0.5`).
- `fresh: { symbol: null }` is rejected by `isPresentationStep` (`fresh`
  needs a real board leaf), so the reels board's null cast for an empty
  fresh cell is unreachable through `executePlan`.

## Debts

1. **Two switches for one feature**: `mechanics1.config.tumble: true` does
   nothing visible unless `reels1.config.config.cascade.enabled: true` —
   the board could force it for a `tumble`, or the host could report the
   pair. Name it in the README before a second cascade project ships.
2. **`TumbleController.skip()` leaves alpha/scale residue** on cells
   killed inside its `Tween.delay(t.wait)` window (`_resetPositions` runs
   before the remove tweens start); the re-seat fixes the data, not the
   look. `ReelStepController.skip()` snaps a `_pending` grid — the tumble
   controller should too (`packages/*`, off limits).
3. The skip latch fans `reelSystem.skip()` once per remaining step; each
   call destroys the `fx` overlay's children. `turbo` halves only what the
   reels board animates (`spin`, `cascade`); `revealWins` and a project
   handler decide their own.
4. Sound ramps are per instance, not per category bus; the shell's
   persisted volume/mute is 26's. `audio-state`'s per-instance listeners
   outlive `dispose`.
5. `fresh` is gravity-derived from `removed` per column; `deriveDrops`
   counts rows from the renderer's grid while the math counts from
   `round.grid` — a short column yields `symbol: undefined` → one clean
   `plan[i] malformed` diagnostic. `drops` semantics beyond the legacy
   controller's are unread.
6. A `$event` with no payload writes `null` into `turbo` silently (spec
   sanctioned); a `present.turbo` literal other than `'true'`/`'false'` is
   `false` without a diagnostic.
7. Example `main.ts` keeps growing prose per feature (turbo, skip, hooks);
   the README pair's turbo sentence was rewritten once already. `ide-web`'s
   six TS7016 remain (since slice 12).

## Method

- **The default adapter nobody injects is the one nobody tests.** Every
  ramp test injected a subscription-shaped clock; production's `rafClock`
  is call-then-reschedule, and the leak lived only there. Test the
  production adapter once, with a fake that has its shape.
- **"The library does it itself" must name which half.** `cascade` sets
  the `board` closure; the grid is set by a controller that exits early on
  skip. A ruling that drops a spec line on such a claim needs the second
  half read too.
- **A shape the spec assumes about the bus is a claim to verify in
  preflight** — the preflight table even reasoned about `$event.payload`
  resolving `null`, on a shape nobody had read.
- **An e2e case that proves a fix needs its negative control** — revert
  the fix, watch the case fail. The tumble×skip case passed vacuously on a
  default (`cascade.enabled: false`) that made the feature instant.
- **A one-shot skip against a controller that re-arms on entry** — read
  the controller's ENTRY, not only its `skip()`, before deciding skip is
  one call.
- **Measure the rate of a rare fixture outcome before writing a search
  loop** (0.67 % two-round spins would have looped 40 tries and thrown).
- `npm test -w a -w b -- <filter>` applies the filter to EVERY workspace
  — run filtered and unfiltered suites in separate commands.
- A sub-agent's `git stash push` (immediately popped) happened again; the
  probe-on-a-copy rule holds.
