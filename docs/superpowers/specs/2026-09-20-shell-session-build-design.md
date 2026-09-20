# Shell, session and a build — design (slice 26)

Date: 2026-09-20. Branch: `feat/slot-webide-cordis`. Answers R10 of
`docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.
Designed with the user (slices 22–25 ran autonomously). Slice 27 is R11
(responsive layout, the safe area).

## 0. Where this sits

A composed project plays only under the IDE host: the page is a Spin
button over a canvas, the flow's `spin` kind POSTs `/api/spin` to the host,
the rows fetch their documents from `/api/*`, and nothing knows a balance,
a bet ladder or a currency. The legacy `createSlotGame` owns all of that —
shell, SDK handshake, autoplay, buy bonus, win count-up — as one 931-line
host with the scene as a callback, which is the opposite of "the flow is
the only driver". Three additions on existing seams: a `session` service
behind the seam `@energy8engine/seam` already names, provided by one of two
rows (the host's `/api/spin`, or the Energy8 platform through
`@energy8platform/game-sdk`); a `shell1` row wrapping the Pixi shell
(`@energy8platform/shell/pixi`) as a thing the flow drives and listens to,
exactly like a scene; and `e8 build`, which turns a project into a static
`dist/` by freezing what the host answers and bundling what it serves.

## 1. Goal

`first-slot` shows the Pixi shell (bar, bet ladder, balance, win, turbo,
autoplay, menu); a tap on its Spin runs the flow, which sets `busy`, spins
at the shell's bet, presents at the shell's turbo, shows the win and the
new balance, and clears `busy`; autoplay is a loop in `flow.yml`; a tap on
the canvas during a presentation skips it. `e8 build` produces a `dist/`
that boots the same composition without the IDE, and `e8 build --target
platform` produces one that plays through the Energy8 SDK.

## 2. Non-goals

- Stake (books, `@energy8platform/stake-bridge`, `dist-stake`) and Artube —
  each is its own `session` candidate later; nothing here blocks them.
- Responsive layout and the safe area (27). The shell's `safeArea` is
  exposed for it, not consumed.
- Modals from the flow (`openModal`), replay, connection recovery, resume
  of an open round (`initData.session`), persisted volumes/mute, the
  double-tap skip, a paytable derived from `spec.json` into `gameInfo`.
- A typed IDE form for the shell's nested config (`gameInfo`, `menu`,
  `buyBonus`); the row validates leniently and the form shows YAML.
- Rewriting the shell. The row composes `createPixiShell` as is.

## 3. `session`

```ts
// @energy8engine/contracts session.ts
export interface SessionInit {
  balance: number;          // currency units
  currency: { code: string; symbol: string; decimals: number; position: 'left' | 'right' };
  betLevels: number[];      // currency units, ascending
  defaultBet: number;       // one of betLevels
  language?: string;
  device?: 'desktop' | 'mobile';
}
export interface PlayRequest { action: string; betLevel?: number; roundId?: string; params?: Record<string, unknown> }
export interface SessionService {
  readonly init: SessionInit;                       // resolved before the row provides the service
  play(req: PlayRequest): Promise<{ result?: SpinResult; diagnostics: Diagnostic[] }>;
  ack?(result: SpinResult): void;                   // "the result was shown" — a backend's credit hook
}
```

`SpinResult` gains `balance?: number` (after this play; absent when the
backend has no wallet) and `winAmount`/`totalWinAmount` (`win × bet`,
`totalWin × bet`, currency units — the shell shows money, the math speaks
multipliers). Both providers fill them through one contracts helper.

Seam `session` (the mechanism exists: `E8SeamDeclaration` in the manifest,
`@energy8engine/seam` picks one provider per seam from `buildTarget`/`urlParam`/
`default`, `createGame` drops the rows that lost). Two rows in `e8-base`:

- `@energy8engine/session-host` — `seam { name: session, matcher: { default: true } }`.
  `init` from a new `GET /api/session` on the preview server (`betLevels`
  from the authored `.spin`'s `bet_levels`, `defaultBet` = the first,
  `currency` USD/`$`/2/left, `balance: 1000`; a failed GET → a diagnostic
  and `{ balance: 0, betLevels: [1], defaultBet: 1 }`, so the shell still
  mounts); `play` = today's `POST /api/spin`
  body `{ action, betLevel, roundId }`; a dev wallet in the row: `balance −=
  betLevel` on every play, `+= winAmount` on every result, reported as
  `result.balance`; `ack` absent.
- `@energy8engine/session-sdk` — `matcher { buildTarget: 'platform' }`.
  `createPlatformSession({ sdk })` from `@energy8platform/platform-core`;
  `init` from `initData` (`balance`, `currency` from `config.currency`'s
  meta — code alone → symbol = code, 2 decimals —, `config.betLevels` — the
  spec's `bet_levels` when absent —, `config.stake?.defaultBetLevel ?? betLevels[0]`
  clamped to the ladder, `lang`, `device`); `play` → `PlayParams { action,
  bet: betLevel, roundId, params }` → `PlayResultData` normalised: `bet = req.betLevel`,
  `win = data.win ?? totalWin / bet`, `totalWin = (session?.totalWin ?? totalWin) / bet`
  (the platform's `totalWin` is money; the contract's is a multiplier),
  `stage = data.stage ?? action`, `data`, `vars = data.vars ?? {}`,
  `nextActions`, `roundComplete = session ? session.completed === true : true`
  (a completed round on every host still carries the NEXT round's entry
  actions — `nextActions` is informational; no session ⇒ a single-action
  round; the convention `host/slotPlay.ts` measured), `bet = session?.betAmount ?? request bet`
  (Stake and Artube echo the round's bet; a `step` of an open round plays
  at that bet, not the default),
  `spinsRemaining/spinsPlayed` from `session` (0 when none), `balance = balanceAfter`,
  `roundId`; `ack` → `playAck(raw)`. `BALANCE_UPDATE` events update
  `init.balance` in place. Unit-tested over the SDK's `devMode` memory
  channel with `DevBridge` as the platform. The platform's `data` for a
  `.spin` game is e8-server's `data_json` by construction; the mapping is
  verified against the SDK's types only — confirmed on the first real
  launch (§10).

The flow's `spin`/`step` kinds call `ctx.session.play(request)` (lenient
read; no session → report `no session row` and leave by `failed`) instead
of `fetch('/api/spin')`; `spin.betLevel` keeps its `string` shape (literal
or `$path`). A new `ack` kind (`outs: ['next']`) calls `session.ack?.(vars.result)`;
absent either → report, `next`. `flow1`'s `fetchFn` stays for `/api/flow`.

## 4. `shell1`

`@energy8engine/shell-pixi`, `seam { name: 'ui.shell', matcher: { default: true } }`,
`inject: ['renderer', 'session']`. `apply`: `createPixiShell({ app: renderer.app,
...config, availableBets: init.betLevels, defaultBet: init.defaultBet,
currentBet: init.defaultBet, balance: init.balance, currency: init.currency
(`symbol`/`position`/`maxDecimals`), language: config.language || init.language || 'en',
win: 0, mode: 'base' })`; the shell's root is raised to the top of
`app.stage` after apply and again when `scenes` is re-provided (a hot
`scenes1` re-apply appends a new root); disposer → `removePixiShell()`.
Provides `shell` (the `Shell` handle: `state`, setters, `actions`, `safeArea`).

Row config (schemastery, lenient — nested shell structures are `any` with a
description): `language` (default `''` → init/`en`), `version` (`'1.0.0'`),
`features` (`ShellFeatures` — `turbo` 0–3 default 1, `autoplay` `{ maxCount? } | null`
default `{}`, `buyBonus` `BonusOption[] | false` default `false`, `hotkeys`,
`spacebar`), `gameInfo` (default `{ sections: [] }`), `menu` (omitted → the
shell's default list), `i18n` (`{}`), `tiers`, `theme`.

**The row decides nothing.** Two mechanical bridges only:

- Shell → flow: every `ShellEvents` entry is re-emitted on the flow bus
  (`ctx.reflect.get('events', false)`, lenient) as `shell.<name>` with the
  payload as an object — an object passes as is, a scalar becomes
  `{ value }`, `void` becomes `{}`: `shell.spin {}`, `shell.betChange { value }`,
  `shell.turboChange { value }`, `shell.autoplayStart { active, remaining }`,
  `shell.autoplayStop {}`, `shell.buyBonusSelect { id }`,
  `shell.featureActivate { id }`, `shell.featureDeactivate { id }`,
  `shell.settingChange { key, value }`, `shell.menuOpen {}`,
  `shell.settingsOpen {}`, `shell.infoOpen {}`. A flow listens with
  `on { event: shell.spin }` and waits with `wait { event: shell.settingChange }`.
- Live state: the row registers a live root `shell` with the flow
  (`flow.provideRoot('shell', () => shell.state)`, through `ctx.inject(['flow'])`
  so row order does not matter) — `$shell.bet`, `$shell.turbo`,
  `$shell.autoplay.remaining`, `$shell.busy` read the CURRENT state in any
  node of any run. `session-host`/`session-sdk` register `session` the same
  way (`$session.balance`, `$session.betLevels`).

The editor page composes without a shell: `createGame({ without: ['ui.shell'] })`
in `editor.ts` — `without` names seams whose candidates are all dropped
(the plan's third input beside `buildTarget`/`urlParams`).

## 5. Flow additions

- **Live roots.** `FlowService.provideRoot(name, getter): () => void`. A
  run's `vars` is created with the roots view as its prototype
  (`Object.create(view)`, one getter per root), so `readPath`/`evaluate`/
  `resolve` are unchanged, `set` shadows a root for that run, and trace
  JSON never serialises a root. Re-providing a name replaces the getter.
- **`shell` kind** (`outs: ['next']`), every prop a `string`, `''` = leave
  untouched, a literal is coerced by the setter's type, a `$path` resolves
  first: `balance` → `setBalance`, `win` → `setWin(n, { animate: true })`,
  `bet` → `setBet`, `mode` (`base|bonus|freeSpins|replay`) → `setMode`,
  `busy` (`true|false`) → `setBusy`, `turbo` (level) → `setTurbo`,
  `buyBonusEnabled` → `setBuyBonusEnabled`, `freeSpins` (a `$path` to
  `{ current?, total, totalWin }` or a literal `total`) → `setFreeSpins`,
  `bonus` (a `$path` to `{ label, value, totalWin }`) → `setBonus`,
  `autoplay`: `tick` (`remaining − 1`; at 0 → `{ active: false, remaining: 0 }`),
  `stop`, or a number `n` → `{ active: n > 0, remaining: n }`. A NaN, a bad
  enum, no `shell` service → report, `next` (a readout that cannot be set
  does not stop the round).
- **`ack` kind** (§3).
- **`present.turbo`** also accepts a number > 0 as `true` (the shell's
  level).
- **`playloop1.config.skipEvents: string[]`** default `['ui.skip']` — the
  bus events the play-loop row's skip subscription listens to; the
  template lists `[ui.skip, ui.tap]`, so a tap on the canvas during a
  presentation skips it (the shell's own Spin is disabled while `busy`).

## 6. `e8 build`

`e8 build [--target <name>] [--base <path>] [--out <dir>]` — the fourth
one-shot command of `engine/apps/cli` (`check`/`spin`/`shot` shape, JSON
diagnostics on stdout, exit 1 on an error). Steps:

1. Resolve the composition exactly as `GET /api/composition` does; write
   `dist/api/composition` with `runtimeUrl` = the row id (what the bundled
   row map is keyed by) and `clientUrl: null`.
2. Write `dist/api/flow`, `dist/api/scenes`, `dist/api/symbols` — the
   bodies the host plugins' `get` handlers answer, byte-identical, so no
   row changes: they fetch the same same-origin URLs from static files.
3. `vite build` with `root` = the project, `base`, `outDir`, `define
   { 'import.meta.env.E8_TARGET': target }`, and the vite plugin
   `viteRows(map)` from `@energy8engine/ide-host` (`src/vite-rows.ts`; the
   host already owns vite), which serves
   `virtual:e8-rows` = `{ [rowId]: () => import('<pkg>/<e8.runtime.entry>') }`
   (static specifiers, so vite bundles and code-splits every runtime half).
   `dev-game`'s vite gets the same plugin answering `{}`.
4. Copy the project's `assets/` to `dist/assets/` (documents name assets
   by relative path; nothing in the bundle references them statically).

`main.ts` (the pinned pair): `import { rows } from 'virtual:e8-rows'`;
`createGame({ mount, buildTarget: import.meta.env.E8_TARGET, loader:
{ importModule: (url) => rows[url]?.() ?? import(/* @vite-ignore */ url) } })`;
`ide-bridge` composed and the `#controls`/`#log` dev toolbar shown only
under `import.meta.env.DEV` (a built page removes them); the `__e8` hooks
stay (the harness). `src/env.d.ts` declares the virtual module and
`E8_TARGET`. The toolbar's Spin becomes a proxy for the shell's: it calls
`shell.actions.spin()` when a shell is provided AND emits `ui.spin` (a
flow without a shell — every e2e fixture flow — keeps working; exactly one
of the two has a listener); the `#turbo` checkbox sets the shell's turbo
level as well as the `ui.spin` payload; `__e8.spin({ turbo })` does the
same. Removing the toolbar instead would have cost ~90 e2e premises on
`#status`/`#spin` for no product gain.

