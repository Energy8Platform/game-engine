# Symbols View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Symbols document shows the selected symbol large, in the board's own cell frame on a checkerboard, with zoom, a header, Play and on-screen explanations; its Properties are grouped to what a symbol needs; every SchemaForm labels a field by its YAML key with the description as a hint.

**Architecture:** `reel-core` exports its cell-frame defaults; `scene-edit`'s symbol mode lays out a checkerboard, the frame and the state's view against `app.screen` with a `zoom` rpc call; the IDE's `SymbolsDocument` sizes its canvas iframe to the pane and grows a toolbar and help texts; `SymbolsProperties` filters `COMMON`; `SchemaForm` changes its label rule once for every form.

**Tech Stack:** TypeScript, pixi.js v8, cordis 4, React 18, schemastery, vitest (+ jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-symbols-view-design.md`

## Global Constraints

- `packages/*` is not edited. No `@energy8platform/game-engine` under `engine/`. Every change carries a test in its package.
- `symbols.yml`'s shape does not change.
- `engine/examples/first-slot/*` and `engine/templates/slot-basic/*` copies that are pinned byte-identical stay so (`engine/ide/host/tests/template.test.ts`).
- One workspace per test command (`npm test -w <name>`); `@energy8engine/ide-host` ALONE. Playwright ALONE from `engine/apps/web`: `E8_E2E_HOST_PORT=5779 npx playwright test <files>`.
- After adding a dependency: `npm install` at the root (`package-lock.json` is gitignored).
- `engine/ide/client/src/styles.css`: colours only through `--e8-*` tokens (`tests/styles.test.ts`).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`. Never `git stash`/`checkout`/`restore`. Never kill a process you did not start.

## Review Focus

1. **A pane resized while a symbol shows** (sidebar dragged, window resized, the panel collapsed): the checkerboard covers the new screen and the cell stays centred at its zoom. Pinned in Task 1 (a screen-size change on the next frame re-lays out).
2. **A symbol whose art is much larger or smaller than the cell** (a 512-px PNG, `fit: none`): `fit` zoom is about the CELL, the view obeys the symbol's own `fit` inside it — the frame never resizes to the art. Pinned in Task 1 (a 400×400 view under `fit: none` leaves the frame at cell size).
3. **A composition with no reels row** (`board` absent): the canvas still draws a 96×96 frame with the default style and the symbol in it. Pinned in Task 1.
4. **A field that has no description** in SchemaForm: label = key, no empty hint element, no dangling `aria-describedby`. Pinned in Task 2.
5. **A symbol state's YAML carrying a hidden common prop** (`mask: true`, `pin: top`): editing `scale` in Properties keeps it. Pinned in Task 4.

---

### Task 1: `scene-edit` symbol mode — checkerboard, the board's frame, zoom

**Files:**
- Modify: `engine/game/reel-core/src/grid/SymbolCell.ts` (export the defaults), `engine/game/reel-core/src/index.ts`
- Modify: `engine/game/scene-edit/src/index.ts` (`bootSymbol`), `engine/game/scene-edit/package.json` (depend on `@energy8engine/reel-core: "*"`)
- Test: `engine/game/reel-core/tests/` (the SymbolCell test file — find it with `ls engine/game/reel-core/tests`), `engine/game/scene-edit/tests/plugin.test.ts` (`describe('symbol mode')`)

**Interfaces:**
- Produces:
  - `reel-core`: `export const DEFAULT_CELL_FRAME_STYLE: Readonly<Required<CellFrameStyle>>` (the current `DEFAULT_STYLE`, frozen; `SymbolCell` uses it).
  - `scene-edit` rpc (symbol mode): `zoom({ mode: 'fit' | '1:1' | '2x' }) → { mode }` (an unknown mode → `fit`); `snapshot()` answers `{ symbol, state, w, h, screen: { w: number; h: number }, cell: { width: number; height: number } }` — `screen` is the cell's ON-SCREEN size, `cell` its design size.
  - Stage children labels (for tests): `symbol-checker` (Graphics), `symbol-preview` (Container, as today) holding `symbol-frame` (Graphics, replaces `symbol-outline`) and the view.

- [ ] **Step 1: reel-core export (test first).** In the SymbolCell test file add:

```ts
import { DEFAULT_CELL_FRAME_STYLE, SymbolCell } from '../src';

it('exports its frame defaults and draws its idle frame with them', () => {
  expect(DEFAULT_CELL_FRAME_STYLE.idle).toEqual({ color: 0x223047, alpha: 0.34 });
  expect(DEFAULT_CELL_FRAME_STYLE.radius).toBe(8);
  expect(Object.isFrozen(DEFAULT_CELL_FRAME_STYLE)).toBe(true);
  const cell = new SymbolCell({ size: 96, resolve: () => null as never });
  // the frame is the first child; its tint is the idle colour (`_drawFrame` stores it)
  expect((cell.children[0] as { tint: number }).tint).toBe(0x223047);
});
```

(Read how the file constructs a `SymbolCell` — reuse its resolver fake if `null` is not acceptable.) Then in `SymbolCell.ts` rename `DEFAULT_STYLE` → `export const DEFAULT_CELL_FRAME_STYLE: Readonly<Required<CellFrameStyle>> = Object.freeze({ … })` with the same values, used where `DEFAULT_STYLE` was; export it from `src/index.ts` beside `SymbolCell`. `npm test -w @energy8engine/reel-core` — PASS.

- [ ] **Step 2: scene-edit failing tests** in `plugin.test.ts`'s `describe('symbol mode')`. Extend `bootSymbol` to accept an optional `board` (provided as `ctx.provide('board', board)` when given) and to let a test change `app.screen`. Cases (screen 480×288 unless said):

```ts
it('draws a checkerboard over the whole screen and the default frame at 96×96 with no board', async () => {
  const { symbols } = fakeSymbols();
  const { app, ready } = bootSymbol(symbols);
  await ready();
  const checker = app.stage.getChildByLabel('symbol-checker')!;
  const b = checker.getBounds();
  expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 480, 288]);
  const frame = app.stage.getChildByLabel('symbol-frame', true) as Graphics;
  expect(frame.tint).toBe(0x223047);
});

it('fit: the cell\'s larger side is 60% of the screen\'s smaller side; 1:1 and 2x follow', async () => {
  const { symbols } = fakeSymbols();
  const { call, ready } = bootSymbol(symbols);
  await ready();
  await call('symbol', { id: 'coin', state: 'static' });
  const screenOf = async () => ((await call('snapshot')).result as { screen: { w: number; h: number } }).screen;
  expect((await screenOf()).w).toBeCloseTo(288 * 0.6, 3);           // 96 → 172.8
  expect((await call('zoom', { mode: '1:1' })).result).toEqual({ mode: '1:1' });
  expect((await screenOf()).w).toBeCloseTo(96, 3);
  await call('zoom', { mode: '2x' });
  expect((await screenOf()).w).toBeCloseTo(192, 3);
  expect((await call('zoom', { mode: 'bogus' })).result).toEqual({ mode: 'fit' });
});

it('takes the cell size and the idle frame style from the board', async () => {
  const board = { cellSize: { width: 120, height: 80 }, config: { grid: { frameStyle: { radius: 4, idle: { color: 0x112233, alpha: 0.5 } } } } };
  const { symbols } = fakeSymbols();
  const { app, call, ready } = bootSymbol(symbols, 'coin', board);
  await ready();
  const snap = (await call('snapshot')).result as { cell: { width: number; height: number } };
  expect(snap.cell).toEqual({ width: 120, height: 80 });
  expect((app.stage.getChildByLabel('symbol-frame', true) as Graphics).tint).toBe(0x112233);
});

it('a screen resize re-lays out on the next frame: checker covers it, the cell stays centred', async () => {
  const { symbols } = fakeSymbols();
  const { app, frame, ready } = bootSymbol(symbols);
  await ready();
  app.screen.width = 800; app.screen.height = 600;
  frame();
  const b = app.stage.getChildByLabel('symbol-checker')!.getBounds();
  expect([b.maxX, b.maxY]).toEqual([800, 600]);
  const box = app.stage.getChildByLabel('symbol-preview')!;
  expect([box.position.x, box.position.y]).toEqual([400, 300]);
  expect(box.scale.x).toBeCloseTo((600 * 0.6) / 96, 5);
});

it('the frame is the cell\'s size whatever the art: a large view under fit none does not grow it', async () => {
  const symbols = {
    replace: vi.fn(),
    ready: Promise.resolve(),
    // what `symbols.preview` returns for a `fit: none` symbol with 400×400 art: the view at its own size
    preview: vi.fn(() => {
      const c = new Container();
      c.addChild(new Graphics().rect(-200, -200, 400, 400).fill(0xffffff));
      return c;
    }),
  };
  const { app, call, ready } = bootSymbol(symbols, 'big');
  await ready();
  await call('symbol', { id: 'big', state: 'static' });
  const frame = app.stage.getChildByLabel('symbol-frame', true)!;
  expect(frame.getLocalBounds().width).toBe(96);
  const snap = (await call('snapshot')).result as { screen: { w: number } };
  expect(snap.screen.w).toBeCloseTo(288 * 0.6, 3);   // the zoom is about the cell, not the art
});
```

(`frame()` in this harness calls the first `app.ticker.add` callback — symbol mode must register its re-layout there; if scene mode's ticker is the first, expose symbol mode's as the only one in symbol mode.) Keep the existing symbol-mode tests; adjust those that read `symbol-outline` to `symbol-frame`, and the design-space `w`/`h` in `snapshot` stays as it is.
Run `npm test -w @energy8engine/scene-edit` — FAIL.

- [ ] **Step 3: Implement** in `bootSymbol` (keep its doc accurate):

```ts
type Zoom = 'fit' | '1:1' | '2x';
const ZOOMS: readonly Zoom[] = ['fit', '1:1', '2x'];
const board = ctx.reflect.get('board', false) as
  | { cellSize?: { width: number; height: number }; config?: { grid?: { frameStyle?: CellFrameStyle } } }
  | undefined;
const cellSize = board?.cellSize ?? { width: 96, height: 96 };
const frameStyle = { ...DEFAULT_CELL_FRAME_STYLE, ...(board?.config?.grid?.frameStyle ?? {}) };
let zoom: Zoom = 'fit';

const checker = new Graphics();
checker.label = 'symbol-checker';
const frameG = new Graphics()
  .roundRect(-cellSize.width / 2, -cellSize.height / 2, cellSize.width, cellSize.height, frameStyle.radius)
  .fill({ color: frameStyle.idle.color, alpha: frameStyle.idle.alpha });
frameG.tint = frameStyle.idle.color;   // what SymbolCell stores, read by tests
frameG.label = 'symbol-frame';
previewBox.addChild(frameG);          // replaces the old outline; the view is added after it
app.stage.addChildAt(checker, 0);     // under the preview box

const CHECK = 8;
const drawChecker = (w: number, h: number) => {
  checker.clear();
  checker.rect(0, 0, w, h).fill({ color: 0x2a2f3a });
  for (let y = 0; y < h; y += CHECK)
    for (let x = (y / CHECK) % 2 === 0 ? 0 : CHECK; x < w; x += CHECK * 2)
      checker.rect(x, y, Math.min(CHECK, w - x), Math.min(CHECK, h - y));
  checker.fill({ color: 0x3a4152 });
};
const scaleFor = (w: number, h: number) =>
  zoom === '1:1' ? 1 : zoom === '2x' ? 2
    : (Math.min(w, h) * 0.6) / Math.max(cellSize.width, cellSize.height);
let laidOut = { w: -1, h: -1, zoom: '' as string };
const layout = () => {
  const { width: w, height: h } = app.screen;
  if (laidOut.w === w && laidOut.h === h && laidOut.zoom === zoom) return;
  laidOut = { w, h, zoom };
  drawChecker(w, h);
  previewBox.position.set(w / 2, h / 2);
  previewBox.scale.set(scaleFor(w, h));
};
layout();
app.ticker.add(layout);
ctx.effect(() => () => app.ticker.remove(layout), 'scene-edit:symbol-layout');
wire.handle('zoom', (p) => {
  const mode = (p as { mode?: unknown })?.mode;
  zoom = ZOOMS.includes(mode as Zoom) ? (mode as Zoom) : 'fit';
  layout();
  return { mode: zoom };
});
```

`snapshot` adds `cell: { ...cellSize }` and `screen: { w: cellSize.width * previewBox.scale.x, h: cellSize.height * previewBox.scale.y }`. The previous `previewBox.scale.set(root.getGlobalTransform().a)` goes (the zoom owns the scale now). The disposal effect removes the checker too. Colours in scene-edit are literal hex (it is canvas code, not the IDE stylesheet). Add `"@energy8engine/reel-core": "*"` to `scene-edit`'s dependencies, `npm install` at the root, and import `DEFAULT_CELL_FRAME_STYLE`, `type CellFrameStyle` from it.

- [ ] **Step 4:** `npm test -w @energy8engine/scene-edit`, `npm test -w @energy8engine/reel-core`, typecheck both — PASS / 0. `find engine -path '*/node_modules/@energy8engine/reel-core' -type d` prints nothing (no nested copy).
- [ ] **Step 5: Commit** — `Canvas: a symbol sits large in the board's own cell frame on a checkerboard, zoomable`.

---

### Task 2: SchemaForm labels a field by its key; the description is a hint

**Files:**
- Modify: `engine/ide/client/src/schema-form/fields.tsx` (`label`, `ObjectFields`, `Field`'s controls)
- Modify: `engine/ide/client/src/styles.css` (`.e8-field-hint`)
- Modify: every unit test in `engine/ide/client/tests/` and `engine/apps/web/tests/` that finds a field by its description text (grep `getByLabelText(` / `getByLabel(`), and the six e2e lookups: `media.spec.ts:121,124`, `scenes.spec.ts:148`, `runtime.spec.ts:192,193,307`, `reel-step.spec.ts:149`, `skeleton.spec.ts:51`, `symbols.spec.ts:204` (line numbers at planning time — grep)
- Test: `engine/ide/client/tests/schema-form.test.tsx`

**Interfaces:**
- Produces: `label(node, key)` returns `key`; `hint(node): string | undefined` returns the description; a field with a description renders `<p className="e8-field-hint" id={`${id}-hint`}>` after its control, and the control (or the `<fieldset>` for a group) carries `aria-describedby={`${id}-hint`}`; a field without one renders neither.

- [ ] **Step 1: Failing tests** in `schema-form.test.tsx`:

```tsx
it('labels a field by its key and shows the description as a hint tied to the control', () => {
  const schema = toJSON(Schema.object({ cellSize: Schema.number().default(96).description('Square cell size.') }));
  render(<SchemaForm rowId="r" schema={schema} value={{}} onChange={() => {}} />);
  const input = screen.getByLabelText('cellSize');
  expect(input).toHaveAccessibleDescription('Square cell size.');
  expect(screen.getByText('Square cell size.')).toHaveClass('e8-field-hint');
});

it('a field with no description has no hint and no aria-describedby', () => {
  const schema = toJSON(Schema.object({ gap: Schema.number().default(6) }));
  render(<SchemaForm rowId="r" schema={schema} value={{}} onChange={() => {}} />);
  const input = screen.getByLabelText('gap');
  expect(input).not.toHaveAttribute('aria-describedby');
  expect(document.querySelector('.e8-field-hint')).toBeNull();
});

it('a group field puts its key on the legend and its description as the group hint', () => {
  const schema = toJSON(Schema.object({ win: Schema.object({ glow: Schema.boolean().default(true) }).description('win highlight') }));
  render(<SchemaForm rowId="r" schema={schema} value={{}} onChange={() => {}} />);
  const group = screen.getByRole('group', { name: 'win' });
  expect(group).toHaveAccessibleDescription('win highlight');
});
```

(Use the file's own schema-to-JSON helper and render idiom — read it first; the names above are placeholders for them.) Run `npm test -w @energy8engine/ide-client` — the new cases FAIL, and existing ones that look fields up by description FAIL too: list them in the report.

- [ ] **Step 2: Implement.** `label` returns `key`; add `export function hint(node: SchemaNode): string | undefined { return node.meta?.description || undefined; }`. In `ObjectFields`, compute `const described = hint(child) ? `${id}-hint` : undefined;`, pass `describedBy={described}` to `Field` and put `aria-describedby={described}` on the `<fieldset>` of a group; render `{described ? <p className="e8-field-hint" id={described}>{hint(child)}</p> : null}` after the control. `Field` gains `describedBy?: string` and applies `aria-describedby={describedBy}` on each leaf control it renders (inputs, selects, the checkbox, the textarea/JSON fallback — every element that gets `id={id}`). Update `label`'s doc. CSS: `.e8-field-hint { margin: 2px 0 0; color: var(--e8-fg-muted); font-size: var(--e8-size-label); line-height: 1.35; }` (existing tokens only).
- [ ] **Step 3: Move the lookups.** Every unit test and e2e lookup that found a field by its description now finds it by its key, `exact: true` where the key is a substring of another label (`getByLabel('mechanic', { exact: true })`, `getByLabel('x', { exact: true })`). Keep each assertion's meaning.
- [ ] **Step 4:** `ide-client`, `ide-web` tests + typecheck — PASS / 0. Playwright ALONE: `media.spec.ts scenes.spec.ts runtime.spec.ts reel-step.spec.ts skeleton.spec.ts symbols.spec.ts` — PASS.
- [ ] **Step 5: Commit** — `Forms: a field is labelled by its key; its description is a hint under it`.

---

### Task 3: `SymbolsDocument` — the canvas fills its pane; toolbar, header, help

**Files:**
- Modify: `engine/ide/client/src/shell/SymbolsDocument.tsx`
- Modify: `engine/ide/client/src/styles.css`
- Test: `engine/ide/client/tests/symbols-document.test.tsx` (read `symbols-harness.tsx` first)

**Interfaces:**
- Consumes: Task 1's `zoom` rpc and `snapshot().cell`.
- Produces: test ids `symbols-toolbar`, `symbols-header`, `symbols-cell-size`, `symbols-zoom-fit`, `symbols-zoom-1:1`, `symbols-zoom-2x` (buttons, `aria-pressed`), `symbol-replay` (kept, now labelled `▶ Play`), `symbols-help` (the explanation), `symbols-state-empty` (the empty-state line); `localStorage['e8.symbols-zoom']`.

- [ ] **Step 1: Failing tests:**
  - the iframe has no `width`/`height` attributes and no `transform` style; its wrapper fills the canvas pane (class `e8-symbols-stage`); `FALLBACK_DESIGN`/`FIT_PAD` and the `ResizeObserver` fit are gone;
  - nothing selected → `symbols-help` visible and contains `static`, `idle`, `win`, and "drop a file"; with no doc (`doc === null`) it also says the first add creates `symbols.yml`; `symbols-header` absent;
  - select `{ id: '3', state: 'static' }` (def name `sym-3`) → `symbols-header` reads `3 · sym-3 · static`; a def with no name → `3 · static`;
  - selecting a state the def has not got (`win` on a def with no `win`) → `symbols-state-empty` reads `no win yet — drop a file on the chip, or Create in Properties`;
  - the canvas answers `snapshot` with `cell: { width: 96, height: 96 }` → `symbols-cell-size` reads `cell 96×96` (drive the harness's fake canvas; read how the existing tests fake rpc answers);
  - clicking `symbols-zoom-2x` sends `zoom { mode: '2x' }`, marks it `aria-pressed="true"`, writes `'2x'` to `localStorage['e8.symbols-zoom']`; a remount starts on `2x` and sends it after the canvas's `ready`; junk in storage → `fit`; a throwing storage → `fit`;
  - `symbol-replay` reads `▶ Play` and sends `symbol` with the selection (existing behaviour).
- [ ] **Step 2: Implement.** Remove the design-fit machinery. The canvas column becomes: `div.e8-symbols-toolbar` (header left; right: `cell W×H`, the three zoom buttons as a segmented group with `role="group"` and `aria-label="zoom"`, `▶ Play`), then `div.e8-symbols-stage` with the iframe at `width: 100%; height: 100%` (CSS, no attributes) — or, when nothing is selected, the help panel OVER the stage (the iframe stays mounted underneath so the canvas is warm; the help panel is an absolutely positioned layer). After every `ready` the document sends, in order: `replaceSymbols` (as today), `zoom` (the remembered mode), `symbol` (when selected), then asks `snapshot` once to fill `cell W×H` (re-ask after a `replaceSymbols`, since a board change can change the cell). Help text (write it plainly; keep it short):

> **Symbols** — how each symbol a reel shows looks. A reel's board carries symbol ids; each id here gets a picture per state:
> - **static** — at rest (required);
> - **idle** — an optional looping look at rest;
> - **win** — plays when the symbol is in a win;
> - **named states** — played by a mechanic's plan steps (`+` on a row adds one).
>
> Drop a file from the Explorer onto a state chip, onto a row (its static), or below the list (a new symbol). Pick a symbol on the left to see it here.

With no doc, one more line: "There is no symbols.yml yet — the first symbol you add creates it." CSS: the stage and help use existing tokens; the toolbar is one row that wraps; the old `.e8-symbols-replay` absolute placement goes.
- [ ] **Step 3:** `ide-client` tests + typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Symbols: the canvas fills its pane under a toolbar — the symbol's name, its cell, zoom, Play — and says what a symbol is`.

---

### Task 4: `SymbolsProperties` — Symbol, State, Adjust

**Files:**
- Modify: `engine/ide/client/src/shell/SymbolsProperties.tsx`
- Test: `engine/ide/client/tests/symbols-properties.test.tsx`

**Interfaces:**
- Consumes: `mergedSchema` / `COMMON_JSON` from `PropertiesSidebar.tsx` (read how they are built).
- Produces: three sections with test ids `symbol-props-symbol`, `symbol-props-state`, `symbol-props-adjust`, each with a heading (`Symbol`, `State <state>`, `Adjust`).

- [ ] **Step 1: Failing tests:**
  - with `{ id: '1', state: 'static' }` selected on an `image` state: `symbol-props-symbol` holds a read-only `id` (value `1`), `name`, `fit` (select `contain`/`none`, with the hint `contain: scaled into the cell · none: centred at its own size`); `symbol-props-state` holds the type select and the image's own `src` (and no common prop); `symbol-props-adjust` holds exactly `x`, `y`, `scale`, `rotation`, `alpha`, `tint` — and no `width`, `height`, `visible`, `anchor`, `anchorX`, `anchorY`, `mask`, `pin` anywhere in the panel;
  - a state whose YAML props carry `mask: true` and `pin: 'top'`: changing `scale` to `2` writes props that still carry `mask: true` and `pin: 'top'` (read the written doc from the fake `update`);
  - changing `src` writes only that prop's change (the others kept);
  - a named state still shows `Remove state`; an absent state still shows `Create <state>`.
- [ ] **Step 2: Implement.** Build two schemas from the merged one: `own` = the type's own dict (`info.schema`), `adjust` = `COMMON` restricted to `['x', 'y', 'scale', 'rotation', 'alpha', 'tint']`. Render the `State` section's `SchemaForm` over `own` and the `Adjust` section's over `adjust`, each handed the WHOLE `props` object as `value` and writing back `{ ...props, ...next }` — so keys neither form shows (the hidden common props) survive every write. The `Symbol` section keeps `name` (blur commits) and `fit` as today, plus the read-only `id` and the `fit` hint. Keep the reducer-through-`ctx.symbols.update` rule and the type-change rule (keep the props the new schema also has — now: the new type's own keys plus every common key). Update the component doc.
- [ ] **Step 3:** `ide-client` tests + typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Symbols: Properties in three groups — the symbol, its state's own fields, and the adjustments a symbol can use`.

---

### Task 5: e2e — the symbol, large, in the IDE

**Files:**
- Modify: `engine/apps/web/tests/e2e/symbols.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`snapshot().screen`, the toolbar test ids, `symbols-help`).

- [ ] **Step 1:** Add, in the spec's own setup style (read its helpers — `readyCanvas`, `snapshot`):
  - open `#/doc/symbols` with nothing selected → `symbols-help` visible;
  - click row `1` → at `fit`, `snapshot().screen.w` ≥ 0.4 × min(the canvas iframe's client width, height) (read the iframe's `boundingBox()`); the iframe fills the stage (its box ≈ the stage's box);
  - `symbols-zoom-1:1` → `screen.w` = 96 (±1); `symbols-zoom-2x` → 192 (±1); a reload keeps `2x`;
  - select chip `1`/`win` (a spritesheet in first-slot) and click `▶ Play` → `__e8edit.frameOf('symbol')` advances (poll for a frame > the first read), as the existing win case does;
  - `symbols-cell-size` reads `cell 96×96`.
- [ ] **Step 2:** Run `E8_E2E_HOST_PORT=5779 npx playwright test tests/e2e/symbols.spec.ts` ALONE — PASS.
- [ ] **Step 3: Commit** — `E2E: the Symbols canvas shows a symbol large, zooms to 1:1 and 2x, plays a win, explains itself`.

---

## After the tasks

Unit gate (each alone): `reel-core`, `scene-edit`, `symbols`, `ide-client`, `ide-web`, `ide-host` (ALONE); typecheck each. Full Playwright ALONE: `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test`.
