# S Overlays Revision 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Apply the user's second round of overlay asks. Modals and pages lose their backings, page title plates and ✕ move to the screen corners, the bet and autoplay pickers become stepped sliders, and the menu gets a yellow thumb and rows narrower than SPIN.

**Architecture:** All changes are to the existing S files in `packages/shell/src/ui/pixi-s/`. HB code is not touched. There is one new primitive, `SStepSlider`, in `primitives/controls.ts`. `pickers.ts` is rewritten around a new `SPicker` layer. The rest are layout edits to `card.ts`, `page.ts`, `GameInfo.ts`, `BuyBonus.ts` and `Menu.ts`.

**Tech Stack:** TypeScript 5.6, PixiJS 8.20, Vitest 2 (jsdom + the canvas stub).

**Spec:** `docs/superpowers/specs/2026-09-30-pixi-s-overlays-design.md` — **Revision 2 (R1–R5)** at the end is binding and overrides earlier sections where they conflict.

## Global Constraints

- HB code is not touched. Every test in `tests/pixi-hb/` and `tests/pixi/` passes unchanged.
- There is no stroke and no rounding: `tests/pixi-s/no-round.test.ts` stays green, and every new graphic is a `rect` or a `poly`.
- Commands:
  - Single file: `cd packages/shell && npx vitest run tests/pixi-s/<file>`.
  - Full suite, from the repo root: `npm test --workspace @energy8platform/shell`.
  - Typecheck: `npm run typecheck --workspace @energy8platform/shell`.
  - Build: `npm run build --workspace @energy8platform/shell`.
  - Never run a root-level `npx vitest run <path>`.
- Commits:
  - Stage only the files you changed. Never stage `engine/`.
  - Never use `git stash`, `git checkout -- <file>` or `git restore` on other people's files.
  - Message: a subject line, a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Verify with `git log -1 --format=%B`.
- When a test's rule changes because the spec's R-rules replace it, rewrite that test to the new rule, and say which test it was in the report. Never delete a rule without replacing it.

## Review Focus

1. **A picker with 1 choice** (a single bet level). The slider must not divide by zero; the thumb sits at the start and Confirm still works. Test in Task 2.
2. **A picker value plate at either end.** At index 0 and at the last index the value plate stays within the slider's extents. Test in Task 2.
3. **Game info content scrolling under the fixed plates.** A tap on the title plate area must not reach the content, and ✕ must stay tappable over scrolled content (it is drawn above the scroll box). Test in Task 3.
4. **A mobile menu row with a long toggle label.** It stacks, and the toggle stays inside the row. Test in Task 4.
5. **A modal with a long body on a short screen.** Without a panel it still fits (scales) and ✕ stays in the corner. Test in Task 1.

---

### Task 1: SCardModal without a backing

**Files:**
- Modify: `packages/shell/src/ui/pixi-s/primitives/card.ts`
- Test: `packages/shell/tests/pixi-s/modals.test.ts` (rewrite the card-modal layout tests to R3)

**Interfaces:**
- Consumes: `stripMetrics` from `./page`.
- Produces: `SCardModal`, with the same API. `closeBtn` is now a child of the layer, not of the card root. It sits at the screen's top-right corner.

- [ ] **Step 1: Rewrite the layout tests to R3**

In `tests/pixi-s/modals.test.ts`, replace these three tests with the four below:
- the test that checks the title plate rides the card's top-left edge;
- the ✕ size / hit-area test;
- the `fit()` test.

```ts
  it('R3: no backing panel; the title plate is centred over the content; ✕ in the screen top-right corner', () => {
    const host = makeContext({ screenW: 1280, screenH: 720 });
    const m = new SCardModal(host, { title: 'Bet', onClose: () => {} });
    m.build();
    const root = m.children.find((c) => c !== m.closeBtn && (c as Container).children?.includes(m.body)) as Container;
    // no flat panel rect behind the body
    const panels = (root.children as Container[]).filter((c) => c instanceof Graphics && c.context.instructions.length > 0);
    expect(panels).toEqual([]);
    const t = m.titlePlate!;
    const cx = t.x + t.measureSize().w / 2;
    expect(cx).toBeCloseTo(m.cardWidth / 2, 0);
    const strip = stripMetrics(720);
    expect(m.closeBtn!.parent).toBe(m);
    expect(m.closeBtn!.x + strip.height).toBeCloseTo(1280 - strip.top, 0);
    expect(m.closeBtn!.y).toBeCloseTo(strip.top, 0);
  });

  it('R3: the ✕ plate is at least 44 (it is its own hit area)', () => {
    const m = new SCardModal(makeContext({ screenW: 390, screenH: 844 }), { title: 't', onClose: () => {} });
    m.build();
    expect((m.closeBtn as SButton).measureSize().w).toBeGreaterThanOrEqual(44);
  });

  it('fit(): a tall body on a short screen scales the content block down and keeps it on screen', () => {
    const host = makeContext({ screenW: 400, screenH: 225 });
    const m = new SCardModal(host, { title: 'Long', onClose: () => {} });
    for (let i = 0; i < 12; i++) m.body.add(new Graphics().rect(0, 0, 100, 40).fill(0xffffff));
    m.build();
    const root = m.children.find((c) => c !== m.closeBtn && (c as Container).children?.includes(m.body)) as Container;
    expect(root.scale.x).toBeLessThan(1);
    const b = root.getBounds();
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(225);
  });

  it('an empty title draws no title plate', () => {
    const m = new SCardModal(makeContext(), { title: '  ', onClose: () => {} });
    m.build();
    expect(m.titlePlate).toBeUndefined();
  });
```

