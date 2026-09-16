import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PNG_BYTES, projectCopy, startDevHost, type DevHost } from './project-fixture';

/**
 * The Explorer's verbs against a real host and a real disk: what the tree
 * shows after each is what `fs` shows. Drops from the desktop cannot be
 * driven by Playwright's mouse — `dragTo` carries no `dataTransfer.files`
 * — so the OS drop is a `drop` event dispatched from inside the page with
 * a `DataTransfer` built there (measured: jsdom has none, Chromium does).
 *
 * The last test does not observe the restart itself — a real `e8-server`
 * comes back too fast for a status poll to catch it mid-flight — that chain
 * (`files/written` on a `.spin` move → `session.restart()`) is proven at the
 * unit level by `files.test.ts`'s "emits files/removed … files/written" and
 * `dev-game.test.ts`'s "restart on a script.spin write"; this test proves
 * only what a browser can see: a rename inside `game/` leaves the engine
 * alive on both sides of the round trip.
 */
const IDE_URL = 'http://127.0.0.1:5680/';

let dir: string;
let host: DevHost;

test.beforeEach(async ({ page }) => {
  dir = projectCopy();
  writeFileSync(join(dir, 'win.mp3'), Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]));
  host = await startDevHost(dir);
  await page.goto(IDE_URL);
  await expect(page.getByTestId('explorer-game/script.spin')).toBeVisible({ timeout: 20_000 });
});

test.afterEach(async () => {
  await host.stop();
  rmSync(dir, { recursive: true, force: true });
});

const row = (page: Page, path: string) => page.getByTestId(`explorer-${path}`);

test('new folder, new file in it, rename, delete the folder — the disk agrees at every step', async ({
  page,
}) => {
  await page.getByTestId('explorer-new-folder').click();
  await page.getByTestId('explorer-input').fill('assets');
  await page.keyboard.press('Enter');
  await expect(row(page, 'assets')).toBeVisible();
  expect(existsSync(join(dir, 'assets'))).toBe(true);

  await row(page, 'assets').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New file' }).click();
  await page.getByTestId('explorer-input').fill('readme.txt');
  await page.keyboard.press('Enter');
  await expect(row(page, 'assets/readme.txt')).toBeVisible();
  expect(existsSync(join(dir, 'assets', 'readme.txt'))).toBe(true);

  await row(page, 'assets/readme.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByTestId('explorer-input').fill('notes.txt');
  await page.keyboard.press('Enter');
  await expect(row(page, 'assets/notes.txt')).toBeVisible();
  expect(existsSync(join(dir, 'assets', 'notes.txt'))).toBe(true);
  expect(existsSync(join(dir, 'assets', 'readme.txt'))).toBe(false);

  await row(page, 'assets').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('delete folder "assets" and 1 entries?')).toBeVisible();
  await page.getByTestId('confirm-yes').click();
  await expect(row(page, 'assets')).toHaveCount(0);
  expect(existsSync(join(dir, 'assets'))).toBe(false);
});

test('dragging a file onto a folder moves it on disk', async ({ page }) => {
  await page.getByTestId('explorer-new-folder').click();
  await page.getByTestId('explorer-input').fill('assets');
  await page.keyboard.press('Enter');
  await expect(row(page, 'assets')).toBeVisible();
  await row(page, 'game/spec.json').dragTo(row(page, 'assets'));
  await expect(row(page, 'assets/spec.json')).toBeVisible();
  expect(existsSync(join(dir, 'assets', 'spec.json'))).toBe(true);
  expect(existsSync(join(dir, 'game', 'spec.json'))).toBe(false);
});

test('a file dropped from the desktop onto a folder lands in it', async ({ page }) => {
  await page.getByTestId('explorer-new-folder').click();
  await page.getByTestId('explorer-input').fill('art');
  await page.keyboard.press('Enter');
  await expect(row(page, 'art')).toBeVisible();
  await row(page, 'art').evaluate((el, bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'logo.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, Array.from(PNG_BYTES));
  await expect(row(page, 'art/logo.png')).toBeVisible();
  expect(existsSync(join(dir, 'art', 'logo.png'))).toBe(true);
});

test('an .mp3 opens in an audio player', async ({ page }) => {
  await row(page, 'win.mp3').click();
  const audio = page.getByTestId('viewer-audio');
  await expect(audio).toBeVisible();
  await expect(audio).toHaveAttribute('src', '/api/files/win.mp3');
});

test('renaming the maths inside game/ keeps the engine alive', async ({ page }) => {
  const status = page.getByTestId('status-session');
  await expect(status).toHaveText('e8-server ●', { timeout: 20_000 });

  await row(page, 'game/script.spin').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByTestId('explorer-input').fill('main.spin');
  await page.keyboard.press('Enter');
  await expect(row(page, 'game/main.spin')).toBeVisible();
  expect(existsSync(join(dir, 'game', 'main.spin'))).toBe(true);
  expect(existsSync(join(dir, 'game', 'script.spin'))).toBe(false);
  await expect(status).toHaveText('e8-server ●', { timeout: 20_000 });

  await row(page, 'game/main.spin').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByTestId('explorer-input').fill('script.spin');
  await page.keyboard.press('Enter');
  await expect(row(page, 'game/script.spin')).toBeVisible();
  await expect(status).toHaveText('e8-server ●', { timeout: 20_000 });
});
