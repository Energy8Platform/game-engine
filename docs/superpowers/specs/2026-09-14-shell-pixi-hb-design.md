# `@energy8platform/shell/pixi-hb` — Hellbuddha Pixi shell

A second Pixi renderer for the game shell, styled for the Hellbuddha (HB) brand. It starts as a
copy of `src/ui/pixi/` and diverges in visual language only: the renderer-agnostic core
(`src/core/`) is unchanged and every public contract (`ShellConfig`, `Shell`, events, actions,
state) stays identical, so a game switches renderers by importing `createPixiHbShell` instead of
`createPixiShell`.

## 1. Package layout

```
packages/shell/
├── icons-hb.svg                         ← authored HB icon sheet (stroke glyphs)
├── scripts/
│   ├── gen-hb-icons.mjs                 ← icons-hb.svg → src/ui/pixi-hb/icons.ts
│   └── build-hb-fonts.mjs               ← Space Grotesk + Switzer → src/ui/pixi-hb/fonts.ts
└── src/ui/pixi-hb/
    ├── index.ts                         ← createPixiHbShell / removePixiHbShell (+ types)
    ├── PixiHbRenderer.ts                ← copy of PixiRenderer, wired to hb components
    ├── theme.ts                         ← fixed HB tokens (no scheme, no accent override)
    ├── fonts.ts                         ← generated base64 faces
    ├── icons.ts                         ← generated 24×24 fragments, HbIconName
    ├── pixi-icon.ts                     ← IconView over hb icons (multi-colour slots)
    ├── text.ts                          ← font stacks: body Inter, heading Space Grotesk, digits Switzer
    ├── primitives/{plaque,widgets,controls,card,overlay,popover,scroll,scroll-affordance}.ts
    └── components/{BottomBar,Menu,GameInfo,BuyBonus,Modal,ReplayModal,pickers}.ts
```

Style-free modules are **imported from `../pixi/`**, not copied: `primitives/flex.ts`,
`motion-pixi.ts`, `context.ts`. Everything that draws a colour, picks a font or lays out chrome is
a copy under `pixi-hb/` so the two renderers never share a visual decision.

Exports:

- `package.json` `exports["./pixi-hb"]` → `dist/pixi-hb.{esm,cjs}.js` + `.d.ts`.
- `rollup.config.mjs` gains `...bundle('src/ui/pixi-hb/index.ts', 'pixi-hb', ['pixi.js', SOCIAL])`.
- `index.ts` exports `createPixiHbShell(config: PixiShellConfig)`, `removePixiHbShell()`,
  `PixiHbRenderer`, the same `PixiShellConfig` / `BonusOption` / `GameInfoSection` /
  `PixiGameShell` types, and `export * from '@/core'`.
- game-engine does not re-export it (not requested).

Demo: `examples/pixi-hb-shell-demo` — a copy of `examples/pixi-shell-demo` that imports
`@energy8platform/shell/pixi-hb`. Used for puppeteer screenshots during development.

## 2. Icons

Source: `packages/shell/icons-hb.svg` (the sheet the brand delivered). Generator
`scripts/gen-hb-icons.mjs` is a fork of `gen-icons-from-svg.mjs` that keeps strokes instead of
flattening to monochrome fills.

Glyph id → name map:

| svg id | name | style |
|---|---|---|
| `spin` | `spin` | fill+stroke |
| `turbo` | `turbo` | fill+stroke |
| `stop` | `stop` | fill+stroke |
| `minus`, `plus` | `minus`, `plus` | solid |
| `menu` | `menu` | solid |
| `info` | `info` | solid |
| `close` | `close` | fill+stroke |
| `chevrom-up` (sic) | `chevronUp`; rotated → `chevronDown`, `chevronRight`, `back` | fill+stroke |
| `sound-on`, `sound-off` | `soundOn`, `soundOff` | solid |
| `music-on`, `music-off` | `musicOn`, `musicOff` | stroke only, round caps |
| `autoplay` | `autoplay` | fill+stroke; the middle triangle path → accent slot |
| `bonus` | `bonus` | fill+stroke |
| `volality` (sic) | `volatility` | fill+stroke |

Colour slots (string placeholders substituted at build time, like `currentColor` today):

- `currentColor` — ink: strokes and solid glyphs.
- `currentFill` — inner fill of stroked shapes (default beige).
- `currentAccent` — the autoplay triangle (default orange).

