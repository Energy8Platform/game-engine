/**
 * Scenes and layers, proven in a real browser (spec §5, Playwright): the
 * Scenes sidebar edits `stage1`'s `layers`/`scenes`, the host writes them
 * to `e8.patch.yml` and re-applies the stage row IN PLACE (no reload), the
 * running game enters the scene on the next spin and hides the layers it
 * leaves out, and clicking a scene pushes it into the game without a spin
 * at all. The Composition screen shows the same row as a form — `layers`
 * as array rows, `design.width` still a `restart` field whose edit reloads
 * the preview.
 *
 * Same iframe, same readers as `hot-fork.spec.ts`: the composition
 * document's `Preview` (`iframe[title="game preview"]`), stamped with
 * `data-e8-marker` so a remount is visible, and the game's own
 * `window.__e8` (`spin()`, `spins()`, `sceneCurrent()`, `layerVisible()`).
 * The Scenes view is a SIDEBAR beside the composition document, which
 * stays in front the whole time — so the frame a Scenes edit is measured
 * against is the one the composition screen booted, never a fresh one,
 * and it keeps getting animation frames while the sidebar is used.
 *
 * **Knowing a hot edit landed.** A stage re-apply builds a NEW stage
 * (`current()` starts `null`), so the protocol is: spin first (`current`
 * becomes `base_game`), edit, then wait for `current` to read `null` —
 * that null is THIS edit's re-apply, and only then is the next spin (or
 * the next preview push) made against the stage that has the new config.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = 'http://127.0.0.1:5680/';
const PREVIEW = 'iframe[title="game preview"]';

/**
 * The game up once on its own URL, then the IDE on its composition document
 * (as `hot-fork.spec.ts`). `settle: false` skips that first visit: the IDE
 * boots the game itself, the way a person opening the IDE does.
 */
async function openComposition(page: Page, host: DevHost, settle = true): Promise<void> {
  if (settle) {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
  }
  await page.goto(`${IDE_URL}#/doc/composition`);
}

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.locator(PREVIEW).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('preview iframe has no content frame');
  return frame;
}

const status = (frame: Frame) => frame.locator('#status').textContent();
const spins = (frame: Frame) => frame.evaluate(() => (window as any).__e8.spins().length);
const current = (frame: Frame) =>
  frame.evaluate(() => (window as any).__e8.sceneCurrent() as string | null);
const visible = (frame: Frame, id: string) =>
  frame.evaluate((layer) => (window as any).__e8.layerVisible(layer) as boolean | null, id);

/** Shows the Scenes sidebar. The activity button TOGGLES, so only a hidden one is clicked. */
async function showScenes(page: Page): Promise<void> {
  const scenes = page.getByTestId('scenes-screen');
  if (!(await scenes.isVisible())) await page.getByTestId('activity-scenes').click();
  await expect(scenes).toBeVisible();
  await expect(page.getByTestId('sidebar').getByTestId('scenes-screen')).toBeVisible();
}

/** One real spin through the harness; the composition document (and its iframe) is in front throughout. */
async function spin(page: Page, frame: Frame): Promise<void> {
  await frame.evaluate(() => (window as any).__e8.spin().then(() => null));
  expect(await current(frame)).toBe('base_game');
}

/** The stage row was re-applied in place: a new stage, in no scene yet. */
async function reapplied(frame: Frame): Promise<void> {
  await expect.poll(() => current(frame), { timeout: 10_000 }).toBeNull();
}

/** Boots to `ready`, stamps the iframe, spins once (the stage in `base_game`), and opens the Scenes sidebar. */
async function openScenes(page: Page, host: DevHost, settle = true): Promise<Frame> {
  await openComposition(page, host, settle);
  const frame = await gameFrame(page);
  await expect.poll(() => status(frame), { timeout: 20_000 }).toBe('ready');
  await page.locator(PREVIEW).evaluate((el) => {
    el.setAttribute('data-e8-marker', 'kept');
  });
  await spin(page, frame);
  await showScenes(page);
  return frame;
}

/** `+`, then the id, then Enter — the row is listed once the host's frame is back. */
async function addScene(page: Page, id: string): Promise<void> {
  await page.getByTestId('scene-add').click();
  const input = page.getByTestId('scene-add-input');
  await input.fill(id);
  await input.press('Enter');
  await expect(page.getByTestId(`scene-${id}`)).toBeVisible({ timeout: 10_000 });
}

const patch = (dir: string) => readFileSync(join(dir, 'e8.patch.yml'), 'utf8');

