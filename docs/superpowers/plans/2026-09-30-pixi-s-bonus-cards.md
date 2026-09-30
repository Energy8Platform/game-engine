# S Bonus Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Make SPIN, BUY and the tabs 30% shorter.
- Rebuild the S buy-bonus page as one horizontally scrolling row of portrait ticket cards: the hero
  art fades to black from the title down.
- Add a fly-in confirm and drop the band's backing.

**Architecture:**
- `ScrollBox` (HB primitive) gets an optional `axis: 'x'`.
- `SBuyBonusPage` (`src/ui/pixi-s/components/BuyBonus.ts`) is rewritten around it: a page scaled
  on short screens, a row of `buildCard` cards, and a confirm that tweens a copy of the chosen card
  to the centre with the existing `tween()`.

**Tech Stack:** PixiJS 8.20 (`FillGradient`, `Graphics`, `Sprite`), Vitest 2 + jsdom with the canvas
stub, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-30-pixi-s-bonus-cards-design.md`. It is the authority.
Every number below is copied from it.

## Global Constraints

**Look (S rules):**
- No strokes and no rounding anywhere in S. `tests/pixi-s/no-round.test.ts` must stay green. There
  are no circles, no `roundRect` with r > 0, and no `stroke()`. The dashed separator is a row of
  filled rects.
- Palette from `src/ui/pixi-s/theme.ts`: `S.plate #0b0b0b`, `S.yellow`, `S.red`, `S.fg`, `S.muted`,
  `S.track`, `S.shadow`, `SHADOW_ALPHA`, `DISABLED_ALPHA`. Shadows use `SHADOW_OFFSET` (3) from
  `slab.ts`.
- Icons come only from `sIcon` (`src/ui/pixi-s/icons.ts`): `bonus`, `chevronLeft`, `chevronRight`, …

**Tests and gates:**
- Run from the repo root: `npm test --workspace @energy8platform/shell` (green),
  `npm run typecheck --workspace @energy8platform/shell` (0) and
  `npm run build --workspace @energy8platform/shell` (0).
- For a single file: `cd packages/shell && npx vitest run tests/pixi-s/<file>`. Never run
  root-level `npx vitest run <path>`.
- In tests `matchMedia` is absent, so `prefersReducedMotion()` is true and `tween()` finishes
  synchronously. The test host's ticker (`tests/pixi/_host.ts` `stubTicker`) never ticks. To test a
  running animation, pass a manual ticker (`{ add(fn), remove(fn) }` that stores `fn`, driven by
  calling `fn({ deltaMS })`) through `makeContext({ ticker })`. Stub `globalThis.matchMedia` to
  return `{ matches: false }`, and restore it after.

**Commits:**
- Commit only the files you changed. Never commit `engine/`, `dist/` or `node_modules`.
- Never run `git stash`, `git checkout -- <file>` or `git restore` on files you did not write.
  Look at the base with `git show HEAD:<path>`. Retry on `index.lock`.
- The message is a subject line, a blank line, then exactly
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Check it with
  `git log -1 --format=%B` and amend if it differs.

## Review Focus

1. **A 1–2 card config** (a game with one bonus) must centre the row with no scrollbar and no
   empty scroll. Task 3 test: one slot at 1280×720 is centred and `maxScroll` is 0.
2. **A pending thumbnail** must not throw or draw over the fade when it arrives after a rebuild or
   close. `Assets.load` resolves late, and the slot may already be destroyed. Task 3 test: the
   hero slot is destroyed before the promise resolves, and nothing is added.
3. **A tap on the row after a drag** must not fire a CTA. Guard with `ScrollBox.didDrag`, as the
   HB list does. Task 3 test: a drag across the row followed by pointerup on a CTA does not open
   the confirm.
4. **A rebuild during the confirm** (a bet step from the keyboard is ignored while the confirm is
   open; a resize closes it) must leave no orphan flyer. Task 4 test: resize while open leaves
   no `bb-flyer` in the page.
