/**
 * The scene canvas, proven in a real browser (scene canvas spec, Task 9):
 * the scene tab boots the editor page (`iframe[title="scene canvas"]`,
 * `${previewUrl}/editor.html?scene=<id>`) and what the POINTER does there
 * lands in `scenes/<id>.scene.yml` — the IDE is the one writer, the canvas
 * only reports (`edit`/`zorder`/`drop` over the `e8:ide:*` wire).
 *
 * Readers, as `scenes.spec.ts` reads the game through `window.__e8`: the
 * editor page's `window.__e8edit` — `snapshot()` (design-space bounds per
 * top-level node) and `emitted()` (what it told the IDE). Every gesture is
 * `page.mouse` at SCREEN coordinates: the iframe's intrinsic size is the
 * design size (so design (0,0) is the iframe's top-left and the game's own
 * fit is 1:1), and the IDE CSS-scales it by the zoom — so a design point is
 * `iframe box top-left + design × (box.width / design width)`. Moves go in
 * steps: the gizmo counts a press as a drag only past 3 px.
 *
 * What lands in the file arrives asynchronously (an event → the IDE's
 * `PUT /api/scenes/<id>` → disk), so every file claim is a poll.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { load } from 'js-yaml';
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
 * The IDE with its game running, the Scenes sidebar shown, `base_game`
 * opened as a tab. The game runs in the Preview document (which stays
 * mounted behind the scene tab): the scene document learns which node type
 * a dropped file makes from the running game (`no node type for .png — the
 * game has not reported its node types yet` without one), and the
 * composition document no longer embeds a game to report them.
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

/** The canvas iframe's frame, once `scene-edit` has emitted `ready` (the scene is shown). */
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

const snapshot = (frame: Frame) =>
  frame.evaluate(
    () =>
      (window as any).__e8edit.snapshot() as {
        selected: string | null;
        bounds: Record<string, Bounds>;
      },
  );

/** Design → screen for the canvas iframe, from its (CSS-scaled) box and intrinsic width. */
async function mapper(
  iframe: Locator,
): Promise<(x: number, y: number) => { x: number; y: number }> {
  const box = await iframe.boundingBox();
  const width = Number(await iframe.getAttribute('width'));
  if (!box || !width) throw new Error('canvas iframe has no box');
  const zoom = box.width / width;
  return (x, y) => ({ x: box.x + x * zoom, y: box.y + y * zoom });
}

