# Slice 39 — the Preview like the harness, a game without a dev overlay, a tabbed panel: what was left behind

Slice: `docs/superpowers/plans/2026-09-26-preview-and-panel.md`, spec
`2026-09-26-preview-and-panel-design.md` (amended with the rulings below).
Commits `db8c9f92..a7afab96` on `feat/slot-webide-cordis` plus this note's.

Source: the user, after using the IDE — the composition showed the game
beside a Preview; the Preview was a wall of full-size tiles with the game
page's own Spin/turbo/mechanic/status toolbar and log floating over the
game; diagnostics had no place of their own; plugins could not add blocks
to the bottom bar. Items 3 (symbols: a tiny symbol on black) and 4 (the
reels board's form) are slices 40 and 41.

What shipped:
- **Composition** shows the composition only (rows, forms, cards).
- **Preview** (`screens/Preview.tsx`): one iframe at the chosen preset's
  size, 1:1, centred in a scrolling stage; a labelled toolbar — screen
  (7 presets) + Rotate, language (16), currency (`DEV_CURRENCIES`),
  balance, social. An address change (lang/currency/balance/social/device)
  relaunches the game; a screen/rotate change resizes it (the harness's
  `applyScreen`). Remembered in `localStorage['e8.preview']`, field-by-field
  fallback.
- **The session takes it**: `session-host` forwards the page's `lang`,
  `currency`, `balance`, `social`, `device` to `GET /api/session`; the dev
  host applies each valid one (`Object.hasOwn` on the currency table); the
  tab's wallet is keyed on its seed (`e8:wallet:<gameId>:<balance>:<code>`);
  `shell-pixi` maps `social` to `isSocial`. `SessionInit.social`,
  `DEV_CURRENCIES` in contracts.
- **The game page draws only the game**: `#controls` and `#log` gone from
  both `index.html`/`main.ts` copies; `window.__e8` drives tests
  (`spin()` → `{ out, kind }`, `skip()`, `session()`); `e8 shot` waits for
  and spins through `__e8`.
- **Status bar**: `ide-bridge` sends `game-status`
  (loading/ready/spinning/failed); the host relays, greets, says `offline`
  when the owning socket closes or the project changes; `GameStatus`
  (`● ready[ — message]`, `◌ spinning…`, `✕ <message>` → opens
  Diagnostics, `… loading`, `○ no game`). Spinning never sticks: a
  restarted run, an idle flow (bounded poll only while spinning), a flow
  gone, a failed boot each end it.
- **Bottom panel = tabs**: `PanelMeta.order`, `ctx.shell.panel()`,
  `showPanel(key)`, `setPanelBadge(key, value)`, entries always mounted,
  active tab remembered. Diagnostics first, badge = errors + warnings.
- **The game always runs while a project is open**: the Preview opens in
  the background (`openContributed(key, { background: true })`) on every
  workspace frame with an active project — fresh load, F5, deep link.

Unit gate: contracts 172, session-host 20, shell-pixi 30, ide-bridge 91,
ide-client 715, ide-web 38, game-runtime 109, flow 138, play-loop 87,
scenes 211, symbols 57, reels 66, ide-host (alone) 554; typecheck 0
everywhere. Full Playwright alone (`E8_E2E_HOST_PORT=5779`): 164/164 (10.3
min).

## Amendments made while running the plan

- **No `game=` identity on the Preview's address** — a named game loses
  its retained diagnostics when its socket closes; the one frame is the
  anonymous game.
- **`e8 shot` on the hooks** — the spec missed that it read `#status` and
  clicked `#spin`.
- **Resize, not relaunch, for screen/rotate** — the spec said every
  toolbar change relaunches; the harness resizes, and so does this.
- **The Preview opens in the background** (Task 8b, then the final
  review's C1 for reloads/deep links). Removing the composition's embedded
  frame had removed the running game the IDE depends on: node types
  (scene drops, fields), flow kinds (palette and edges), transitions, the
  status item and the `e8-server` dot. A `display: none` Preview boots its
  game in Chromium.
- **Status robustness** (final review I3): the status ended only on a
  `present`/`spin` exit port; a `replace`, a thrown node, a disposed flow
  or a rejected `flow.ready` left it stuck.

## Debts

1. **Interleaved runs** (`on { busy: parallel }`, e.g. paper-duel's sfx):
   `run < lastRun` can read a false `● ready` mid-spin. Fix with a
   busy-change / replaced signal on the flow service, which would also
   replace the idle poll (`ponytail:` comment in `ide-bridge`).
2. **One status slot for all game sockets**: the game open in its own tab
   and closed last shows `○ no game` while the Preview's game runs. Keep
   the last frame per socket.
3. **Flow canvas without a running game** drops the edges out of
   `sound`/`count` nodes after an edit — masked now that a game always
   runs; root cause (ports only a running game registers?) not found.
4. **Panel**: badges not cleared when their entry is withdrawn; the
   tablist also holds the collapse toggle (a11y); `openContributed`'s
   background branch re-spells the `OpenDocument` literal.
5. **Status**: `GameStatus` lives on `gameComposition`, so every status
   frame re-renders every `useGameComposition` consumer; a composition with
   boot errors reads `● ready` (the Diagnostics badge carries it).
6. **Tests**: `game-status` through the restricted preview socket is not
   unit-tested (e2e covers it); `○ no game` e2e is staged through
   `POST /api/workspace/close` (no close control in the IDE); canvas.spec
   dropped a `#status` check without an inline reason; flow.spec's
   `openComposition` leaves the Preview active; composition.spec's
   `pressSpin` leaves an in-page spin promise pending; six prettier-dirty
   files left as they were.
7. **Not done here**: a Preview docked beside the composition; a Spins
   tab; replay; a currency list from a server; `session-sdk`'s social.
8. **Slices 40–41**: the Symbols document (canvas at the design size with a
   96 px symbol; scene-node properties that mean nothing for a symbol);
   the reels board (a long autoform, `unsupported (union)` fields, colours
   as numbers, a raw `board`, no live view beside it).

## Method

- **Look at the screen before designing it**: a throwaway Playwright spec
  screenshotting the IDE on a project copy showed the wall, the overlay and
  the 96 px symbol faster than reading the code did.
- **Removing a view can remove a side effect someone depended on**: the
  composition's frame was also "the game is running". Ask what else a
  removed component guaranteed before deleting it.
- **A default that writes the address is a deep link on the next load**:
  a behaviour tied to "no document open" never runs after F5.
- **A transient UI state needs a held cause in e2e** (`page.route` on the
  request that keeps it), never a race against an un-awaited promise.