5. **Commit during the open tween** (Enter before the fly ends) must commit once and close. It must
   not throw on the tween's later ticks. Task 4 test: Enter mid-tween, then keep ticking, and there
   is no error and one `selectBuyBonus`.

---

### Task 1: Bar — SPIN, BUY and the tabs 30% shorter

**Files:**
- Modify: `packages/shell/src/ui/pixi-s/SideBar.ts` (the `WIDE` / `MOBILE` size tables)
- Test: `packages/shell/tests/pixi-s/sidebar.test.ts`
- Docs: `docs/superpowers/specs/2026-09-29-pixi-s-shell-design.md` (the sizes table and the
  "150×90, tabs 42×30" line)

**Interfaces:**
- Consumes: nothing new.
- Produces: `WIDE.spin = [174, 126]`, `WIDE.tab = [34, 34]`, `MOBILE.spin = [105, 90]`,
  `MOBILE.tab = [29, 30]`. BUY uses `z.spin`, so it follows.

- [ ] **Step 1: Write the failing test.** Add to `sidebar.test.ts`:

```ts
  it('SPIN, BUY and both tabs are 30% shorter than the first cut (the user, 2026-09-30)', () => {
    const wide = parts(build(host(1280, 720)));
    expect(wide.spin!.measureSize()).toEqual({ w: 174, h: 126 });
    expect(wide.buy!.measureSize()).toEqual({ w: 174, h: 126 });
    expect(wide.autoTab!.measureSize()).toEqual({ w: 34, h: 34 });
    expect(wide.turboTab!.measureSize()).toEqual({ w: 34, h: 34 });
    const phone = parts(build(host(390, 844)));
    expect(phone.spin!.measureSize()).toEqual({ w: 105, h: 90 });
    expect(phone.buy!.measureSize()).toEqual({ w: 105, h: 90 });
    expect(phone.autoTab!.measureSize()).toEqual({ w: 29, h: 30 });
    expect(phone.turboTab!.measureSize()).toEqual({ w: 29, h: 30 });
  });
```

`measureSize` is in design units, since the bar's scale lives on the column container. If a
`Sized` item reports scaled px, compare the `z` table through `measureSize` of an unscaled build
and say so in the report.

- [ ] **Step 2: Run** `cd packages/shell && npx vitest run tests/pixi-s/sidebar.test.ts`. Expected:
  FAIL, because the sizes are still 248/150 and 48/42.
- [ ] **Step 3: Implement.** In `SideBar.ts` set `spin: [174, 126]` and `tab: [34, 34]` in `WIDE`,
  and `spin: [105, 90]` and `tab: [29, 30]` in `MOBILE`. Nothing else changes.
- [ ] **Step 4: Run** the sidebar file, then the whole S folder
  (`npx vitest run tests/pixi-s/`). Any test that hard-codes the old sizes must follow the table.
  Report each one you change and why. The seam, "one size" and safe-area tests must pass unchanged.
- [ ] **Step 5: Docs.** In `2026-09-29-pixi-s-shell-design.md` update the SPIN/BUY/tab sizes and
  the mobile line to 105×90 / tabs 29×30. Add one line citing 2026-09-30 "укоротим процентов на 30".
- [ ] **Step 6: Gates** (tests, typecheck), then commit: `S bar: SPIN, BUY and the tabs 30% shorter`.

---

### Task 2: `ScrollBox` gets an `axis`

**Files:**
- Modify: `packages/shell/src/ui/pixi-hb/primitives/scroll.ts`
- Test: `packages/shell/tests/pixi/scroll-axis.test.ts` (new)

**Interfaces:**
- Consumes: `ScrollAffordanceView.update(vp, hint)` from `scroll-affordance.ts`. Its `vp.axis`
  already accepts `'x'`. `scrollHint({ scrollTop, scrollHeight, clientHeight })` from
  `@/core/scrollHint` is axis-agnostic: pass left/width/clientWidth for x.
- Produces: `new ScrollBox(canvas?, ticker?, look?, axis: 'x' | 'y' = 'y')`. With `'x'`:
  - `scrollBy(d)` scrolls along x;
  - `maxScrollY` reports the max along the box's axis (keep the name);
  - `content.x` moves;
  - `didDrag` works as today.

