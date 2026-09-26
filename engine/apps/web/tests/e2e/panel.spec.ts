/**
 * The bottom panel's tabs and the status bar's game item (slice 39),
 * through a live `e8 dev` host and a real browser.
 *
 *  - **The panel is tabs.** One per `shell.panel` entry: Diagnostics is
 *    first (`order: 0`) and selected; its badge is the count the entry
 *    itself pushes (`ctx.shell.setPanelBadge` — errors plus warnings);
 *    collapsing hides the entry but keeps it mounted, the way a hidden
 *    document's pane is kept.
 *  - **`status-game` says what the page's own `#status` used to** — now in
 *    the IDE, read off the running game's flow by its `ide-bridge` and
 *    relayed by the host: `● ready`, `◌ spinning…` while a spin is out,
 *    `✕ <what failed>` (a button that opens the Diagnostics tab), and
 *    `○ no game` once nothing reports.
 *
 * Same fixture as the rest of the suite: a private `projectCopy()` served
 * by `startDevHost`, removed in `afterEach`, and a settle visit to the game
 * before the IDE (see `screens.spec.ts`'s header for why). The game the
 * status item reads is the one the IDE runs — the Preview's, which opens
 * in the background with the project.
 */
import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import {
  gameBooted,
  previewFrame,
  projectCopy,
  spinOnce,
  startDevHost,
  type DevHost,
  type ProjectCopyOptions,
} from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

let dir: string | undefined;
let host: DevHost | undefined;

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
  host = undefined;
  dir = undefined;
});

/** A project copy, its host, the game settled once on its own URL, then the IDE. */
async function openIde(page: Page, options?: ProjectCopyOptions): Promise<DevHost> {
  dir = projectCopy(options);
  host = await startDevHost(dir);
  await page.goto(host.gameUrl);
  await gameBooted(page);
  await page.goto(IDE_URL);
  return host;
}

const gameStatus = (page: Page) => page.getByTestId('status-game');

test('Diagnostics is the first tab and selected, its badge counts the one diagnostic, and collapsing keeps it mounted', async ({
  page,
}) => {
  // `patchRowId`: exactly ONE project diagnostic (its own doc), and the
  // game otherwise composes as the fixture does.
  await openIde(page, { patchRowId: 'panel-probe' });

  const tabs = page.getByTestId('panel').getByRole('tab');
  await expect(tabs.first()).toHaveAttribute('data-testid', 'panel-tab-diagnostics');
  await expect(page.getByTestId('panel-tab-diagnostics')).toHaveAttribute('aria-selected', 'true');
  const entry = page.getByTestId('panel-diagnostics');
  await expect(entry.getByTestId('diagnostics-panel')).toBeVisible();
  await expect(entry).toContainText('panel-probe', { timeout: 20_000 });
  // Read once the IDE's own game is up (its status is in): that game's list
  // mirrors the project's complaint (`createGame`), and the copy is not a
  // second diagnostic — `diagnostics.spec.ts`'s "appears once" case.
  await expect(gameStatus(page)).not.toHaveText(/loading|no game/, { timeout: 30_000 });
  await expect(page.getByTestId('panel-badge-diagnostics')).toHaveText('1');

  await page.getByTestId('panel-toggle').click();
  await expect(entry).toBeHidden();
  // Hidden, not gone: the entry and what it drew are still in the DOM.
  await expect(entry).toHaveCount(1);
  await expect(entry.getByTestId('diagnostics-panel')).toHaveCount(1);
  await page.getByTestId('panel-toggle').click();
  await expect(entry.getByTestId('diagnostics-panel')).toBeVisible();
});

test('status-game follows the game: ready, spinning, ready again, and no game once the project closes', async ({
  page,
}) => {
  await openIde(page);
  const frame = await previewFrame(page);
  await gameBooted(frame);
  await expect(gameStatus(page)).toHaveText('● ready', { timeout: 30_000 });

  // The game's `POST /api/spin` is held (`tempo.spec.ts`'s case 3b does the
  // same; `page.route` sees the Preview iframe's requests too), so the
  // spinning window cannot close under the read: the item flips when the
  // flow's `spin` node is ENTERED — `ide-bridge` sends `spinning` on its
  // `out: null` trace entry, before the request answers — and stays there
  // until the request is let go.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let seen!: () => void;
  const requested = new Promise<void>((r) => (seen = r));
  await page.route('**/api/spin', async (route) => {
    seen();
    await held;
    await route.continue();
  });
  const spun = spinOnce(frame);
  await requested;
  await expect(gameStatus(page)).toHaveText('◌ spinning…');
  release();
  expect(await spun).toBe('done');
  await expect(gameStatus(page)).toHaveText('● ready');

  // The host's own route: nothing in the IDE closes a project from a click.
  const closed = await page.request.post(`${host!.url}/api/workspace/close`);
  expect(closed.ok()).toBe(true);
  await expect(gameStatus(page)).toHaveText('○ no game', { timeout: 20_000 });
});

test('a spin the host refuses reads ✕ spin failed, and a click on it opens the Diagnostics tab', async ({
  page,
}) => {
  // `specId`: the math is asked for a game it does not have, so every
  // `POST /api/spin` fails in the host — the game itself boots and runs.
  await openIde(page, { specId: 'not-a-game' });
  const frame = await previewFrame(page);
  await gameBooted(frame);
  expect(await spinOnce(frame)).toContain('spin failed');
  await expect(gameStatus(page)).toHaveText('✕ spin failed', { timeout: 20_000 });

  // Collapsed first, so the click has something to do: with the panel
  // shut, the Diagnostics entry is hidden until the click selects it.
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('panel-diagnostics')).toBeHidden();
  await gameStatus(page).getByRole('button').click();
  await expect(page.getByTestId('panel-tab-diagnostics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('panel-diagnostics')).toBeVisible();
  await expect(page.getByTestId('panel-diagnostics')).toContainText('spin failed');
});
