/**
 * The scene editor, proven in a real browser (scene editor spec, Task 15):
 * the Scenes SIDEBAR lists `scenes/*.scene.yml`, adds one (a file the
 * Explorer then shows) and opens one as a tab; the tab adds a node whose
 * properties appear on the RIGHT and land in the file; clicking a scene
 * pushes it into the running game without a spin; and a spin still
 * presents — through `flow.yml` now (`on shell.spin → spin → present`), on
 * the `base_game` its `show` node put up at boot.
 *
 * Same iframe, same readers as `hot-fork.spec.ts`: the Preview
 * document's game frame (`iframe[title="game preview"]`) and the game's own
 * `window.__e8` — here `scenesVisible()` (the scenes on screen: top-level
 * ones in show order, then shown nested ones) and `nodeVisible(scene,
 * node)` (a top-level node of a mounted scene; `big_win` is nested INTO
 * `base_game` as a `scene` node, so "showing big_win" is that node flipping
 * visible, listed after its host). The Scenes view is a sidebar beside that document,
 * which stays in front the whole time.
 *
 * What lands in the game arrives asynchronously (a PUT → the host's
 * `scenes` frame → `ide-bridge`; a click → `POST /api/scenes/preview` →
 * a `scene-preview` frame), so every game-side claim is a poll.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
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

/**
 * The game up once on its own URL, then the IDE, which opens on its
 * composition document with the project's game running in the Preview
 * behind it (as `hot-fork.spec.ts`). The first visit is what registers the
 * game's node types with the host, so the IDE's boot `GET /api/scenes`
 * already carries them.
 */
async function openComposition(page: Page): Promise<void> {
  await page.goto(host.gameUrl);
  await gameBooted(page);
  await page.goto(IDE_URL);
}

/** The Preview's game, in front and booted to `ready`. */
async function readyFrame(page: Page): Promise<Frame> {
  const frame = await previewFrame(page);
  await gameBooted(frame);
  expect(await bootStatus(frame)).toBe('ready');
  return frame;
}

const scenesVisible = (frame: Frame) =>
  frame.evaluate(() => (window as any).__e8.scenesVisible() as string[]);
const nodeVisible = (frame: Frame, scene: string, node: string) =>
  frame.evaluate(
    ([s, n]) => (window as any).__e8.nodeVisible(s, n) as boolean | null,
    [scene, node],
  );

/** Shows the Scenes sidebar. The activity button TOGGLES, so only a hidden one is clicked. */
async function showScenes(page: Page): Promise<void> {
  const scenes = page.getByTestId('scenes-screen');
  if (!(await scenes.isVisible())) await page.getByTestId('activity-scenes').click();
  await expect(page.getByTestId('sidebar').getByTestId('scenes-screen')).toBeVisible();
  await expect(page.getByTestId('scene-base_game')).toBeVisible();
}

const sceneFile = (id: string) => join(dir, 'scenes', `${id}.scene.yml`);

test('the Scenes sidebar adds a scene, the Explorer shows the file, a double-click opens the tree', async ({
  page,
}) => {
  // The IDE's own default (the composition, with the game running in the
  // Preview behind it) rather than a deep link to the composition alone,
  // which would run no game at all — what the composition's own preview
  // used to guarantee (see `openComposition`).
  await page.goto(IDE_URL);
  await showScenes(page);
  await expect(page.getByTestId('scene-big_win')).toBeVisible();

  await page.getByTestId('scene-add').click();
  await page.getByTestId('scene-add-input').fill('intro');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('scene-intro')).toBeVisible({ timeout: 10_000 });
  expect(existsSync(sceneFile('intro'))).toBe(true);
  expect(readFileSync(sceneFile('intro'), 'utf8')).toBe('id: intro\nnodes: []\n');

  // The Explorer is a sidebar of its own; switching to it mounts it afresh
  // and it reads the tree — which now holds the file the host wrote.
  await page.getByTestId('activity-explorer').click();
  await expect(page.getByTestId('explorer-scenes/intro.scene.yml')).toBeVisible();

  await showScenes(page);
  await page.getByTestId('scene-intro').dblclick();
  await expect(page.getByTestId('scene-doc-intro')).toBeVisible();
  await expect(page.getByTestId('scene-doc-empty')).toBeVisible();
});

