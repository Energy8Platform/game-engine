# Slice 43 — Preview and canvases: what was left behind

Slice: `docs/superpowers/plans/2026-09-28-preview-and-canvases.md`, spec
`2026-09-28-preview-and-canvases-design.md` (its §9 records the amendments).
Commits `ddd1d2ee..8bc085be` on `feat/slot-webide-cordis` plus this note's.

Source: the user's feedback of 2026-09-28, items 1, 3 and 8 — a refresh
button in the Preview, balances like the harness, and a Reels canvas that
showed only a brown window in their own game (paper-duel). The same list's
item 2 (spin/turbo/status over the game) is paper-duel's own `#controls`
— the user removes it; item 9 (the wild-glue animation in Symbols) was
skipped: it is a plugin step, not a symbol state. Items 4–7 (undo/redo,
sidebars per tab) are slices 44 and 45.

What shipped:
- **Preview `↻`** relaunches the game at the same address; the wallet
  and the shell's balance keep what was left.
- **Balances like the harness**: a list 1 … 10B (default 10K); every pick
  and `↺` start a fresh wallet (a wallet number in the game's address,
  folded into session-host's `sessionStorage` key). An old stored
  free-text balance loads as its level, or 10K.
- **The shell shows the kept wallet** after any reload: session-host hands
  out `init.balance` = the stored wallet (the key still comes from the
  seed). Before, the accounting kept it but the bar showed the seed until
  the first spin (since slice 39).
- **Canvases find their own mode**: scene-edit reads `?scene`, `?symbol`,
  `?reels` and the parent's origin from its page whenever the project's
  `editor.ts` leaves them out (what a project passes still wins). So
  paper-duel's Reels canvas works with its `editor.ts` unchanged; first-slot
  and the template pass nothing now.
- **An empty board is filled at once** in the Reels canvas (a lab spin
  skipped to its end); a rebuild of the same shape keeps the symbols shown
  (while every id is still known), another shape gets a random board.
- **The Reels and Symbols documents say what the canvas says**: a canvas
  `error` in the status line; no `ready`/`error` in 10 s → "the canvas did
  not answer"; a later `ready` clears only what the canvas said.

Unit gate: session-host 24, scene-edit 120, ide-client 849, game-runtime 109,
ide-host (alone) 554; typecheck 0. Full Playwright alone
(`E8_E2E_HOST_PORT=5779`): 173/173 (11.4 min), first run.

## Debts

1. **The fill with the anticipation zoom on plays the whole spin** — the
   anticipator's `zoomIn` is awaited before the motion starts, so the
   synchronous `skip()` lands too early. The lab Spin shares it; the zoom
   is off by default.
2. **Two IDE tabs share the wallet number** (localStorage, last writer
   wins): a tab can reload onto a number it used before and resume that
   wallet. Dev-only.
3. **Small**: a hot re-apply of `shell1` shows the boot-time balance, not
   the current one (a `get balance()` on the provided init would cover
   it); changing the currency back resumes that currency's old wallet
   (only balance picks and `↺` are fresh by design); `search` is parsed
   twice in session-host; symbol mode's zoom handler shadows the outer
   `mode`; `new URL(referrer)` is unguarded (a browser referrer is always
   valid); every Reels open fills twice (before `ready`, then after the
   `rows` rebuild) — harmless, the second reuses the first's grid.
4. **Not here**: the paper-duel page overlay (the user's file), symbol
   states that play over the static image (the glue), sidebars per tab
   (slice 44), undo/redo (slice 45).

## Method

- **A game's own copy of an engine file drifts**: paper-duel's `editor.ts`
  predated the reels mode, and every project would have needed the same
  edit. Read what the page can read for itself in the engine; leave the
  project file nothing to parse.
- **A seed is not the balance**: `session.init` answered the seed while
  the wallet kept the leftover — two e2e rounds read the seed and proved
  nothing. Assert the value the player sees, or the arithmetic of the
  next play from it.
- **A status cleared on `ready` must be the canvas's own**: a blanket
  clear wiped errors the canvas sent before `ready` and the document's own
  messages.