**Requirements (spec §4):**
- `'y'` behaves exactly as today. Every existing test under `tests/pixi/` and `tests/pixi-hb/` that
  touches `ScrollBox` passes unchanged.
- `'x'`:
  - measure with `b.width + b.x`;
  - the viewport's long side is `viewW`;
  - `setScroll` writes `content.x`;
  - the affordance gets `{ x: 0, y: 0, w: viewW, h: viewH, axis: 'x' }` and the hint built from
    the x values;
  - drag uses the pointer's x;
  - the thumb-drag test is `local.y >= t.y - THUMB_INSET` (the gutter is at the bottom edge), and
    the thumb maths use `t.x` / `t.w` / `b.x` / `b.w`;
  - the wheel uses `Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY`.
- **Drag deltas are in the parent's space on both axes.** Keep `lastX/lastY` from
  `this.parent.toLocal(e.global)` (fall back to `e.global` when there is no parent). For an
  unscaled parent this is identical to today. Under a parent scaled by `k`, a finger move of
  `d` screen px scrolls `d / k` local px, which is 1:1 under the finger.

- [ ] **Step 1: Write failing tests** in `tests/pixi/scroll-axis.test.ts`:
  - an `'x'` box with viewport 300×100 and content one 900×80 rect: `maxScrollY === 600`;
    `scrollBy(250)` gives `content.x === -250`; scrolling past the end clamps to −600;
  - a wheel `deltaY: 120` dispatched on the canvas (`new WheelEvent('wheel', { deltaY: 120 })`)
    moves `content.x` by −120;
  - drag: `pointerdown` at global (200, 50), `globalpointermove` to (150, 50) gives `content.x`
    of −50, and `didDrag === true`;
  - drag under a parent scaled 0.5: the same 50px move scrolls 100 local px;
  - `'y'` default: the same content rotated (80×900) scrolls `content.y`, and `content.x` stays 0.
  Use `import '../pixi/setup-canvas'` first, as the other pixi tests do. Emit pointer events with
  `box.emit('pointerdown', { global: new Point(x, y) } as unknown as FederatedPointerEvent)`.
- [ ] **Step 2: Run** `npx vitest run tests/pixi/scroll-axis.test.ts`. Expected: FAIL (no axis
  parameter).
- [ ] **Step 3: Implement** the axis in `scroll.ts`, keeping the file's comments accurate (the class
  doc says "vertically-scrolling"; make it "scrolling (vertical by default, or horizontal)"). The
  `GUTTER` doc should say "room the scrollbar takes at the right edge (y) or the bottom edge (x)".
- [ ] **Step 4: Run** the new file, then `npx vitest run tests/pixi tests/pixi-hb tests/pixi-s`.
  All green.
- [ ] **Step 5: Gates**, then commit: `ScrollBox: optional horizontal axis; drag deltas in the parent's space`.

---

### Task 3: Buy-bonus page — portrait ticket cards in one horizontal row

**Files:**
- Modify: `packages/shell/src/ui/pixi-s/components/BuyBonus.ts` (page frame, row, `buildCard`,
  `buildHero`; the confirm stays the current `SCardModal` until Task 4)
- Modify: `packages/shell/src/ui/pixi-s/text.ts` only if `sLabel` needs an optional wrap width and
  alignment (`makeText` already supports `wrapWidth` / `align`)
- Test: `packages/shell/tests/pixi-s/buybonus.test.ts` (rewrite the layout tests; keep the
  behaviour tests)
- Demo: `examples/pixi-s-shell-demo/public/bonus-art.svg` (new) and
  `examples/pixi-s-shell-demo/src/main.ts` (give the two free-spins bonuses
  `thumbnail: '/bonus-art.svg'`)

