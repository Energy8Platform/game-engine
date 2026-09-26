# Preview like the harness, a game without a dev overlay, a tabbed panel — design (slice 39)

Date: 2026-09-26. Branch: `feat/slot-webide-cordis` at `155f70ab` (slice 38).
Source: the user, after using the IDE —
1. "why a game screen on the composition when there is a preview";
2. "the preview must be like the UI harness: one screen, switch the
   resolution, control language, currency, social, balance; no spin /
   turbo / ready overlay on top of the game (the game has them); a status
   bar apart, not an overlay; errors in the bottom bar with diagnostics;
   let plugins manage the blocks there".
Items 3 (symbols) and 4 (reels) are slices 40 and 41.

Decided with the user: one frame at 1:1 with scroll (not fitted); the
game's status in the IDE status bar; the bottom panel as tabs with a badge;
the toolbar has screen + rotate, language, currency + balance, social.

## 0. What is there today

- `CompositionScreen` (`engine/ide/client/src/screens/CompositionScreen.tsx`)
  renders `<Preview>` — the running game in an iframe — above the rows.
- The Preview document is `PreviewWall`: a wall of tiles, three presets at
  once, each an iframe at its preset's full size, so one is visible in the
  pane; a language select; `Rotate`.
- The game page (`engine/examples/first-slot/{index.html,src/main.ts}` and
  its byte-identical `engine/templates/slot-basic` copy) draws a DOM toolbar
  over the canvas — `#controls` (Spin, turbo, a mechanic `<select>`,
  `#status`) — and `#log`, the game's diagnostics as text. The game's own
  shell (`shell-pixi`) already has Spin and turbo; `ide-bridge` already
  forwards the game's diagnostics to the IDE's Diagnostics panel; the
  editor composition's `ide-bridge` row already has a `mechanic` field.
- `GET /api/session` (`engine/ide/host/src/plugins/dev-game.ts`) always
  answers `balance: 1000` and USD. `SessionInit` has `language` and
  `device`, no `social`. `session-host` keeps the tab's wallet in
  `sessionStorage['e8:wallet:<gameId>']`.
- The bottom panel (`Shell.tsx`) renders every `shell.panel` entry stacked;
  collapsing unmounts them. `PanelMeta` is `{ key, title }`.

## 1. Rules

