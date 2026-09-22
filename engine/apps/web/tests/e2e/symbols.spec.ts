/**
 * Symbols as data, proven in a real browser (Task 9): the Symbols document
 * draws one row per `symbols.yml` id with its state chips; a drop from the
 * Explorer onto a chip sets that state through the game's own node-types
 * report (`assetNodeTypes.pick`), and both the symbol canvas and the
 * running game draw the result.
 *
 * Same fixture and idioms as `media.spec.ts`: a private `projectCopy()`
 * served by `startDevHost`, and `frameOf`/`readyCanvas` — generalised here
 * to take any canvas selector, so the same readers work for
 * `iframe[title="scene canvas"]` there and `iframe[title="symbol canvas"]`
 * here. The synthesised Explorer drop is the same manually-built
 * `DataTransfer`/`DragEvent('drop')` dispatch `canvas.spec.ts`'s own
 * Explorer-drop test uses — `Locator.dragTo`'s native HTML5 drag simulation
 * proved unreliable once source and target sit in different React
 * subtrees (measured: no `symbols.yml` write followed), so this file
 * dispatches directly on the target element instead, iframe or not.
 *
 * The last two cases are the symbol-scenes slice's own, and they are about
 * the running game rather than the Symbols tab:
 *
 *  - **A cell scene.** The example's symbol `'6'` no longer draws an
 *    `image`: its `static` is `{ type: scene, props: { scene: orb } }`, and
 *    `scenes/orb.scene.yml` is mounted as a PRIVATE copy for each cell that
 *    lands a `'6'`, with its `text` bound to `'$cell.multiplier'`.
 *  - **A named state.** That symbol also declares a `pop` state, and the
 *    project's own `reel-step` mechanic names it in the plan it emits
 *    (`{ kind: 'playState', cells, state: 'pop', wait: true }`, after each
 *    round's `revealWins`) — so the plan the game actually ran carries a
 *    state this engine knows nothing about, named by a project's plugin.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = 'http://127.0.0.1:5680/';
const SYMBOL_CANVAS = 'iframe[title="symbol canvas"]';
const PREVIEW = 'iframe[title="game preview"]';

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
 * and applies — AFTER `#status` already reads `ready`, so a `#status`
 * wait proves nothing about the report (measured under load: navigating
 * away on `ready` left the host with no types, and the drop below found
 * `no node type for .json`). The host keeps the types after the game
 * disconnects (`nodeTypes` on every later `GET /api/scenes`, `scenes.ts`),
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

test('a drop of coin.json onto a chip sets its state, and the symbol canvas previews it spinning', async ({
  page,
}) => {
  await reportNodeTypes(page);
  await openSymbols(page);

  // The Explorer sidebar opens on its own once the workspace's boot GET
  // resolves and finds a project active (`App.tsx`'s `decide()`) — a
  // `shell.sidebar` default, independent of the main document panel
  // (`explorer` opens `sidebar`, not `document`, so the Symbols document
  // stays mounted throughout). No click needed, and clicking
  // `activity-explorer` here would be a TOGGLE off whatever the default
  // already opened — `explorer.spec.ts`'s own `beforeEach` waits the same
  // way, with no click either.
  await expect(page.getByTestId('explorer-assets/coin.json')).toBeVisible({ timeout: 20_000 });

  // The canvas boots symbol mode on its own (`editor.html?symbol=`); a chip
  // click is a `symbol` call into it, never a navigation.
  const canvas = await readyCanvas(page, SYMBOL_CANVAS);
  await page.getByTestId('symbol-chip-2-win').click();

  await page.getByTestId('symbol-chip-2-win').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/x-e8-path', 'assets/coin.json');
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });

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
});

test('the Preview draws a symbol sprite after a spin, and Properties shows src as a select of project images', async ({
  page,
}) => {
  await reportNodeTypes(page);
  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await frameOf(page, PREVIEW);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 20_000 })
    .toBe('ready');
  // The board is empty at boot — nothing to check `cellArt` about until a spin lands.
  const outcome = (await frame.evaluate(() => (window as any).__e8.spin())) as { out: string };
  expect(outcome.out).toBe('next');
  // Exactly `'Sprite'` in source (`pixi.js`'s `Sprite` class) — vite's dev
  // bundler can deconflict same-named top-level bindings with a leading
  // underscore, so this matches on the class name rather than pinning the
  // exact mangled identifier.
  expect(await frame.evaluate(() => (window as any).__e8.cellArt(0, 0))).toMatch(/Sprite$/);

  await openSymbols(page);
  await page.getByTestId('symbol-chip-1-static').click();
  const right = page.getByTestId('side-right-symbols');
  await expect(right.getByTestId('prop-state-type')).toHaveValue('image');
  const src = right.getByLabel('image path, project-relative');
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
    expect(await frame.evaluate(() => (window as any).__e8.spin())).toEqual({ out: 'next' });
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

/** The composition screen's preview, booted to `ready` — `text.spec.ts`'s `readyFrame`. */
async function readyPreview(page: Page): Promise<Frame> {
  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await frameOf(page, PREVIEW);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 20_000 })
    .toBe('ready');
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
  // node inside a CELL. It reads empty, and that is the honest answer rather
  // than a missing one — `first-slot`'s math hands its board over as
  // `[[int]]`, so a cell's data is `{ symbol }` and nothing else, and
  // `'$cell.multiplier'` therefore stands at its prop's empty value
  // (`cellProps`, `@energy8engine/scenes`) instead of failing the schema.
  // A game whose math carries a per-cell figure gets the figure here; this
  // one proves the node mounted, bound and resolvable.
  expect(await frame.evaluate(([c, r]) => (window as any).__e8.cellText(c, r), orb)).toBe('');
  // And it came from the document, not from the board's own furniture: a
  // cell of any other symbol has no text node in it at all.
  expect(
    await frame.evaluate(([c, r]) => (window as any).__e8.cellText(c, r), plain),
  ).toBeNull();
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
    expect(await frame.evaluate(() => (window as any).__e8.spin())).toEqual({ out: 'next' });
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
