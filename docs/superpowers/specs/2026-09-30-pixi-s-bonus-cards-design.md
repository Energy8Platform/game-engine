# S skin: shorter SPIN, portrait bonus cards, fly-in confirm

Branch `feat/pixi-s-shell`. Package `@energy8platform/shell`, S code in `src/ui/pixi-s/`.
This builds on `2026-09-29-pixi-s-shell-design.md` (the bar) and
`2026-09-30-pixi-s-overlays-design.md` (the overlays, Revision 2).

## What the user asked (2026-09-30)

1. "давай spin и turbo немного по длине укоротим процентов на 30". Asked to clarify, the user chose
   "the SPIN button and the ⚡ tab".
2. Redo the bonus cards after the reference screenshot:
   - tall ticket cards;
   - the hero art fills the top and, from the title down, fades to black;
   - a fixed card proportion;
   - volatility above the price;
   - the chevrons next to the title;
   - pressing the card's button makes a soft transition that enlarges the card.

   Answers to the clarifying questions: one row that scrolls sideways; the ‹ › sit "у title"; the
   card flies to the centre and grows.
3. "в buy bonus осталась подложка, надо убрать". This is the panel behind the BALANCE | BET band.

## Rulings (the controller's; the user can overturn them)

- Both tabs (▶ and ⚡) get 30% shorter. The user's standing rule is that the tabs are one size
  (2026-09-29: "кнопки turbo/autoplay должны быть одного размера").
- BUY stays SPIN-sized, so it shrinks with SPIN. This is the standing rule from 2026-09-29.
- The ticket notches are sharp triangles, not the reference's half-circles, because S has no
  rounding anywhere. The top edge is straight.
- The card proportion is 1:2 (width = height / 2). A card is at most 70% of the screen width, so a
  phone shows one card and the next one peeks in. (It was 62%; the phone shot left about 200px empty
  above and below the row.)
- The ✕ stays on screen during the confirm. There it cancels the confirm instead of closing the page.

## 1. Bar

`SideBar.ts`, size tables (design px):

| | SPIN / BUY (w × h) | tabs (w × h) |
|---|---|---|
| WIDE | 248×126 → **174×126** | 48×34 → **34×34** |
| MOBILE | 150×90 → **105×90** | 42×30 → **29×30** |

- The glyph sizes (`spinGlyph`, `buyGlyph`, `tabGlyph`) are unchanged. The FS counter is SPIN-sized
  and its texts already scale to fit.
