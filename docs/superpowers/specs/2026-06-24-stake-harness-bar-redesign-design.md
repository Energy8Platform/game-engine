# Stake Harness Bar — Stake-style Tabs + Popovers (redesign) — Design

Date: 2026-06-24. Branch: `feat/game-spec-define-game` (continuing).

**Goal:** restyle and restructure the Stake harness wrapper bar so it matches the
look and interaction of Stake's real ACP developer harness (the reference
screenshots): a **fixed bottom tab bar** whose tabs open **popovers** over the
game, instead of today's single flat row of controls. Functionality is unchanged
— this is a UI restructure of the wrapper page only. We adopt Stake's *structure
and visual language*, but build **only the controls our harness actually backs**;
anything Stake exposes that we have no backing for is not built.

This redesign supersedes **Component 3 — control bar** of
[2026-06-23-stake-dev-harness-design.md](2026-06-23-stake-dev-harness-design.md).
Components 1, 2, 4, 5 (the plugin, dev-RGS data layer, dev-RGS handler, scaffold
wiring) are unchanged except for one additive field (per-mode book `count`, below).

## Decisions (from brainstorming)

- **Fidelity:** *Stake structure, pragmatic depth* — adopt the tabbed bottom bar +
  popovers and Stake's exact visual language, but flatten Stake's nested Settings
  submenus into inline controls, and build only tabs/controls with real backing.
- **Only-backed rule:** controls Stake has but our harness does not back are **not
  built**. Dropped: **Versions** (no multi-version — always `v1`), **Local
  Testing** (no equivalent), **Language** (no language list/endpoint), **Device
  Type** (Screen presets already cover responsive sizing; `device` is not varied).
- **Open in New Tab:** **not built** (per the only-backed rule).
- **Replay fields:** Replay panel carries its own **Amount**; **Currency** is the
  single shared value from Settings (not duplicated in Replay).
- **Pattern preserved:** the wrapper stays **vanilla DOM, inlined in
  [wrapper.ts](../../../packages/stake-kit/src/harness/wrapper.ts)** (its header
  documents this deliberate choice — helpers are duplicated inline to avoid
  served-ESM module-resolution friction). No framework, no new served modules.
  [bar.ts](../../../packages/stake-kit/src/harness/bar.ts) stays the typed,
  unit-tested SSOT for presets and pure helpers.

## Capability map (what is backed → what we render)

| Stake control | Backed by | Render |
|---|---|---|
| Screen (7 presets) | `SCREEN_PRESETS` (bar.ts) | **Screen** tab → preset list |
| Settings → Balance | `GET /__rgs/__dev/balance?major=` (`DevRgs.setBalance`) | **Settings** row |
| Settings → Currency | `GET /__rgs/__dev/currency?code=`, `CURRENCY_META` | **Settings** row |
| Settings → Social Mode | `social` launch param | **Settings** toggle |
| Replay (Mode/Event/Amount) | `replay()`, `index.json` modes, `betLevels` | **Replay** tab → panel |
| Event ID range `0 – N` | LUT row count per mode (new `count` field) | Replay range hint |
| `gameId` + version | config `spec.id`, `version: '1'` | static brand chip (left) |
| Versions / Local Testing / Language / Device Type | — (no backing) | **not built** |

## The redesigned bar

A fixed full-width overlay pinned to the bottom of the wrapper window. Left to
right:

- **Brand chip** — `‹gameId› · v1` (static; replaces a Versions tab — we have the
  info, not a version picker).
- **Tabs** — `Settings`, `Screen`, `Replay`. Each is a button; clicking toggles its
  popover. The active tab is highlighted. At most one popover is open; clicking
  outside the open popover or pressing `Esc` closes it.

