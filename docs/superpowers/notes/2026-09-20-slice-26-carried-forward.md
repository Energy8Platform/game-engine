# Slice 26 — shell, session, build: what was left behind

Slice: `docs/superpowers/plans/2026-09-20-shell-session-build.md`, spec
`2026-09-20-shell-session-build-design.md` (answers R10 of
`2026-09-19-paper-duel-port-feasibility.md`). Commits `967aa72..54918f5`
on `feat/slot-webide-cordis` plus this note's. Designed with the user;
run per the standing method. A `session` contract behind the seam
`@energy8engine/seam` already named, provided by `session-host` (the
IDE host's `/api/spin`, a dev wallet) or `session-sdk` (the Energy8
platform through `@energy8platform/game-sdk`, `buildTarget: 'platform'`);
the flow's `spin`/`step` play through it; live roots (`$shell.*`,
`$session.*`) and the `shell`/`ack` kinds; `shell-pixi` wraps the Pixi
shell as a row the flow drives and listens to; `first-slot` plays through
the shell with an autoplay loop in `flow.yml`; `e8 build` freezes the
host's `GET /api/*` into `dist/api/*` and bundles the rows. Full
Playwright alone: 144/145 on the first pass — the one failure
(`symbols.spec.ts:96`, a chip drop whose write never landed within its
5 s poll; the file still read as the fixture) passed 3/3 alone; the
preview boots heavier now (the shell, a `GET /api/session` before the
rows), so a load-sensitive poll is the debt, not the drop.

## Amendments made while running the plan

- **`$event` is the payload; `$shell.*` is live.** Vars live in ONE run,
  so a `shell.betChange` event cannot carry the bet to a later `spin`; the
  flow gained `provideRoot(name, getter)` — run vars are
  `Object.create(view)` with one accessor per root (a setter so `set shell
  = …` shadows for that run), `readPath`/`evaluate`/trace JSON unchanged.
- **`roundComplete` on every real host**: the spec's `nextActions.length
  === 0` rule never holds — a completed round lists the NEXT round's entry
  actions (e8, DevBridge, Stake), so `first-slot`'s `if roundComplete →
  step` would have played paid rounds forever. `session ? completed ===
  true : true`; `bet = session.betAmount ?? request bet` (a `step` plays
  at its round's bet); the platform's `totalWin` is money and is divided
  by `bet` (the contract speaks multipliers).
- **`session-host` reads `game/spec.json`'s `betLevels`** (the source the
  host already used for its default), not the `.spin`'s `bet_levels`;
  `POST /api/spin` answers the `SpinResult` body on 200 and `{ diagnostics
  }` on 502 — the plan had it wrong; providers RETURN play diagnostics
  and never report them (the kind reports; twice would show twice).
- **The flow refuses an unquoted YAML scalar** on any `Schema.string()`
  prop (`busy: true`, `bet: 2`) with a whole-node diagnostic that ends the
  branch; every literal in the example is quoted. `mode`/`busy`/
  `buyBonusEnabled` are unions of literals (dropdowns) and refuse a
  `$path` — a flow branches with `if` to two `shell` nodes instead.
- **`spin` breaks a cycle** in `validateFlow` (it awaits the server like
  `step`); the autoplay loop keeps a `wait { ms: 500 }` beat anyway, with
  a second `if active` gate after it so a Stop pressed during the beat is
  honoured. An absent `ack` hook is silence (session-host has none).
- **A failure halts autoplay** (`spin`/`present`/`step` `failed` → `shell {
  autoplay: stop, balance: '$session.balance' }` → `busy: 'false'`);
  without it the ∞ count retried a dead host at 2 Hz. `bal` moved after
  `win` (the balance readout was revealing the outcome before the reels
  landed). WIN is cleared at spin start (`busy` node `win: '0'`; the kind
  animates only a non-zero win). A boot-time `reset` frees the shell
  after a mid-round `replace()` (an IDE flow edit while a spin is live).
- **The dev toolbar stays** (`#controls`, `#log`, hidden when
  `!import.meta.env.DEV`): its Spin sets the shell's turbo, taps
  `shell.actions.spin()` AND emits `ui.spin { turbo }` — exactly one has
  a listener (the example's flow vs every e2e fixture flow) — removing it
  would have cost ~90 e2e premises on `#status`/`#spin`.
- **`shell-pixi`**: the shell mounts in the row's own layer (raised on a
  `scenes` re-provide); `tiers` is not a `ShellConfig` field (dropped);
  `i18n` reserved (no `ShellController` hook); `autoplay: … || null`
  (schemastery turns a YAML `null` into the default; `false` is the off
  spelling); a blank `theme:` must reach the shell as `undefined`
  (`resolveTheme(null)` throws → the row FAILED); `turbo` bounded 0–3;
  `device: 'mobile'` forces `hotkeys: false` over the author; the relay
  list is type-exhaustive against `ShellEvents`.
