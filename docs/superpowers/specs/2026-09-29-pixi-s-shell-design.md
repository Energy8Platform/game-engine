# `@energy8platform/shell/pixi-s` — the S Pixi shell

A third Pixi skin for the game shell. It reuses the Hellbuddha renderer (`PixiHbRenderer`) and all
of HB's overlays unchanged, and replaces only the control bar: instead of HB's bottom panel, S draws
two **side columns** that flank the reels, built from skewed black "slabs" with a halftone dot
texture and a yellow accent. The core (`src/core/`) and every public contract (`ShellConfig`,
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
    ├── slab.ts         ← the slab primitive (skewed quad, shadow, halftone, sawtooth edge)
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
| `yellowDot` | `#d8a63d` | halftone dots on yellow |
| `plate` | `#0b0b0b` | slab face |
| `plateDot` | `#1c1c1c` | halftone dots on black |
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
  dots?: string;                // halftone colour; omitted = no texture
  fade?: boolean;               // dots thin toward the top-right (default true; SPIN passes false)
  corners?: Corners;            // per-corner offsets in px (the "torn" skew)
  sawtooth?: boolean;           // zig-zag bottom edge (SPIN / FS counter)
  shadow?: boolean;             // offset darker copy behind the face (default true)
})                              // + setFace(color) for hover
```

- **Shape.** A quadrilateral whose four corners are shifted from the `w × h` box by fixed
  offsets. Each element has its own preset (for example win: top edge rising 6px to the right,
  bottom edge rising 4px). The offsets are constants, not random, so the bar looks the same on
  every render and in every test.
- **Shadow.** The same quad offset by `(3, 3)` in `S.shadow`, drawn first.
- **Halftone.** A dot grid (spacing 6px, dot radius 1.1px). A dot is kept only when it lies
  wholly inside the quad (point-in-polygon on its four extreme points), so no mask is needed. On
  black plates the dot radius fades from full at the bottom-left to nothing toward the top-right.
  On SPIN the dots are uniform. The dots of one slab are one `GraphicsContext`, cached by size,
  corners, colour and fade, and shared, so a bar rebuild re-tessellates nothing.
- **Sawtooth.** SPIN's bottom edge is a zig-zag: teeth 8px wide and 5px deep.

### Elements

| element | slab | content |
|---|---|---|
| menu | black, 64×44 | white `menu` glyph |
| WIN / BALANCE | black, 280×54 (label 15, value 26) | yellow caps label (`t('Win')` / `t('Balance')`), white value |
| TOTAL WIN (FS) | as WIN | label `t('Total win')` |
| BET | black, 290×46 (label 14, value 24) | yellow `minus` · white caps `t('Bet')` · white value · yellow `plus` |
| BUY | yellow tab, 96×52 | black `mask` glyph; feature active: red face, white `close` |
| SPIN | yellow, sawtooth, 260×136 | black `spin` glyph; busy: glyph spins (HB behaviour) |
| FS counter (replaces SPIN) | yellow, sawtooth | black label `t('Free spins')` + value `3 / 10` (or `state.bonus` label/value) |
| autoplay tab | black, 52×40, tucked 12px under SPIN's left edge | white `play`; running: yellow face, black `stop` |
| turbo tab | black, under the autoplay tab | `bolt`: L0 white; L1 yellow glyph; L2 yellow face, black glyph |

Sizes are desktop design units, before the fit scale (section 5).

Text: labels in Montserrat ExtraBold, uppercase, `S.yellow`. Values in Montserrat ExtraBold,
`S.fg`, with no stroke. The BET label is `S.fg`, as in the reference.

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

```
[≡]                                              [BUY]
[ВЫИГРЫШ  $0.00      ]                  [− СТАВКА $1.00 +]
[БАЛАНС   $1,000.00  ]              ▶ ┌──────────────────┐
                                    ⚡ │       SPIN       │
                                       └/\/\/\/\/\/\/\/\/┘
```

- The left column is anchored bottom-left and stacks, from the top: menu, (TOTAL WIN in FS),
  WIN, BALANCE. BALANCE is hidden in replay, as in HB. The slabs are left-aligned and the gap
  between them is 10.
- The right column is anchored bottom-right and stacks, from the top: BUY (right-aligned, base
  mode only), BET, SPIN (or the FS counter). The autoplay and turbo tabs hang off SPIN's left
  edge, vertically centred on it.
- Outer padding is 16 from the screen edges.
- **Fit scale.** `s = clamp(min(W / 1280, H / 720), 0.35, 1)`, applied to each column's inner
  container. The 0.35 floor keeps Stake popout S (400×225) readable, as in HB.
- **Safe area.** `left` = the left column's right edge + 12 (screen px). `right` = screen width −
  the right column's left edge (tabs included) + 12. `top = bottom = 0`. `barHeight` is therefore 0.
  Scenes that read `api.shell.safeArea` fit the reels between the columns. Scenes that ignore it
  are unaffected.
- **Menu anchor.** `menuAnchor()` is the burger rect. `menuPlate()` is the left column's bounds,
  so the HB popover opens above the column, left-aligned.

### Mobile (portrait)

```
┌──────────── 390 ────────────┐
│          (reels)            │
│ [≡]                         │
│ [ВЫИГРЫШ $0.00] [− $1.00 +] │
│ [БАЛАНС $1,000]             │
│ ┌─────────┐   ▶ ┌─────────┐ │
│ │   BUY   │   ⚡ │  SPIN   │ │
│ └─────────┘     └─────────┘ │
└─────────────────────────────┘
```

- The same two columns, pulled together and sharing one bottom line. Side padding is 10 and
  bottom padding is 8.
- The left column stacks: menu, (TOTAL WIN in FS), WIN, BALANCE, then BUY. The right column
  stacks: BET, then SPIN with the tabs.
- **BUY is spin-sized.** On mobile BUY uses SPIN's slab size (150×90, without the sawtooth),
  shows the mask glyph large (76), and sits bottom-left, level with SPIN. Outside base mode BUY is
  hidden and both columns stay bottom-anchored.
- Mobile design sizes: menu 52×38, readouts 172×44 (label 11, value 17), BET 186×40, SPIN and BUY
  150×90, tabs 42×34. Left column (172) + gap (12) + right column (186) = 370 = 390 − 2·10.
  Readouts and BET grow when a value does not fit, and the block then scales down.
- **Fit scale.** The block is designed at 370 wide (390 minus the side padding) and scaled by
  `min(1, (W − 20) / blockW)`, where `blockW = max(370, left + 12 + right)`. It is never wider than
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
   - BUY sits above BET.
   - The tabs lie to the left of SPIN and overlap its box.
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

- **Halftone cost.** About 2000 circles per bar. The shared dot contexts make each rebuild after
  the first a cache hit. Readout widths are rounded to whole pixels, so the cache stays bounded by
  the number of distinct slab sizes.
- **Safe-area semantics.** Until now `safeArea` was bottom-only. Scaffolded games do not read it,
  so nothing breaks. A game that relies on `barHeight` sees 0 on S desktop. This is intended: the
  columns take the sides, not a bottom strip.
- **Overlays in HB style.** Beige and rounded, next to a black and yellow skewed bar. The user
  accepted this for this slice.