```
┌──────────────────────────────────────────────────────┐
│              GAME  (iframe = selected Screen preset)    │
│                              ┌─ Replay ──────────────┐  │
│                              │ Game Mode         [v] │  │
│                              │ Event ID  (0 – 9999)  │  │
│                              │ [0]                   │  │
│                              │ Amount                │  │
│                              │ [1.00]                │  │
│                              │ [     Play Event    ] │  │
│                              │      Close Replay     │  │
│                              └───────────────────────┘  │
├──────────────────────────────────────────────────────┤
│  demo-slot · v1        Settings    Screen    Replay    │ ← fixed bottom
└──────────────────────────────────────────────────────┘
```

### Settings popover (flattened — no nested submenus)

A compact menu of three rows, each `caption + control`:

- **Balance** — select of the existing balance levels (`1 … 10B`, default `10K`).
  On change: `GET /__rgs/__dev/balance?major=<n>` then relaunch (normal).
- **Currency** — select of `cfg.currencies` (default `EUR`). On change:
  `GET /__rgs/__dev/currency?code=<code>` then relaunch (normal). This is the
  single currency source the Replay panel reads.
- **Social Mode** — toggle switch (default off). On change: relaunch (normal) with
  `social=<bool>`.

### Screen popover

A vertical list of the 7 presets, each labelled `Name (W×H)` (Desktop 1200×675,
Laptop 1024×576, Popout S 400×225, Popout L 800×450, Mobile L 425×812, Mobile M
375×667, Mobile S 320×568). Selecting one highlights it and resizes the iframe
(CSS width/height). No relaunch.

### Replay panel

A vertical panel (matches the reference screenshot), disabled with a hint when no
curated books exist (`modes.length === 0`):

- **Game Mode** — select of `cfg.modes` (placeholder "Select a game mode" when
  none chosen). Switching the mode updates the Event ID range hint.
- **Event ID** — numeric input, label shows `(Range: 0 – N)` where `N = count-1`
  for the selected mode (from the new per-mode `count`). Default `0`.
- **Amount** — numeric input, seeded with the min bet level (`betLevelsMajor[0]`);
  threaded to the launch as `amount = value × API_MULTIPLIER` (minor units).
- **Play Event** — primary button; relaunches the iframe via the existing
  `buildLaunchUrl({ replay })` branch (`replay=true&game&version&mode&event&amount
  &currency&social&lang&rgs_url`), reading currency/social from Settings.
- **Close Replay** — red text link; relaunches normal play.

The current **🎲 random** button is **removed** — it is not in Stake's reference
panel and the existing implementation was a non-functional placeholder
(`Math.random()*1000`, not a real weighted pick). If a real random pick is wanted
later it is a trivial add now that `count` is known (`floor(rng()*count)`).

## Layout & interaction

- **Bar:** fixed full-width overlay at the window bottom; the stage above reserves
  the bar's height (`padding-bottom`) and centers the iframe at the chosen preset
  size, so a large preset isn't occluded by the bar.
- **Popovers:** absolutely positioned, anchored above their tab, opening **upward**,
  floating over the game (not pushing it). Rounded, bordered, shadowed.
- **One-open invariant:** opening a tab closes any other; outside-click / `Esc`
  closes. Implemented with a single `openPanel` state variable in the inline driver.
- **Launch model is unchanged:** Screen = resize (CSS); Settings changes + Social +
  Replay = relaunch the iframe with new query params (the existing
  `launchNormal` / `launchReplay`). The `/__rgs/__dev/*` calls are unchanged.

## Visual language (Stake)

Tuned from the existing palette toward the screenshots:

- Near-black popover panels (`#13161b`/`#0f1218`), 1px subtle border (`#262b33`),
  soft drop shadow; ~10–12px radius.
- Tabs: muted label (`#9aa3b0`), active tab brighter with an underline/blue accent.
- Captions: uppercase, letter-spaced, muted (`#8a92a0`).
- Inputs/selects: dark fill (`#1c2128`), `#3a414c` border, blue focus ring (`#3b82f6`).
- **Play Event:** full-width blue primary (`#3b82f6 → #2563eb`).
- **Close Replay:** red text link (`#e5616b`).
- Selected list row (Screen preset / Game Mode): blue highlight (`#2f6bff`).
- Font: Inter (already bundled/used by the wrapper).

