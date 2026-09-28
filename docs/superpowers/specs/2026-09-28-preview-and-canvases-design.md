# Preview and canvases — design (slice 43)

Date: 2026-09-28. Branch: `feat/slot-webide-cordis` at `3747ad84` (slice 42).
Source: the user's feedback of 2026-09-28, items 1, 3 and 8 (a refresh
button, balances like the harness, an empty brown Reels canvas). Decided
with the user: this slice first, then sidebars per tab (44), then
undo/redo (45). Not here: the spin/turbo/status overlay in the Preview
(item 2 — it is paper-duel's own `#controls` in its `index.html`/`main.ts`;
the user removes it), the wild-glue animation in Symbols (item 9 —
skipped: it is a plugin step, not a symbol state).

## 0. What is there today

- **Preview** (`engine/ide/client/src/screens/Preview.tsx`, slice 39): a
  toolbar — screen, rotate, language, currency, balance, social — over one
  iframe of the game. The iframe's key is `${reloads}:${active}:${src}`:
  a new address relaunches the game; screen and rotate only resize. The
  balance is a free text field (`''` = the host's default, 1000),
  committed on blur/Enter, kept in `localStorage['e8.preview']`, sent as
  `?balance=`. There is no refresh.
- **Dev wallet** (`engine/game/session-host/src/index.ts`): `/api/session`
  seeds the balance; the game tab keeps what is left in `sessionStorage`
  under `e8:wallet:<gameId>:<balance>:<currency>`, and a stored wallet
  wins over the seed. So re-entering the same balance brings back the
  drained wallet, and 1000 → 500 → 1000 finds the old 1000-wallet.
- **Harness** (`packages/harness`, the reference): a `<select>` of 1, 10,
  100, 1K, 10K, 100K, 1M, 10M, 100M, 1B, 10B (major units), default
  10 000; every pick sets the balance absolutely and relaunches.
- **Canvases**: the Symbols and Reels documents embed `editor.html` of the
  project; the project's own `src/editor.ts` parses `?scene=`,
  `?symbol=`, `?reels=` and hands them to `@energy8engine/scene-edit`.
  A project whose `editor.ts` predates a mode (paper-duel has no `reels`
  line) falls into scene mode with `scene: ''`: the canvas reports
  `scene "" is not declared` and shows the renderer's background only.
  The Reels document listens for `ready` only, so the error is never
  shown. A board with no symbols (no `reels1.board`, symbols seeded by a
  flow step the editor page never runs) is empty until Spin.

## 1. Rules

- `packages/*` is not edited. No `@energy8platform/game-engine` under
  `engine/`. Every change carries a test in its package.
- A project's existing `editor.ts` keeps working unchanged (whatever it
  passes still wins).
- `engine/examples/first-slot` and `engine/templates/slot-basic` stay
  byte-identical where they are today.

## 2. Preview: refresh

- A `↻` button in the toolbar (`aria-label="refresh"`) relaunches the game
  at the same address: the iframe remounts, the address does not change,
  so the wallet left over is kept.

## 3. Preview: balance like the harness

- The balance field becomes a `<select>` of the harness's levels: 1, 10,
  100, 1K, 10K, 100K, 1M, 10M, 100M, 1B, 10B (major units, labelled as the
  harness labels them). Default 10K. The Preview always sends it
  (`?balance=`); the host's own default (1000) stays for pages opened
  without the Preview.
- **Every pick starts a fresh wallet**, the same amount included: the
  Preview keeps a wallet number `wallet` (an integer, stored with the rest
  of `e8.preview`) and bumps it on every pick; the address carries
  `?wallet=<n>`. A `↺` button beside the select (`aria-label="reset
  balance"`) bumps it without changing the amount (a `<select>` does not
  fire on picking the value it already has).
- session-host's wallet key gains the page's `wallet` parameter:
  `e8:wallet:<gameId>:<balance>:<currency>:<wallet>` (absent → as today).
  It is read from the page's own address; it is not forwarded to the host.
- Refresh (§2) keeps the wallet number, so it keeps the wallet.
- A stored balance from before this slice that is not a level becomes the
  default; the wallet number starts at 0.

## 4. Canvases: the mode comes from the page's address

- scene-edit reads its mode from the page's own address when the project
  does not pass it: `symbol` left out → `?symbol=` if present; `reels`
  left out → `?reels` present; `scene` left out or `''` → `?scene=`;
  `parentOrigin` left out → the referrer's origin (`'*'` without one).
  What a project passes still wins.
- first-slot's and the template's `editor.ts` stop parsing those four and
  pass only what is theirs (`safeArea`, `editorPage`, `without`).
- So every project's Reels and Symbols canvases work, paper-duel's
  included, without editing its `editor.ts`.

## 5. The Reels document says what the canvas says

- A canvas `error` event is shown in the Reels document's status line (as
  the Symbols document already does).
- No `ready` within 10 s after the canvas loads → the status says the
  canvas did not answer (the Symbols document gets the same).

## 6. An empty board is filled at once

- Reels mode: when the board has no symbols (every cell empty) after it
  mounts or is rebuilt, it gets a random board of the project's known
  symbols at once — the lab's `Spin` board, applied and skipped to its end
  (no animation). A board that already shows symbols is left alone.
- With no known symbols the board stays empty and the status says so.

## 7. Tests

- `ide-client` Preview: the refresh button remounts the frame with the
  same address; the balance select lists the levels, defaults to 10K,
  and a pick sets `balance` and bumps `wallet` in the address; `↺` bumps
  `wallet` only; a stored non-level balance loads as the default.
- `session-host`: the wallet key carries `wallet` from the page address;
  a different `wallet` finds no stored wallet (seed), the same one finds
  it.
- `scene-edit`: with a config that leaves the mode out, `?reels=` enters
  reels mode, `?symbol=x` symbol mode, `?scene=a` scene mode; a passed
  value wins over the address; an empty board is filled with known
  symbols (a board already showing symbols is not touched).
- `ide-client` Reels/Symbols documents: a canvas `error` reaches the
  status; no `ready` in 10 s says so.
- e2e (alone): refresh keeps the balance left after a spin; picking the
  same level with `↺` restores the full balance; the Reels document on a
  project whose `editor.ts` passes no `reels` shows the board (cells not
  empty) without a Spin; full Playwright alone.

## 8. Not here

- The paper-duel overlay (the user removes `#controls` from its page).
- Symbol states that play over the static image (the glue).
- Sidebars per tab (slice 44), undo/redo (slice 45).