Nothing serves `dist/` — any static server does (`npx serve dist`); the
proof's server proxies `/api/session` and `/api/spin` to a running host.

## 7. IDE

- Flow palette: `shell`, `ack` (schema-driven; `mode`/`busy`/`autoplay`
  render as selects where enumerated). `flow-kinds` report carries them.
- Composition form: `shell1`'s row config with its nested `any` fields as
  YAML text; `sessionhost1`/`sessionsdk1` have no config.
- The preview shows the shell (it is a row); the scene editor page does
  not (§4).
- Diagnostics: `no session row`, `shell: <prop> …`, build diagnostics.

## 8. Bundle, template, example

- `e8-base`: `+ sessionhost1 (@energy8engine/session-host)` and
  `+ sessionsdk1 (@energy8engine/session-sdk)` after `renderer1`;
  `+ shell1 (@energy8engine/shell-pixi)` after `playloop1`. `compose.test.ts`
  pins the order.
- `first-slot` ≡ `slot-basic`: `flow.yml` rebuilt on the shell —
  `boot → show base_game → on shell.spin → shell { busy: true } → sound →
  spin { betLevel: $shell.bet } → shell { balance: $result.balance } →
  present { turbo: $shell.turbo } → prop win → shell { win: $result.totalWinAmount }
  → done → step → draw … → ack → shell { busy: false } → idle`; autoplay:
  `on shell.autoplayStart` edges into the same `shell { busy: true }`; after
  `shell { busy: false }` an `if '$shell.autoplay.active'` gate → `shell
  { autoplay: tick }` → `if '$shell.autoplay.remaining > 0'` → back to
  `shell { busy: true }` (one chain, two entries; the shell itself clears
  `active` when its toggle stops, so no `autoplayStop` node is needed;
  `tick` leaves a non-finite `remaining` alone). `e8.patch.yml`: `shell1.config { features:
  { turbo: 1, autoplay: {}, buyBonus: false }, gameInfo: { sections: [] } }`,
  `playloop1.config.skipEvents: [ui.skip, ui.tap]`. `index.html`/`main.ts`/
  `env.d.ts`/`README.md` per §6. `template.test.ts`: the file list grows by
  `src/env.d.ts`; every pin holds.
