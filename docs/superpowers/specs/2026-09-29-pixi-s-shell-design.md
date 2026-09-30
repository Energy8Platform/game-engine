# `@energy8platform/shell/pixi-s` — the S Pixi shell

A third Pixi skin for the game shell. It reuses the Hellbuddha renderer (`PixiHbRenderer`) and all
of HB's overlays unchanged, and replaces only the control bar: instead of HB's bottom panel, S draws
two **side columns** that flank the reels, built from flat skewed black "slabs" with a yellow accent. The core (`src/core/`) and every public contract (`ShellConfig`,
`Shell`, events, actions, state) stay as they are. A game switches by passing
`shellFactory: createPixiSShell`.

Reference: the desktop screenshot the user supplied on 2026-09-29 (a ninja-themed 5×3 slot with the
columns beside the reels).

## 1. Scope

In this slice:

- the S bar (desktop and mobile layouts) and its primitives, palette and font;
- one hook in `PixiHbRenderer` so a skin can supply its own bar;
- the `./pixi-s` package entry, a demo and tests.

Not in this slice:

- restyling the overlays (menu popover, game info, buy-bonus window, bet/autoplay pickers, modals,
  replay modal). S shows HB's overlays exactly as HB draws them. A later slice restyles them; that
  slice forks the relevant HB components into `pixi-s/` at that point.
- version bumps and releases.
- a game-engine re-export.

## 2. Package layout

```
packages/shell/
├── fonts/montserrat-{latin,cyrillic}-800.woff2  ← new (OFL), + fonts/OFL-montserrat.txt
├── scripts/build-s-fonts.mjs             ← new: woff2 → src/ui/pixi-s/fonts.ts (base64)
└── src/ui/pixi-s/
    ├── index.ts        ← createPixiSShell / removePixiSShell (+ the same public types as pixi-hb)
    ├── theme.ts        ← S palette (fixed, like HB)
    ├── fonts.ts        ← generated
    ├── text.ts         ← installSFont(), S text styles (label, value)
    ├── icons.ts        ← S glyphs: mask, play, bolt (hand-written SVG fragments)
    ├── slab.ts         ← the slab primitive (skewed quad + shadow)
    └── SideBar.ts      ← the bar: wide + mobile layouts, safe area, menu anchor
```

Everything else comes from `../pixi-hb/` (renderer, overlays, `IconView`, HB icons for `spin` /
`close` / `stop` / `menu` / `minus` / `plus`) and `../pixi/` (`FlexBox`, motion, context).

Exports:

- `package.json` `exports["./pixi-s"]` → `dist/pixi-s.{esm,cjs}.js` + `.d.ts`.
- `rollup.config.mjs` gains `...bundle('src/ui/pixi-s/index.ts', 'pixi-s', ['pixi.js', SOCIAL])`.
- `index.ts` exports `createPixiSShell(config: PixiShellConfig)`, `removePixiSShell()`, the
  `PixiShellConfig` / `BonusOption` / `GameInfoSection` / `PixiGameShell` / `PixiShellSurface`
  types (re-exported from pixi-hb), `S` (the palette) and `export * from '@/core'`.
- `CLAUDE.md`: one line in the shell note naming `@energy8platform/shell/pixi-s`.

Only one shell is active at a time. `createPixiSShell` keeps its own `active` handle, like
`createPixiHbShell`.

## 3. Renderer hook

`PixiHbRenderer` today hard-codes `new BottomBar(this.ctx)` and reports
`safeArea = { top: 0, right: 0, bottom: barHeight, left: 0 }`. Both move behind a bar interface:

```ts
/** What PixiHbRenderer needs from a control bar. BottomBar (HB) and SideBar (S) implement it. */
export interface HbBar extends Container {
  balanceValue?: Text;
  winValue?: Text;
  applyFit(): void;
  menuAnchor(): Rect | null;
  menuPlate(): Rect | null;
  fitScale(): number;
  /** Screen-space insets the scene should avoid. */
  safeArea(): SafeArea;
}

export interface PixiHbRendererOptions {
  app: Application;
  parent?: Container;
  /** Build the control bar. Default: HB's BottomBar. */
  bar?: (ctx: PixiComponentContext) => HbBar;
}
```

