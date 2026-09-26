/**
 * The media node types, proven in a real browser (media nodes spec, Task
 * 7): the example's `coin` — a `spritesheet` node over `assets/coin.json`
 * — shows on the canvas AND spins there (`__e8edit.frameOf`, the same kind
 * of reader as `snapshot()`); the Explorer's `.json` drops as a
 * `spritesheet` node (the game's own `accept` report, nothing built in);
 * Properties renders the type's schema — `fps` a number, `sheet` a
 * `<select>` of the project's `.json` files; and the Preview's `base_game`
 * holds the node visible.
 *
 * Same idioms as `canvas.spec.ts` (the scene tab, the canvas iframe, the
 * in-frame `DragEvent` drop) and `scenes.spec.ts` (the Preview's
 * `window.__e8`) — see those for why each is shaped as it is.
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
  startDevHost,
  type DevHost,
} from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;
const CANVAS = 'iframe[title="scene canvas"]';

type Bounds = { x: number; y: number; w: number; h: number };

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

const sceneFile = () => readFileSync(join(dir, 'scenes', 'base_game.scene.yml'), 'utf8');

/**
 * `canvas.spec.ts`'s own: the Preview's game booted first (it stays
 * mounted behind the scene tab) — the node types, their schemas and the
 * `accept` table arrive from the running game, and the composition
 * document no longer embeds one.
 */
async function openSceneTab(page: Page): Promise<void> {
  await page.goto(IDE_URL);
  await gameBooted(await previewFrame(page));
  await page.getByTestId('activity-scenes').click();
  await expect(page.getByTestId('scene-base_game')).toBeVisible();
  await page.getByTestId('scene-base_game').dblclick();
  await expect(page.getByTestId('scene-doc-base_game')).toBeVisible();
}

async function frameOf(page: Page, selector: string): Promise<Frame> {
  const handle = await page.locator(selector).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`${selector} has no content frame`);
  return frame;
}

async function readyCanvas(page: Page): Promise<Frame> {
  const frame = await frameOf(page, CANVAS);
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

const bounds = (frame: Frame) =>
  frame.evaluate(
    () => (window as any).__e8edit.snapshot().bounds as Record<string, Bounds | undefined>,
  );
const coinFrame = (frame: Frame) =>
  frame.evaluate(() => (window as any).__e8edit.frameOf('coin') as number | null);

test('the canvas shows the coin at (40,40), and it spins', async ({ page }) => {
  await openSceneTab(page);
  const frame = await readyCanvas(page);
  // `coin`: four 32×32 frames, at (40,40), anchor 0.5. The sheet loads AFTER
  // the mount (the placeholder is `Texture.EMPTY`), so the size is a poll.
  await expect
    .poll(() => bounds(frame).then((b) => b.coin), { timeout: 10_000 })
    .toEqual({ x: 24, y: 24, w: 32, h: 32 });
  // 8 fps: a new frame every 125 ms.
  const first = await coinFrame(frame);
  expect(first).not.toBeNull();
  await expect.poll(() => coinFrame(frame), { timeout: 1000 }).not.toBe(first);
});

test('Properties: fps a number, sheet a select of .json files; a dropped .json is a spritesheet node', async ({
  page,
}) => {
  await openSceneTab(page);
  const frame = await readyCanvas(page);
  await page.getByTestId('canvas-tree').getByTestId('node-coin').click();
  const right = page.getByTestId('side-right-scenes');
  await expect(right.getByTestId('prop-id')).toHaveValue('coin');
  await expect(right.getByTestId('prop-type')).toHaveText('spritesheet');

  // The type's own fields arrive with the game's `node-types` report
  // (until then the form is the common props alone), labelled by their
  // schema descriptions — `engine/game/node-media/src/spritesheet.ts`.
  const fps = right.getByLabel('frames per second');
  await expect(fps).toHaveValue('8', { timeout: 10_000 });
  await expect(fps).toHaveAttribute('type', 'number');
  const sheet = right.getByLabel('spritesheet JSON, project-relative');
  await expect(sheet).toHaveJSProperty('tagName', 'SELECT');
  await expect(sheet).toHaveValue('assets/coin.json');
  await expect(sheet.locator('option[value="assets/coin.json"]')).toHaveCount(1);

  // The Explorer lists the sheet; the drop goes INSIDE the frame with the
  // Explorer's own type (canvas.spec.ts: Playwright's drag never crosses
  // into the canvas). Centre of the canvas: (240, 144).
  await page.getByTestId('activity-explorer').click();
  await expect(page.getByTestId('explorer-assets/coin.json')).toBeVisible();
  await frame.locator('canvas').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/x-e8-path', 'assets/coin.json');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
  });
  const row = page.getByTestId('canvas-tree').getByTestId('node-spritesheet-1');
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(right.getByTestId('prop-id')).toHaveValue('spritesheet-1');
  await expect
    .poll(sceneFile)
    .toMatch(
      /id: spritesheet-1\n\s+type: spritesheet\n\s+props:\n\s+sheet: assets\/coin\.json\n\s+x: 240\n\s+'y': 144\n/,
    );
  // And the new node plays too: a second spinning coin, at the drop point.
  await expect
    .poll(() => bounds(frame).then((b) => b['spritesheet-1']), { timeout: 10_000 })
    .toEqual({ x: 224, y: 128, w: 32, h: 32 });
});

test('the Preview shows the coin on base_game', async ({ page }) => {
  await page.goto(IDE_URL);
  const frame = await previewFrame(page);
  await gameBooted(frame);
  expect(await bootStatus(frame)).toBe('ready');
  await expect
    .poll(
      () =>
        frame.evaluate(() => (window as any).__e8.nodeVisible('base_game', 'coin') as boolean | null),
      { timeout: 10_000 },
    )
    .toBe(true);
});
