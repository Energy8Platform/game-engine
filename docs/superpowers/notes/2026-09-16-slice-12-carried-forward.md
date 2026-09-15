# Slice 12 — the headless loop: what was left behind

Slice: `docs/superpowers/plans/2026-09-15-headless-loop.md`, spec
`2026-09-15-headless-loop-design.md`. Commits `2fecaab..96b3df6` on
`feat/slot-webide-cordis` (eight). An agent without a browser in hand now
has three commands, each one JSON document on stdout: `e8 check` (the
panel's own verdict, one `checkSource` for route and CLI), `e8 spin --n
--seed` (RTP, hit rate, max win, stage histogram, percentiles, seeded and
deterministic), `e8 shot --spin` (a settled full-page PNG from Playwright's
Chromium, `loadMs` from navigation to `#status`). The e2e suite carries a
load budget (`LOAD_BUDGET_MS` = 2500, median 809 ms × 3 on this machine,
`E8_LOAD_BUDGET_MS` overrides). §10 p.6 of the parent spec is closed.

## Debts

1. **`spin` counts first responses.** A round with `roundComplete: false`
   (a bonus game) is tallied by its first response and reported as
   `incompleteRounds` with a warning; stepping rounds to completion is the
   next math slice. `first-slot` has no such round, so no test plays one.
2. **Stage-binding errors carry no `at`.** `checkActionStages` reports an
   action naming an undeclared stage without a line; the parser holds the
   block's line in `parseActions` but `ActionDef` has no position field.
   ~6 lines across `spin-parser`, `contracts`, `schema.ts`, and eight
   `toEqual` assertions in `spin-parser/tests/parse.test.ts` to update.
3. **`where` differs between panel and CLI** when `e8 check` is given an
   absolute path (the panel says `game/script.spin`). Relativise under
   `cwd` if it bites.
4. **`shot`'s readiness race** (`within` timer vs Playwright's own) is
   redundant; `ready.then(() => true, () => false)` would do. The `--ide`
   success path (needs `dist`) has no unit test.
5. **`run()`'s `ide`/`dev` branch** still touches `process` for signals;
   the one-shot commands are pure over `io`.
6. **`session-dev` defaults `serverSeed` to a constant**, so `e8 dev`
   replays the same spin sequence after every restart. `e8 spin` randomises
   and echoes its seed; the dev host does not. Decide whether the dev game
   should.
7. **`e8 shot` boots a whole IDE host** to obtain a preview URL — fine
   locally, wasteful for a queue. The `compute` seam of §6 (cloud) is still
   three functions, not a service.

## Method

- **One verdict, one function.** The CLI's first `check` re-derived the
  panel's severity policy and missed a whole class of errors; the fix was
  not "match the policy" but "call the same function", and the test
  compares the route's answer with that function on the same text.
- **A seed that defaults to a constant hides a dropped seed.** The
  determinism mutation survived until a second seed was asserted to differ;
  "same seed → same result" alone is satisfied by a server that ignores
  the seed.
- **`spinning…` is also a change.** The spec said "wait for `#status` to
  change"; the first change is the click's own synchronous write. Settled
  means "neither the text before the click nor the in-flight text".
- **A CLI that can throw is not one JSON document.** `run(argv, io)` with a
  top-level catch, tested by injecting a command that throws, is what made
  the contract a fact; the stdout drain before `exit` is the other half.
- **An orphan from a mutation run poisons the next suite.** A guard
  removed for a mutation let a fake hang past vitest's timeout, the worker
  died mid-`shot()`, and the host it had started stayed up; the next
  Playwright run found the port busy. `pgrep` after every mutation, not
  only after the suite.
