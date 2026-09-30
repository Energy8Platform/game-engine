# S shell overlays — the menu, game info, buy bonus and the small modals in the S style

Slice 2 of `@energy8platform/shell/pixi-s`. Slice 1 (spec `2026-09-29-pixi-s-shell-design.md`) built
the S bar and reused every HB overlay unchanged. This slice replaces all of them with S versions and
turns the burger into a ✕ while the menu is open.

User asks (2026-09-30), verbatim:

> 0) нигде нет обводки как было в pixihb, и не каких round все края острые
> 1) при клике на меню когда открывается вместо знака меню рисовать крестик
> 2) … при открытие меню всплывают плашки на каждый блок только чуть покороче, без иконок, текст и
> контрол: ползунок довольна широкая полоска по толщие как сейчас, но без закруглений квадратная,
> ползунок в виде прямоугольника; остальные контролы тоже надо стилизовать
> 3) открытое информация об игре: полностью на весь экран; сверху большая плашка желтого цвета
> слева и крестик в желтой плашке справа; блюр; в целом по ширине и позиционированию оставить
> также, единственное название блоков в плашках; paytables растягиваем на всю ширину и делаем
> всегда 3 в ряд

Answers to the follow-up questions:
- All overlays, not only the menu and game info.
- The menu rows stack upward above the burger.
- Section titles in game info sit in **yellow** plates with ink text.
- No master sound toggle: sound is controlled by the sliders only.

## 1. Scope

In this slice:
- S versions of every overlay: the menu, game info, the buy-bonus page and its confirm, the bet
  picker, the autoplay picker, the generic modal and the replay modal;
- the burger shows ✕ while the menu is open;
- two hooks in HB code (section 3), each defaulting to today's behaviour.

Not in this slice: behaviour changes. Every overlay keeps HB's logic, keys, events and the
controller contract. Only the look and the layout described below change.

## 2. Package layout

```
packages/shell/src/ui/pixi-s/
├── theme.ts                 ← + panel/track/muted/veil tokens
├── text.ts                  ← + sBody() (Inter body copy)
├── SideBar.ts               ← + setMenuOpen()
├── index.ts                 ← passes `overlays` to the renderer
├── primitives/
│   ├── controls.ts          ← SSlider, SToggle, SChip, STextButton, sTitlePlate(), sCloseButton()
│   ├── card.ts              ← SCardModal (same API as HB CardModal)
│   └── page.ts              ← SPage: the full-screen frame (title plate + ✕ + scrolling column)
└── components/
    ├── Menu.ts              ← openSMenu
    ├── GameInfo.ts          ← openSGameInfo (fork of HB GameInfo)
    ├── BuyBonus.ts          ← openSBuyBonus (fork of HB BuyBonus)
    ├── pickers.ts           ← openSBetPicker / openSAutoplayPicker (fork)
    ├── Modal.ts             ← buildSModal (fork)
    └── ReplayModal.ts       ← buildSReplayModal (fork)
```

As in the HB fork from `pixi/`, anything that draws a colour, picks a font or lays out chrome is a
copy under `pixi-s/`. Anything style-free is imported, not copied:
- `FlexBox`, the context and the motion helpers from `../pixi/`;
- `hbRows`, `ScrollBox`, the `groupBonusSlots` helper and `betDir` from HB or core.

## 3. Hooks in HB code

### 3.1 Renderer overlays

```ts
/** The overlay builders PixiHbRenderer uses; a skin overrides any of them. */
export interface HbOverlays {
  menu(ctx: PixiComponentContext, anchor: () => Rect | null, plate: () => Rect | null, scale: () => number): ShellLayer;
  gameInfo(ctx: PixiComponentContext): ShellLayer;
  buyBonus(ctx: PixiComponentContext): ShellLayer | null;
  betPicker(ctx: PixiComponentContext): ShellLayer;
  autoplayPicker(ctx: PixiComponentContext): ShellLayer;
  replay(ctx: PixiComponentContext, opts: ReplayModalOptions, reopen: () => void): ShellLayer;
  modal(ctx: PixiComponentContext, opts: ModalOptions): ShellLayer;
}
PixiHbRendererOptions.overlays?: Partial<HbOverlays>;
```

- `openOverlay` routes each request kind through `{ ...HB_OVERLAYS, ...opts.overlays }`.
  `HB_OVERLAYS` holds today's `openMenu`, `openGameInfo` and the rest, so HB is unchanged.
- The renderer remembers the kind of the open layer (`currentKind`).

### 3.2 Burger state

