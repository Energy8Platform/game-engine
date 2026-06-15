# Game Shell — Visual Design System

**Date:** 2026-06-15
**Status:** design (approved to plan)
**Builds on:** `2026-06-15-game-shell-design.md` (architecture/contract — unchanged by this spec)

This spec defines the **visual re-skin** of the already-shipped game shell
(`@energy8platform/platform-core/shell`). The game-driven contract, state, setters,
and events are **unchanged**. This work replaces the prototype CSS and adjusts a few
component structures to realize the design. Interactive mockups from the brainstorm
live in `.superpowers/brainstorm/.../content/` (gitignored).

## Design pillars

1. **Minimal, doesn't compete with the game.** The chrome is transparent — no panel,
   no divider. Controls float directly over the game; text carries a soft shadow for
   legibility. Flat: **no blur, no drop-shadow, no glow, no gradients**.
2. **Brand lives in two places only:** the **BUY BONUS** accent colour and a
   **distinctive duotone icon set**. Everything else is neutral monochrome.
3. **Motion is minimal and functional only:** button press (slight scale), balance/win
   count-up, fade on overlay/mode change. No decorative motion.

## Colour system

Neutral monochrome base; a single accent reserved for BUY BONUS; a tiny purple touch
for active states (organic).

| Token | Value | Use |
|---|---|---|
| `--shell-fg` | `#f3f5fa` | primary text, SPIN icon-on-white |
| `--shell-muted` | `#9aa3b6` | micro-labels (BALANCE/BET/WIN), inactive |
| `--shell-icon` | `#c7cedb` | icon base tone (duotone tone 1) |
| `--shell-icon-bright` | `#ffffff` / `#e8ecf4` | icon accent tone (duotone tone 2) |
| `--shell-accent` | `#8b5cf6` | **BUY BONUS** + active-state purple. Game-overridable. |
| `--shell-surface` | `#0c111c` | full-screen overlay background (near-opaque, flat) |
| `--shell-hairline` | `rgba(255,255,255,.07)` | overlay dividers, control borders |
| `--shell-spin` | `#f4f6fb` | SPIN disc (solid white) |
| `--shell-spin-fg` | `#141a28` | SPIN icon (dark, on the white disc) |

- **Only BUY BONUS carries colour** in the bar. `--shell-accent` default `#8b5cf6`,
  overridable per-game via `theme.buyBonusColor` (existing whitelist). Each
  `BonusOption.accentColor` tints its own card (border / price / BUY pill).
- **Active-state purple (organic):** a 5px purple dot under an active icon control
  (e.g. turbo when level > 0, autoplay when active); purple fill on an active Settings
  toggle and slider fill. Nothing else is coloured.
- Text legibility without a panel: `text-shadow: 0 1px 3px rgba(0,0,0,.65)` on floating
  readouts; micro-labels have no shadow.
- Numerals are **tabular** (`font-variant-numeric: tabular-nums`).

## Icon set (duotone)

Custom duotone icons — two neutral tones (`--shell-icon` base + `--shell-icon-bright`
accent). This set is the brand's signature; it must read clearly at ~22px and on a
busy game background. Inventory:

| Icon | Notes |
|---|---|
| spin | two curved arrows forming a ring; used inside the SPIN disc (dark on white) |
| turbo | lightning bolt |
| autoplay | play triangle inside a disc |
| menu | three bars, middle bar shorter (duotone) |
| bet up / bet down | chevron up / chevron down (wide layout) |
| bet minus / plus | `−` / `+` (narrow layout, flanking SPIN) |
| buy / gift | gift box (used in BUY BONUS button + overlay) |
| info | circled `i` |
| sound | speaker (with on/off state) |
| close | `✕` (overlay close) |
| back | chevron-left (Game info overlay back) |
| chevron-right | row affordance (Game info button) |
| volatility star | `★` outline/fill, 1–5 scale |

SPIN is a **solid white disc** with the dark spin icon — reads as the primary action
without using colour. All other bar icons are borderless duotone glyphs (no button
backing).

## Bottom bar — adaptive layout

Transparent. Driven by a **container query on the shell root** (already an
`inline-size` container). Breakpoint ≈ **720px** viewport width.

**Wide (`≥ ~720px`) — spin-right (Hacksaw/Twist convention):**
- **Bottom-left:** `☰ menu` · `Balance` · `Win` · `BUY BONUS`
- **Bottom-right:** `Bet` value · bet up/down chevrons (stacked) · `turbo` · `autoplay` · **SPIN** (large disc, far right)