test('the Scenes sidebar adds a scene: the layer is listed, the patch holds it, the preview was not reloaded', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    const frame = await openScenes(page, host);

    // Nothing is a scene yet; the layer is listed but has nothing to be shown in.
    await expect(page.getByTestId('scenes-none')).toBeVisible();
    await expect(page.getByLabel('reels', { exact: true })).toBeDisabled();
    // The script's one stage is offered once the input is up.
    await page.getByTestId('scene-add').click();
    await expect(page.locator('#e8-scene-add-stages option[value="base_game"]')).toHaveCount(1);
    await page.getByTestId('scene-add-input').press('Escape');

    await addScene(page, 'base_game');
    await expect(page.getByTestId('scenes-none')).toHaveCount(0);
    await expect(page.getByLabel('reels in base_game')).toBeChecked();

    await expect.poll(() => patch(dir), { timeout: 10_000 }).toContain('scenes:');
    const written = patch(dir);
    expect(written).toContain('base_game:');
    expect(written).toMatch(/layers:\n\s+- reels/);

    // The edit reached the game in place: a new stage, the same frame, the same log.
    await reapplied(frame);
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-e8-marker', 'kept');
    expect(await spins(frame)).toBe(1);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a layer left out of a scene is hidden after the next spin, and shown again once it is back', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    const frame = await openScenes(page, host);
    await addScene(page, 'base_game');
    await reapplied(frame);
    await spin(page, frame);
    expect(await visible(frame, 'reels')).toBe(true);

    // `click`, not `uncheck`: the box is controlled by the host's rows, so
    // it flips only when the PUT's frame comes back — `uncheck` would
    // fail on "clicking did not change its state" (measured).
    const reels = page.getByLabel('reels in base_game');
    await reels.click();
    await expect(reels).not.toBeChecked({ timeout: 10_000 });
    await reapplied(frame);
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-e8-marker', 'kept');

    await spin(page, frame);
    expect(await visible(frame, 'reels')).toBe(false);
    expect(await current(frame)).toBe('base_game');

    await reels.click();
    await expect(reels).toBeChecked({ timeout: 10_000 });
    await reapplied(frame);
    await spin(page, frame);
    expect(await visible(frame, 'reels')).toBe(true);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scene the script has no stage for is warned about, takes a transition, and a click shows it in the preview', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    // No settling visit: the game must boot AFTER the IDE's boot GET, so
    // the transitions below can only have come over the socket.
    const frame = await openScenes(page, host, false);

    await addScene(page, 'free_spins');
    // Not a stage the script declares: never offered, but taken.
    await page.getByTestId('scene-add').click();
    await expect(page.locator('#e8-scene-add-stages option')).toHaveCount(1);
    await expect(page.locator('#e8-scene-add-stages option[value="free_spins"]')).toHaveCount(0);
    await page.getByTestId('scene-add-input').press('Escape');
    await expect(page.getByTestId('scenes-screen')).toContainText('has no stage of that name', {
      timeout: 10_000,
    });
    await reapplied(frame);

    await spin(page, frame);
    // The game's transitions reached the pick list over the socket, no reload.
    await expect
      .poll(() => page.getByTestId('scene-transition').locator('option').allTextContents(), {
        timeout: 10_000,
      })
      .toEqual(['stage default', 'cut', 'fade']);
    await page.getByTestId('scene-transition').selectOption('fade');
    await expect(page.getByTestId('scene-transition')).toHaveValue('fade', { timeout: 10_000 });
    await expect.poll(() => patch(dir), { timeout: 10_000 }).toContain('transition: fade');
    await reapplied(frame);

    await page.getByTestId('scene-free_spins').click();
    await expect.poll(() => current(frame), { timeout: 2_000 }).toBe('free_spins');
    await expect(page.getByTestId('scene-free_spins')).toHaveText(/fade/);
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-e8-marker', 'kept');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Composition form shows the stage layers as rows, and design.width still restarts the preview', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openComposition(page, host);
    const first = await gameFrame(page);
    await expect.poll(() => status(first), { timeout: 20_000 }).toBe('ready');

    const stage = page.getByTestId('row-stage1');
    await expect(stage.getByTestId('array-row-field-stage1-layers-0')).toBeVisible({
      timeout: 20_000,
    });
    await expect(stage.locator('#field-stage1-layers-0-id')).toHaveValue('reels');
    // The innermost field: `design` (the group) carries a badge of its own.
    await expect(
      stage.locator('.e8-field:has(> label[for="field-stage1-design-width"]) > .e8-badge'),
    ).toHaveText('restart');

    await page.locator(PREVIEW).evaluate((el) => {
      el.setAttribute('data-e8-marker', 'kept');
    });
    const width = page.locator('#field-stage1-design-width');
    await width.fill('500');
    await width.blur();

    // A remount: a new element without the stamp, and a fresh game behind it.
    await expect(page.locator(PREVIEW)).not.toHaveAttribute('data-e8-marker', 'kept', {
      timeout: 10_000,
    });
    const second = await gameFrame(page);
    await expect.poll(() => status(second), { timeout: 20_000 }).toBe('ready');
    expect(patch(dir)).toContain('width: 500');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
