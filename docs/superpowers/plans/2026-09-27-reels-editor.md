# Reels Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Reels document — the sections of every reel row beside a reel-lab canvas showing the project's own board with Spin / Spin → scatters / Win / Tumble — plus SchemaForm widgets (colour, one-or-per-reel, literal-or-value) and "changed + reset" for composition forms.

**Architecture:** SchemaForm learns three union/role shapes and an opt-in `resettable` mode, a `root` (render one object key flattened) and `fieldOverrides` by path; `scene-edit` gets a `reels` mode that mounts the live board on a checkerboard, re-applies rows through `gameRows.update` and runs synthetic board steps; the IDE's Reels document composes sections over the rows' schemas, two Reels-only editors (symbol chips, board painter) and the canvas.

**Tech Stack:** TypeScript, React 18, cordis 4, schemastery, pixi.js v8, vitest (+ jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-reels-editor-design.md`

## Global Constraints

- `packages/*` is not edited. No `@energy8platform/game-engine` under `engine/`. Every change carries a test in its package.
- The rows' YAML shapes do not change (a colour stays a number `0xRRGGBB`).
- `engine/examples/first-slot/src/editor.ts` and `engine/templates/slot-basic/src/editor.ts` stay byte-identical (check with `cmp`; `engine/ide/host/tests/template.test.ts` pins the template files).
- One workspace per test command (`npm test -w <name>`); `@energy8engine/ide-host` ALONE. Playwright ALONE from `engine/apps/web`: `E8_E2E_HOST_PORT=5779 npx playwright test <files>`.
- `engine/ide/client/src/styles.css`: colours only through `--e8-*` tokens (`tests/styles.test.ts`).
- NEVER `git stash`/`checkout`/`restore`. To look at the pre-change file: `git show HEAD:<path> > <scratch file>`. Never kill a process you did not start.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.

## Review Focus

1. **A user value SchemaForm cannot classify** under the new widgets (a `colGap: [6]` list on a 5-reel grid, `topReel: {}` with no `size`, a `null` where the schema says `number | number[]`): the widget shows what is there and never rewrites it on render. Pinned in Task 1 (render-only tests assert no `onChange`).
2. **Reset on a key the row got from a bundle, not the patch**: `row.config` is the patch's own object; a key absent there has no marker and no reset, even if its value differs from the schema default. Pinned in Task 2.
3. **A hot `reels1` re-apply while a lab action runs**: the old board is disposed mid-tween; the mode drops the old board, mounts the new one, and the action's answer is `{ ok: false, reason: 'board replaced' }` rather than a thrown rpc. Pinned in Task 4.
4. **A project with no symbols (no `symbols.yml`, no spec ids)**: lab actions answer `{ ok: false, reason: 'no symbols' }`, the buttons show it. Pinned in Tasks 4 and 5.
5. **A saved `board` whose shape no longer fits the grid** (cols changed after painting): the painter shows it as saved, says so, and `fit to grid` truncates/pads — never silently rewrites on render. Pinned in Task 6.

---

### Task 1: SchemaForm — colour, one-or-per-reel, literal-or-value

**Files:**
- Modify: `engine/ide/client/src/schema-form/fields.tsx` (`Field`'s dispatch; new `ColorField`, `OneOrListField`, `LiteralOrValueField`; `SchemaNode.meta.role`)
- Modify: `engine/ide/client/src/styles.css`
- Modify: `engine/game/reels/src/schema.ts` (`FrameState.color` → `.role('color')`), `engine/game/reels-features/src/schema.ts` (`ringColor`, `labelColor`, `totalColor` → `.role('color')`)
- Test: `engine/ide/client/tests/schema-form.test.tsx`, the reels and reels-features schema tests (must stay green; add one assertion each that the colour fields carry `meta.role === 'color'` in `JSON.parse(JSON.stringify(Config))`)

**Interfaces:**
- Produces (in `fields.tsx`): the dispatch order in `Field` becomes: object → dict(string) → array → dict → **union shapes (below)** → string-literal select → **number with `meta.role === 'color'`** → number → boolean → string → unsupported. Union shapes, decided on the node's `list` (members resolved):
  - `oneOrList(node)`: exactly two members, one `type: 'number'` and one `type: 'array'` whose `inner.type === 'number'` → `OneOrListField`;
  - `literalOrValue(node)`: exactly two members, one `type: 'const'` (value `null` or a string) and the other not `const` → `LiteralOrValueField`;
  - an all-string-literal union stays the existing `<select>` (checked first).
- Test ids / labels: `ColorField` renders `<input type="color" id={id}>` and `<input type="text" aria-label="hex" id={`${id}-hex`}>`; `OneOrListField` renders a `role="radiogroup"` with radios `one` / `per reel` and either one number input (`id={id}`) or inputs `${id}-0`, `${id}-1`, … plus buttons `+` / `−`; `LiteralOrValueField` renders a checkbox (`id={id}`) labelled by the literal's name: for `null` → checked = "on" (value present), for a string literal → a radiogroup `<literal> | these` — see Step 3.

- [ ] **Step 1: Failing tests** in `schema-form.test.tsx` (use the file's own render/schema helpers; `S` = schemastery):

```tsx
it('a colour role renders a picker and hex text that read and write the number', () => {
  const onChange = vi.fn();
  renderForm(S.object({ color: S.number().role('color').default(0x223047) }), { color: 0x112233 }, onChange);
  expect(screen.getByLabelText('color')).toHaveValue('#112233');
  const hex = screen.getByRole('textbox', { name: 'hex' });
  fireEvent.change(hex, { target: { value: '#ff0000' } });
  fireEvent.blur(hex);
  expect(onChange).toHaveBeenLastCalledWith({ color: 0xff0000 });
  fireEvent.input(screen.getByLabelText('color'), { target: { value: '#00ff00' } });
  expect(onChange).toHaveBeenLastCalledWith({ color: 0x00ff00 });
});

it('an invalid hex is refused in the field, not written', () => {
  const onChange = vi.fn();
  renderForm(S.object({ color: S.number().role('color') }), { color: 1 }, onChange);
  const hex = screen.getByRole('textbox', { name: 'hex' });
  fireEvent.change(hex, { target: { value: 'nope' } });
  fireEvent.blur(hex);
  expect(onChange).not.toHaveBeenCalled();
  expect(hex).toHaveAttribute('aria-invalid', 'true');
});

it('number | number[] is a one / per reel switch; switching converts', () => {
  const onChange = vi.fn();
  renderForm(S.object({ colGap: S.union([S.number(), S.array(S.number())]) }), { colGap: 6 }, onChange);
  expect(screen.getByRole('radio', { name: 'one' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'per reel' }));
  expect(onChange).toHaveBeenLastCalledWith({ colGap: [6] });
});

it('a list value shows one input per entry; + appends the last value, − drops the last', () => {
  const onChange = vi.fn();
  renderForm(S.object({ colGap: S.union([S.number(), S.array(S.number())]) }), { colGap: [4, 8] }, onChange);
  expect(screen.getByRole('radio', { name: 'per reel' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '+' }));
  expect(onChange).toHaveBeenLastCalledWith({ colGap: [4, 8, 8] });
  fireEvent.click(screen.getByRole('button', { name: '−' }));
  expect(onChange).toHaveBeenLastCalledWith({ colGap: [4] });
});

it('null | object is an on switch with the object\'s fields; off writes null', () => {
  const onChange = vi.fn();
  const schema = S.object({ topReel: S.union([S.object({ size: S.natural().default(4) }), S.const(null)]).default(null) });
  renderForm(schema, { topReel: { size: 4 } }, onChange);
  expect(screen.getByRole('checkbox', { name: 'topReel' })).toBeChecked();
  expect(screen.getByLabelText('size')).toHaveValue(4);
  fireEvent.click(screen.getByRole('checkbox', { name: 'topReel' }));
  expect(onChange).toHaveBeenLastCalledWith({ topReel: null });
});

it('turning a null | object on writes the object\'s defaults', () => {
  const onChange = vi.fn();
  const schema = S.object({ topReel: S.union([S.object({ size: S.natural().default(4) }), S.const(null)]).default(null) });
  renderForm(schema, {}, onChange);
  fireEvent.click(screen.getByRole('checkbox', { name: 'topReel' }));
  expect(onChange).toHaveBeenLastCalledWith({ topReel: { size: 4 } });
});

it("'trailing' | number[] is a trailing / these switch", () => {
  const onChange = vi.fn();
  const schema = S.object({ reels: S.union([S.const('trailing'), S.array(S.natural())]).default('trailing') });
  renderForm(schema, {}, onChange);
  expect(screen.getByRole('radio', { name: 'trailing' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'these' }));
  expect(onChange).toHaveBeenLastCalledWith({ reels: [] });
});

it('rendering never writes: odd values stay as they are until the user acts', () => {
  const onChange = vi.fn();
  renderForm(
    S.object({
      colGap: S.union([S.number(), S.array(S.number())]),
      topReel: S.union([S.object({ size: S.natural() }), S.const(null)]),
    }),
    { colGap: [6], topReel: {} },
    onChange,
  );
  expect(onChange).not.toHaveBeenCalled();
});

it('a union none of the shapes covers is still unsupported', () => {
  renderForm(S.object({ odd: S.union([S.number(), S.string(), S.boolean()]) }), {}, vi.fn());
  expect(screen.getByText(/unsupported \(union\)/)).toBeInTheDocument();
});
```

Run `npm test -w @energy8engine/ide-client` — FAIL.

- [ ] **Step 2: Colour.** `SchemaNode.meta` gains `role?: string`. `ColorField`: `const hex = '#' + (Number(value ?? node.meta?.default ?? 0) >>> 0).toString(16).padStart(6, '0').slice(-6)`; the picker `onInput`/`onChange` writes `parseInt(v.slice(1), 16)` at once (a click is one commit, as a select); the text field uses the file's `useDraft` pattern (commit on blur/Enter), accepts `/^#?[0-9a-f]{6}$/i`, refuses otherwise with `aria-invalid="true"`. Both carry `aria-describedby={describedBy}`; the picker gets `id={id}` (so the field's `<label htmlFor>` names it).
- [ ] **Step 3: The two union widgets.**
  - `OneOrListField`: mode = `Array.isArray(current) ? 'list' : 'one'` (where `current = value ?? node.meta?.default`); `one` → switching to `per reel` writes `[n]` (n = the number, or `0` when none); `per reel` → switching to `one` writes `list[0] ?? 0`. In `per reel` each entry is a number input committing the whole array with that entry replaced; `+` appends the last entry (or `0`); `−` drops the last (disabled at length 0).
  - `LiteralOrValueField`: `literal` = the `const` member's value, `other` = the other member. With `literal === null`: a checkbox `id={id}` (so the field's label names it), checked when `current !== null && current !== undefined`; unchecking writes `null`; checking writes `defaults(other)` (the file already has `defaults(node)` — reuse it; for an array it is `[]`); when checked, render `<Field node={other} … />` for the value below it (id `${id}-value`). With a string `literal`: a radiogroup `<literal> | these` (radios labelled by the literal and `these`); `these` writes `defaults(other)`, the literal radio writes the literal; the member's editor shows only in `these`.
  - Both render only; no effect writes on mount.
- [ ] **Step 4: Schemas.** `reels/src/schema.ts`: `FrameState.color: Schema.number().role('color').description('frame colour, 0xRRGGBB')`. `reels-features/src/schema.ts`: add `.role('color')` to `ringColor` (every occurrence), `labelColor`, `totalColor` (keep defaults/descriptions). Add the role assertions to the two schema tests. Run `npm test -w @energy8engine/reels`, `npm test -w @energy8engine/reels-features`.
- [ ] **Step 5: CSS** for the new widgets (token colours only): the colour picker and hex text on one row; the radiogroup as a compact segmented row; list inputs wrap. Run `ide-client` tests + typecheck — PASS / 0; `npm test -w @energy8engine/ide-host` ALONE (it reads row schemas) — PASS.
- [ ] **Step 6: Commit** — `Forms: a colour, one value or one per reel, and a literal or a value — each drawn, none unsupported`.

---

### Task 2: SchemaForm — changed and reset; a root key; field overrides

**Files:**
- Modify: `engine/ide/client/src/schema-form/SchemaForm.tsx`, `engine/ide/client/src/schema-form/fields.tsx`
- Modify: `engine/ide/client/src/screens/CompositionScreen.tsx` (`GameComposition` passes `resettable`)
- Modify: `engine/ide/client/src/styles.css`
- Test: `engine/ide/client/tests/schema-form.test.tsx`, `engine/ide/client/tests/composition-screen.test.tsx`

**Interfaces:**
- Produces (SchemaForm props, all optional):
  - `resettable?: boolean` — a field whose key is present (`Object.hasOwn`) in its parent object value shows a marker `<span className="e8-field-set" aria-label="set in the patch">●</span>` after its label and a button `reset` (`aria-label={`reset ${key}`}`) that writes the parent object without that key; a nested object/dict/array field's legend gets the same marker and `reset section` (`aria-label={`reset section ${key}`}`). When the schema default differs from the set value and is a primitive, the hint gains ` · default <value>` (a colour default printed `#rrggbb`).
  - `root?: string` — render only the object at this top-level key, its fields directly (no legend for `root` itself); `onChange` still receives the WHOLE value (`{ ...value, [root]: next }`); a missing `root` object reads as `{}`.
  - `fieldOverrides?: Record<string, (props: FieldProps) => JSX.Element>` — keyed by the dotted path from the form's value root (`win.frameShake.onlyOnSymbols`, `board`); `Field` uses the override for a NON-union node at that path (so a literal-or-value union still draws its switch and the override draws the value member).
  - `FieldProps` gains `path: string` (dotted, from the value root).

- [ ] **Step 1: Failing tests:**
  - `resettable`: `{ grid: { cols: 6 } }` over a schema with `grid.cols` (default 5) and `grid.rows` (default 3) → `cols` has the marker and `reset cols`, `rows` has neither; clicking `reset cols` calls `onChange({ grid: {} })`; the `grid` legend has `reset section grid`, which calls `onChange({})`; the `cols` hint contains `default 5`;
  - without `resettable`: no marker, no reset buttons;
  - `root: 'grid'`: only grid's fields render, no `grid` legend; editing `cols` calls `onChange({ grid: { cols: 7 }, win: { glow: true } })` when the value was `{ grid: { cols: 6 }, win: { glow: true } }`;
  - `fieldOverrides: { 'win.frameShake.onlyOnSymbols': Fake }` over `onlyOnSymbols: null | string[]`: the literal-or-value switch renders; turned on, `Fake` receives `path === 'win.frameShake.onlyOnSymbols'` and the array value;
  - `composition-screen.test`: a game row with `config: { grid: { cols: 6 } }` shows `reset cols` on the Composition screen.
- [ ] **Step 2: Implement.** Thread `path` through `ObjectFields` → `Field` → nested fields (array items `${path}.${i}`, dict entries `${path}.${key}`); `ObjectFields` knows its value object, so `Object.hasOwn(value, key)` decides the marker when `resettable` (read from a React context `FormOptions` set by `SchemaForm`, like `Pickers`). `root` is handled in `SchemaForm` (render `ObjectFields` over `node.dict[root]` with `value[root] ?? {}` and wrap `onChange`). `GameComposition`'s `SchemaForm` gets `resettable`. CSS: the marker in `--e8-accent`, the reset button a small ghost button on the label row (no layout shift for rows without one).
- [ ] **Step 3:** `ide-client`, `ide-web` tests + typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Forms: a value set in the patch is marked and can be reset; a form can draw one key of its value, and a field can be drawn by its owner`.

---

### Task 3: `scene-edit` reels mode — the live board on the canvas, rows re-applied

**Files:**
- Modify: `engine/game/scene-edit/src/index.ts` (`SceneEditConfig.reels?: boolean`, `bootReels`; symbol mode reads the board per layout)
- Modify: `engine/examples/first-slot/src/editor.ts`, then `cp` to `engine/templates/slot-basic/src/editor.ts`
- Test: `engine/game/scene-edit/tests/plugin.test.ts` (new `describe('reels mode')`; symbol mode cases)

**Interfaces:**
- Consumes: `board` service (`view: Container`, `cellSize`, `config: { grid: { cols, rows, rowsPerReel?, frameStyle? } }`, `spinTo`, `revealWins`, `tumble`, …); `gameRows.update(id, config): Promise<'updated' | 'unknown' | 'failed'>`.
- Produces: `editor.html?reels=` → `sceneEdit` with `reels: true`; rpc in reels mode: `rows({ rows: { id: string; config: Record<string, unknown> }[] }) → { results: { id: string; result: 'updated' | 'unknown' | 'failed' }[] }`; `snapshot() → { mode: 'reels', cols: number, rows: number[], fitted: { w: number, h: number }, busy: boolean }` (`rows` = per-reel heights; `fitted` = the board's on-screen size); event `ready` `{ reels: true }`; stage labels `reels-checker`, `reels-box` (holds `board.view`).

- [ ] **Step 1: editor.ts.** Add `reels: params.has('reels'),` to the `sceneEdit` config (next to `symbol`), with a one-line comment; `cp` to the template; `cmp` them.
- [ ] **Step 2: Failing tests** (`plugin.test.ts`, a `bootReels(board, gameRows?)` harness modelled on `bootSymbol`; a fake board: `{ view: new Container() with a 500×300 Graphics child, cellSize, config: { grid: { cols: 5, rows: 3 } }, spinTo: vi.fn(async () => {}), revealWins: vi.fn(async () => {}), tumble: vi.fn(async () => {}) }`, provided as `board`):
  - `ready` emits `{ reels: true }`; `reels-box` contains `board.view`; the scenes root is hidden; `reels-checker` covers the screen;
  - on 480×288, the board is scaled to fit with a 24-px margin: `snapshot().fitted.w` ≈ `min((480-48)/500, (288-48)/300) * 500`, centred;
  - a new board provided (dispose the first provider, provide a second fake) → the box holds the NEW view, the old one is removed from the box (not destroyed by the mode — its owner destroys it);
  - `rows({ rows: [{ id: 'reels1', config: { grid: { cols: 6 } } }] })` calls `gameRows.update('reels1', { grid: { cols: 6 } })` and answers `{ results: [{ id: 'reels1', result: 'updated' }] }`; no `gameRows` → each result is `'unknown'`;
  - a screen resize re-fits on the next frame;
  - symbol mode (existing harness): providing a board AFTER boot with `cellSize: { width: 120, height: 120 }` changes `snapshot().cell` to 120×120 on the next frame, and the frame redraws (its local bounds 120 wide) — slice 40's debt.
- [ ] **Step 3: Implement `bootReels`** beside `bootSymbol` (same checkerboard helper — extract it from `bootSymbol` into a function both use; same `scenes.container` hiding; same ticker-driven layout with the size memo):

```ts
function bootReels(): void {
  const root = scenes.container;
  root.visible = false;
  const checker = makeChecker();              // extracted from bootSymbol; label 'reels-checker'
  const box = new Container();
  box.label = 'reels-box';
  app.stage.addChild(checker.graphics, box);
  let mounted: Container | null = null;
  const currentBoard = () => ctx.reflect.get('board', false) as ReelsBoardLike | undefined;
  const MARGIN = 24;
  let laid = { w: -1, h: -1, view: null as Container | null, bw: -1, bh: -1 };
  const layout = () => {
    const board = currentBoard();
    const view = board?.view ?? null;
    if (view !== mounted) {
      if (mounted && mounted.parent === box) box.removeChild(mounted);
      mounted = view;
      if (view) box.addChild(view);
    }
    const { width: w, height: h } = app.screen;
    checker.resize(w, h);                     // redraws only on a size change
    if (!view) return;
    const b = view.getLocalBounds();
    if (laid.w === w && laid.h === h && laid.view === view && laid.bw === b.width && laid.bh === b.height) return;
    laid = { w, h, view, bw: b.width, bh: b.height };
    const s = Math.min((w - 2 * MARGIN) / b.width, (h - 2 * MARGIN) / b.height);
    box.scale.set(s);
    box.position.set(w / 2 - (b.x + b.width / 2) * s, h / 2 - (b.y + b.height / 2) * s);
  };
  layout();
  app.ticker.add(layout);
  ctx.effect(() => () => { app.ticker.remove(layout); if (mounted?.parent === box) box.removeChild(mounted); box.destroy(); checker.destroy(); root.visible = true; }, 'scene-edit:reels');
  wire.handle('rows', async (p) => { /* per row: gameRows?.update → result, 'unknown' without gameRows */ });
  wire.handle('snapshot', () => {
    const grid = currentBoard()?.config?.grid;
    const cols = grid?.cols ?? 0;
    const rows = grid?.rowsPerReel ?? Array.from({ length: cols }, () => grid?.rows ?? 0);
    return { mode: 'reels', cols, rows, fitted: { w: laid.bw * box.scale.x, h: laid.bh * box.scale.y }, busy: false };
  });
  emit('ready', { reels: true });
}
```

(`cols`/`rows` from `board.config.grid`: `rowsPerReel ?? Array(cols).fill(rows)`; `busy` belongs to Task 4 — `false` here.) Dispatch in the plugin's apply: `config.reels === true` → `bootReels()` (checked before `symbol`). Symbol mode: read `cellSize`/`frameStyle` off the current board inside `layout()`, redraw the frame when either changed (keep slice 40's memo split). Keep every doc comment accurate.
- [ ] **Step 4:** `scene-edit` tests + typecheck; `ide-host` ALONE (template pin) — PASS / 0.
- [ ] **Step 5: Commit** — `Canvas: a reels mode shows the project's board on its own, fitted, following a rebuilt board and re-applying rows it is handed`.