- `HbBar` gains an optional `setMenuOpen?(open: boolean): void`.
- The renderer calls it:
  - with `true` after pushing a `menu` layer;
  - with `false` when any layer is cleared;
  - after every `renderBar()` with `currentKind === 'menu'`, so a bar rebuilt under the open
    menu keeps the ✕.
- HB's `BottomBar` does not implement it (no change).

### 3.3 Scroll look

- HB `ScrollBox` and `ScrollAffordance` take an optional look, `{ track, thumb, radius }`.
  The default is today's `{ HB.track, HB.orange, THUMB_THICK / 2 }`.
- S passes `{ S.track, S.yellow, 0 }` for a flat yellow thumb on a flat track.
- The scroll logic is not forked.

## 4. Visual language

### Tokens (added to `theme.ts`)

| token | value | use |
|---|---|---|
| `panel` | `#0b0b0b` | flat panels: menu rows, modal cards, content cards |
| `track` | `#2a2a2a` | slider/toggle/scroll tracks, empty volatility bars, off grid cells |
| `muted` | `rgba(244,242,235,.6)` | secondary text (descriptions, stat labels, version) |
| `veil` | `rgba(0,0,0,.55)` | the dark layer over the frosted game under a modal |

### Rules

- **No stroke and no rounding, anywhere.** No outline on any shape, glyph or text: `stroke` is
  never set on S text. Every corner is sharp: `rect` / `poly`, never `roundRect` or `circle`.
- **Plates** — interactive or titled things — are `Slab`s with the lean and the 3px drop shadow
  from slice 1:
  - titles and ✕;
  - buttons, chips and menu rows;
  - the buy-bonus hero.
- **Panels** — surfaces that hold content — are flat axis-aligned rects with no lean and no shadow:
  - the modal card;
  - content cards in game info;
  - buy-bonus cards;
  - the bet band.
- **Type:**
  - labels, titles and values: Montserrat ExtraBold (`sLabel` / `sValue`);
  - body copy (descriptions, rules, paragraphs): Inter 400/600 through the new `sBody(str, size,
    color, wrapWidth?)`, because long text in 800 caps is unreadable.
- **Backdrop.** Modal layers keep the renderer's frosted snapshot (the blur) with `S.veil` over it.
  The menu is light-dismiss: no veil and no blur, as in HB.

### Primitives (`primitives/controls.ts`)

| primitive | look |
|---|---|
| `sTitlePlate(text, h)` | yellow slab (lean as `SKEW.readout`), ink caps text, width = text + 2·0.6h, min 3h |
| `sCloseButton(size, onTap)` | yellow square slab `size × size`, ink HB `close` glyph (ink/ink), hover `S.yellowHover` |
| `STextButton(label, { w, h, kind })` | slab: `accent` = yellow/ink, `red` = red/fg, `ghost` = plate/fg; caps label; disabled alpha 0.4; hover darkens (yellow/red) or turns yellow with ink text (ghost) |
| `SChip(id, label, selected)` | slab: plate + fg value; selected = yellow + ink; hover on an unselected chip = `S.plateHover` |
| `SSlider(value, onInput)` | 24 tall. Track: flat rect, full width, 8 thick, `S.track`. Fill: yellow rect to the thumb. Thumb: flat rect 12×24, `S.fg`. Same drag/`setValue` API as HB `Slider` |
| `SToggle(value, onChange)` | 44×24 flat rect track (`S.track` off / yellow on), knob a flat 18×18 square inset 3 (fg off on the left / ink on the right) |

## 5. Components

### 5.1 Menu (`openSMenu`)

- **Rows.** `hbRows(resolveMenu(host))`: no separators and no `sound` master toggle, as in HB.
  Each row is its own black slab, laid out as label then control:
  - the label: `sLabel(row.label, 13, S.fg)`, left-aligned, 16 from the slab's left;
  - `range`: an `SSlider` from label end + 16 to the slab's right − 16, min 120 wide. With no
    mute icon, 0 on the slider is mute;
  - `toggle`: an `SToggle` flush right;
  - `button`: no control. The whole slab is tappable: tap closes the menu and runs `row.select()`.
    Hover gives the yellow face and ink label.
  - Disabled rows are alpha 0.5 and inert, as in HB. There are no icons and no chevrons.
- **Sizes.** Wide: 320 × 44 design px (the bar readouts are 56 — "чуть покороче"), `SKEW.readout`
  lean, gap 6. Mobile: rows as wide as the bar block (370) × 40, gap 6.
- **Placement.**
  - Anchor: the burger rect (`menuAnchor()`).
  - The stack's bottom edge sits 8 × scale above the burger's top, left edge = burger's left.
  - Rows are in menu order, top to bottom.
  - Scale = the bar's `fitScale()`. If the stack does not fit between the screen top (+8) and
    the burger, it scales down further until it does.