**Interfaces:**
- Consumes: Task 2's `new ScrollBox(canvas, ticker, S_SCROLL, 'x')` and `ScrollBox.GUTTER`.
- Produces, for Task 4:
  - `buildCard(slot: number, w: number, h: number): Container`, labelled `bb-card-<slot>`, with
    its CTA reachable as `ctas[slot]`;
  - page fields `scroll`, `band`, `titlePlate` and `closeBtn`;
  - a method `cardEm(h)` returning `h / 36`;
  - `private cardSize(): { w: number; h: number }`, the current card size;
  - the page-scale container: all page content lives under `this.stage` (a `Container` scaled by
    `k`), and `this.veil` stays unscaled at full screen.

**Requirements (spec §2, verbatim values):**

**Page scale.**
- `k = Math.min(1, h / 440)`. Lay out at `W = w / k`, `H = h / k`, and set `stage.scale = k`.
- The veil stays at the real `w × h`.
- `stripMetrics`, `closeCorner` and the em are computed from `H` / `W`.

**Band.**
- Remove the `S.panel` rect (no `bg`). BALANCE | BET stay where they are now, laid out from `W`/`H`.

**Row.**
- `rowTop = strip.top + strip.height * 1.3`; `rowBottom = band top − pad * 0.5`.
- `cardH = Math.min(rowBottom − rowTop − ScrollBox.GUTTER, 0.62 * W / ASPECT, 640)` with
  `ASPECT = 0.5`, `cardW = Math.round(cardH * ASPECT)`, `CARD_GAP = 14`.
- Viewport: `x = pad`, width `W − 2·pad`, height `cardH + GUTTER`, vertically centred between
  `rowTop` and `rowBottom`.
- Cards sit at `x = i · (cardW + CARD_GAP)`. When `total ≤ viewport width`, the content is offset
  to centre the row, and nothing scrolls.

**Card (`em = cardH / 36`, `pad = em · 1.2`):**
- **Body.** One polygon in `S.plate`, with the same polygon in `S.shadow` at `SHADOW_ALPHA`, offset
  by `SHADOW_OFFSET`. It is a rectangle with two inward triangular notches at `sepY`: depth
  `em · 0.6`, height `em · 1.2`. The points run clockwise:
  `0,0 · w,0 · w,sepY−nh/2 · w−nd,sepY · w,sepY+nh/2 · w,h · 0,h · 0,sepY+nh/2 · nd,sepY · 0,sepY−nh/2`.
- **Title zone.**
  - `titleTop = Math.round(0.40 · cardH)`; the zone height is two title line heights.
  - The title is Montserrat 800 caps (`sLabel`) at `em · 2`, `S.fg`, word-wrapped to the zone's
    inner width and centred. It is scaled down if a word is too wide or it runs past two lines.
    One line is centred vertically in the zone.
  - The inner width is `cardW − 2·pad`, minus `2 · (em · 2 + em · 0.5)` for a group slot.
- **‹ › (group slots).** `SButton`s `em · 2` square, `face: 'yellow'`, `corners: SKEW.menu`, with
  glyphs `sIcon('chevronLeft' | 'chevronRight', round(em), S.ink)`. They sit at x `pad` and
  `cardW − pad − em·2`, vertically centred on the zone. Labels are `bb-prev-<slot>` /
  `bb-next-<slot>`, and taps call `step(slot, ∓1)`.
- **Hero.** Covers `0..zoneBottom` and is clipped to it:
  - thumbnail: a cover-fit Sprite. Guard `if (slot.destroyed) return` in the `.then`;
  - custom node: contain-fit in `0..titleTop` with `em · 0.8` padding, through `persistent(node)`;
  - fallback: a face rect in `S.yellow` (`bb-hero-yellow`) or `S.red` for a feature
    (`bb-hero-red`), with `sIcon('bonus', round(0.6 · min(cardW, titleTop)), S.ink | S.fg)` centred
    in `0..titleTop`.
- **Fade.** A rect `(0, titleTop, cardW, zoneH)` labelled `bb-fade`, filled with
  `new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 'rgba(11,11,11,0)' }, { offset: 1, color: S.plate }], textureSpace: 'local' })`.
  Check the exact v8.20 constructor in `node_modules/pixi.js/lib/scene/graphics/shared/fill/FillGradient.d.ts`.
  Z-order: hero, then fade, then title and ‹ ›.