Add these imports if they are missing:
- `Graphics` from `pixi.js`;
- `SButton` from `@/ui/pixi-s/widgets`;
- `stripMetrics` from `@/ui/pixi-s/primitives/page`.

If an existing test of the same name ("an empty title …") already exists, keep only one copy.

Other tests in the file that assert the old corner-of-card placement follow the same rule: rewrite them to R3.

- [ ] **Step 2: Run and confirm RED**

Run: `cd packages/shell && npx vitest run tests/pixi-s/modals.test.ts`
Expected: FAIL. The panel is still drawn, and ✕ is still a child of the card root.

- [ ] **Step 3: Implement**

In `card.ts`:
- Import `stripMetrics` from `'./page'`.
- **Doc comment.** "The S card modal — HB `CardModal`'s API with no backing (R3). The content block (the title plate centred on top, then the body and the actions) sits straight on the veil over the frosted game, and ✕ is a yellow plate in the screen's top-right corner."
- **Constructor.**
  - Remove `bg` from `cardRoot.addChild(...)` and delete the `bg` field.
  - The title plate's `maxW` becomes `this.cardW - 2.4 * this.em`.
  - Create ✕ at `stripMetrics(host.screenH).height` (which is at least 44), with no padded hit area.
  - Add it to `this` (the layer), after `cardRoot`.
  - Delete the `closeSize` field.
- **`build()`.**
  - `const top = this.titlePlate ? this.headH + Math.round(0.8 * this.em) : 0;`
  - Centre the title plate: `this.titlePlate.position.set((this.cardW - this.titlePlate.measureSize().w) / 2, 0)`.
  - Body at `top`, actions at `top + bodyH`, and `cardH = top + bodyH + this.actionsH`.
  - Do not draw a panel.
- **`resize(w, h)`.**
  - Keep the veil.
  - Place ✕ at `x = w − strip.top − size` and `y = strip.top`, with `strip = stripMetrics(h)`. Size stays as built.
  - Then call `fit()`.
- **`fit()`.** Unchanged apart from `lift`:
  - drop `lift` from `fullH` and from the y maths, since nothing overhangs any more;
  - delete the `lift` field.

- [ ] **Step 4: GREEN and the gates**

Run: `cd packages/shell && npx vitest run tests/pixi-s/modals.test.ts tests/pixi-s/buybonus.test.ts tests/pixi-s/no-round.test.ts`
Expected: PASS.

Then run the full suite and the typecheck. Expected: green, and exit 0.

- [ ] **Step 5: Commit**

Subject: `S card modal without a backing: centred title plate, ✕ in the screen corner`

---

### Task 2: Stepped-slider pickers

**Files:**
- Modify: `packages/shell/src/ui/pixi-s/primitives/controls.ts` (add `SStepSlider`)
- Rewrite: `packages/shell/src/ui/pixi-s/components/pickers.ts`
- Test: `packages/shell/tests/pixi-s/modals.test.ts`. Rewrite the bet and autoplay picker tests. Add `SStepSlider` tests to `tests/pixi-s/controls.test.ts`.

**Interfaces:**
- Produces:
  - `class SStepSlider(count: number, index: number, onChange: (i: number) => void)` with `index`, `setIndex(i)`, `thumbCenterX`, `layout(width, height)` and `measureSize()`.
  - `class SPicker` with `slider`, `valuePlate`, `titlePlate`, `closeBtn`, `confirm` and `onKey`.
  - `openSBetPicker(host)` and `openSAutoplayPicker(host)`, with the same names as before.

- [ ] **Step 1: Failing tests**

Add to `tests/pixi-s/controls.test.ts`:

```ts
  it('SStepSlider: the index maps to the thumb; a tap snaps to the nearest step; 1 step never divides by 0', () => {
    const onChange = vi.fn();
    const s = new SStepSlider(5, 2, onChange);
    s.layout(400, 40);
    const tw = Math.round(40 * 0.8);
    expect(s.thumbCenterX).toBeCloseTo(tw / 2 + (2 / 4) * (400 - tw), 5);
    s.setIndex(4);
    expect(s.thumbCenterX).toBeCloseTo(400 - tw / 2, 5);
    expect(onChange).not.toHaveBeenCalled();
    (s as unknown as { setFromX(x: number): void }).setFromX(0);
    expect(s.index).toBe(0);
    expect(onChange).toHaveBeenCalledWith(0);
    const one = new SStepSlider(1, 0, () => {});
    one.layout(300, 40);
    expect(Number.isFinite(one.thumbCenterX)).toBe(true);
    expect(one.thumbCenterX).toBeCloseTo(tw / 2, 5);
  });
```

(Import `SStepSlider` alongside the existing imports.)

In `tests/pixi-s/modals.test.ts`, replace the two picker tests with:

```ts
  it('bet picker: a stepped slider over the bet levels at the current bet; → then Enter confirms the next', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, screenW: 1280, screenH: 720, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 1 }) });
    const p = openSBetPicker(host) as unknown as SPicker;
    expect(p.slider.index).toBe(1);
    expect(p.valuePlate.labelText.text).toBe('€1.00');
    expect(all(p, SChip).length).toBe(0); // no chips any more
    p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    expect(p.valuePlate.labelText.text).toBe('€2.00');
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('betChange', 2);
  });

  it('picker layout (R4): title plate centred, ✕ in the corner, value plate over the thumb within the slider, no backing', () => {
    const host = makeContext({ screenW: 1280, screenH: 720, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 0.5 }) });
    const p = openSBetPicker(host) as unknown as SPicker;
    expect(p.titlePlate.x + p.titlePlate.measureSize().w / 2).toBeCloseTo(640, 0);
    const strip = stripMetrics(720);
    expect(p.closeBtn.x + p.closeBtn.measureSize().w).toBeCloseTo(1280 - strip.top, 0);
    const s = p.slider.getBounds();
    const v = p.valuePlate.getBounds();
    expect(v.x).toBeGreaterThanOrEqual(s.x - 0.5); // index 0: clamped to the slider's left end
    expect(v.y + v.height).toBeLessThanOrEqual(s.y);
    p.onKey({ code: 'End' } as KeyboardEvent); // not a picker key — ignored
    for (let i = 0; i < 5; i++) p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    const v2 = p.valuePlate.getBounds();
    expect(v2.x + v2.width).toBeLessThanOrEqual(s.x + s.width + 3.5); // last index: clamped (+ shadow)
  });

  it('autoplay picker: counts incl. ∞ on the slider; START confirms', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, screenW: 1280, screenH: 720, config: defaultConfig({ features: { turbo: 0, autoplay: {}, buyBonus: false } }) });
    const p = openSAutoplayPicker(host) as unknown as SPicker;
    expect(p.titlePlate.labelText.text).toBe('AUTOPLAY');
    p.slider.setIndex(8);
    (p as unknown as { sync(): void }).sync();
    expect(p.valuePlate.labelText.text).toBe('∞');
    p.confirm.emit('pointertap', {});
    expect(emit).toHaveBeenCalledWith('autoplayStart', { active: true, remaining: Infinity });
  });

  it('a single bet level: slider at the start, confirm still works', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, config: defaultConfig({ availableBets: [1], defaultBet: 1 }) });
    const p = openSBetPicker(host) as unknown as SPicker;
    expect(p.slider.index).toBe(0);
    p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    expect(p.slider.index).toBe(0);
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(host.state.bet).toBe(1);
  });
```

(Imports: `SPicker` from `@/ui/pixi-s/components/pickers`, and `stripMetrics`.)

The test host's `setBet` is a no-op when the value is unchanged, so the single-level test asserts the state, not an emit.

- [ ] **Step 2: Run and confirm RED**

Run: `cd packages/shell && npx vitest run tests/pixi-s/controls.test.ts tests/pixi-s/modals.test.ts`
Expected: FAIL. `SStepSlider` and `SPicker` do not exist yet.

- [ ] **Step 3: `SStepSlider`** (append to `controls.ts`)