- `renderBar()` calls `(this.opts.bar ?? defaultBar)(this.ctx)`.
- `get safeArea()` returns `this.bar?.safeArea() ?? NO_INSET`.
- `get barHeight()` returns `this.safeArea.bottom`.
- `BottomBar.safeArea()` returns `{ top: 0, right: 0, bottom: this.height, left: 0 }`, so HB
  behaviour does not change. The existing HB tests are the guard.

`createPixiSShell` builds `new PixiHbRenderer({ app, parent, bar: (ctx) => new SideBar(ctx) })` and
installs the S font in addition to HB's (the overlays still draw with HB's faces).

## 4. Visual language

### Palette (`theme.ts`)

Sampled from the reference screenshot:

| token | value | use |
|---|---|---|
| `yellow` | `#f8be45` | SPIN and BUY faces, labels, ± glyphs, active tab |
| `plate` | `#0b0b0b` | slab face |
| `shadow` | `rgba(0,0,0,.45)` | slab drop shadow |
| `fg` | `#f4f2eb` | values, white glyphs |
| `ink` | `#0b0b0b` | glyphs on yellow |
| `red` | `#e0301e` | BUY face while a feature is active |
| `disabled` | alpha `0.4` | disabled controls |

Like HB, the palette is fixed: `theme.scheme` and `theme.accent` are ignored.

### The slab (`slab.ts`)

One class draws every bar element:

```ts
new Slab(w: number, h: number, opts: {
  face: string;                 // S.plate or S.yellow or S.red
  corners?: Corners;            // per-corner offsets in px (the "torn" skew)
  shadow?: boolean;             // offset darker copy behind the face (default true)
})                              // + setFace(color) for hover
```

- **Shape.** A quadrilateral whose four corners are shifted from the `w × h` box by fixed
  offsets. Each element has its own preset (for example win: top edge rising 6px to the right,
  bottom edge rising 4px). The offsets are constants, not random, so the bar looks the same on
  every render and in every test.
- **Shadow.** The same quad offset by `(3, 3)` in `S.shadow`, drawn first.
- **Flat faces.** No texture and no sawtooth edge (2026-09-29, the user's call after the first demo:
  "убери эти точки на плашках, и у спина пилу снизу").

### Elements

| element | slab | content |
|---|---|---|
| menu | black, 64×44 | white `menu` glyph |
| WIN / BALANCE | black, 280×54 (label 15, value 26) | yellow caps label (`t('Win')` / `t('Balance')`), white value |
| TOTAL WIN (FS) | as WIN | label `t('Total win')` |
| BET | black, 290×46 (label 14, value 24) | yellow `minus` · yellow caps `t('Bet')` · white value · yellow `plus` |
| BUY | yellow, SPIN's size and shape | black `mask` glyph; feature active: red face, white `close` |
| SPIN | yellow, 248×126 | black `spin` glyph; busy: glyph spins (HB behaviour) |
| FS counter (replaces SPIN) | yellow, SPIN's size | black label `t('Free spins')` + value `3 / 10` (or `state.bonus` label/value) |
| autoplay tab | black parallelogram, 48×34 (mobile 42×30), a 4px seam from SPIN's slanted left edge | white `play`; running: yellow face, black `stop` |
| turbo tab | black, under the autoplay tab | `bolt`: L0 white; L1 yellow glyph; L2 yellow face, black glyph |

Sizes are desktop design units, before the fit scale (section 5).

Text: labels in Montserrat ExtraBold, uppercase, `S.yellow`. Values in Montserrat ExtraBold,
`S.fg`, with no stroke. The BET label is `S.yellow`, as in the reference.

### Behaviour kept from HB

The behaviour below is identical to HB. Where an HB widget already does it, SideBar reuses that
code.

- Tapping the bet value opens the bet picker. ± step the bet. Both are locked while busy, while
  autoplay runs, and while a feature is active. With a feature active, the BET label is the
  feature title and the value is `bet × priceMultiplier`.
- Tapping autoplay starts the picker, or stops a run that is going.
- A halted run with `remaining > 0` offers to resume it on SPIN, with the count shown.
- Turbo cycles levels.
- BUY opens the buy-bonus window, or deactivates the active feature. It is locked by
  `bonusBuyLocked(state)` and hidden when `features.buyBonus === false && !onBonusBuy`.
