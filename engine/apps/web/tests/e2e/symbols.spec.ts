/**
 * Symbols as data, proven in a real browser (Task 9): the Symbols document
 * draws one row per `symbols.yml` id with its state chips; a file dragged
 * from the Explorer onto the symbol canvas sets the selected state through
 * the game's own node-types report (`assetNodeTypes.pick`), and both the
 * symbol canvas and the running game draw the result.
 *
 * Same fixture and idioms as `media.spec.ts`: a private `projectCopy()`
 * served by `startDevHost`, and `frameOf`/`readyCanvas` — generalised here
 * to take any canvas selector, so the same readers work for
 * `iframe[title="scene canvas"]` there and `iframe[title="symbol canvas"]`
 * here. The Explorer drag is Playwright's own `Locator.dragTo`, a real
 * pointer drag: the Explorer allows only a `move` effect, so a target
 * asking for any other refuses the drop — which is what once made this
 * drag look unreliable (no `symbols.yml` write followed).
 *
 * The last two cases are the symbol-scenes slice's own, and they are about
 * the running game rather than the Symbols tab:
 *
 *  - **A cell scene.** The example's symbol `'6'` no longer draws an
 *    `image`: its `static` is `{ type: scene, props: { scene: orb } }`, and
 *    `scenes/orb.scene.yml` is mounted as a PRIVATE copy for each cell that
 *    lands a `'6'`, with its `text` a TEMPLATE over the cell's own data
 *    (`'x{$cell.multiplier}'`) rather than a bare field.
 *  - **Art a row claims.** The project's `reel-step` plugin calls
 *    `scenes.require(['assets/coin.png'])` from its `apply` — a path no
 *    document in the project names, so nothing but that call can put it in
 *    the loader.
 *  - **A named state.** That symbol also declares a `pop` state, and the
 *    project's own `reel-step` mechanic names it in the plan it emits
 *    (`{ kind: 'playState', cells, state: 'pop', wait: true }`, after each
 *    round's `revealWins`) — so the plan the game actually ran carries a
 *    state this engine knows nothing about, named by a project's plugin.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import {
  bootStatus,
  gameBooted,
  previewFrame,
  projectCopy,
  spinOnce,
  startDevHost,
  type DevHost,
} from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;
const SYMBOL_CANVAS = 'iframe[title="symbol canvas"]';

let dir: string;
let host: DevHost;

test.beforeEach(async () => {
  dir = projectCopy();
  host = await startDevHost(dir);
});

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const symbolsFile = () => readFileSync(join(dir, 'symbols.yml'), 'utf8');

async function frameOf(page: Page, selector: string): Promise<Frame> {
  const handle = await page.locator(selector).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`${selector} has no content frame`);
  return frame;
}

/** Polls a canvas iframe's `__e8edit.emitted()` for a `ready` event — `media.spec.ts`'s `readyCanvas`, generalised to any canvas selector. */
async function readyCanvas(page: Page, selector: string): Promise<Frame> {
  const frame = await frameOf(page, selector);
  await expect
    .poll(
      () =>
        frame.evaluate(
          () =>
            (window as any).__e8edit
              ?.emitted()
              .some((e: { event: string }) => e.event === 'ready') ?? false,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  return frame;
}

/**
 * The running game reports its node types to the host over `/ide` only
 * once `main.ts`'s deferred `import('@energy8engine/ide-bridge')` lands
 * and applies — AFTER `window.__e8` is already installed (`ready`), so a
 * readiness wait proves nothing about the report (measured under load:
 * navigating away on `ready` left the host with no types, and the drop
 * below found `no node type for .json`). The host keeps the types after
 * the game disconnects (`nodeTypes` on every later `GET /api/scenes`, `scenes.ts`),
 * so this polls that field until it is non-empty; one direct visit is
 * then enough for every later `assetNodeTypes.pick` this file makes —
 * `#/doc/symbols`'s own canvas (`editor.ts`) never applies the bridge.
 */
async function reportNodeTypes(page: Page): Promise<void> {
  await page.goto(host.gameUrl);
  await expect
    .poll(
      async () => {
        const res = await fetch(`${host.url}/api/scenes`);
        return ((await res.json()) as { nodeTypes?: unknown[] }).nodeTypes?.length ?? 0;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

async function openSymbols(page: Page): Promise<void> {
  await page.goto(`${IDE_URL}#/doc/symbols`);
  await expect(page.getByTestId('symbols-doc')).toBeVisible();
}

test('the Symbols tab lists rows 1..6, the win chip of 1 reads spritesheet, and there are no ghosts', async ({
  page,
}) => {
  await openSymbols(page);
  for (const id of ['1', '2', '3', '4', '5', '6']) {
    await expect(page.getByTestId(`symbol-row-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('symbol-chip-1-win')).toHaveText('spritesheet');
  await expect(page.locator('[data-testid^="symbol-ghost-"]')).toHaveCount(0);
});

test('a drag of coin.json from the Explorer onto the canvas sets the selected state, and the canvas previews it spinning', async ({
  page,
}) => {
  await reportNodeTypes(page);
  await openSymbols(page);

  // The canvas boots symbol mode on its own (`editor.html?symbol=`); a chip
  // click is a `symbol` call into it, never a navigation.
  const canvas = await readyCanvas(page, SYMBOL_CANVAS);
  await page.getByTestId('symbol-chip-2-win').click();

  // The symbol list and the Explorer share the left sidebar: picking the
  // Explorer puts it beside the canvas, the selection held meanwhile. The
  // file is then dragged the way a person drags it — a real pointer drag
  // from its row onto the canvas, which takes the drop for the selection.
  await page.getByTestId('activity-explorer').click();
  const source = page.getByTestId('explorer-assets/coin.json');
  await expect(source).toBeVisible({ timeout: 20_000 });
  await source.dragTo(page.getByTestId('symbols-canvas'));

  await expect
    .poll(symbolsFile, { timeout: 15_000 })
    .toMatch(
      /id: '2'[\s\S]*?win:\n\s+type: spritesheet\n\s+props:\n\s+sheet: assets\/coin\.json\n\s+loop: false/,
    );

  // The selection was `{2, win}` since the click; the bounds come once the
  // written doc has round-tripped (`symbols` frame → `replaceSymbols` → re-preview).
  const snapshot = () =>
    canvas.evaluate(
      () => (window as any).__e8edit.snapshot() as { symbol: string; state: string; w: number },
    );
  await expect.poll(snapshot).toMatchObject({ symbol: '2', state: 'win' });
  await expect.poll(async () => (await snapshot()).w).toBeGreaterThan(0);

  // A one-shot (`loop: false`, 333 ms) may already sit on its last frame:
  // Replay re-previews it from frame 0, then it moves on. Tight polling
  // for the 0 — the first frame lasts ~80 ms at 12 fps.
  const frameOfSymbol = () =>
    canvas.evaluate(() => (window as any).__e8edit.frameOf('symbol') as number | null);
  await page.getByTestId('symbol-replay').click();
  await expect.poll(frameOfSymbol, { intervals: [10], timeout: 5000 }).toBe(0);
  await expect.poll(frameOfSymbol, { timeout: 5000 }).not.toBe(0);

  // The state exists now, so nothing covers the canvas: a drag onto the
  // iframe's box still reaches the document, and replaces the state.
  // `force`: what the pointer hits there is the stage behind the iframe,
  // which Playwright's own target check would otherwise refuse.
  await expect(page.getByTestId('symbols-state-empty')).toHaveCount(0);
  await page
    .getByTestId('explorer-assets/logo.png')
    .dragTo(page.locator(SYMBOL_CANVAS), { force: true });
  await expect
    .poll(symbolsFile, { timeout: 15_000 })
    .toMatch(/id: '2'[\s\S]*?win:\s+type: image\s+props:\s+src: assets\/logo\.png/);
});

test('the Symbols canvas shows a symbol large, zooms to 1:1 and 2x, plays a win, explains itself', async ({
  page,
}) => {
  await openSymbols(page);
  // Nothing picked yet: the canvas is warm underneath, but the help panel
  // is what covers it.
  await expect(page.getByTestId('symbols-help')).toBeVisible();

  let canvas = await readyCanvas(page, SYMBOL_CANVAS);
  const snapshot = () =>
    canvas.evaluate(
      () =>
        (window as any).__e8edit.snapshot() as {
          symbol: string | null;
          state: string | null;
          screen: { w: number; h: number };
        },
    );

  await page.getByTestId('symbol-row-1').click();
  await expect.poll(async () => (await snapshot()).symbol).toBe('1');

  // `fit` sizes the cell to 60% of the screen's smaller side (`scene-edit`'s
  // `scaleFor`); 0.4 is a loose floor rather than pinning that exact
  // fraction, since the iframe's CSS box and the canvas' own `app.screen`
  // need not agree to the pixel.
  const iframe = page.locator(SYMBOL_CANVAS);
  const box = (await iframe.boundingBox())!;
  const minSide = Math.min(box.width, box.height);
  expect((await snapshot()).screen.w).toBeGreaterThanOrEqual(0.4 * minSide);

  // The iframe fills the stage under the toolbar — no border, no padding
  // (`.e8-symbols-stage iframe { width: 100%; height: 100% }`).
  const stageBox = (await page.locator('.e8-symbols-stage').boundingBox())!;
  expect(box.x).toBeCloseTo(stageBox.x, -1);
  expect(box.y).toBeCloseTo(stageBox.y, -1);
  expect(box.width).toBeCloseTo(stageBox.width, -1);
  expect(box.height).toBeCloseTo(stageBox.height, -1);

  await page.getByTestId('symbols-zoom-1:1').click();
  await expect
    .poll(async () => Math.abs((await snapshot()).screen.w - 96), { timeout: 5000 })
    .toBeLessThanOrEqual(1);

  await page.getByTestId('symbols-zoom-2x').click();
  await expect
    .poll(async () => Math.abs((await snapshot()).screen.w - 192), { timeout: 5000 })
    .toBeLessThanOrEqual(1);

  // A reload keeps the remembered zoom (`localStorage['e8.symbols-zoom']`)
  // — proven by the toolbar button AND by the canvas actually laying the
  // cell out at 2x again once a symbol is re-selected.
  await page.reload();
  await expect(page.getByTestId('symbols-doc')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('symbols-zoom-2x')).toHaveAttribute('aria-pressed', 'true');
  canvas = await readyCanvas(page, SYMBOL_CANVAS);

  // The win chip of `1` is a spritesheet (`assets/coin.json`, `loop: false`)
  // — the same asset the "a drop of coin.json…" case above plays.
  await page.getByTestId('symbol-chip-1-win').click();
  await expect
    .poll(async () => Math.abs((await snapshot()).screen.w - 192), { timeout: 5000 })
    .toBeLessThanOrEqual(1);

  await page.getByTestId('symbol-replay').click();
  const frameOfSymbol = () =>
    canvas.evaluate(() => (window as any).__e8edit.frameOf('symbol') as number | null);
  // Whatever frame Replay lands on first (a one-shot may already be warm
  // from the selection above) — polled tight, same reasoning as the
  // "a drop of coin.json…" case's own frame-0 poll (~80 ms first frame).
  await expect.poll(frameOfSymbol, { intervals: [10], timeout: 5000 }).not.toBeNull();
  const first = (await frameOfSymbol()) as number;
  await expect.poll(frameOfSymbol, { timeout: 5000 }).toBeGreaterThan(first);

  await expect(page.getByTestId('symbols-cell-size')).toHaveText('cell 96×96');
});

test('the Preview draws a symbol sprite after a spin, and Properties shows src as a select of project images', async ({
  page,
}) => {
  await reportNodeTypes(page);
  const frame = await readyPreview(page);
  // The board is empty at boot — nothing to check `cellArt` about until a spin lands.
  expect(await spinOnce(frame)).toBe('done');
  // Exactly `'Sprite'` in source (`pixi.js`'s `Sprite` class) — vite's dev
  // bundler can deconflict same-named top-level bindings with a leading
  // underscore, so this matches on the class name rather than pinning the
  // exact mangled identifier.
  expect(await frame.evaluate(() => (window as any).__e8.cellArt(0, 0))).toMatch(/Sprite$/);

  await openSymbols(page);
  await page.getByTestId('symbol-chip-1-static').click();
  const right = page.getByTestId('side-right-symbols');
  await expect(right.getByTestId('prop-state-type')).toHaveValue('image');
  // `exact`: `src` is a substring of the same schema's `srcKey`.
  const src = right.getByLabel('src', { exact: true });
  await expect(src).toHaveJSProperty('tagName', 'SELECT');
  await expect(src).toHaveValue('assets/symbols/1.png');
});

/** The live board as `__e8.symbols()` reads it — `[col][row]`, `null` for an empty cell. */
type Board = (string | null)[][];

/**
 * Spins the preview until the board shows `id` somewhere, and answers the
 * whole board. `'6'` carries the heaviest reel weight the example's math
 * has (30 of 105 — `game/script.spin`'s `SYM_W`), so a single spin puts one
 * in fifteen cells about 99 % of the time: the loop is here for the other
 * one per cent, not as a search.
 */
async function boardShowing(frame: Frame, id: string): Promise<Board> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    expect(await frame.evaluate(() => (window as any).__e8.spin())).toEqual({
      out: 'next',
      kind: 'present',
    });
    const board = (await frame.evaluate(() => (window as any).__e8.symbols())) as Board;
    if (board.some((col) => col.includes(id))) return board;
  }
  throw new Error(`no "${id}" landed in five spins — the math or symbols.yml regressed`);
}

/**
 * The first cell the board shows `id` at — or, with `match: false`, the
 * first showing some OTHER symbol. An empty cell is neither: it has no view
 * at all, so it would satisfy the "no text node here" assertion below for
 * entirely the wrong reason.
 */
function cellOf(board: Board, id: string, match = true): [number, number] {
  for (let col = 0; col < board.length; col += 1)
    for (let row = 0; row < board[col].length; row += 1) {
      const cell = board[col][row];
      if (cell !== null && (cell === id) === match) return [col, row];
    }
  throw new Error(`no cell ${match ? 'showing' : 'other than'} "${id}" on this board`);
}

/** The IDE's Preview, in front and booted to `ready` — `text.spec.ts`'s `readyFrame`. */
async function readyPreview(page: Page): Promise<Frame> {
  await page.goto(IDE_URL);
  const frame = await previewFrame(page);
  await gameBooted(frame);
  expect(await bootStatus(frame)).toBe('ready');
  return frame;
}

test("a symbol whose static state is a cell scene draws that document in its cells, bindings and all", async ({
  page,
}) => {
  const frame = await readyPreview(page);
  const board = await boardShowing(frame, '6');
  const orb = cellOf(board, '6');
  const plain = cellOf(board, '6', false);

  // What the copy actually is: `orb.scene.yml`'s first node is its `image`,
  // and `cellArt` walks first-children, so this reads `Sprite` — the same
  // word a plain `image` state gives. It is asserted because the art really
  // being on screen is half of what "the document mounted" means, not
  // because it tells the two apart. The line below does that.
  expect(
    await frame.evaluate(([c, r]) => (window as any).__e8.cellArt(c, r), orb),
  ).toMatch(/Sprite$/);

  // The other half, and the half that only a cell scene can produce: a text
  // node inside a CELL — and the document's prop is a full EXPRESSION, not
  // a bare field: `'x{$cell.multiplier}'`.
  //
  // `'x'` is what that renders here, and it is the honest answer rather
  // than a missing one. `first-slot`'s math hands its board over as
  // `[[int]]`, so a cell's data is `{ symbol }` (plus the `band` reel-step gives a `6`);
  // `resolveValue` renders a template span whose expression reads
  // `null`/`undefined` as `''` (`@energy8engine/contracts`' `expression.ts`),
  // leaving the literal `x` the document wrote around it. So this one
  // string proves three things at once: the copy mounted for THIS cell, the
  // prop was run as an expression rather than taken literally (a literal
  // would read back `'x{$cell.multiplier}'`), and the missing field
  // resolved instead of failing the schema. A game whose math carries a
  // per-cell figure reads `x12` off the very same document.
  expect(await frame.evaluate(([c, r]) => (window as any).__e8.cellText(c, r), orb)).toBe('x');
  // And it came from the document, not from the board's own furniture: a
  // cell of any other symbol has no text node in it at all.
  expect(
    await frame.evaluate(([c, r]) => (window as any).__e8.cellText(c, r), plain),
  ).toBeNull();
});

/**
 * The art `orb.scene.yml`'s `srcOf` holds for each band, and the band the
 * `reel-step` mechanic gives a `6` by its row (`BANDS[row % 4]`,
 * `plugins/reel-step/src/mechanic.ts`) — restated here rather than imported,
 * so a change on either side has to be made on purpose.
 */
const BAND_ART = ['assets/symbols/1.png', 'assets/symbols/2.png', 'assets/symbols/3.png', 'assets/symbols/4.png'];

test('an orb picks its art from its set by the band its row carries', async ({ page }) => {
  const frame = await readyPreview(page);

  // Two `6`s in different rows. `6` is the heaviest reel weight the math
  // has, so most spins land one in every row; the loop covers the rest.
  let orbs: [number, number][] = [];
  for (let attempt = 0; attempt < 10 && orbs.length < 2; attempt += 1) {
    const board = await boardShowing(frame, '6');
    const byRow = new Map<number, [number, number]>();
    board.forEach((col, c) =>
      col.forEach((cell, r) => {
        if (cell === '6' && !byRow.has(r)) byRow.set(r, [c, r]);
      }),
    );
    orbs = [...byRow.values()].slice(0, 2);
  }
  expect(orbs, 'no two rows showed a "6" in ten spins').toHaveLength(2);

  const texture = ([c, r]: [number, number]) =>
    frame.evaluate(([col, row]) => (window as any).__e8.cellTexture(col, row) as string | null, [c, r]);
  const [a, b] = await Promise.all(orbs.map(texture));
  // Each shows the file its row's band names — not `src` (`6.png`), the
  // fallback a cell with no band, or an unpicked set, would show.
  for (const [cell, shown] of [[orbs[0], a], [orbs[1], b]] as const) {
    expect(shown, `cell ${cell}`).toContain(BAND_ART[cell[1] % 4]);
  }
  expect(a).not.toBe(b);
});

test("a row's own art loads: the reel-step plugin requires a path no document names", async ({
  page,
}) => {
  const frame = await readyPreview(page);

  // `assets/coin.png` is in this project, and nothing in it NAMES the file:
  // `coin.json` carries it as its `meta.image`, which pixi's spritesheet
  // parser loads through its Loader rather than `Assets.load` — so that
  // path never reaches the Assets cache, and no scene, symbol or flow
  // document mentions it at all. The one thing that can put it in the
  // loader is the `scenes.require(['assets/coin.png'])` the `reel-step`
  // plugin makes from its own `apply` (`plugins/reel-step/src/index.ts`).
  //
  // Polled rather than read once: the game reads `ready` as soon as the
  // flow is armed, which is before — or during — the boot batch this claim
  // folded itself into.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.loaded('assets/coin.png')), {
      timeout: 20_000,
    })
    .toBe(true);

  // The control, so the line above is not a hook that answers `true` to
  // anything: a path in no document AND in no `require` is not in the
  // loader. (It costs one `assetLoader` warning in that page's own list —
  // the loader reports a `get` for a path no batch asked for, which is
  // exactly the diagnostic the `require` above exists to avoid.)
  expect(
    await frame.evaluate(() => (window as any).__e8.loaded('assets/nothing-claims-this.png')),
  ).toBe(false);
});

test("a mechanic names a symbol's own state, and the plan the game ran carries it", async ({
  page,
}) => {
  // `playState` only enters the plan for a round that PAID, and the
  // example's math pays roughly one spin in seven — so this is a search,
  // and it gets the same budget and attempt count `reel-step.spec.ts`'s own
  // `winUnder` was measured to need (~2 s a spin, 14-25 % hit rate).
  test.setTimeout(150_000);
  const frame = await readyPreview(page);

  // This project binds `base_game` to its own `reel-step` plugin in
  // `e8.patch.yml`, and that plugin is what names `pop`. Read first, so a
  // failure below is about the plan rather than about the binding.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.bound('base_game')), {
      timeout: 20_000,
    })
    .toBe('reel-step');

  // How many of those spins actually paid: a search that runs out having
  // paid nothing was unlucky, one that paid and still saw no `playState` is
  // the mechanic having stopped emitting it. The message has to tell them apart.
  let paid = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    // The spin completing at all is half the case: `wait: true` means the
    // plan is held while every named cell plays its state, so a state that
    // never resolved would hang `present` and fail here rather than later.
    expect(await frame.evaluate(() => (window as any).__e8.spin())).toEqual({
      out: 'next',
      kind: 'present',
    });
    const spins = (await frame.evaluate(() => (window as any).__e8.spins())) as {
      plan: { kind: string; state?: string; cells?: unknown[]; wait?: boolean }[];
      result: { winAmount: number };
    }[];
    const last = spins.at(-1)!;
    if (last.result.winAmount > 0) paid += 1;
    const played = last.plan.filter((step) => step.kind === 'playState');
    if (played.length === 0) continue;
    for (const step of played) {
      expect(step).toMatchObject({ state: 'pop', wait: true });
      expect(step.cells!.length).toBeGreaterThan(0);
    }
    return;
  }
  throw new Error(
    `no playState step in 40 spins, ${paid} of which paid — ${
      paid > 0
        ? 'the reel-step mechanic has stopped naming a state on a paying spin'
        : 'the math pays nothing at all'
    }`,
  );
});