```ts
/** A stepped slider (the bet / autoplay pickers): a flat track half the thumb's height and a leaning
 *  yellow slab thumb, 0.8·h × h, snapping to `count` evenly spaced steps. */
export class SStepSlider extends Container implements Sizable {
  private track = new Graphics();
  private thumb = new Graphics();
  private w = 0;
  private h = 0;
  private _index: number;
  private count: number;
  private onChange: (i: number) => void;
  private dragging = false;

  constructor(count: number, index: number, onChange: (i: number) => void) {
    super();
    this.count = Math.max(1, count);
    this._index = Math.max(0, Math.min(this.count - 1, index));
    this.onChange = onChange;
    this.addChild(this.track, this.thumb);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', (e: FederatedPointerEvent) => {
      this.dragging = true;
      this.setFromX(this.toLocal(e.global).x);
    });
    this.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (this.dragging) this.setFromX(this.toLocal(e.global).x);
    });
    const end = (): void => {
      this.dragging = false;
    };
    this.on('pointerup', end);
    this.on('pointerupoutside', end);
  }

  get index(): number {
    return this._index;
  }
  private get thumbW(): number {
    return Math.round(this.h * 0.8);
  }
  /** The thumb's centre x in local units. */
  get thumbCenterX(): number {
    const travel = Math.max(0, this.w - this.thumbW);
    const u = this.count > 1 ? this._index / (this.count - 1) : 0;
    return this.thumbW / 2 + u * travel;
  }

  private setFromX(x: number): void {
    const travel = Math.max(1, this.w - this.thumbW);
    const u = Math.max(0, Math.min(1, (x - this.thumbW / 2) / travel));
    const i = Math.round(u * (this.count - 1));
    if (i === this._index) return;
    this._index = i;
    this.draw();
    this.onChange(i);
  }

  /** Move to a step without firing onChange (keyboard / programmatic). */
  setIndex(i: number): void {
    this._index = Math.max(0, Math.min(this.count - 1, i));
    this.draw();
  }

  layout(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.draw();
  }

  private draw(): void {
    const th = this.h * 0.5;
    this.track.clear().rect(0, (this.h - th) / 2, this.w, th).fill(S.track);
    const tw = this.thumbW;
    const x = this.thumbCenterX - tw / 2;
    this.thumb.clear().poly(slabPoints(tw, this.h, SKEW.menu).map((v, i) => (i % 2 === 0 ? v + x : v))).fill(S.yellow);
    this.hitArea = new Rectangle(0, 0, this.w, this.h);
  }

  measureSize(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }
  setLayoutSize(): void {
    /* sized by layout() */
  }
}
```

- [ ] **Step 4: Rewrite `pickers.ts`**

Replace the whole file with:

```ts
import { Container, Graphics, Rectangle, type Text } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import { Slab, SKEW } from '../slab';
import type { SButton } from '../widgets';
import { STitlePlate, STextButton, SStepSlider, sCloseButton } from '../primitives/controls';
import { stripMetrics } from '../primitives/page';
import { sValue } from '../text';
import { S } from '../theme';

// The S bet / autoplay pickers (R4): a full-screen layer with no card — a centred title plate, ✕ in the
// corner, a yellow value plate riding above a stepped slider, and a confirm button. Keys as HB's.

interface Choice {
  id: string;
  label: string;
}

interface PickerOpts {
  tag: string;
  title: string;
  choices: Choice[];
  selected: string;
  confirmLabel: string;
  onConfirm: (id: string) => void;
}

/** The yellow value plate: ink value on a leaning slab, sized to the widest choice. */
class ValuePlate extends Container {
  readonly labelText: Text;
  private slab: Slab;
  readonly w: number;

  constructor(maxLabel: string, h: number) {
    super();
    this.labelText = sValue(maxLabel, Math.round(h * 0.5), S.ink);
    this.w = Math.round(Math.max(h * 1.8, this.labelText.width + h * 0.9));
    this.slab = new Slab(this.w, h, { face: S.yellow, corners: SKEW.readout });
    this.addChild(this.slab, this.labelText);
  }

  set(text: string): void {
    this.labelText.text = text;
    this.labelText.position.set((this.w - this.labelText.width) / 2, (this.slab.h - this.labelText.height) / 2);
  }
}

function clampEm(w: number, h: number): number {
  return Math.max(11, Math.min(15, Math.min(w, h) * 0.02));
}

export class SPicker extends Container implements ShellLayer {
  readonly tag: string;
  readonly veil = new Graphics();
  titlePlate!: STitlePlate;
  closeBtn!: SButton;
  slider!: SStepSlider;
  valuePlate!: ValuePlate;
  confirm!: STextButton;
  private host: PixiComponentContext;
  private opts: PickerOpts;
  private index: number;

  constructor(host: PixiComponentContext, opts: PickerOpts) {
    super();
    this.host = host;
    this.opts = opts;
    this.tag = opts.tag;
    const i = opts.choices.findIndex((c) => c.id === opts.selected);
    this.index = i < 0 ? 0 : i;
    this.veil.eventMode = 'static'; // swallow taps to the game behind
    this.addChild(this.veil);
    this.resize(host.screenW, host.screenH);
  }

  resize(w: number, h: number): void {
    this.removeChildren(1).forEach((c) => c.destroy({ children: true }));
    this.veil.clear().rect(0, 0, w, h).fill(S.veil);
    this.veil.hitArea = new Rectangle(0, 0, w, h);
    const em = clampEm(w, h);
    const strip = stripMetrics(h);

    this.closeBtn = sCloseButton(strip.height, () => this.host.closeLayer());
    this.closeBtn.position.set(w - strip.top - strip.height, strip.top);

    const titleH = Math.round(em * 3);
    this.titlePlate = new STitlePlate(this.opts.title, titleH, w - strip.height * 2 - strip.top * 4);
    const sliderW = Math.round(Math.min(620, w * 0.7));
    const sliderH = Math.round(em * 3.2);
    const plateH = Math.round(em * 3.6);
    const widest = this.opts.choices.reduce((a, c) => (c.label.length > a.length ? c.label : a), '');
    this.valuePlate = new ValuePlate(widest, plateH);
    this.slider = new SStepSlider(this.opts.choices.length, this.index, (i) => {
      this.index = i;
      this.sync();
    });
    this.slider.layout(sliderW, sliderH);
    const btnW = Math.round(Math.min(sliderW, em * 16));
    const btnH = Math.round(em * 3);
    this.confirm = new STextButton(this.opts.confirmLabel, { w: btnW, h: btnH, kind: 'accent', size: em, onTap: () => this.doConfirm() });

    // the block: title · gap · value plate · slider · gap · confirm — centred vertically
    const gapA = em * 2;
    const gapB = em * 0.5;
    const gapC = em * 2;
    const blockH = titleH + gapA + plateH + gapB + sliderH + gapC + btnH;
    let y = Math.max(strip.top + strip.height, (h - blockH) / 2);
    this.titlePlate.position.set((w - this.titlePlate.measureSize().w) / 2, y);
    y += titleH + gapA;
    const sliderX = (w - sliderW) / 2;
    this.valuePlate.y = y;
    y += plateH + gapB;
    this.slider.position.set(sliderX, y);
    y += sliderH + gapC;
    this.confirm.position.set((w - btnW) / 2, y);
    this.addChild(this.titlePlate, this.valuePlate, this.slider, this.confirm, this.closeBtn);
    this.sync();
  }

  /** Move the value plate over the thumb (clamped to the slider's ends) and show the current choice. */
  private sync(): void {
    const c = this.opts.choices[this.index];
    this.valuePlate.set(c ? c.label : '');
    const cx = this.slider.x + this.slider.thumbCenterX;
    const x = Math.max(this.slider.x, Math.min(this.slider.x + this.slider.measureSize().w - this.valuePlate.w, cx - this.valuePlate.w / 2));
    this.valuePlate.x = x;
  }

  private step(dir: 1 | -1): void {
    const n = Math.max(0, Math.min(this.opts.choices.length - 1, this.index + dir));
    if (n === this.index) return;
    this.index = n;
    this.slider.setIndex(n);
    this.sync();
  }

  private doConfirm(): void {
    const c = this.opts.choices[this.index];
    if (c) this.opts.onConfirm(c.id);
    this.host.closeLayer();
  }

  fit(): void {
    /* re-laid out on resize */
  }

  onKey(e: KeyboardEvent): boolean {
    switch (e.code) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'Equal':
      case 'NumpadAdd':
        this.step(1);
        return true;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'Minus':
      case 'NumpadSubtract':
        this.step(-1);
        return true;
      case 'Enter':
      case 'Space':
        this.doConfirm();
        return true;
      case 'Escape':
        this.host.closeLayer();
        return true;
      default:
        return false;
    }
  }
}

/** Bet picker — every bet level on the slider; Confirm applies it. */
export function openSBetPicker(host: PixiComponentContext): ShellLayer {
  return new SPicker(host, {
    tag: 'bet-modal',
    title: host.t('Bet'),
    confirmLabel: host.t('Confirm'),
    choices: host.state.availableBets.map((b) => ({ id: String(b), label: host.fmt(b) })),
    selected: String(host.state.bet),
    onConfirm: (id) => host.actions.setBet(Number(id)),
  });
}

const AUTOPLAY_COUNTS = [10, 25, 50, 100, 250, 500, 1000, 2000, Infinity];

function autoplayCounts(maxCount?: number): number[] {
  if (maxCount == null) return AUTOPLAY_COUNTS;
  const capped = AUTOPLAY_COUNTS.filter((n) => Number.isFinite(n) && n <= maxCount);
  if (!capped.includes(maxCount)) capped.push(maxCount);
  return capped;
}

/** Autoplay picker — spin counts (∞ unless maxCount caps them); Start begins autoplay. */
export function openSAutoplayPicker(host: PixiComponentContext): ShellLayer {
  const maxCount = host.config.features.autoplay?.maxCount;
  const counts = autoplayCounts(maxCount);
  return new SPicker(host, {
    tag: 'autoplay-modal',
    title: host.t('Autoplay'),
    confirmLabel: host.t('Start'),
    choices: counts.map((n) => ({ id: String(n), label: Number.isFinite(n) ? String(n) : '∞' })),
    selected: String(host.state.autoplay.remaining || counts[0]),
    onConfirm: (id) => {
      let remaining = Number(id);
      if (maxCount != null) remaining = Math.min(remaining, maxCount);
      host.actions.startAutoplay(remaining);
    },
  });
}
```