---

### Task 4: `scene-edit` lab actions — Spin, Spin → scatters, Win, Tumble

**Files:**
- Create: `engine/game/scene-edit/src/lab.ts` (pure: boards and steps from a grid shape, symbols and a random source)
- Modify: `engine/game/scene-edit/src/index.ts` (rpc handlers in `bootReels`)
- Test: `engine/game/scene-edit/tests/lab.test.ts` (new), `engine/game/scene-edit/tests/plugin.test.ts`

**Interfaces:**
- Produces (`lab.ts`):

```ts
export type Rand = () => number;           // [0, 1)
export interface Shape { cols: number; rows: number[] }   // per-reel heights
export function randomBoard(shape: Shape, symbols: readonly string[], rand: Rand): string[][];
/** The first `threshold` reels each get one trigger symbol at a random row; the rest random. */
export function scatterBoard(shape: Shape, symbols: readonly string[], triggers: readonly string[], threshold: number, rand: Rand): string[][];
/** One full-width line at a random row present on every reel (the smallest reel's height bounds it). */
export function lineWin(board: readonly (readonly string[])[], rand: Rand): RevealWinsStep;
/** A three-cell horizontal cluster at a random row on reels 0..2, removed and refilled from the top. */
export function clusterTumble(board: readonly (readonly string[])[], symbols: readonly string[], rand: Rand): TumbleStep;
```

  (`RevealWinsStep`/`TumbleStep` from `@energy8engine/contracts`; `lineWin` → `{ kind: 'revealWins', total: 0, lines: [{ line: 0, symbol, count: cols, win: 0, positions }] }`; `clusterTumble` → `winning = removed = [(0,r),(1,r),(2,r)]`, `fresh = [{ col, row: 0, symbol }]` per column, `settled` = each of those columns with cell `r` removed, the cells above shifted down one, the fresh symbol at row 0.)