/** Press at `from`, travel to `to` in steps (past the gizmo's 3 px slop), release. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('the scene tab boots the canvas and shows the logo', async ({ page }) => {
  await openSceneTab(page);
  const frame = await readyCanvas(page);
  const shot = await snapshot(frame);
  // `logo` is a 64×64 image at (240, 40), anchor 0.5.
  expect(shot.bounds.logo).toEqual({ x: 208, y: 8, w: 64, h: 64 });
  expect(shot.selected).toBeNull();
  // Nothing picked: no Properties (the right side shows only while a selection stands).
  await expect(page.getByTestId('prop-id')).toHaveCount(0);
  await expect(page.getByTestId('canvas-tree').getByTestId('node-logo')).toBeVisible();
});

test('click selects, drag moves: the file gets the new x', async ({ page }) => {
  await openSceneTab(page);
  const frame = await readyCanvas(page);
  const at = await mapper(page.locator(CANVAS));
  const centre = at(240, 40);

  // A press picks the TOPMOST node under it — the logo, drawn after the
  // board (a 504×300 view at (−48,−48): the whole design) in `first-slot`.
  await page.mouse.click(centre.x, centre.y);
  await expect
    .poll(() => snapshot(frame).then((s) => s.selected), { timeout: 10_000 })
    .toBe('logo');
  await expect(page.getByTestId('side-right-scenes').getByTestId('prop-id')).toHaveValue('logo');

  await drag(page, centre, at(280, 40));
  // The pointer's travel comes back through the zoom as a float (measured:
  // `279.99998474121094`); the canvas rounds what it writes to 2 decimals.
  const x = () =>
    Number(
      /id: logo\n\s+type: image\n\s+props:\n\s+src: assets\/logo\.png\n\s+x: ([\d.]+)/.exec(
        sceneFile(),
      )?.[1],
    );
  await expect.poll(x, { timeout: 10_000 }).toBe(280);
  await expect.poll(() => snapshot(frame).then((s) => s.bounds.logo.x)).toBe(248);
});

test('a corner drag scales, ] moves it forward', async ({ page }) => {
  await openSceneTab(page);
  const frame = await readyCanvas(page);
  const at = await mapper(page.locator(CANVAS));
  // Picked from the tree; the canvas mirrors the selection and the gizmo sits above every node.
  await page.getByTestId('canvas-tree').getByTestId('node-logo').click();
  await expect.poll(() => snapshot(frame).then((s) => s.selected)).toBe('logo');

  // The SE corner, measured against the NW one: (272,72) → (304,104) is 1.5× the diagonal.
  const { logo } = (await snapshot(frame)).bounds;
  await drag(
    page,
    at(logo.x + logo.w, logo.y + logo.h),
    at(logo.x + logo.w + 32, logo.y + logo.h + 32),
  );
  // The LOGO's own `scale`, parsed — not the file's first `scale:`, which
  // since slice 27 is the board's portrait override (`portrait.nodes.board
  // .scale: 0.55`), there before any drag.
  const logoScale = () =>
    (load(sceneFile()) as { nodes: { id: string; props: { scale?: number } }[] }).nodes.find(
      (n) => n.id === 'logo',
    )?.props.scale;
  await expect.poll(logoScale, { timeout: 10_000 }).toBeDefined();
  expect(logoScale()).toBeCloseTo(1.5, 1);
  await expect.poll(() => snapshot(frame).then((s) => Math.round(s.bounds.logo.w))).toBe(96);

  // The press on the handle focused the iframe, so the key lands in the editor page.
  // One step forward: past `coin` (the node after it since Task 6 of the media slice).
  await page.keyboard.press(']');
  await expect
    .poll(sceneFile, { timeout: 10_000 })
    .toMatch(/id: board[\s\S]*id: coin[\s\S]*id: logo[\s\S]*id: big_win/);
  expect(
    await frame.evaluate(() =>
      (window as any).__e8edit.emitted().map((e: { event: string }) => e.event),
    ),
  ).toContain('zorder');
});

test('dropping assets/logo.png from the Explorer adds an image node', async ({ page }) => {
  await openSceneTab(page);
  const frame = await readyCanvas(page);
  await page.getByTestId('activity-explorer').click();
  const source = page.getByTestId('explorer-assets/logo.png');
  await expect(source).toBeVisible();

  // Playwright's own drag (`dragTo`) never reaches the cross-origin canvas
  // (measured: `emitted()` stays at `ready`), so the drop is dispatched
  // INSIDE the frame with the Explorer's own type — as `explorer.spec.ts`
  // dispatches a desktop file's. The pointer is the canvas centre: (240, 144).
  await frame.locator('canvas').evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/x-e8-path', 'assets/logo.png');
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

  const row = page.getByTestId('canvas-tree').getByTestId('node-image-1');
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('side-right-scenes').getByTestId('prop-id')).toHaveValue('image-1');
  await expect
    .poll(sceneFile)
    .toMatch(
      /id: image-1\n\s+type: image\n\s+props:\n\s+src: assets\/logo\.png\n\s+x: 240\n\s+'y': 144\n/,
    );
});

test('the Preview still plays', async ({ page }) => {
  await openSceneTab(page);
  await readyCanvas(page);
  // The Preview is its own document; `previewFrame` brings it in FRONT,
  // since a hidden iframe's ticker never finishes a spin.
  const frame = await previewFrame(page);
  await gameBooted(frame);
  expect(await bootStatus(frame)).toBe('ready');
  expect(await spinOnce(frame)).toBe('done');
  expect(await frame.evaluate(() => (window as any).__e8.spins().length)).toBe(1);
});