- `packages/*` is not edited.
- No `@energy8platform/game-engine` under `engine/` (slice 37's guard).
- Every change carries a test in its package.
- The two `main.ts`/`index.html` copies (first-slot, slot-basic) stay
  byte-identical.

## 2. The composition shows the composition

`EditorComposition` no longer renders `<Preview>`. The screen is the
editor's rows, the game's rows and the `composition.card` slot — nothing
else. The game is on the Preview document; an open document stays mounted
while hidden (`Shell.tsx`'s panes), so switching tabs does not restart it.

## 3. Preview: one frame, a harness toolbar

`PreviewWall` is replaced by `Preview` (`screens/Preview.tsx`), the
component the `preview` document registers.

- **The frame**: one iframe, `width`/`height` = the chosen preset
  (rotated: swapped), at 1:1, centred in a stage that scrolls when the
  frame is larger than the pane.
- **The toolbar**, above the stage:
  - screen — the 7 `SCREEN_PRESETS` (the existing pinned copy), and Rotate;
  - language — the 16 `LANGS` (the existing pinned copy);
  - currency — the codes of `DEV_CURRENCIES` (§4);
  - balance — a number in currency units; empty means the host's default;
    committed on blur/Enter; a value that is not a finite number ≥ 0 is
    refused in the field (not sent);
  - social — a toggle.
- **The address**: `previewUrl` plus `game=preview`, `lang`, `currency`,
  `balance` (omitted when empty), `social=1` (omitted when off),
  `device=mobile` for a preset whose name starts with `Mobile` (omitted
  otherwise). A pure `previewAddress(base, state)` builds it.
- **Relaunch**: any toolbar change yields a new address, and the iframe's
  key includes it — a real navigation, as the harness relaunches. The key
  also keeps `reloads` and the active project, as today.
- **Remembered**: the toolbar state is per-viewer, in
  `localStorage['e8.preview']`, read and written inside try/catch; a stored
  preset name the list no longer has falls back to the first preset.
- `loading…` / `preview unavailable: no project open` stay as today.

## 4. The session takes the toolbar's parameters

- **`DEV_CURRENCIES`** in `@energy8engine/contracts` — pure data, code →
  `{ code, symbol, decimals, position }`: USD `$` 2 left, EUR `€` 2 left,
  GBP `£` 2 left, JPY `¥` 0 left, BRL `R$` 2 left, INR `₹` 2 left, TRY `₺`
  2 left, PLN `zł` 2 right. The toolbar lists its codes; the host reads it.
- **`SessionInit.social?: boolean`** — absent when the provider has no
  opinion.
- **`session-host`** reads `lang`, `currency`, `balance`, `social`,
  `device` off its own page's `location.search` and forwards the ones
  present as the query of `GET /api/session`. Nothing else changes in how it
  fetches.
- **`dev-game`'s `GET /api/session`** applies them over its defaults:
  `balance` — a finite number ≥ 0, else the default 1000; `currency` — a
  `DEV_CURRENCIES` code, else USD; `lang` → `language`; `social=1` →
  `social: true`; `device=mobile` → `device: 'mobile'`. An invalid value is
  ignored field by field; it never fails the request.
- **The wallet is keyed on its seed**: `session-host`'s storage key becomes
  `e8:wallet:<gameId>:<balance>:<currency code>` (the init's own seed
  values), so a new balance or currency from the toolbar starts a fresh
  wallet, and a reload with the same toolbar keeps the old one.
- **`shell-pixi`**: `toShellConfig` maps `init.social` to `isSocial` (the
  shell forces English itself in social mode). `language` already comes
  from `init.language` when the row's own is empty.

## 5. The game page has no dev overlay

In both `index.html` copies `#controls` and `#log` are removed, with their
CSS; in both `main.ts` copies the code that drove them goes (the Spin
button and its skip-on-second-click, the turbo checkbox, the mechanic
`<select>`, `#status` writes, `renderDiagnostics`). What stays:

- the game's own shell for Spin and turbo;
- the IDE's Diagnostics panel for the diagnostics (already forwarded);
- the editor composition's `ide-bridge` `mechanic` field for switching the
  mechanic;
- the `window.__e8` hooks, unchanged in behaviour. `__e8.spin()` keeps
  pressing the shell's Spin plus `ui.spin` (the removed `pressSpin`
  survives as the hook's own helper). A hook for "skip the running spin"
  (`__e8.skip()`, emitting `ui.skip`) is added for the e2e that used the
  button's second click.

A boot failure still renders through `boot.renderFailure` into `#mount`,
as today.

## 6. The game's status in the IDE status bar

- **`ide-bridge`** reports `GameStatusMessage { type: 'game-status', state:
  'loading' | 'ready' | 'spinning' | 'failed', message?: string }` (added to
  `ClientMessage`/`ServerMessage` in `contracts/src/protocol.ts`):
  - `loading` when the bridge connects;
  - `ready` once `flow.ready` settles (or at once when there is no flow
    row, with `message: 'no flow row'`);
  - `spinning` on a trace entry that enters (`out: null`) a node of kind
    `spin`;
  - `ready` on a `present` node leaving by `next`;
  - `failed` on a `present` leaving by `failed` (`message: 'presentation
    failed'`) or a `spin` leaving by `failed` (`message: 'spin failed'`);
    the next `spinning` replaces it.
  Node kinds come from the flow document the bridge already reads. Sent
  only when the state or message changes; re-armed on a re-provided `flow`
  as the trace forwarding is.
- **The host** (`rpc.ts`) accepts `game-status` from the game socket, keeps
  the last one, relays it to every `/ide` socket, sends the last one in the
  greeting, and forgets it (relaying `{ state: 'offline' }` — a host-only
  state) when that game socket closes or another project is opened.
- **The client**: `gameComposition` (`plugins/game-composition.tsx`, the
  service that already takes `game-transitions` off its own socket) gains
  `status: GameStatusMessage | null`, and `GameStatus` — a `shell.status`
  entry, right side, first: `● ready`, `◌ spinning…`, `✕ <message>`
  (`failed`), `… loading`, `○ no game` (`offline`, or no frame yet). When
  `failed`, a click calls `ctx.shell.showPanel('diagnostics')`.

## 7. The bottom panel is tabs

- **`PanelMeta`** gains `order?: number`; tabs are sorted by `order`, then
  registration.
- **`ShellService`** gains:
  - `panel(): string | undefined` — the active tab's key;
  - `showPanel(key)` — expands the panel and selects that tab;
  - `setPanelBadge(key, value: number | string | undefined)` and
    `panelBadge(key)` — imperative, so a project plugin's plain-JS client
    half can set one; `0` and `undefined` show no badge.
- **Rendering**: the header is a tab strip — title and badge per entry —
  with the collapse toggle at its right. Every entry stays mounted; the
  inactive ones and all of them when collapsed are `hidden`, so an entry
  can keep its state and set its badge while not shown.
- **The active tab** is remembered in `localStorage['e8.panel-tab']`
  (try/catch); a remembered key no entry has, or none, falls back to the
  first tab.
- **Diagnostics**: registered with `order: 0`; its badge is the count of
  errors plus warnings across the three lists; `DiagnosticsPanel` drops its
  own `<h2>Diagnostics</h2>` header and count (the tab carries them).

## 8. Tests

- `contracts`: `DEV_CURRENCIES` shape; the `game-status` message in the
  protocol unions.
- `session-host`: the forwarded query (present params only, nothing when
  the page has none); the wallet key includes balance and currency.
- `shell-pixi`: `toShellConfig` maps `social` to `isSocial`.
- `ide-bridge`: the status sequence loading → ready → spinning → ready,
  and → failed with each message; no flow row; nothing re-sent when
  unchanged.
- `ide-host` (alone): `/api/session` with each param, each invalid value
  ignored, unknown currency → USD; `game-status` relayed, kept for the
  greeting, `offline` on close.
- `ide-client`: `previewAddress` for each field and `Mobile*` → device;
  the toolbar's remembered state and its fallback; one iframe at the
  preset's size, swapped on Rotate; the composition renders no iframe;
  panel tabs (order, switch, badge, collapsed keeps entries mounted,
  `showPanel`, remembered tab); `GameStatus` states and the click on
  `failed`.
- e2e: `screens.spec.ts` rewritten for the one frame and its toolbar
  (a currency and balance reaching the game's shell, social, a Mobile
  preset's device); the composition spec's preview checks move to the
  Preview document; every spec that read `#status`/`#log` or clicked
  `#spin` moves to the `__e8` hooks and the IDE's panel/status; a spec
  for the panel tabs and the status item. Full Playwright alone.

## 9. Not here

- The preview docked beside the composition (a right-sidebar preview).
- A Spins tab (the spin log) or any second panel tab.
- Replay, a currency list from a server, `session-sdk`'s social.
- Symbols (slice 40), the reels editor (slice 41).