- The balance and win values are exposed for `animateMoney` count-ups.

## 5. Layout

### Wide (desktop, landscape)

The bar is laid out in rows (the user's call after the second demo, 2026-09-29: "баланс и bet под
кнопками", "win прям по низу между блоками", the tabs "одного размера и идти ровно от верхнего края
кнопки, и при ховер желтым цветом"):

```
[≡]
┌──────────────────┐                ▶ ┌──────────────────┐
│    BUY (mask)    │                ⚡ │       SPIN       │
└──────────────────┘                   └──────────────────┘
[БАЛАНС   $1,000.00  ]  [ВЫИГРЫШ $0.00]  [− СТАВКА $1.00 +]
```

- **Button row.** BUY (left; SPIN's size and lean, base mode only) and SPIN or the FS counter
  (right), level. The burger sits above BUY. In free spins BUY's slot holds TOTAL WIN, so no row
  grows and no inset moves.
- **Under the buttons.** BALANCE under BUY, BET under SPIN, top-aligned right below the button row.
  BALANCE is hidden in replay, as in HB.
- **WIN** sits on the bottom line (with BALANCE), centred in the gap between the two columns.
- **Tabs.** Autoplay and turbo are one size, stacked from SPIN's top edge down. They stand apart from
  SPIN: each is a parallelogram whose sides run parallel to SPIN's slanted left edge, a `tabGap` (4)
  seam away (the user, 2026-09-30: tucked under SPIN, the top tab merged with SPIN's top corner). The
  column reserves both tab slots, so free spins (turbo only) keep the width. Hover on a black tab: the
  yellow face with an ink glyph.
- **Plates never change size** (both layouts; the user's call, 2026-09-30: "размеры должны быть
  фиксированными и не менять у плашек"). WIN / BALANCE / TOTAL WIN and BET keep their design size;
  a label or value that does not fit scales down (label and value by one factor). So the insets do
  not change with content either — scenes read `safeArea` only on resize.
- Outer padding is 16 from the screen edges.
- **Fit scale.** `s = clamp(min(W / 1280, H / 720), 0.35, 1)`, applied to each column's inner
  container. The 0.35 floor keeps Stake popout S (400×225) readable, as in HB.
- **Safe area.** `left` = the left column's right edge + 12 (screen px). `right` = screen width −
  the right column's left edge (tabs included) + 12. `bottom` = screen height − WIN's top + 12 (the
  WIN row between the columns). `top = 0`; `barHeight` equals `bottom`. Scenes that read
  `api.shell.safeArea` fit the reels between the columns and above WIN.
- **Menu anchor.** `menuAnchor()` is the burger rect. `menuPlate()` is the left column's bounds,
  so the HB popover opens above the column, left-aligned.

### Mobile (portrait)

```
┌──────────── 390 ────────────┐
│          (reels)            │
│ [≡]                         │
│ ┌─────────┐   ▶ ┌─────────┐ │
│ │   BUY   │   ⚡ │  SPIN   │ │
│ └─────────┘     └─────────┘ │
│ [БАЛАНС $1,000] [− $1.00 +] │
│       [ВЫИГРЫШ $0.00]       │
└─────────────────────────────┘
```

- The same rows as wide in one bottom block; WIN gets its own bottom row, centred under both
  columns (there is no gap between the columns to hold it). Side padding is 10 and bottom
  padding is 8.
- **BUY is spin-sized.** On mobile BUY uses SPIN's slab size and lean (150×90),
  shows the mask glyph large (76), and sits left, level with SPIN. Outside base mode BUY is
  hidden; its slot stays (TOTAL WIN takes it in free spins).
- Mobile design sizes: menu 52×38, readouts 172×44 (label 11, value 17), BET 186×40, SPIN and BUY
  150×90, tabs 42×30. Left column (172) + gap (12) + right column (186) = 370 = 390 − 2·10.
  Plates keep these sizes whatever the text (see wide).
- **Fit scale.** The block is designed at 370 wide (390 minus the side padding) and scaled by
  `min(1, (W − 20) / blockW)`, where `blockW = max(370, left + 12 + right, WIN)`. It is never wider than
  the screen, so it has no lower bound.
- **Safe area.** `bottom` = screen height − the block's top edge. `left = right = top = 0`.
  `barHeight` equals `bottom`.
- **Menu anchor.** `menuPlate()` is the whole block, so the popover opens above it.

The controller already picks the layout (`h > w` gives mobile). SideBar branches on
`host.layout`, like BottomBar.

## 6. Font

- Montserrat ExtraBold (800), OFL 1.1: the Latin and Cyrillic woff2 subsets from
  `@fontsource/montserrat@5.3.0` (jsDelivr), ~30KB together. The licence text goes beside them.
  Glyphs outside both subsets (for example ₽) fall back to the shell's Inter.
- `scripts/build-s-fonts.mjs` is a copy of `build-hb-fonts.mjs`. It writes two `@font-face`
  rules (family `MontserratS`, weight 800, each with its Google Fonts `unicode-range`) as
  `S_FONT_CSS`, plus `S_FONT_FAMILY`, into `src/ui/pixi-s/fonts.ts`.
- `installSFont()` registers the face with `installFontFaces` (FontFace-from-bytes, CSP-safe, as
  HB does) and nudges `document.fonts.load`, swallowing rejections as HB does.
- `createPixiSShell` registers the S face before it creates the renderer. The renderer's first
  `renderBar` waits on `whenFontReady` (`document.fonts.ready`), which then covers the S face too.

## 7. Icons

`icons.ts` holds three solid 24×24 SVG fragments with one colour slot (`currentColor`):

- `mask`: the reference's stylised mask with two eye slits, drawn by hand to match the screenshot.
- `play`: a solid triangle.
- `bolt`: a single solid lightning bolt.

`sIcon(name, size, color): Graphics` renders them: it wraps the fragment in `<svg viewBox="0 0 24
24">`, parses it once per `name|color` into a cached `GraphicsContext`, and scales it to `size`.
HB's `IconView` is typed to HB's names and stays untouched.

`spin`, `stop`, `close`, `menu`, `minus` and `plus` come from HB's set through `makeIcon`. The mask
is fixed in this slice. The config has no per-game icon override, and none is added.

## 8. Testing

Vitest, in `tests/pixi-s/`, with the shared `tests/pixi/_host` context:

1. **Wide layout.**
   - The left column's left edge is at the padding. The right column's right edge is at `W −`
     padding.
   - Both columns are bottom-anchored.
   - BUY is SPIN-sized at the bottom of the left column, level with SPIN.
   - The tabs lie to the left of SPIN, a 4px seam from its slanted edge.
2. **Wide safe area.**
   - `safeArea.left` and `safeArea.right` equal the measured column edges plus the gap.
   - `bottom` is 0 and `barHeight` is 0.
3. **Mobile layout.**
   - BUY's size equals SPIN's size within 1px.
   - `BUY.x + BUY.w < SPIN.x`.
   - The BUY and SPIN bottoms are equal.
   - `safeArea.bottom` equals the block's height on screen.
4. **Modes.**
   - FS: the counter replaces SPIN, TOTAL WIN is present, and BUY is absent.
   - Replay: no BALANCE.
   - Active feature: BUY is red with `close`, the bet stepper is disabled, and the value is
     multiplied.
5. **Controls.**
   - Autoplay running gives a yellow tab with `stop`.
   - The turbo level sets the glyph and face colours.
   - A halted autoplay run shows its count on SPIN.
6. **Fit.** At 400×225 and 320×568, every element's screen bounds stay inside the screen.
7. **Renderer hook.** The HB suite still passes unchanged. `PixiHbRenderer` with a fake `bar`
   reports that bar's `safeArea`.

Visual check: `examples/pixi-s-shell-demo` is a copy of `pixi-hb-shell-demo` that imports
`@energy8platform/shell/pixi-s`. Take puppeteer screenshots (see the memory note on Pixi headless)
at 1920×1080, 400×225, 390×844 portrait, in FS mode, and with a feature active. Compare them to the
reference by eye.

## 9. Risks

- **Safe-area semantics.** Until now `safeArea` was bottom-only. Scaffolded games do not read it,
  so nothing breaks. A game that relies on `barHeight` sees 0 on S desktop. This is intended: the
  columns take the sides, not a bottom strip.
- **Overlays in HB style.** Beige and rounded, next to a black and yellow skewed bar. The user
  accepted this for this slice.