- **Light-dismiss.** A transparent full-screen catcher under the rows closes on tap. It also
  covers the burger, so tapping the ✕ closes the menu.
- **Live refresh.** `host.setMenuRefresh` updates sliders and toggles in place, as HB does.
- **Keys.** Nothing S-specific: Escape goes to the controller.

### 5.2 Burger ✕ (`SideBar.setMenuOpen`)

`setMenuOpen(true)` shows HB's `close` glyph (fg/fg, same box) in the burger slab and hides the menu
glyph; `false` restores it. Tap still calls `openMenu()`, which the controller turns into close when
the menu is open.

### 5.3 SPage — the full-screen frame (`primitives/page.ts`)

Game info and buy bonus share it.
- **Coverage.** Full screen: the veil (`S.veil`) over the frosted backdrop swallows taps.
- **Column.** Same width and centring as HB's game-info body today: `frameRect(w, h)` → inner
  width → `min(760, inner − 2·sidePad − ScrollBox.GUTTER)`, centred. "по ширине и
  позиционированию оставить также".
- **Top strip.**
  - At `y = clamp(12, 0.03h, 24)`. Height `T = clamp(44, 0.09h, 72)`.
  - The title plate (`sTitlePlate(title, T)`, big caps) sits at the column's left edge.
  - `sCloseButton(T)` sits at the column's right edge.
- **Scroll area.** Below the strip (+ 0.3T) down to the screen bottom − 12, as wide as the column
  plus the gutter, with the S scroll look.
- **API.** `new SPage(host, { tag, title, onClose, build(width) })`. The body is rebuilt on resize.
  Scroll keys are the same as HB `Overlay.onKey`: arrows, Page Up/Down, Space, Home, End.