- **`e8 build`**: one `game` chunk beside the entry (rollup's default
  split deadlocked the page's top-level `await createGame()` against a
  row chunk importing the entry); the runtime's lazy `session-dev` import
  is a variable specifier (rollup followed the literal into `node:fs`);
  `NODE_ENV=production` around `vite build` (the host's vite had set
  `development` process-wide — `ide-bridge` shipped); host option
  `previewPort: null` (the build reads the four `api/*` off the root
  server; no e8-server spawn); `--out` real-pathed and refused when it
  contains the project (`--out .` EMPTIED the project — vite's
  `emptyOutDir`); the `src/` chunk test uses vite's posix ids; `--base`
  other than `/` warns (the rows fetch `/api/*` root-absolute);
  `dist/api/*` written only after a successful vite build.
- `createGame({ without })` — the editor page composes `without:
  ['ui.shell']`; `without: ['session']` alone leaves `shell1` pending
  (`inject: ['renderer', 'session']`) — the docs say `['session',
  'ui.shell']`.
- The DEV `await import('@energy8engine/ide-bridge')` parked the `__e8`
  harness behind a cold-cache fetch after `#status` read `ready`; it is
  `void import().then(apply)` now.

## Debts

1. **`session-sdk`'s normalisation is verified against the SDK's types,
   not a platform** — `data.win` as a multiplier, `data.stage`, `vars` —
   confirm on the first real launch; a `data`-less segment is guarded.
   Artube's `currencyMinimalUnit`/`defaultBetIndex` are unread; a failed
   `ready()` leaks the SDK's transport listeners inside platform-core; the
   resume seed (`initData.session.betAmount`) is unkeyed (no round id on
   `SessionData`); a page outside a casino frame waits the SDK's 15 s
   handshake timeout before the fallback init.
2. **The dev wallet lives in the browser row** (a reload resets it; a
   failed play is still charged, per spec). `session-host` and
   `session-sdk` share the cordis name `session` — diagnostics speak as
   `session-host`/`session-sdk`.
3. **`dist/api/*` are frozen at build time** (a `.yml` edit needs a
   rebuild); `--base` other than `/` needs `dist/api` served at the origin
   root or a proxy; `logLevel: 'silent'` swallows rollup's chunk-size and
   circular warnings; a fresh clone must build `shell`/`platform-core`/
   `game-sdk` before the three new suites (they resolve `dist/`).
4. **`gameInfo` is authored, not derived from the spec** (the legacy
   `defaultGameInfo` paytable); the shell's nested config has no typed
   form (YAML text); `i18n` has no hook in `ShellController`.
5. **A tap skips; the legacy gesture was a double tap.** A tap on the
   shell's bar bubbles to `ui.tap` too (by source; unverified in a
   browser). `Shift+A` during a manual round is dropped by `on` but the
   tail's `auto` gate picks it up (the in-flight spin counts as the
   first).
6. **`step.roundId` goes on the wire as resolved** (a numeric `$path`
   would too); `POST /api/spin` forwards `params` now but no node
   produces one; `without: ['session']` + `config.session` drops the local
   candidate too (no caller).
7. **`symbols.spec.ts:96`'s 5 s poll is load-sensitive** (the preview
   boots heavier); **`reset` warns once on the shell-less editor page**
   (`no shell row`);
   the flow palette's drop position (`80 + 40n`) walks off the canvas past
   ~15 nodes; `flow.spec`'s add-wait case needs a 1200-px viewport.
8. **Modals from the flow, replay, connection recovery, persisted
   volumes, resume of an open round** — spec non-goals, still open;
   `ide-web`'s TS7016 remain.

## Method

- **A spec line about another system's wire is a claim to verify before
  a row ships against it.** `roundComplete = nextActions.length === 0`
  and `$event.payload.turbo` were both written from memory; the first
  would have looped paid rounds, the second was caught by the same
  "read the bus" check slice 25's note asked for.
- **Money vs multiplier must be named at every boundary**: the
  platform's `totalWin` is money, the contract's a multiplier; the
  reviewer's 228k-pair round-trip check is what proved the division.
- **A one-shot command that empties a directory must refuse a directory
  containing the project** — and real-path BOTH sides (a symlink to the
  project slipped through the first guard).
- **A test double that always sets `nextActions: []` hides the
  production shape** — the fixture override was what made the loop bug
  invisible; the fix round dropped the override so the suite proves the
  DevBridge default.
- **Read the entry of the thing you drive, not only its API**: rollup's
  chunk split vs a top-level `await`, the shell's disabled Spin while
  busy (no "second tap" gesture exists), `resolveTheme(null)`.
- **Parallel implementers on disjoint files worked** (Tasks 3–5 with
  reviews in flight) — with the shared files named in every dispatch and
  "commit on top of HEAD"; one `git checkout --` on an own edit happened
  again (re-applied; the rule stands).
- **The final review's interpreter harness on the real `flow.yml`**
  (fake shell/session, six scenarios) found what no e2e case ran: the
  WIN never cleared, the balance revealed early, the mid-round `replace()`
  leaving `busy` stuck. Run the reference flow through the interpreter
  with fakes before the browser proof.
