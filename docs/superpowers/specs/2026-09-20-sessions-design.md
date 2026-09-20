# Sessions and the spec prelude — design (slice 23)

Date: 2026-09-20. Branch: `feat/slot-webide-cordis`. Answers R1 and R13 of
`docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`. Slice
22 (contract holes) precedes; 24 (text + data-bound props), 25
(tumble/turbo/sound), 26 (shell, build — with the user) follow.

## 0. Where this sits

A round on e8-server is `StartRound` followed by zero or more `Step(round_id,
action)` calls until `round_complete`. The IDE plays `StartRound` only: free
spins, retriggers, bonus rounds, buys that open a session — half of any
real game — are unreachable from the flow, the CLI's `e8 spin` measures
first responses only, and a game whose math is a `game.spec.ts` plus a
logic-only `.spin` cannot be loaded because nothing prepends the spec
prelude. Three mechanical additions: `roundId` on the spin request (→
`Step`), a `step` flow kind, the CLI stepping rounds to completion; and the
host assembling `prelude + logic` from a `GameSpec`-shaped `spec.json`.

## 1. Goal

A flow `spin → present → if roundComplete → (false) step → present → …`
plays a whole round in the preview; the spin log holds every response of
the round under one `roundId`; `e8 spin` reports RTP over complete rounds;
a project whose `game/spec.json` is a `GameSpec` (symbols with pays,
actions, grid) and whose `game/script.spin` holds only the logic plays in
the preview and passes `e8 check`. `first-slot`'s math is unchanged; its
flow gains the step loop (a no-op for a script with no sessions).

## 2. Non-goals

- `GetRound`/resume after reload; player/balance bookkeeping; buy-mode
  UI (26); per-stage scenes/transitions beyond what `show`/`hide` do.
- A `game.spec.ts` loader in the host (TypeScript at runtime); the author
  ships the same object as `spec.json`.
- Turbo/skip of a long round (25).

## 3. `Step` in session-dev (R1)

```ts
// @energy8engine/contracts spin.ts
export interface SpinRequest { gameId; action; betLevel; params?; roundId?: string }
```

`session-dev`'s `play(req)`: with `req.roundId` it calls gRPC `Step({
round_id, action, params_json, request_id })` instead of `StartRound`; the
answer maps to the same `SpinResult` with `roundId = req.roundId`. An
e8-server error (`unknown round`, wrong action) is the existing throw path
(`[session-dev] e8-server: …`). The preview route `POST /api/spin` forwards
`body.roundId`. A `SpinResult` already carries `nextActions`,
`roundComplete`, `spinsRemaining`, `roundId`.

## 4. `step` flow kind (R1)

Built into `@energy8engine/flow`:

| prop | schema |
|---|---|
| `roundId` | `string` default `'$result.roundId'` |
| `action` | `string` default `'$result.nextActions.0'` |
| `betLevel` | as `spin` (optional string, literal or `$path`) |

`run`: resolves the three through `vars` (`readPath` follows numeric
segments into arrays — `nextActions.0`); a `roundId` or `action` that
resolves to nothing → `report` and `{ out: 'failed', vars: { error } }`;
otherwise POSTs `{ roundId, action, betLevel }` to `/api/spin` and returns
`{ out: 'result', vars: { result, request } }` exactly as `spin`. `outs:
['result', 'failed']`. `present` is unchanged (it presents whatever stage
the result names; `mechanics1.stages` must bind every stage the script
emits — a missing binding is the existing `check` diagnostic). The
`actions` warning never fires for a `$path`.

The example/template `flow.yml` gains `done` (`if`, `when: $result.roundComplete`)
after `draw`: `true → idle`, `false → next (step) → draw`. For `first-slot`
every round completes on the first response, so the loop is dormant; the
e2e proves it on a session script.

## 5. `e8 spin` steps rounds (R1, the CLI's own promise)

`compute/spin.ts`: after each `StartRound`, while `!roundComplete &&
nextActions.length > 0` the CLI plays `Step` with `nextActions[0]` (cap 500
steps per round → a diagnostic `round did not complete in 500 steps`);
`rtp`/`wins`/`maxWin` are over the round's `totalWin` (the last response's);
`stages` counts every response; the report gains `steps` (total Step calls)
and drops the "did not complete on the first response" warning. `e8 spin
--action X` still names the entry action.

## 6. The spec prelude (R13)

A project whose `game/spec.json` is a `GameSpec` (the platform's
`@energy8platform/platform-core/game-spec` type — detected by `type ===
'slot'` and an array `symbols`; no descriptive `spec.json` carries `type`) gets its script ASSEMBLED by the
host: `buildSpinScript(defineGame(spec), logic)` where `logic` is
`game/script.spin`; written to `<project>/.e8/game/script.spin` (the
directory is created; the template's `.gitignore` gains `.e8/`), and
e8-server's `--games-dir` is `.e8/game` for such a project. `validateSpec`
errors and `defineGame` throws are diagnostics (plugin `spec`, where
`game/spec.json`); the project opens without its game on an error (the
existing "spec present but unusable" path). Re-assembled on every write to
`game/spec.json` or `game/script.spin` BEFORE the existing restart-on-write.
`e8 check` and `e8 spin` assemble first and read the assembled file,
carrying `assemble`'s diagnostics; the IDE's spin schema keeps reading
the AUTHORED `game/script.spin` — the parser reads records, enums, the
`game` block and actions and skips every `const`, which is all the prelude
holds, so the assembled read would change nothing and cost a disk write
per refresh. A missing `maxWin` (which `validateSpec` lets through) is the
host's own diagnostic. A `spec.json` that is NOT a `GameSpec` (first-slot's descriptive
one) changes nothing. `known` (symbols) and `actions` (flow warning) read
the same file as before.

## 7. Testing

- contracts/session-dev: `roundId` → `Step` (the real vendored binary, a
  fixture script `tests/fixtures/session/script.spin` that always opens a
  2-spin session: first response `roundComplete: false, nextActions:
  ['free_spin']`; two `Step`s complete it; a `Step` on an unknown round
  throws the e8-server error).
- flow: `step` posts `{ roundId, action }` from defaults and literals;
  `failed` when `$result` is missing; `readPath('$a.0')` on an array; the
  example flow validates (`validateFlow` on the new `flow.yml`); host route
  forwards `roundId`.
- compute: `spin` on the session fixture steps to completion (`steps` ≥ 2,
  no incomplete diagnostic; `rtp` over `totalWin`); the cap diagnostic on
  a fake session that never completes.
- host `spec`: a `GameSpec` `spec.json` + logic → `.e8/game/script.spin`
  assembled and `gamesDir` switched; a broken spec → diagnostic, no game; a
  descriptive `spec.json` → untouched; a write re-assembles; `e8 check`
  reads the assembled file.
- e2e `session.spec.ts`: a copy of `first-slot` with the session fixture
  script swapped in (`mechanics1.stages` binds `free_spins` to `reel-step`
  in the copy's `e8.patch.yml`) → `__e8.spin()` resolves; `flowTrace()`
  has ≥ 2 `step` entries with `out: 'result'`; `__e8.spins()` has 3 entries
  sharing one `roundId`, the last with `roundComplete: true`. e2e
  `prelude.spec.ts`: a copy whose `game/spec.json` is a `GameSpec` built
  from first-slot's script (the implementer derives the pays from the
  script's `PAY_*` — or a minimal spec + a logic file that compiles) → the
  preview spins and `e8 check` (through the host's compute) is clean.

## 8. Debts this opens

The flow shows a round's responses one `present` at a time; a "round
total" readout needs slice 24's text. `GetRound` resume is not wired.