Stroke width is fixed in the 24-unit box: `HB_STROKE = 2.2` (≈3 px on a 32 px glyph), with
`stroke-linejoin="round"`; `musicOn/Off` keep `stroke-linecap="round"`. Fit rule unchanged from the
existing generator (largest dimension → 24 − 2·PAD, centred), but the bbox is expanded by half the
stroke so a stroked glyph never clips.

`icons.ts` exports `HB_ICON_NAMES`, `type HbIconName`, `icon(name)`, `iconSVG(name, ink, fill,
accent)`. `pixi-icon.ts` (`IconView`) caches contexts by `name|ink|fill|accent` and exposes
`setColors({ ink?, fill?, accent? })`. Core `icon-names.ts` is untouched; the hb menu/bar choose
glyphs from `HbIconName` themselves, and a config-supplied `icon` that is not an `HbIconName` is
ignored.

## 3. Tokens — `pixi-hb/theme.ts`

Fixed palette. `theme.scheme` and `theme.accent` from `ShellConfig` are ignored (brand rule).

```ts
export const HB = {
  orange: '#FF7A00', gold: '#F5B800',   // accent + its hover
  red: '#E0301E',                        // volatility fill, feature (Ante) CTA
  beige: '#F5EFE3', beigeHover: '#E3D8C4', // button faces
  ink: '#1A120A',                        // borders, glyphs and text on beige/orange
  panel: '#1E1410',                      // solid modal / popover ground
  bar: 'rgba(30,20,16,.72)',             // control bar
  fg: '#F5EFE3', muted: 'rgba(245,239,227,.6)', track: 'rgba(245,239,227,.18)',
  backdrop: 'rgba(10,6,4,.55)',
  winOk: '#4ade80', winNo: '#f87171',
} as const;
export const BORDER = 3;
export const RADIUS = 8;
```

`resolveHbTokens()` returns a `ShellTokens`-shaped object (so `createShell`'s host typing keeps
working) with `accent = orange`, `btn = beige`, `btnInk = ink`, `plaque* = panel/beige`-based
values; hb components read `HB` directly and never consult `host.tokens` for colour.

`primitives/plaque.ts` is the one place the pattern is drawn:

```ts
plaque(g, w, h, { fill, border = HB.ink, radius = RADIUS, round = false })
```
— rounded rect (or circle when `round`) with a `BORDER`-wide inside stroke. Every button, panel,
card, popover and modal frame calls it.

## 4. Fonts — `scripts/build-hb-fonts.mjs` → `pixi-hb/fonts.ts`

- **Space Grotesk** variable (300–700), latin subset, from
  `https://cdn.jsdelivr.net/npm/@fontsource-variable/space-grotesk` (OFL). Family alias
  `SpaceGroteskHB`. Headings, section titles, bet-mode chip, CTA labels, emphasised captions.
  No Cyrillic — RU/UK headings fall back to Inter (documented in the file header).
- **Switzer** 700, full woff2 from Fontshare (ITF Free Font License, web embedding permitted).
  Family alias `SwitzerHB`. All numeric readouts (balance / bet / win / FS counter / autoplay
  countdown / prices), rendered with `TextStyle.stroke = { color: HB.ink, width: 3 }`.
- **Inter** — reused from `@/core/fonts` for body text.

`pixi-hb/text.ts` mirrors `pixi/text.ts` with three stacks (`FONT_FAMILY`, `HEAD_FONT_FAMILY`,
`NUM_FONT_FAMILY`), installs all three `@font-face` blocks once under `__ge-pixi-hb-font__`, and
`makeText` gains `stroke?: boolean` (numbers) and `heading?: boolean` (Space Grotesk) switches.

## 5. Bottom bar

Desktop (wide):

```
[bonus]   ┌──────────────────────────────────────────┐   (spin)  [auto] [turbo]
          │ [menu]  BALANCE  WIN   BET ▂▂▂▂▂ [+][−]    │
          └──────────────────────────────────────────┘
```

- Panel: `plaque(HB.bar)` — semi-transparent dark ground, 3 px ink border, radius 8. Holds menu,
  balance, win, bet readouts and the ± stepper. Heights / zoom / fit-scale rules are the existing
  ones (`BAR_H`, `BAR_REF_W`, `BAR_MIN_SCALE`, mobile `M_*`).