(`autoplayCounts` and the confirm handlers are HB's logic, copied unchanged.)

- [ ] **Step 5: GREEN and the gates**

Run: `cd packages/shell && npx vitest run tests/pixi-s/controls.test.ts tests/pixi-s/modals.test.ts tests/pixi-s/no-round.test.ts tests/pixi-s/shell.test.ts`
Expected: PASS. If `no-round.test.ts` opened the bet picker via chips, it still works: the picker is a layer.

Then run the full suite and the typecheck. Expected: green, and exit 0.

- [ ] **Step 6: Commit**

Subject: `S bet / autoplay pickers: a stepped slider with a value plate, no card`

---

### Task 3: Pages — corners; game info — no backing, centred plates, no control sub-headings

**Files:**
- Modify: `packages/shell/src/ui/pixi-s/primitives/page.ts`
- Modify: `packages/shell/src/ui/pixi-s/components/GameInfo.ts`
- Modify: `packages/shell/src/ui/pixi-s/components/BuyBonus.ts` (the title plate and ✕ only)
- Test: `packages/shell/tests/pixi-s/gameinfo.test.ts`, `packages/shell/tests/pixi-s/buybonus.test.ts`

- [ ] **Step 1: Rewrite and add the tests to R1/R2**

In `gameinfo.test.ts`:
- Rewrite "covers the whole screen; title plate at the column left, ✕ at the column right" as:
```ts
  it('R1: title plate top-left corner, ✕ top-right corner (clear of the scrollbar), scroll area the whole screen', () => {
    const p = info([PAYTABLE(3)]);
    const strip = stripMetrics(720);
    expect(p.titlePlate!.x).toBeCloseTo(strip.top, 0);
    expect(p.titlePlate!.y).toBeCloseTo(strip.top, 0);
    expect(p.closeBtn!.x + strip.height).toBeCloseTo(1280 - strip.top - ScrollBox.GUTTER, 0);
    expect([p.scrollContent.x, p.scrollContent.y]).toEqual([0, 0]);
    expect(p.getChildIndex(p.closeBtn!)).toBeGreaterThan(p.getChildIndex(p.scrollContent)); // ✕ above the content
    const col = pageColumn(1280, 720);
    const content = p.scrollContent.content.children[0] as Container;
    expect(content.x).toBeCloseTo((1280 - ScrollBox.GUTTER - col.width) / 2, 0);
    expect(content.y).toBeGreaterThanOrEqual(strip.top + strip.height);
  });
```
- Rewrite "a wins section title plate sits at the column left, like the paytable plate" as "section title plates are centred in the column (wins too)". Assert that each `STitlePlate` under `scrollContent.content` has a global centre x ≈ the column's centre x (±1). Include a wins section, and a cluster with its badge (the plate and the badge together are centred ±1).
- Add:
```ts
  it('R2: no backing panels anywhere in the content', () => {
    const p = info([PAYTABLE(3), { type: 'controls' }, { type: 'modes', modes: [{ title: 'Base', description: 'd' }] }]);
    const bg: unknown[] = [];
    const walk = (n: Container): void => {
      const style = (n as unknown as { bgStyle?: { fill?: string } }).bgStyle;
      if (style?.fill) bg.push(style.fill);
      n.children.forEach((c) => walk(c as Container));
    };
    walk(p.scrollContent.content);
    expect(bg).toEqual([]);
  });

  it('R2: controls has no GAME / MENU & INFO sub-headings', () => {
    const p = info([{ type: 'controls' }]);
    const texts: string[] = [];
    const walk = (n: Container): void => {
      const t = (n as unknown as { text?: string }).text;
      if (typeof t === 'string') texts.push(t);
      n.children.forEach((c) => walk(c as Container));
    };
    walk(p.scrollContent.content);
    expect(texts).not.toContain('GAME');
    expect(texts).not.toContain('MENU & INFO');
    expect(texts).toContain('SPIN');
  });
```
(Imports: `ScrollBox` from `@/ui/pixi-hb/primitives/scroll`, and `stripMetrics`.)

In `buybonus.test.ts`, add:
```ts
  it('R1: the BUY BONUS plate and ✕ sit in the screen corners', () => {
    const { page: p } = page();
    const strip = stripMetrics(720);
    expect(p.titlePlate!.x).toBeCloseTo(strip.top, 0);
    expect((p as unknown as { closeBtn: { x: number } }).closeBtn.x + strip.height).toBeCloseTo(1280 - strip.top - ScrollBox.GUTTER, 0);
  });
```

- [ ] **Step 2: Run and confirm RED**

Run: `cd packages/shell && npx vitest run tests/pixi-s/gameinfo.test.ts tests/pixi-s/buybonus.test.ts`
Expected: FAIL. The plates are still aligned to the column.

- [ ] **Step 3: Implement**

**`page.ts` `resize(w, h)`:**
- `const m = strip.top;`
- Title plate: `new STitlePlate(title, strip.height, w - m * 4 - strip.height - ScrollBox.GUTTER)`, placed at `(m, m)`.
- ✕: `sCloseButton(strip.height, …)`, placed at `(w - m - ScrollBox.GUTTER - strip.height, m)`.
- Scroll box: at `(0, 0)`, with the viewport `setViewport(w, h)` and `this.viewH = h`.
- Content: built at `col.width` and placed at `x = Math.round((w - ScrollBox.GUTTER - col.width) / 2)`, `y = m + strip.height * 1.5`.
- The tail stays below the content.
- Add the plates after the scroll box, so they draw above it.
- Update the class doc comment to R1.

**`GameInfo.ts`:**
- `card()` becomes a plain `FlexBox` with no `background`. Update its doc comment to "a content block — no backing (R2)".
- The paytable card loses its `background`.
- `section()` gets a head with `justify: 'center'`.
- The wins header row gets `justify: 'center'`.
- In `ctlBlock`, delete the `head` FlexBox (the "GAME" / "MENU & INFO" label). Keep the `label` parameter, because the call sites pass it, and prefix it `_label`.

**`BuyBonus.ts` `rebuild()`:**
- The title plate goes to `(m, m)` with `maxW = this.w - m * 4 - strip.height - ScrollBox.GUTTER`.
- ✕ goes to `(this.w - m - ScrollBox.GUTTER - strip.height, m)`, with `m = strip.top`.
- Nothing else changes.

- [ ] **Step 4: GREEN and the gates**

Run: `cd packages/shell && npx vitest run tests/pixi-s/gameinfo.test.ts tests/pixi-s/buybonus.test.ts tests/pixi-s/no-round.test.ts`
Expected: PASS.

Then run the full suite and the typecheck. Expected: green, and exit 0.

- [ ] **Step 5: Commit**

Subject: `S pages: plates in the screen corners; game info without backings, centred section plates`

---

### Task 4: Menu — yellow thumb, rows under SPIN's width, stacked rows; visual check

**Files:**
- Modify: `packages/shell/src/ui/pixi-s/primitives/controls.ts` (`SSlider` thumb colour)
- Modify: `packages/shell/src/ui/pixi-s/components/Menu.ts`
- Test: `packages/shell/tests/pixi-s/menu.test.ts`
- Scratch: the screenshot script in the scratchpad

- [ ] **Step 1: Failing tests**

Add to `menu.test.ts`:
```ts
  it('R5: rows are narrower than SPIN (wide 248, mobile 150)', () => {
    expect(menu().rows.every((r) => (r.hitArea as Rectangle).width < 248)).toBe(true);
    const m = openSMenu(makeContext({ layout: 'mobile', screenW: 390, screenH: 844 }), () => ({ x: 10, y: 600, w: 52, h: 38 }), () => null, () => 1) as SMenu;
    expect(m.rows.every((r) => (r.hitArea as Rectangle).width < 150)).toBe(true);
  });

  it('R5: on mobile a range row stacks its label above the slider, inside the row; rows stack by their own heights', () => {
    const m = openSMenu(makeContext({ layout: 'mobile', screenW: 390, screenH: 844 }), () => ({ x: 10, y: 600, w: 52, h: 38 }), () => null, () => 1) as SMenu;
    const row = m.rows[0];
    const slider = all(row, SSlider)[0];
    const label = row.children.find((c) => (c as { text?: string }).text !== undefined) as Container;
    const hit = row.hitArea as Rectangle;
    expect(slider.y).toBeGreaterThanOrEqual(label.y + label.height);
    expect(slider.x + slider.measureSize().w).toBeLessThanOrEqual(hit.width);
    expect(slider.y + 24).toBeLessThanOrEqual(hit.height);
    expect(m.rows[1].y).toBeGreaterThanOrEqual(row.y + hit.height);
  });

  it('R5: a long toggle label on mobile stacks, the toggle inside the row', () => {
    const host = makeContext({
      layout: 'mobile',
      screenW: 390,
      screenH: 844,
      menu: [{ id: 'lefty', type: 'toggle', label: 'Left-hand mode', value: false }] as never,
    });
    const m = openSMenu(host, () => ({ x: 10, y: 600, w: 52, h: 38 }), () => null, () => 1) as SMenu;
    const row = m.rows[0];
    const toggle = all(row, SToggle)[0];
    const hit = row.hitArea as Rectangle;
    expect(toggle.x + 44).toBeLessThanOrEqual(hit.width);
    expect(toggle.y + 24).toBeLessThanOrEqual(hit.height);
  });
```

Also add to `controls.test.ts`, in the slider test:
```ts
    const thumbFill = (s as unknown as { thumb: Graphics }).thumb.context.instructions[0].data.style.color;
    expect(thumbFill).toBe(Number.parseInt(S.yellow.slice(1), 16));
```
(Import `Graphics` from `pixi.js`. If Pixi stores the colour differently, compare it through `new Color(S.yellow).toNumber()` from `pixi.js`.)

- [ ] **Step 2: Run and confirm RED**

Run: `cd packages/shell && npx vitest run tests/pixi-s/menu.test.ts tests/pixi-s/controls.test.ts`
Expected: FAIL. The rows are 320/370 wide, nothing stacks, and the thumb is fg.

- [ ] **Step 3: Implement**

**`controls.ts` `SSlider.draw()`:** the thumb fill becomes `S.yellow`. Update the doc comment: "a flat 12×24 yellow rect thumb".

**`Menu.ts`:**
- `WIDE_ROW = { w: 236, h: 44 }` and `MOBILE_ROW = { w: 142, h: 40 }`. Comment: "just under SPIN's width (248 / 150), R5".
- `MIN_SLIDER = 90`.
- `buildRow` returns a node whose `hitArea` height is the row's real height:
  - **Range:** if `w - PAD - sliderX < MIN_SLIDER`, stack. The label is at `(PAD, 10)`, scaled to `w - 2*PAD`. The slider is at `(PAD, 10 + label.height + 8)`, `w - 2*PAD` wide. The row is `10 + label.height + 8 + 24 + 10` tall, and the slab is built at that height. Otherwise use the one-line layout from today.
  - **Toggle:** if `label.width > w - 2*PAD - 44 - 8`, stack. The label is at the top, scaled to `w - 2*PAD`. The toggle sits right-aligned below it, at `(w - PAD - 44, 10 + label.height + 8)`. The row height is computed the same way.
  - **Button:** unchanged; one line, with the label scaled to fit.
  - Build the `Slab` after the row height is known.
- `resize()`:
  - stack rows by `y += (row.hitArea as Rectangle).height + GAP`;
  - `stackH` is the sum of the row heights plus the gaps;
  - `stack.hitArea` is `new Rectangle(0, 0, z.w, stackH)`.

- [ ] **Step 4: GREEN and the gates**

Run: `cd packages/shell && npx vitest run tests/pixi-s/menu.test.ts tests/pixi-s/controls.test.ts tests/pixi-s/no-round.test.ts`
Expected: PASS.

Then, from the repo root, run the full suite, the typecheck and the build. Expected: green, and exit 0.

- [ ] **Step 5: Visual check**

The scratchpad is `/private/tmp/claude-501/-Users-mrphelko-Documents-repo-game-engine/968dd56f-f1b3-4442-a728-5f12a6cdbb98/scratchpad`, and `overlays.mjs` already exists there.
1. Copy `ov/` to `ov-r1/`.
2. Rebuild the shell.
3. Start `cd examples/pixi-s-shell-demo && npx vite --port 4331 --strictPort --force` in the background.
4. Run `node <scratchpad>/overlays.mjs`.
5. Stop only your Vite.

Open the images and compare them with R1–R5 and the user's two reference screenshots:
- `/private/tmp/claude-501/-Users-mrphelko-Documents-repo-game-engine/968dd56f-f1b3-4442-a728-5f12a6cdbb98/images/2.png` (game info);
- `…/images/3.png` (the autoplay picker).

Check each of these:
- the game-info plates and ✕ are in the corners, the scrollbar runs along the right edge, the content column is centred, there are no panels, and the section plates are centred;
- the pickers show the centred title, ✕ in the corner, and the value plate over the slider;
- the modals have no panel;
- the menu rows are narrower than SPIN, with a yellow thumb, and stack on the phone.

You may tune only sizes, paddings and font sizes, in at most 2 rounds, and the suite must stay green. List any remaining differences in the report.

- [ ] **Step 6: Commit**

Subject: `S menu: yellow thumb, rows under SPIN's width, labels above controls when a row is narrow`

If you tuned anything in Step 5, commit that first, with the subject `Tune the S overlays (revision 2)`.