- **Description.** `sBody(description, em, S.muted, cardW − 2·pad, 'center')`, `em · 0.6` below the
  zone. It is masked to `[zoneBottom + em·0.6, sepY − em·0.6]`, and omitted if that room is under
  `em · 1.3`.
- **Separator.** Filled rects `em·0.5 × 2` every `em·0.9` in `S.track`, from `nd` to `cardW − nd`
  at `sepY − 1`.
- **Bottom block,** centred, bottom-up:
  - `pad`;
  - the CTA: `STextButton(label, { w: cardW − 2·pad, h: em · 2.8, kind: feature ? 'red' : 'accent', size: em, onTap })`,
    labelled `bb-cta-<slot>`. It is disabled unless affordable or active. The label follows the
    current rule (Buy / Activate / Deactivate);
  - a gap of `em·0.8`;
  - the price: `sValue(fmt(price), em·2.2, S.yellow)`, scaled to fit `cardW − 2·pad`;
  - a gap of `em·0.5`;
  - `sVolatilityRow(volatility, em)` when set;
  - `em·1.0` above it is `sepY`.
- **CTA tap after a drag.** `onTap` returns early when `this.scroll?.didDrag` (Review Focus 3).

**Keys (spec §2).**
- ArrowLeft / ArrowRight / ArrowUp / ArrowDown without Shift: `scroll.scrollBy(±(cardW + CARD_GAP))`,
  with Left/Up negative.
- `betDir` keys and `Equal` / `Minus` step the bet as now.
- Escape closes the page. While the Task 3 `SCardModal` confirm is open, its current key handling
  stays.

- [ ] **Step 1: Write failing tests** in `buybonus.test.ts`. Keep:
  - R1 (plates in the corners);
  - group flip with wrap, now through `bb-next-<slot>`;
  - feature red / bonus accent;
  - CTA opens the confirm and Enter commits;
  - I3;
  - unaffordable disabled;
  - the hero face colours;
  - the phone band.

  Replace the layout tests with:
  - **Aspect.** At 1280×720 and 390×844 every `bb-card-*` is `|w − h/2| ≤ 1`, measured on the
    card body. At 390×844 the width is `≤ 0.62 · 390 + 1`.
  - **Fits, so centred.** 1280×720 with the demo's 4 slots: `scroll.maxScrollY === 0`, and the row
    is centred (left and right margins within 1). Also one slot (Review Focus 1).
  - **Overflows, so it peeks.** 390×844: `maxScrollY > 0`; the second card's left edge is inside
    the viewport and its right edge past it.
  - **Card order,** on a thumbnail-less card:
    - fade top = `titleTop`, fade bottom = zone bottom;
    - the fade's fill instruction carries a `FillGradient`
      (`(ins.data.style.fill instanceof FillGradient)`, or whatever v8.20 stores; read the context
      instructions);
    - hero face bottom ≤ zone bottom;
    - title bounds inside the zone;
    - volatility bottom < price top < CTA top;
    - CTA bottom = `cardH − pad` (±1).
  - **‹ › at the title.** On the group slot, `bb-prev-0` / `bb-next-0` vertical centres = zone
    centre (±1). Tapping next 4 times wraps to the first member.
  - **No band backing.** No `Graphics` in `band` has a fill instruction with colour `S.panel`.
    Simplest: walk `band` and assert that every `Graphics` belongs to a slab (child of a
    `Slab`/`SReadout`/`SBet`).
  - **Thumbnail late resolve.** Stub `Assets.load` (`vi.spyOn(Assets, 'load')`) to return a
    deferred promise. Rebuild (resize), then resolve. No throw, and no Sprite is added to a
    destroyed node (Review Focus 2).
  - **Drag then tap.** Pointerdown on the row, globalpointermove 40px, then a pointertap on a CTA:
    no confirm (Review Focus 3).
  - **Keys.** ArrowRight: `content.x` decreases by `cardW + 14` (at 390×844). Shift+ArrowUp steps the
    bet (`state.bet` rises).
  - **Short screen.** At 400×225, `stage.scale.x ≈ 225/440`. Every card's and the band's
    `getBounds()` fits vertically inside 0..225, the row's viewport inside 0..400, and the veil
    covers 400×225.