- There is no back button (HB's `onBack` is dropped). ✕ and Escape close.

### 5.4 Game info (`openSGameInfo`)

- **Base.** A fork of HB `GameInfo.ts` inside an `SPage` titled `t('Game info')`. The sections,
  their order, the auto-injected hotkeys and the version footer are all unchanged.
- **Section title.** `sTitlePlate(title, 1.8em)` — yellow, ink caps — left-aligned at the top of
  each section. It replaces HB's centred heading text.
- **Cards.** Every HB `card()` becomes a flat `S.panel` rect (padding as HB) with no border.
- **Modes.** Title `sLabel` fg. Stats: label `sLabel` muted caps + value `sValue` yellow.
  Description in `sBody` muted.
- **Controls.**
  - HB's round/plaque icon badges become small S slabs, each 36 square:
    - SPIN: yellow slab with ink `spin`;
    - ± / menu / autoplay (▶) / turbo (⚡): black slabs with fg glyphs;
    - buy: yellow slab with ink `mask`.
  - Name in `sLabel` fg, description in `sBody` muted.
- **Hotkeys.** Keycaps become flat `S.panel` rects with `sValue` fg text, sharp.
- **Paytable** — full column width, **always 3 per row**:
  - card width `(width − 2·gap) / 3`, gap 12, rows of 3 (the last row may hold fewer; its cards
    keep the same width, left-aligned);
  - card: flat panel; symbol (image or `sLabel` text) on top, then win rows: count in `sBody`
    muted + `×mult` in `sValue` yellow.
- **Wins** (lines / cluster / ways / shapes). Grid cells are flat squares: on = yellow,
  off = `S.track`, 2px gaps, no rounding. Line numbers use `sValue`.
- **Custom.** Title plate, then the node or the html-stripped text in `sBody`.
- **Version footer.** `sBody` muted, centred.

### 5.5 Buy bonus (`openSBuyBonus`)

- **Base.** A fork of HB `BuyBonus.ts` inside the SPage chrome, titled `t('Buy bonus')`. Its
  behaviour is kept:
  - slots, `groupedBy` flipping with wrap, CTA → confirm, Enter commits;
  - an unaffordable option disables its CTA;
  - `ctas` stays exposed for tests;
  - keys via `betDir`.
- **Grid.** Two cards per row from a content width of 640, else one (HB's rule), gap 12.
- **Card.** A flat panel.
  - **Hero:** the left third is a flat rect, yellow (bonus) or red (feature), with the `mask`
    glyph in ink, contained at 70% of the zone. A `thumbnail` covers the zone instead, a `custom`
    node is contained as HB does, and either is clipped to the zone rect.
  - **Title and group flip:** title `sLabel` fg. Group arrows are two small yellow slabs with ink
    `back` / `chevronRight`.
  - **Volatility:** 5 flat bars `0.5em × 1.1em`, filled `S.yellow`, empty `S.track`.
  - **Description:** `sBody` muted.
  - **Price and CTA:** the price (`sValue` fg) sits bottom-right over the CTA. The CTA is an
    `STextButton`: `accent` "BUY", or `red` "ACTIVATE" for a feature.
- **Bet band.** A flat `S.panel` band pinned to the bottom. It holds an S `SReadout` BALANCE on
  the left and an S `SBet` (stepper) on the right — the bar's widgets at the band's height.
- **Confirm.** `SCardModal` (5.6).

### 5.6 SCardModal and the small modals

`SCardModal` has the same API as HB `CardModal`: `tag`, `title`, `closable`, `blur`, `onClose`,
`maxEm`, `accent`; `body: FlexBox`, `setActions(CardAction[])`, `build()`, `emSize`, `cardWidth`,
`resize`, `fit`. The look:
- **Card.** A flat `S.panel` rect centred on the veil, width as HB (`maxEm · em`, ≤ 86% of the
  screen). It scales to fit as HB does.
- **Header.**
  - `sTitlePlate(title, 2.4em)` at the card's top-left, overhanging the card top by 0.6em
    (a plate on the panel's edge, like the bar).
  - `sCloseButton(2.4em)` at the top-right when closable.
  - The title is no longer the first body row.
- **Actions.** `STextButton`s, `accent` / `red` / `ghost` mapped from `CardAction.kind`.

Its users, forked with only imports and styles changed:
- **Bet and autoplay pickers.** `SChip` grid, CONFIRM as `accent`. HB's `autoFit`, columns and
  scroll logic are unchanged.
- **Generic modal.** `sBody` text centred, actions as above.
- **Replay modal.**
  - Rows show the label in `sLabel` muted caps and the value in `sValue` fg. There are no hairlines;
    the rows keep 0.73em padding.
  - The total-win value is yellow.
  - START REPLAY is `accent`.
  - Not closable, as in HB.

## 6. Tests (`tests/pixi-s/`)

- **Renderer.**
  - Each overlay kind goes to its injected builder, and the HB defaults apply when none is given.
  - `setMenuOpen` gets `true` on a menu open and `false` on close, and is re-applied after a
    `renderBar()` while the menu is open.
- **SideBar.** `setMenuOpen(true)` shows the close glyph and hides the menu glyph. `false`
  restores them.
- **Menu.**
  - Row filtering: no `sound` row, no separators.
  - One slab per row.
  - The stack's bottom is above the burger's top, and its left edge equals the burger's left
    (wide and mobile).
  - A tall menu on a short screen still fits.
  - The slider thumb is a 12×24 rect, and the track is 8 thick at full width.
  - A button row's hover gives the yellow face; its tap closes and selects.
  - Live refresh moves the slider.
- **SPage / game info.**
  - The layer covers the whole screen.
  - The title plate's left edge is at the column's left, and the close plate's right edge at the
    column's right.
  - Section titles are yellow title plates.
  - Paytable with 7 rows: rows of 3, 3, 1, every card `(width − 24) / 3` wide, the row spanning
    the column.
  - Escape and ✕ close.
  - The HB scroll-key parity.
- **Buy bonus.**
  - The HB buy-bonus tests, ported: cards per slot, group flip with wrap, CTA kinds and labels,
    confirm + Enter, unaffordable disabled.
  - The page title plate.
  - The hero face is yellow for a bonus and red for a feature.
- **Small modals.**
  - Pickers: the selected chip is yellow; confirm emits the choice.
  - Generic modal: actions run and close.
  - Replay: not closable; START REPLAY closes and reopens after `onReplay`.
- **No-round / no-stroke guard.** Walk every `Graphics` of an opened menu, game info, buy-bonus
  page and card modal. Assert there is no `roundRect` / `circle` shape. HB glyphs are excepted:
  they are SVG paths inside `IconView`/`sIcon`. Use `GraphicsContext.instructions` with shape type
  and a stroke check.
- **Visual.** Demo screenshots of every overlay on desktop and on a phone, compared by eye with the
  asks. Add demo params: `open=menu` (alias of `settings`), and `open=bet` / `open=auto` /
  `open=replay`.

## 7. Risks

- **Fork size.** GameInfo (~600 lines) and BuyBonus (~460) are copied. The copies must keep HB's
  behaviour fixes. The ported HB tests are the guard. Every HB behaviour test that exists for a
  forked component is ported.
- **Menu over the bar.** The stack grows upward from the burger. On short landscape screens the
  scale-down keeps it on screen, at the cost of small rows. This is accepted.
- **Inter in S overlays.** It is a deliberate readability choice for long copy. Montserrat stays
  for everything that is a label, title or number.