test('adding a node shows its properties on the right and writes the file', async ({ page }) => {
  await openComposition(page);
  await showScenes(page);
  await page.getByTestId('scene-base_game').dblclick();
  const doc = page.getByTestId('scene-doc-base_game');
  await expect(doc).toBeVisible();
  await expect(doc.getByTestId('node-board')).toBeVisible();
  await expect(doc.getByTestId('node-big_win')).toBeVisible();

  // The type list is the running game's own (`node-types`), relayed by the host.
  await doc.getByTestId('node-add').click();
  const type = doc.getByTestId('node-add-type');
  await expect(type.locator('option[value="container"]')).toHaveCount(1, { timeout: 10_000 });
  await type.selectOption('container');
  await doc.getByTestId('node-add-ok').click();
  const row = doc.getByTestId('node-container-1');
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => readFileSync(sceneFile('base_game'), 'utf8'))
    .toContain('id: container-1');

  await row.click();
  const right = page.getByTestId('side-right-scenes');
  await expect(right).toBeVisible();
  await expect(right.getByTestId('prop-id')).toHaveValue('container-1');
  await expect(right.getByTestId('prop-type')).toHaveText('container');

  // `commit="blur"`: the PUT goes on Enter (or blur), not per keystroke.
  // `exact`: `x` is a substring of `anchorX`/`anchorY`, also on this form.
  const x = right.getByLabel('x', { exact: true });
  await expect(x).toHaveValue('0');
  await x.fill('12');
  await x.press('Enter');
  await expect
    .poll(() => readFileSync(sceneFile('base_game'), 'utf8'), {
      timeout: 10_000,
    })
    .toMatch(/id: container-1\n\s+type: container\n\s+props:\n\s+x: 12\n/);
  await expect(x).toHaveValue('12');

  // And taken out again: the row goes, and so does the file's node.
  await doc.getByTestId('node-remove-container-1').click();
  await expect(row).toHaveCount(0, { timeout: 10_000 });
  await expect
    .poll(() => readFileSync(sceneFile('base_game'), 'utf8'))
    .not.toContain('container-1');
});

test('clicking a scene shows it in the preview; showing big_win flips its node visible', async ({
  page,
}) => {
  await openComposition(page);
  const frame = await readyFrame(page);
  // `base_game` is up from boot — the flow's `show` node — so the click
  // below finds it there already; what the click proves is the selection
  // and the Properties, and `big_win` below is the preview path itself.
  await expect.poll(() => scenesVisible(frame), { timeout: 10_000 }).toEqual(['base_game']);
  await showScenes(page);

  await page.getByTestId('scene-base_game').click();
  await expect(page.getByTestId('scene-base_game')).toHaveClass(/e8-explorer-selected/);
  expect(await scenesVisible(frame)).toEqual(['base_game']);
  // The scene with no node picked: its id and node count on the right.
  await expect(page.getByTestId('prop-scene-id')).toHaveText('base_game');
  // `board`, `logo`, `coin`, `win`, `big_win` — the example gained its image
  // in slice 18, its spritesheet in the media slice, its `win` text node
  // (a `prop` flow node writes `$result.win` into it) this slice.
  await expect(page.getByTestId('prop-node-count')).toHaveText('5');
  expect(await nodeVisible(frame, 'base_game', 'big_win')).toBe(false);

  // `big_win` is nested into `base_game`, so showing it is that node
  // turning visible — and `visible()` lists it after its host: it is on
  // screen, nested or not.
  await page.getByTestId('scene-big_win').click();
  await expect
    .poll(() => nodeVisible(frame, 'base_game', 'big_win'), { timeout: 10_000 })
    .toBe(true);
  expect(await scenesVisible(frame)).toEqual(['base_game', 'big_win']);
});

test('a spin still presents, through the flow, on the scene shown at boot', async ({ page }) => {
  await openComposition(page);
  const frame = await readyFrame(page);
  await expect.poll(() => scenesVisible(frame), { timeout: 10_000 }).toEqual(['base_game']);

  // The shell's Spin in, the `present` node's exit out; the scene list is unchanged
  // — presenting draws on the board `base_game` already holds.
  expect(await spinOnce(frame)).toBe('done');
  expect(await scenesVisible(frame)).toEqual(['base_game']);
  expect(await frame.evaluate(() => (window as any).__e8.spins().length)).toBe(1);
});