## Implementation surface

| Unit | File | Change |
|---|---|---|
| Tabbed bar + popovers markup, styles, inline driver | `packages/stake-kit/src/harness/wrapper.ts` | rewrite the bar half of the page |
| Pure helpers if any new (e.g. tab ids) — presets unchanged | `packages/stake-kit/src/harness/bar.ts` | additive |
| Per-mode `count` (LUT row count) added to wrapper `modes` | `packages/stake-kit/src/harness/plugin.ts` (+ `books.ts` helper) | additive |
| `WrapperMode` gains `count: number` | `packages/stake-kit/src/harness/wrapper.ts` | additive |

`books.ts` gains a small `countLutRows(booksDir, mode)` (read the LUT, count
non-empty lines — files are small integer CSVs, already read synchronously by
`pickWeighted`). `plugin.ts`'s `wrapperHtmlFor` populates `count` per mode.

## Data flow (unchanged)

`npm run stake` → vite (`BUILD_TARGET=stake-harness`) → `stakeHarnessPlugin` serves
the wrapper. Bar defaults: Settings (Balance 10K / Currency EUR / Social off),
Screen Desktop, Replay closed. Initial normal launch. Tab interactions toggle
popovers; control changes relaunch or resize exactly as before.

## Testing

- **bar.ts pure helpers:** existing `SCREEN_PRESETS` / `screenPreset` /
  `buildLaunchUrl` tests stay green (URL contract is unchanged). Add a test for any
  new pure helper.
- **books.ts:** `countLutRows` returns the row count for a fixture LUT and `0` for a
  missing file.
- **plugin.ts (`harness-plugin.test.ts`):** the served wrapper HTML still contains
  `id="harness-config"`, now also exposes per-mode `count`; the page contains the
  three tab buttons (`Settings`/`Screen`/`Replay`) and the Replay panel ids
  (`mode`/`round`/`amount`/`replay`/`close`). Assert the `🎲` random control is
  gone.
- **wrapper render:** `renderWrapperHtml(cfg)` with `modes: []` renders the Replay
  tab disabled; with modes renders the Game Mode options and the Event ID range
  hint from `count`.
- **Manual:** `npm run stake` in `examples/demo-slot` — open each tab, switch a
  Screen preset (iframe resizes), change Balance/Currency/Social (relaunch),
  replay a Game Mode + Event ID (replay launch). Pixi boot can't be automated here
  (see memory: Pixi headless init hang); the render/URL/plugin tests are the
  automatable coverage.

## Out of scope (YAGNI / only-backed)

- Versions, Local Testing, Language, Device Type, Open in New Tab — no backing.
- Stake's nested Settings submenus (Balance ▸ / Currency ▸ drill-ins) — flattened.
- Any new dev-RGS endpoint or RGS behavior; the launch/relaunch model is unchanged.
- Persisting bar state across reloads; theming beyond the Stake-style palette.

## Risks / open items

- **Popover layering vs the iframe:** an absolutely-positioned popover must render
  above the same-origin iframe. Mitigation: popovers are siblings of `#stage` with a
  higher `z-index`; the iframe has no stacking context that traps them. Verify in
  the manual pass.
- **Inline driver complexity:** tabs + outside-click + one-open invariant grow the
  inline `<script>`. Mitigation: keep one small `openPanel(name)` /
  `closePanels()` pair and a single document `click`/`keydown` listener; the page
  stays a single self-contained string (no new module), consistent with the
  documented pattern.
- **Event ID range when no `count`:** if `count` is unavailable (legacy index), the
  range hint falls back to no upper bound (plain numeric input), never throws.