**Narrow (`< ~720px`) — spin-center:**
- **Menu** pinned bottom-left corner (always).
- Info row above controls: `Balance` (left) · `Win` (right).
- `BUY BONUS` centered above the control row.
- Control row centered: `turbo · − · SPIN(center, largest) · + · auto`, with `BET` label under the SPIN disc.

**Menu is always bottom-left** in both layouts.

## Modes

- **base** — as above.
- **freeSpins** — counter is the hero: large centered `current / total`; `Total win`,
  `Last win`, `Balance` flank it; `Bet` read-only + `turbo` (if available) on the
  right. No spin / bet± / buy / autoplay. Menu bottom-left.
- **replay** — read-only HUD only: `Bet` · `Win` · (`Free spins` if any) · `turbo` (if
  available). **No badge.** No controls. Menu bottom-left.

## Overlays (full-screen)

Each surface is a **full-screen layer** over the game (not a centered card):
flat `--shell-surface` background, near-opaque, **no blur**. Header = title (+ optional
back) + close `✕`, hairline divider, content below (scrollable).

- **Settings** (opened by the bar **menu** button — Menu and Settings are **merged**;
  there is no separate menu list):
  - `Sound` toggle
  - `Master volume` / `Music` / `SFX` sliders (purple fill = value, white knob)
  - a **`Game info ›` button** at the bottom that opens the Game info overlay
  - **Removed vs prototype:** Fullscreen, Battery saver, Quick spin (TURBO on the bar
    already governs spin speed; a separate quick-spin toggle is redundant).
- **Game info** — **its own** full-screen overlay, opened from the Settings button.
  Header has a back `‹` (returns to Settings) and close `✕`. Sections: `RTP` ·
  `Rules` · `Paytable` · `Features` (content from `config.gameInfo`).
- **Buy bonus** — its own full-screen overlay, opened from the bar BUY BONUS button.
  One card per `BonusOption`: name, volatility (1–5 stars), description, live price
  (`priceMultiplier × bet`), `BUY` pill. Per-bonus `accentColor` tints border / price /
  pill (default `--shell-accent`).

## Structural deltas from the shipped shell (for the implementation plan)

The contract/events/setters do **not** change. These component/CSS changes do:

1. **`shell.css.ts` — full rewrite:** transparent bar (remove panel/divider/blur),
   neutral tokens above, container-query adaptive layout (spin-right / spin-center),
   full-screen overlay styling, duotone icon styling, minimal-motion transitions.
2. **Icons:** replace text glyphs (`☰`, `−`, `+`, `✕`, `★`) and any emoji with the
   duotone SVG set (new `components/icons.ts` exporting SVG strings).
3. **`BottomBar.ts`:** restructure into layout zones (left cluster / right cluster for
   wide; centered stack for narrow) with `data-ge` hooks preserved; SPIN as white disc;
   active-state purple dot on turbo/autoplay.
4. **Menu → Settings merge:** the bar **menu** button opens the **Settings** overlay
   directly (no standalone Menu list). `Menu.ts` is removed/folded into Settings.
   Decision: `openMenu()` emits `menuOpen` (kept for backward-compat) **and** opens the
   Settings overlay, which emits `settingsOpen`. Both events fire on a menu tap.
5. **`Settings.ts`:** drop Quick spin + Battery saver; keep Sound + 3 sliders; add the
   `Game info ›` button (calls `openInfo()`); render as a full-screen overlay; remove
   Fullscreen.
6. **`GameInfo.ts`:** full-screen overlay; add a back control that re-opens Settings.
7. **`BuyBonus.ts`:** full-screen overlay; cards restyled per above.
8. **Motion:** press scale on buttons, count-up on `setBalance`/`setWin` (respect a
   reduced-motion guard), fade on overlay open/close and `setMode`.

Tests: existing `data-ge` hooks and event assertions must keep passing; update only the
DOM-shape assertions the restructure changes (e.g. overlay full-screen container,
removed quick-spin/battery/fullscreen/menu-list nodes, new Game-info button node).

## Out of scope

- New brand assets / logo work (uses existing `buildLogoSVG` palette context only).
- Per-game theming beyond the existing `accent` / `buyBonusColor` whitelist.
- Sound/haptics design; only the Sound toggle + volume sliders are in scope.