- The tab seam rule (a parallelogram parallel to SPIN's slanted edge, `tabGap` away) is unchanged.
- The column widths still come from the widest item, so both layouts keep working. On WIDE the
  widest item is the readout (268) or the bet (232). On MOBILE it is the 172 readout or the 186 bet.

## 2. Buy-bonus page

`components/BuyBonus.ts` (`SBuyBonusPage`).

### Page frame

- The title plate and ✕ are unchanged: in the corners, at `closeCorner()`.
- **The band has no backing.** The `S.panel` rect behind BALANCE | BET is removed; only the two
  plates remain. With the panel gone so is its side inset: BALANCE starts and BET ends at the band's
  edges, in line with the card row (2026-10-01).
- **Short screens scale the page.** The row and the band lay out at the logical size `(w / k, h / k)`
  with `k = min(1, h / 440)` and are drawn scaled by `k`. On Stake popout S (400×225) the logical size
  is about 784×440 at `k ≈ 0.51`. The title plate and ✕ are not scaled: they stay at screen size, at
  `stripMetrics(w, h)` / `closeCorner(w, h)` like every other S overlay, above the scaled row and band.
  Everything below is in logical units.

### Row

- One horizontal row of cards between the strip and the band:
  - `rowTop = (strip.top + strip.height · 1.3) / k`, with `strip = stripMetrics(w, h)` at screen size;
  - `rowBottom = band top − pad · 0.5`.
- It sits in a `ScrollBox` with `axis: 'x'` (see §4). The viewport is the full page width minus
  `pad` on each side. It is `cardH + ScrollBox.GUTTER` tall; the horizontal S scrollbar runs in the
  gutter under the cards.
- Card size: `cardH = min(rowBottom − rowTop − GUTTER, 0.70 · W / ASPECT, 640)`, with
  `cardW = round(cardH · ASPECT)`, `ASPECT = 0.5`, and a gap of `CARD_GAP = 14` between cards.
- The row is vertically centred between `rowTop` and `rowBottom`.
- When every card fits, the row is centred horizontally and does not scroll. Otherwise it starts at
  the left and the next card peeks in at the right edge.
- **Input:**
  - Drag scrolls the row, as the vertical page does now.
  - The wheel scrolls it: whichever of `deltaX` / `deltaY` is larger.
  - ←/→ and ↑/↓ (without Shift) scroll by one `cardW + CARD_GAP`.
  - Shift+↑/↓, =/− and NumpadAdd/Subtract still step the bet.
  - Escape closes the page.

### Card

`buildCard(slot, cardW, cardH)`. The card's em is `cardH / 36` (15 at 540 tall). `pad = em · 1.2`.

**Body.**
- One black polygon (`S.plate`) with a 3px S drop shadow (the same polygon offset by
  `SHADOW_OFFSET`, `S.shadow` at `SHADOW_ALPHA`).
- Corners are sharp. Two triangular notches point inward at the separator line `sepY`: depth
  `em · 0.6`, height `em · 1.2`.

**Top to bottom:**

1. **Title zone.**
   - `titleTop = round(0.40 · cardH)`; the zone is two title lines tall. The title is
     `sLabel(title, em · 2)` in `S.fg`, centred, and word-wrapped to the zone's inner width.
   - If a word is wider than that, or the text needs more than two lines, it scales down to fit.
     A one-line title is centred vertically in the zone.
   - The zone's inner width is `cardW − 2·pad`. For a group slot it also leaves room for ‹ › on
     both sides: yellow `SKEW.menu` squares `em · 2` wide with the sheet's `chevronLeft` /
     `chevronRight` in ink, vertically centred on the zone. They keep the labels
     `bb-prev-<slot>` / `bb-next-<slot>` and wrap through the group as now.
2. **Hero.** It fills the card from the top to the title zone's bottom and is clipped to that rect.
   - A **thumbnail** is a Sprite covering the rect (`object-fit: cover`).
   - A **custom** node is fitted (contain) inside `0..titleTop` with `em · 0.8` padding. It is
     borrowed (`persistent`), as now.
   - **Neither**: a face rect in `S.yellow` (bonus) or `S.red` (feature), labelled `bb-hero-yellow` /
     `bb-hero-red`. On it, the sheet's `bonus` mask, sized `0.6 · min(cardW, titleTop)` and centred
     in `0..titleTop`. The mask is `S.ink` on yellow and `S.fg` on red.
3. **Fade.** A rect over the title zone (from `titleTop` to the zone's bottom), labelled `bb-fade`.
   It is filled with a vertical `FillGradient` from `S.plate` at alpha 0 (top) to `S.plate` at
   alpha 1 (bottom). Below the zone the card is plain black. The hero is under the fade; the title
   and ‹ › are over it.
4. **Description.** `sBody(description, em, S.muted, cardW − 2·pad, 'center')`, `em · 0.6` under the
   title zone. It is clipped to the room above the separator: at least `em · 1.3`, else it is omitted.
5. **Separator.** At `sepY`: a dashed line from notch tip to notch tip, `2` thick, in `S.track`,
   dash `em · 0.5` and gap `em · 0.4`.
6. **Bottom block**, centred, bottom-up:
   - `pad`;
   - the CTA, `STextButton` `cardW − 2·pad` × `em · 2.8`, label size `em`, kind `red` for a feature
     and `accent` otherwise, labelled `bb-cta-<slot>`. It reads Buy, Activate or Deactivate as now,
     and is disabled when neither affordable nor active;
   - a gap of `em · 0.8`;
   - the price, `sValue(fmt(price), em · 2.2, S.yellow)`, scaled down to `cardW − 2·pad`;
   - a gap of `em · 0.5`;
   - the volatility bars (`sVolatilityRow`), when set;
   - `em · 1.0` more, which is where `sepY` falls.

The card keeps its label `bb-card-<slot>`, and `ctas[]` stays in slot order.

## 3. Confirm transition

This replaces the `SCardModal` confirm.

**Open.** Tap an affordable, inactive CTA:

- A fresh copy of that card (`buildCard` for the slot, the same size), labelled `bb-flyer`, is
  placed on the page at the original card's page-local position. The original is hidden.
- The copy's CTA is hidden, and the rest of the copy takes no taps. Its ‹ › (a group slot) are
  hidden too: on the copy they would be dead buttons.
- The row's `ScrollBox` goes `eventMode = 'none'`: no drag and no wheel scroll under the confirm.
  The rebuild's new box starts live again.
- One `tween` (`ui/pixi/motion-pixi`, `easeOutCubic`) of 300ms, on the host ticker:
  - the flyer moves to the centre and scales up to
    `s = min(1.3, (H − top − m) / cardH, (W − 2·m) / cardW)`, where `m = strip.top` and
    `top = 2·strip.top + strip.height` (the ✕'s bottom plus one margin), so it clears the ✕ strip;
  - it is centred horizontally, and vertically within `[top, H − m]`;
  - the scroll row, band and title plate fade from alpha 1 to 0. The ✕ stays.
- Then the action row fades in, labelled `bb-confirm-actions`: CANCEL (`dim`) and BUY (`accent`)
  or ACTIVATE (`red`), side by side **in the copy's CTA slot**, a child of the flyer in card units
  (so it scales with it). Each is `(cardW − 2·pad − em/2) / 2` wide and `2.8·em` tall, `em/2` apart,
  label size `em` (the card's em and pad). The row takes taps only once it is fully shown.

**Keys and taps while open:**
- Enter / Space commit.
- Escape, CANCEL and the ✕ cancel.
- Taps on the veil do nothing.

**Cancel.** A 250ms reverse: the flyer goes back to the original card's spot and scale, the page parts
fade back in, and the action row hides at once. At the end the flyer is destroyed and the page
rebuilds. That brings back a `custom` hero node the flyer borrowed, and catches up any state change a
same-size resize skipped.

**Commit.** As now: `activateFeature` or `selectBuyBonus`, then `closeLayer()`. No animation.

**Reduced motion** (or no `matchMedia`, as in tests): `tween` jumps to the end synchronously, so open
and cancel land in their final state at once.

**Resize while open.** A changed size removes the confirm without animation and the page rebuilds.
A same-size resize keeps an open (or opening, or closing) confirm and does nothing else: the
renderer re-sends the same size on every bar state change (balance, win, bet …). That holds only
while the state the confirm opened with still holds: `bet`, `balance`, `busy`, `buyBonusEnabled` and
`activeFeature?.id`, recorded at open. When any of them differs, the same-size resize drops the
confirm without animation and rebuilds, as a changed size does. Otherwise the flyer would show the
old price while BUY charged the new bet, or BUY and Enter would silently do nothing.

`dim` is an `STextButton` kind: an `S.track` face with `S.fg` ink, going `S.plateHover` on hover.
A `ghost` (an `S.plate` face) would be bare text on the black card.

**The row's scroll offset survives every rebuild** (a bet step, a group flip, the end of a cancel):
`ScrollBox.scrollPos` is read before the old box goes, and the new one is `scrollBy` that much.

`SCardModal` stays: the replay and generic modals use it.

**As built (Task 4).**
- At full fade-out the row, band and title plate also go `visible = false`, and they come back as
  the reverse starts. Pixi still hit-tests a node at alpha 0, so the other CTAs and the bet stepper
  would otherwise take taps through the empty page. A CTA tap while a flyer is out does nothing.
- On the way back, Enter, Escape and the ✕ do nothing: the confirm is already closing. The bonus
  being confirmed is cleared when the reverse starts, not when it ends.
- Any rebuild drops an open confirm without animation. Only a changed size or the end of a cancel
  gets there while a confirm is out.

**As built (Task 4, fix round 1).** These were ruled after the first screenshots and are folded
into the text above: the actions sit in the CTA slot (there was an empty band where the CTA had
been), the flyer clears the ✕ strip (on a phone the ✕ overlapped its top-right corner), a same-size
resize keeps the confirm (any balance update used to close it), a cancel ends with a rebuild, and
the scroll offset survives a rebuild.

## 4. `ScrollBox` gets an axis

`pixi-hb/primitives/scroll.ts`: `new ScrollBox(canvas, ticker, look?, axis: 'x' | 'y' = 'y')`.

- With `'y'` the behaviour is unchanged (HB and every existing S page), except the drag slop and
  the wheel guard below, which now apply to every list.
- With `'x'`:
  - content is laid out from x≈0 rightward and measured by width;
  - scrolling moves `content.x`;
  - drag uses the pointer's x;
  - the wheel uses the larger of `deltaX` / `deltaY`;
  - the affordance is drawn with `axis: 'x'` (already supported by `ScrollAffordanceView` and
    `scrollHint`);
  - a press in the bottom gutter drags the thumb;
  - `scrollBy(d)` scrolls along the axis.
- **Drag deltas** are measured in the box's parent space (`parent.toLocal(e.global)`), not in
  global px, so a scaled page drags 1:1 under the finger. For an unscaled parent this is identical
  to today.
- **Drag slop**, on both axes: a press becomes a drag (`didDrag`, which the CTAs check) once the
  pointer is more than 4 **global** px from the press along the axis, cumulative from the press, so
  a slow drag counts. It is measured in screen px, so a scaled-down page (k ≈ 0.51) does not shrink
  it to 2 px and let touch jitter eat CTA taps.
- **Wheel guard**, on both axes: the wheel is still swallowed (`preventDefault`), but it scrolls
  nothing while the box is `eventMode = 'none'` or hidden (any ancestor `visible = false`).

## 5. Demo

`examples/pixi-s-shell-demo`:
- Add one art file, `public/bonus-art.svg`: a night-sky gradient with a dark mountain silhouette,
  hand-written SVG, no raster.
- Give the two free-spins bonuses `thumbnail: '/bonus-art.svg'`, so the art fade shows next to the
  fallback faces.

## 6. Tests (`tests/pixi-s/`)

- **Bar:** the WIDE / MOBILE SPIN, BUY and tab sizes from the table; the tabs are still one size;
  the seam test still passes.
- **Cards:**
  - every card is `cardW = cardH / 2 (±1)`, and at most `0.70 · W` wide at 390×844;
  - the row is centred with no scroll when the cards fit (1280×720, 4 cards);
  - it scrolls with the next card peeking when they do not (390×844).
- **Card order:**
  - the fade's top is `titleTop` and its bottom the zone's bottom;
  - its fill is a `FillGradient`;
  - the hero is clipped to that bottom;
  - the price sits above the CTA, and the volatility bars above the price;
  - on a group slot, ‹ › are level with the title zone and wrap the group.
- **Band:** no `Graphics` fill behind BALANCE | BET (no `S.panel` rect in the band).
- **Horizontal scroll:**
  - `ScrollBox` with `'x'`: wheel `deltaY` scrolls x; drag moves `content.x`; `maxScroll` comes
    from the width;
  - with `'y'` the existing HB scroll tests pass unchanged.
- **Keys:** ArrowRight scrolls by one card step; Shift+ArrowUp steps the bet.
- **Confirm:**
  - with a manual ticker and a `matchMedia` stub (motion allowed), after 300ms the flyer is
    centred, its scale is `s`, and the page parts are at alpha 0 with the ✕ visible. Before the
    end, the action row does not take taps;
  - Escape runs the reverse, and at the end the original card is visible, the flyer gone and the
    parts at alpha 1;
  - with reduced motion, both states land at once;
  - Enter commits;
  - a resize while open removes it.
- **Short screen:** at 400×225 the page is scaled by `k = 225/440`, and every card and the band are
  on screen.
- `no-round.test.ts` stays green: the notches are straight lines and the gradient is a rect.

## Out of scope

- The replay and generic modals (they keep `SCardModal`).
- Game info.
- The menu.
- The pickers.
- A torn top edge.
- Round notches.