- Outside the panel, right: **spin** — circle, `HB.orange` face, beige glyph, hover `HB.gold`;
  the autoplay counter / stop faces of `SpinDisc` are kept. Then **autoplay** and **turbo** —
  square plaques, beige face, ink glyph, hover `beigeHover`; the autoplay triangle is orange;
  active state = orange border + orange glyph (no glow). Turbo levels keep the glyph swap
  (off/1/2 → `turbo` with level shown by the ink/orange colour; only one turbo glyph exists in the
  hb sheet, so level 2 draws the glyph with `fill = orange`).
- Outside the panel, left: **bonus** — square plaque, orange face, beige `bonus` glyph, hover gold.
  Disabled = 50 % alpha. When a feature is active the face turns red (deactivate).
- Readouts: label Inter 600 11 px muted uppercase; value Switzer 700 with ink stroke. Bet value
  gets a **bet strip** below it: `availableBets.length` segments (gap 2, height 4, radius 2),
  segments `0..index` filled orange, rest `HB.track`. Width = the bet box width. When
  `availableBets` has 1 entry the strip is hidden.
- ±: square plaques 28 px stacked (as today's stack, styled).
- **Ante / feature active**: the "Bet" label is replaced by a chip — orange plaque, ink Space
  Grotesk 700 text = `feature.title` (uppercase); the ± stack is replaced by one `close` glyph
  (ink, 24 px) that is not interactive — the bet is locked by the active feature, and the cross
  says so instead of a dimmed stepper.
- Mobile: existing two-row structure (info row above, controls row with bet− / spin / bet+) with
  hb styling; autoplay / turbo / bonus become square plaques flanking the controls row exactly
  where the current mobile layout places them.

## 6. Menu popover

`components/Menu.ts`: the popover body is a single `plaque(HB.panel)` block (border 3, radius 8,
pointer arrow kept). Rows are laid out with `gap 4`, no per-row background, no separator rows
(`separator` items are skipped). Preset handling:

- `sound` preset rows are **dropped** (no master mute in the hb menu).
- `music` / `sfx`: row = `[mute icon] label ───── slider`. The icon is an `IconView`
  (`musicOn/musicOff` for music, `soundOn/soundOff` for sfx) inside a 32 px beige plaque; tapping
  it sets the value to 0 and remembers the previous non-zero value in a module-level
  `Map<id, number>`; tapping again restores it (default 1 when nothing was remembered). The glyph
  shows `*Off` whenever the value is 0. The slider is the existing `Slider` restyled: track
  `HB.track`, fill orange, knob beige plaque 18 px.
- `toggle` rows: `Toggle` restyled (on = orange, off = track, knob beige with ink border).
- `button` rows: label + optional icon + chevron; hover = label turns orange.
- `gameInfo` preset stays a button row.

`setMenuRefresh` updaters flip the mute glyph when the value changes from elsewhere.

## 7. Game info

`components/GameInfo.ts` renders into a `CardModal`-style frame sized to **80 % × 80 %** of the
screen (`min(screen − 16, 80 %)` on either axis, so phones get screen − 16 px). Frame:
`plaque(HB.panel)` with border and radius, solid (no backdrop alpha on the frame; the veil behind
it is `HB.backdrop`).

- Header strip (height 48): title in Space Grotesk 700 20 px beige, centred; a 36 px orange
  square `close` plaque at the right; a 3 px ink line under the header (the header is the one
  "highlighted" band).
- Body: `ScrollBox` with a permanently visible **scrollbar**: track `HB.track` 6 px wide, radius 3,
  right-inset 6 px; thumb orange, radius 3, min 24 px; the thumb is draggable and follows the wheel /
  drag. The existing edge-scrim + chevron affordance is dropped in hb (the thumb is the affordance).
- Sections: no hairlines. Section titles Space Grotesk 700 16 px, centred; paragraphs Inter 14 px,
  centred, `wrapWidth = inner − 32`. Modes and paytable rows render as `plaque(HB.panel,
  border = rgba(245,239,227,.25))` cards on the panel ground — one card per row/mode, radius 8,
  content centred. Keycaps stay as small plaques. Custom sections render the game node unchanged.
- Version footer: muted 11 px centred.

## 8. Buy bonus

`components/BuyBonus.ts` is rewritten as a single-option **page** inside the same 80 % × 80 %
frame (`plaque(HB.panel)`, same header rule: title "Buy bonus" + orange close plaque).

Option list = `config.features.buyBonus` flattened: `groupedBy` groups are expanded into their
members in config order, so the ‹ › arrows walk every option. Index kept across bet steps /
resizes (`this.index`).

Layout (desktop, inner area under the header):

```
┌────────────┬──────────────────────────────────────────┐
│            │  ‹   BONUS TITLE   ›                       │
│   HERO     │  volatility  🐦🐦🐦🐦🐦                    │
│   33 %     │  description (Inter, wrap)                 │
│            │                                            │
│            │  [ price ]   [   BUY / ACTIVATE   ]        │  ← pinned bottom of right column
├────────────┴──────────────────────────────────────────┤
│  BALANCE 1,000.00     BET 2.00  [+][−]                 │  ← bet block, full width
└───────────────────────────────────────────────────────┘
```

- Hero: left 33 % of the inner width, full height of the upper band, separated by a 3 px ink
  vertical divider. Content: `bonus.custom(ctx)` node if given, else `bonus.art` image, else the
  thumb art from `buy-bonus-art.ts`; fitted (contain) and centred.
- Right column (padding 20): title row — Space Grotesk 700 22 px beige, centred, flanked by
  `back` / `chevronRight` square plaques (only when > 1 option; wrap around). Volatility row:
  five `volatility` glyphs 22 px, `fill = red` for `i < level`, `fill = panel` otherwise, ink
  stroke; hidden when `volatility` is undefined. Description: Inter 14 px beige, left-aligned,
  scrollable via the page's ScrollBox if it overflows. Bottom-pinned action row: price text
  (Switzer, stroked) and the CTA plaque — `feature` type → red face, label
  `Activate` / `Deactivate` when it is the active feature; `bonus` type → orange face, label
  `Buy`. CTA text beige Space Grotesk 700. Disabled (unaffordable / `disabled`) = 50 % alpha,
  non-interactive.
- Bet block (bottom band, height 64): balance readout, bet readout with the same bet strip as the
  bar, ± square plaques. Bet changes go through `host.actions.setBet` like the existing footer.
- Confirm step: existing `CardModal` flow restyled (`plaque(HB.panel)` frame, orange primary
  button, beige ghost secondary). `onBonusBuy` / `featureActivate` / `featureDeactivate` emission
  is unchanged.
- Mobile (`host.layout === 'mobile'`) keeps the same left/right split (33 % / 67 %); the right
  column scrolls. Short landscape popouts: whole page fit-scaled like the current overlay's
  `chromeScale`.
- Keyboard: ←/→ step options, Enter = CTA, Escape = close (through `onKey`).

## 9. Other surfaces

- `Modal` / `ReplayModal` / `pickers` (bet picker): `CardModal` frame → `plaque(HB.panel)`; chips
  → square plaques, selected = orange face + ink text; primary button orange, secondary beige.
- `navButton` (`close` / `back`) → 36 px square plaque, orange face, beige glyph.
- `Overlay` veil → `HB.backdrop`.
- Scroll affordance: hb `scroll-affordance.ts` draws only the orange thumb (always visible while
  content overflows; no fade, no chevron).

## 10. Responsiveness

No new rules: the hb bar reuses the existing wide/mobile switch, zoom-to-`BAR_REF_W`, mobile
fit-scale and `safeArea` reporting; modals reuse `CardModal`'s clamp/fit-scale. The 80 % frame
clamps to `screen − 16` on phones. All new widgets implement `Sizable` so `FlexBox` lays them out.

## 11. Tests (`tests/pixi-hb/`)

Vitest + jsdom like `tests/pixi/`:

- `icons.test.ts` — every `HB_ICON_NAMES` entry builds a `GraphicsContext` via `iconSVG` without
  throwing and substitutes all three colour slots.
- `menu.test.ts` — `sound` preset rows are absent; tapping the music mute icon sets `music` to 0
  and restores the previous value on the second tap.
- `bet-strip.test.ts` — with 5 bets and `bet = availableBets[2]`, three segments are orange.
- `buybonus-page.test.ts` — 3 options (one `groupedBy` pair) → 4 pages; › wraps; the CTA emits
  `bonusBuy` for the current option; feature option shows the red CTA.
- Copies of `autoplay-halted.test.ts` and `safeArea.test.ts` targeting `createPixiHbShell`.

## 12. Out of scope

HTML/DOM hb renderer, light scheme, per-game accent override, re-export from
`@energy8platform/game-engine/shell`, Cyrillic Space Grotesk.