- [ ] **Step 2: Run** `npx vitest run tests/pixi-s/buybonus.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement** in `BuyBonus.ts`. Update the file's header doc comment to the new page.
- [ ] **Step 4: Run** the file, then `npx vitest run tests/pixi-s/` (the no-round guard included).
- [ ] **Step 5: Demo.**
  - Write `public/bonus-art.svg`: `viewBox="0 0 300 400"`, a vertical `linearGradient` from
    `#1b2a4a` (top) to `#3a4f78`, two or three dark `#101826` mountain `polygon`s, a few small
    `#f8be45` window rects. Hand-written, under 2 KB.
  - In `main.ts` give the two free-spins bonuses `thumbnail: '/bonus-art.svg'`.
  - Rebuild the shell (`npm run build --workspace @energy8platform/shell`) and run
    `cd examples/pixi-s-shell-demo && npx vite --port 4331 --strictPort --force` in the background
    (stop only your own process). If 4331 is busy, stop the process there only if it is this
    demo's vite.
  - Screenshot with the scratchpad script `overlays.mjs`: open `?screen=desktop&open=buybonus`,
    `?screen=phone&open=buybonus` and `?screen=stake-s&open=buybonus`.
  - Confirm: portrait cards, the fade from the title, ‹ › at the Warrior title, no band panel,
    the scrollbar under the row on the phone.
- [ ] **Step 6: Gates**, then commit (code + tests, then demo):
  `S buy bonus: portrait ticket cards in one horizontal row` and
  `S demo: bonus art for the free-spins cards`.

---

### Task 4: Fly-in confirm

**Files:**
- Modify: `packages/shell/src/ui/pixi-s/components/BuyBonus.ts` (replace the `SCardModal` confirm)
- Test: `packages/shell/tests/pixi-s/buybonus.test.ts`

**Interfaces:**
- Consumes:
  - Task 3's `buildCard`, `cardSize()`, `cardEm()`, `stage`, `scroll`, `band`, `titlePlate`,
    `closeBtn` and `ctas`;
  - `tween(ticker, { duration, ease?, onUpdate, onComplete? })` and `easeOutCubic` from
    `src/ui/pixi/motion-pixi.ts` / `@/core/motion`;
  - `STextButton` (kinds `ghost`, `accent`, `red`).
- Produces: page fields `flyer?: Container` (labelled `bb-flyer`) and `actions?: Container`
  (labelled `bb-confirm-actions`), and `confirmBonus?: BonusOption`.

**Requirements (spec §3, verbatim values):**

**Open (`select` → affordable and not active).**
1. `flyer = buildCard(slot, cardW, cardH)`, labelled `bb-flyer`, added to `stage` above everything
   except `closeBtn`. Position it at the original card's stage-local position
   (`stage.toLocal(card.getGlobalPosition())`). Hide the original card and the flyer's own CTA.
2. Target: `m = strip.top`, `s = Math.min(1.3, (H − 2·m − actH − gap) / cardH, (W − 2·m) / cardW)`,
   where `actH = em · 2.8 · s` and `gap = em · s` (with `em = cardEm(cardH)`). Solve for `s`: since
   `actH` and `gap` scale with `s`, `s = Math.min(1.3, (H − 2·m) / (cardH + em·2.8 + em), (W − 2·m) / cardW)`.
   The block height is `cardH·s + gap + actH`; its top is `(H − block) / 2`; the flyer is centred
   horizontally.
3. `tween(host.ticker, { duration: 300, ease: easeOutCubic, onUpdate })`:
   - lerp the flyer's x, y and scale from start to target;
   - lerp the alpha of `scroll`, `band` and `titlePlate` from 1 to 0. `closeBtn` stays at 1.