- `paper-duel` (the user's port, untracked) is not touched.

## 9. Testing

- contracts: `SessionService`/`PlayRequest` shapes; the amounts helper.
- session-host: `init` from a fake `/api/session`; `play` posts the body;
  the dev wallet; a failed POST → `diagnostics`, no result.
- session-sdk: over `devMode` + `DevBridge`: `init` from `initData`, the
  normalisation table row by row, `ack` → `playAck`, `BALANCE_UPDATE`.
- seam: two candidates, `buildTarget: 'platform'` picks `session-sdk`,
  none picks `session-host`, `without: ['ui.shell']` drops the shell.
- flow: live roots (a run reads a root, `set` shadows it, a re-provided
  root replaces, trace JSON excludes it); `shell` kind per prop incl.
  `autoplay: tick` reaching 0, refusals; `ack`; `present.turbo` numeric;
  `spin`/`step` through a fake `session` (no session → `failed`).
- play-loop: `skipEvents` config, two events subscribed.
- shell-pixi: a fake `createPixiShell` — every `ShellEvents` entry
  re-emitted as `shell.<name>` with the object payload; the `shell` service
  and root provided; `removePixiShell` on dispose; root raised on `scenes`
  re-provide.
- host: `GET /api/session`; the build's frozen `api/*` equal the live GET
  bodies.
- cli: `e8 build` on a fixture → files, diagnostics, exit code.
- e2e `game-shell.spec.ts`: (1) the example boots with `__e8.shell().state`
  = `{ bet: defaultBet, balance: 1000, availableBets: the spec's }`; (2)
  `__e8.shellAction('spin')` → trace `on shell.spin → … → present → ack`,
  `busy` true during and false after, `state.win === totalWinAmount`,
  `state.balance` moved; (3) `shellAction('stepBet', 1)` then a spin → the
  spin log's request `betLevel` is the new bet (the live root); (4)
  `shellAction('startAutoplay', 2)` → two `spin` runs then
  `autoplay.remaining === 0`; (5) a canvas tap during `present` skips
  (`present` leaves within 1 s); (6) `editor.html` has no `shell` service.
- e2e `build.spec.ts`: `e8 build` on a copy → `dist/index.html`,
  `dist/api/{composition,flow,scenes,symbols}`, `dist/assets/spin.wav`; (1)
  `dist/` under a bare static server: boots, `base_game` mounted, the shell
  present, `__e8.spin()` leaves by `failed` with `no session` (no
  `/api/spin`); (2) the same `dist/` under a static server that proxies
  `/api/session` and `/api/spin` to the running host: `__e8.spin()`
  resolves `next` — the bundled rows, a working session.

## 10. Debts this opens

`session-sdk`'s normalisation is checked against the SDK's types, not a
platform; `gameInfo` is authored, not derived from the spec; the shell's
nested config has no typed form; a tap skips, a double tap is the legacy
gesture; the dev wallet lives in the browser row (a reload resets it);
`dist/api/*` are frozen at build time (a `.yml` edit needs a rebuild);
`without` is a page-level switch, not a composition-level one.
