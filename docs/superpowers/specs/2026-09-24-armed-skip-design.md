# A skip that lands before its plan — design (slice 34)

Date: 2026-09-24. Branch: `feat/slot-webide-cordis` at `29e6439a` (slice 33).
Source: slice 32's debt 10 (still open in slice 33's note): a skip that lands
while the round's request is in flight is dropped. Decided with the user:
option A — the network nodes ARM the play row; a skip while armed waits for
the plan.

## 0. Rules

- `packages/*` is not edited.
- Every fix carries a unit test in its package; the browser proof is §3's e2e.

## 1. The problem

`play.skip()` (`engine/game/play-loop/src/runtime.ts`) collapses the run in
flight and latches for its rest — but only when there IS one: with no live
`execute` (`lastBoard` unset) it returns. That guard is deliberate: an idle
`ui.skip` used to reach the last board, and `ReelSystem.skip()` wipes the `fx`
overlay layer.

A round is not live only while its plan plays. Between a Spin click and
`present` the flow runs `spin` — a POST to the session — and a second click
(or a `ui.tap`, which the template also routes to skip) in that window lands
on no live run and is dropped. The player tapped to skip and watched the whole
round. On a loaded machine the window outlasts `tempo.spec`'s 100 ms wait, and
the case fails (2.2–2.4 s against 1 s, measured in slices 32 and 33).

## 2. The change

### 2.1 `PlayService.arm()`

```ts
/**
 * "A plan is on its way": until the next `execute` starts, or the returned
 * release is called, a `skip()` with no run in flight is KEPT, and that next
 * `execute` starts latched — every step collapsed as it starts, exactly as a
 * skip mid-run does. Arms nest (a count, not a flag); a release is
 * idempotent. `execute` starting disarms everything, so a skip AFTER a plan
 * began is the ordinary mid-run skip and one after it ended is dropped as
 * before. Never throws.
 */
arm(): () => void;
```

In the row: a set of live arm tokens and a `pending` flag.

- `skip()` — a live run: as today. No live run and at least one arm: `pending
  = true`. Neither: dropped, as today (the idle guard stands).
- `execute()` — at its start, `skipped = pending`, then `pending = false` and
  every arm is released. The latch then does the rest unchanged (`onStepStarted`
  fans out; `finally` clears it).
- The last release with no `execute` having started clears `pending`: a skip
  kept for a round whose request failed does not hurry the NEXT round.

### 2.2 The flow's network nodes arm it

`spin` and `step` (`engine/game/flow/src/kinds.ts`, through `playThrough`):

- before `session.play(request)`: `const release = play?.arm()` — `play` read
  leniently (`ctx.reflect.get('play', false)`), since a composition without a
  play row still spins;
- on the `failed` out (no result, a thrown session): `release()` at once;
- on `result`: released when the run goes idle (`idle().then(release)`) —
  normally long after `present`'s `execute` already disarmed it; this only
  matters for a flow that takes `result` somewhere other than `present`.

A tap that dismisses a win overlay BEFORE the next free spin's `step` is not
armed and is dropped — the reason option B was declined.

### 2.3 Not changed

- `executePlan` (`play-loop/src/index.ts`), the latch, the idle guard.
- A caller of `execute` that never arms (the editor page's own plays, a plugin
  playing a plan) behaves as today.

## 3. Tests

- play-loop (`runtime.test.ts`, the real row): a skip with no run and no arm
  is dropped (board `skip` not called, next `execute` not latched); armed →
  the next `execute` fans out at its first step; the release before any
  `execute` clears it (the following `execute` is not latched); two arms, one
  released — still armed; `execute` starting disarms (a skip after the plan
  ended is dropped even though the spin node has not released yet).
- flow (`kinds.test.ts`): `spin` and `step` arm before `session.play` is
  called and release on `failed`; on `result` the release waits for `idle`; a
  composition without `play` still spins.
- e2e (`tempo.spec.ts`): a new case — the page's `/api/spin` held 800 ms by
  `page.route`, `skip()` 100 ms after `spin()`: the spin resolves within
  `800 + 1000` ms of the skip (a played-out round is ≥ 2 s on top of the
  hold). Case 3 keeps its 100 ms wait; its doc stops claiming the POST
  "settles well under that".

## 4. Not here

- F9, the load-budget specs (a loaded machine, proven by A/B in slice 33).
