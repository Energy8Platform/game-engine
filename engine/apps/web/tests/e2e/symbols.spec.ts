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
 * The running game reports its node types to the host over `/ide` the
 * moment it boots (`ideBridge.apply` in `main.ts`); the host keeps them
 * after the game disconnects (served back on the next `GET /api/scenes`),
 * so one direct visit is enough for every later `assetNodeTypes.pick` this
 * file makes. Same idiom as `flow.spec.ts`'s `openComposition`.
 */
async function reportNodeTypes(page: Page): Promise<void> {
  await page.goto(host.gameUrl);
  await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
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
    .poll(symbolsFile)
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