4. `onComplete`:
   - build `actions`: `STextButton(t('Cancel'), { kind: 'ghost' })` and
     `STextButton(t(feature ? 'Activate' : 'Buy'), { kind: feature ? 'red' : 'accent' })`;
   - each is `(cardW·s − gap) / 2` wide and `actH` tall, side by side under the flyer at `+gap`;
   - then `tween(150)` its alpha from 0 to 1. `actions.eventMode = 'none'` until that ends, then
     `'passive'`.
   - Hold the cancel functions of both tweens and call them on close or cancel.

**While open.**
- Enter / Space: `commit(confirmBonus)`.
- Escape, CANCEL and the ✕: `cancelConfirm()`. While a confirm is open, the ✕'s `onTap` routes
  to `cancelConfirm()` instead of `closeLayer()`.
- Taps on the veil do nothing (the veil already swallows them).
- Other keys return false, as now.

**`cancelConfirm()`.**
- Remove `actions` at once.
- `tween(250)` the flyer back to its start x, y and scale and the parts' alpha back to 1.
- `onComplete`: destroy the flyer, show the original card, clear `confirmBonus`.
- A second cancel during the reverse is a no-op.

**`commit(bonus)`.**
- Cancel running tweens, then act (`activateFeature` / `selectBuyBonus`) and `closeLayer()`, as now.
- Every tween `onUpdate` returns early if `this.destroyed` or the flyer is destroyed (Review Focus 5).

**Resize or rebuild while open.**
- `removeConfirm()` cancels the tweens, destroys the flyer and actions, and restores the parts'
  alpha and the original card, with no animation (Review Focus 4).
- `resize` already calls `removeConfirm()` before `rebuild()`.

**Remove** the `SCardModal` confirm code and its import if nothing else in the file uses it. The
`showPage()` helper becomes the alpha fade; drop it if unused.

- [ ] **Step 1: Write failing tests** (a manual ticker and a `matchMedia` stub for the animated
  ones; see Global Constraints):
  - **Open, animated.** Tap `bb-cta-2` (an affordable bonus) and tick 150ms:
    - the flyer is between start and target;
    - `actions` is not there yet, or has `eventMode === 'none'`.

    Tick to 300ms, then 150ms more:
    - the flyer is centred (`|flyer centre x − W/2| ≤ 1`) with `flyer.scale.x ≈ s`;
    - `scroll.alpha === 0`, `band.alpha === 0`, `titlePlate.alpha === 0`, `closeBtn.visible` and
      `closeBtn.alpha === 1`;
    - the original card is not visible;
    - `actions` takes taps.
  - **Cancel, animated.** Escape, then tick 250ms: the flyer is gone, the original visible, and the
    parts' alpha is 1. The ✕ during the confirm cancels it (the page stays open).
  - **Reduced motion.** With the default test env (no `matchMedia`), a tap on the CTA lands the final
    state at once, and Escape restores at once.
  - **Enter commits.** It emits `buyBonusSelect` (or calls `selectBuyBonus`) once and closes the
    layer. Enter mid-tween, then more ticks, gives no throw and exactly one commit (Review Focus 5).
  - **CANCEL button.** A pointertap on the actions' first button cancels.
  - **Resize while open.** No `bb-flyer` remains, the parts' alpha is 1 and every card is visible
    (Review Focus 4).
  - **The feature card.** The actions' second button has kind `red` and the label Activate.
  - **Keep the I3-style test:** while open, nothing under the flyer is visible at alpha > 0 except
    the ✕.
- [ ] **Step 2: Run** the file. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `npx vitest run tests/pixi-s/`.
- [ ] **Step 5: Visual.** Rebuild the shell, restart the demo vite with `--force`, and screenshot
  `?screen=desktop&open=buybonus`. Then click a Buy CTA with Playwright
  (`page.mouse.click` at the CTA's screen position; read it from the page, or click the bottom
  centre of the third card) and screenshot after 600ms. Do the same on `?screen=phone`. Confirm:
  the card is centred and larger, the actions are under it, and the rest has faded.
- [ ] **Step 6: Docs.** Append to the spec's §3 any deviation you had to make, with the reason.
  None is expected.
- [ ] **Step 7: Gates**, then commit: `S buy bonus: the chosen card flies to the centre to confirm`.