- rpc in reels mode: `spin() / scatters({ triggers: string[], threshold: number }) / win() / tumble()` → `{ ok: true } | { ok: false, reason: 'busy' | 'no symbols' | 'no board' | 'board replaced' | string }`; `snapshot().busy` true while one runs.

- [ ] **Step 1: Failing `lab.test.ts`** (a seeded `rand`, e.g. a mulberry32 in the test):
  - `randomBoard({ cols: 5, rows: [3,3,3,3,3] }, ['1','2','3'], rand)` → 5 columns × 3, every cell in the set; a `rows: [2,3,4]` shape gives columns of those heights;
  - `scatterBoard(shape, ['1','2'], ['S'], 2, rand)` → reels 0 and 1 contain `'S'` exactly once each; reels 2..4 contain no `'S'`;
  - `lineWin(board, rand)` → one line, `positions` has `cols` cells all at the same `row < min(rows)`, `symbol === board[0][row]`;
  - `clusterTumble(board, symbols, rand)` → `removed` 3 cells at one row on cols 0..2; `settled` columns 0..2 are the old column with that cell removed, shifted down, `fresh[col].symbol` on top; columns 3.. equal the board's.
- [ ] **Step 2: Failing plugin tests** (reels mode harness from Task 3; provide a fake `symbols` service whose `doc()` lists ids `'1'..'6'`):
  - `spin()` → `board.spinTo` called once with `{ kind: 'spinTo', board }` whose cells are all in `'1'..'6'` and shape 5×3; answers `{ ok: true }`;
  - `scatters({ triggers: ['6'], threshold: 2 })` → `spinTo` with reels 0 and 1 each holding `'6'`;
  - `win()` → `revealWins` with one line on the board the last `spin` landed (before any spin: on the board the mode read from `board.symbols?.()` if the fake has it, else answers `{ ok: false, reason: 'spin first' }`);
  - `tumble()` → `board.tumble` called with a `TumbleStep` built on the last board;
  - a second action while one is pending (hold `spinTo`'s promise) → `{ ok: false, reason: 'busy' }`, and `snapshot().busy === true` until it settles;
  - no symbols (the fake `doc()` returns `null`) → `{ ok: false, reason: 'no symbols' }`;
  - a board step that throws → `{ ok: false, reason: <its message> }` (never a rejected rpc);
  - the board replaced while `spinTo` is pending → the answer is `{ ok: false, reason: 'board replaced' }`.
- [ ] **Step 3: Implement** `lab.ts` (pure, no pixi) and the handlers in `bootReels`: symbols from `(ctx.reflect.get('symbols', false))?.doc()?.symbols.map((s) => s.id)`; `rand = Math.random`; keep `lastBoard` (what the last `spinTo` landed); `busy` flag around each call; compare the board object before/after the await for `board replaced`. Every handler catches.
- [ ] **Step 4:** `scene-edit` tests + typecheck — PASS / 0.
- [ ] **Step 5: Commit** — `Canvas: the reel lab spins a random board, lands scatters for anticipation, lights a line and tumbles a cluster — no mechanic, no server`.

---

### Task 5: The Reels document — sections and the lab canvas

**Files:**
- Create: `engine/ide/client/src/plugins/reels.tsx` (registers activity + document while the composition has `reels1`)
- Create: `engine/ide/client/src/shell/ReelsDocument.tsx`
- Modify: `engine/ide/client/src/context.ts` (compose `reels` after `symbols`), `engine/ide/client/src/index.ts` (exports if the app needs them), `engine/ide/client/src/styles.css`
- Test: `engine/ide/client/tests/reels-document.test.tsx` (new; model the harness on `symbols-harness.tsx`)

**Interfaces:**
- Consumes: Task 2's `SchemaForm` `resettable` / `root`; Tasks 3–4's canvas rpc; `ctx.gameComposition` (`rows`, `update(id, config)`, `subscribe`); `createCanvasRpc` (`shell/canvas-rpc.ts`).
- Produces: activity key `reels` (title `Reels`, icon `layout-grid` or the closest existing icon name — read the icon set the activity bar uses), document key `reels`; test ids `reels-section-<name>` (`grid`, `win`, `board`, `motion`, `anticipation`, `cascade`, `features`), `reels-canvas` (the iframe, `title="reels canvas"`), `reels-action-spin`, `reels-action-scatters`, `reels-action-win`, `reels-action-tumble`, `reels-action-status`.

- [ ] **Step 1: Failing tests:**
  - with rows `reels1` + `motion1` only: sections `grid`, `win`, `board`, `motion`; no `anticipation`/`cascade`/`features`; with no `reels1` row, the plugin registers no `reels` activity/document, and one arriving later registers it (subscribe to `gameComposition`);
  - the `grid` section is `SchemaForm` with `root: 'grid'` over `reels1`'s schema and `resettable`; editing `cols` calls `gameComposition.update('reels1', { ...config, grid: { ...config.grid, cols: 6 } })`;
  - the `motion` section is the whole `motion1` form; a section header has `reset section` when the row's config has any key (writes `{}` for a whole-row section, the object without `grid` for the `grid` section);
  - after a successful `update`, the canvas gets `rows` with every reel row's CURRENT config (`reels1`, `motion1`, … as in `gameComposition.rows`); on the canvas's `ready` too;
  - `reels-action-spin` sends `spin`; `reels-action-scatters` sends `scatters` with `anticipation1`'s `triggerSymbols` and `threshold` (defaults `['scatter']`, `2` when the row sets none) and is disabled without `anticipation1` or with its `enabled: false`; `reels-action-tumble` exists only with `cascade1`; while an action is in flight all four are disabled; an answer `{ ok: false, reason }` shows in `reels-action-status`.
- [ ] **Step 2: Implement.** `plugins/reels.tsx`: a cordis plugin (`name = 'reels'`, `inject = ['gameComposition', 'slots']` or read them as the Symbols plugin does) that subscribes to `gameComposition` and keeps the activity (`order` right after Symbols) + document registered while `rows` has an entry with `id === 'reels1'`. `ReelsDocument`: a two-column layout (sections scroll on the left; the canvas column on the right with its action toolbar on top, the iframe `src={`${previewUrl}/editor.html?reels=`}` filling the rest, keyed like the Symbols canvas on reloads/project/previewUrl). Section table:

| section | row id | form |
|---|---|---|
| Grid | `reels1` | `root: 'grid'` |
| Win | `reels1` | `root: 'win'` |
| Board | `reels1` | Task 6 (a placeholder "board editor" line until then) |
| Motion | `motion1` | whole row |
| Anticipation | `anticipation1` | whole row |
| Cascade | `cascade1` | whole row |
| Features | `features1` | whole row |

Each section: a header (title + `reset section` when applicable) and the form, `commit="blur"`, `resettable`. Writes go through `ctx.gameComposition.update(rowId, next)`; on `{ diagnostics: [] }` send the canvas `rows`. CSS: two columns ≥ 1000 px wide, stacked below; token colours only.
- [ ] **Step 3:** `ide-client`, `ide-web` tests + typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Reels: one document for every reel row — the sections on the left, the project's board on a lab canvas on the right`.

---

### Task 6: Reels-only editors — symbol chips and the board painter

**Files:**
- Create: `engine/ide/client/src/shell/SymbolChips.tsx`, `engine/ide/client/src/shell/BoardPainter.tsx`
- Modify: `engine/ide/client/src/shell/ReelsDocument.tsx` (`fieldOverrides` for the symbol lists; the Board section)
- Modify: `engine/ide/client/src/styles.css`
- Test: `engine/ide/client/tests/reels-editors.test.tsx` (new), `engine/ide/client/tests/reels-document.test.tsx`

**Interfaces:**
- Consumes: Task 2's `fieldOverrides` (`FieldProps` with `path`); `ctx.symbols.known()` and `ctx.symbols.doc()` (ids = the union of both, known first, in order).
- Produces: `SymbolChips(props: FieldProps & { known: readonly { id: string; name: string }[] })` — test ids `symbol-chip-<id>` (a chip with a remove `×`, `aria-label="remove <id>"`; an unknown id gets class `e8-chip-unknown` and title `not a symbol of this project`), `symbol-chips-add` (a `<select>` of the known ids not yet chosen; picking one appends); `BoardPainter({ board, shape, known, onChange })` — test ids `board-cell-<col>-<row>` (a button showing the symbol id or `·`), a menu on click with the known ids and `empty`, `board-clear`, `board-fit`, `board-mismatch` (the line shown when the saved board's shape differs from `shape`).

- [ ] **Step 1: Failing tests** (`reels-editors.test.tsx`):
  - chips: value `['6', 'x']` with known `1..6` → chips `6` and `x`, `x` marked unknown; the add select lists `1..5`; picking `2` calls `onChange(['6','x','2'])`; `remove 6` calls `onChange(['x'])`; an empty list shows the add select only;
  - painter: shape `{ cols: 3, rows: [3,3,3] }`, board absent → 9 cells showing `·`; click `board-cell-1-2` → pick `4` → `onChange` with a 3×3 board whose `[1][2] === '4'` and every other cell `null`; `board-clear` → `onChange(undefined)` (the key removed by the section); a saved 2×3 board on a 3-col shape → `board-mismatch` visible, the saved cells drawn, no `onChange` on render; `board-fit` → a 3×3 board keeping the saved cells, padded with `null`; a 4×3 saved board on a 3-col shape fits by truncating the 4th column.
  - `reels-document.test`: the Anticipation section's `triggerSymbols` is drawn by chips; the Win section's `frameShake.onlyOnSymbols`, switched on, is drawn by chips; the Board section is the painter over `reels1.board` with the grid's shape (`cols`, `rowsPerReel ?? rows`), writing `{ ...config, board }` (and `board` removed on clear).
- [ ] **Step 2: Implement** both components (plain buttons/selects, accessible names on every control); wire them in `ReelsDocument` via `fieldOverrides: { 'triggerSymbols': chips }` for the `anticipation1` form and `{ 'win.frameShake.onlyOnSymbols': chips }` for the `root: 'win'` form (the path is from the value root — the whole config — see Task 2), and the painter as the Board section's body. CSS: a grid of cell buttons (one column per reel, top row first), token colours.
- [ ] **Step 3:** `ide-client` tests + typecheck — PASS / 0.
- [ ] **Step 4: Commit** — `Reels: symbol lists are chips of the project's symbols, and the starting board is painted cell by cell`.

---

### Task 7: e2e — the reels editor, end to end

**Files:**
- Create: `engine/apps/web/tests/e2e/reels.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–6's test ids; `project-fixture.ts` (`projectCopy`, `startDevHost`); the canvas' `window.__e8edit.snapshot()` (reels mode: `{ mode, cols, rows, fitted, busy }`).

- [ ] **Step 1:** In the suite's own setup style (read `symbols.spec.ts`'s `readyCanvas` and reuse its idea), write:
  - open the IDE, click the `reels` activity → sections `grid`, `win`, `board`, `motion`, `anticipation`, `cascade`, `features` (first-slot's `e8-base` composes all five rows); the reels canvas becomes ready (`snapshot().mode === 'reels'`, `cols === 5`);
  - set `cols` to `6` in Grid (blur) → `e8.patch.yml` holds `cols: 6` under `reels1` and `snapshot().cols` polls to `6`;
  - `reels-action-spin` → `snapshot().busy` goes true then false, and the status shows no failure;
  - `reels-action-scatters` enabled only after turning `enabled` on in Anticipation (the row's default is off);
  - pick a colour in Grid → `frameStyle` → `idle` → `color` (hex text `#ff0000`, blur) → `e8.patch.yml` holds `color: 16711680` (a number);
  - `reset cols` → `e8.patch.yml` no longer has `cols` under `reels1.grid` and `snapshot().cols` polls back to `5`;
  - open Composition → the `reels1` row has no `unsupported (union)` text.
- [ ] **Step 2:** Run `E8_E2E_HOST_PORT=5779 npx playwright test tests/e2e/reels.spec.ts` ALONE, then `schema.spec.ts composition.spec.ts symbols.spec.ts` (forms and the symbol canvas changed) — PASS. `npm run typecheck -w @energy8engine/ide-web` — 0.
- [ ] **Step 3: Commit** — `E2E: the Reels document edits the reel rows, rebuilds the lab board, spins it, writes a colour as a number and resets a value`.

---

## After the tasks

Unit gate (each alone): `reels`, `reels-features`, `scene-edit`, `ide-client`, `ide-web`, `ide-host` (ALONE); typecheck each. Full Playwright ALONE: `cd engine/apps/web && E8_E2E_HOST_PORT=5779 npx playwright test`.
