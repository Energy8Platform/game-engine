/**
 * Sidebars follow the tab, proven in a real browser: a document's declared
 * `sidebar`/`sideRight` are what show beside it — Flow's properties leave
 * with the tab and come back with the same node's, Symbols' list and
 * Reels' settings sit beside their own canvas rather than inside the
 * document pane — and the Explorer activity view, picked OVER a tab's own
 * sidebar, yields only to a tab that declares one of its own.
 *
 * Same fixture and idioms as `flow.spec.ts` (`openComposition`/`openFlow`,
 * the Preview's `window.__e8`) and `reels.spec.ts` (`readyCanvas` on the
 * reels lab canvas) — both copied here rather than imported, the suite's
 * own convention (one copy per spec file).
 *
 * Every "still showing"/"now hidden" claim reads the shell's own class or
 * the entry's `hidden` state, never merely an absent piece of text — a
 * wrapper that stayed mounted but empty would otherwise read the same as
 * one correctly collapsed.
 */
import { rmSync } from 'node:fs';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { gameBooted, previewFrame, projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;
const REELS_CANVAS = 'iframe[title="reels canvas"]';

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

/** The game up once on its own URL, then the IDE on its composition document — `flow.spec.ts`'s own. */
async function openComposition(page: Page): Promise<void> {
  await page.goto(host.gameUrl);
  await gameBooted(page);
  await page.goto(`${IDE_URL}#/doc/composition`);
  await gameBooted(await previewFrame(page));
}

/** The Flow document in front, its nodes drawn with ports — `flow.spec.ts`'s own. */
async function openFlow(page: Page): Promise<void> {
  await page.getByTestId('activity-flow').click();
  await expect(page.getByTestId('flow-screen')).toBeVisible();
  await expect(page.getByTestId('flow-node-draw')).toBeVisible();
}

async function frameOf(page: Page, selector: string): Promise<Frame> {
  const handle = await page.locator(selector).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`${selector} has no content frame`);
  return frame;
}

/** Polls a canvas iframe's `__e8edit.emitted()` for a `ready` event — `reels.spec.ts`'s own. */
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

test('Flow: the right sidebar leaves for the Preview tab and comes back with the same node', async ({
  page,
}) => {
  await openComposition(page);
  await openFlow(page);

  await page.getByTestId('flow-node-draw').click();
  const flowRight = page.getByTestId('side-right-flow');
  await expect(flowRight.getByTestId('prop-id')).toHaveValue('draw');
  await expect(flowRight.getByTestId('prop-kind')).toHaveText('present');

  await page.getByTestId('activity-preview').click();
  // Not merely "no properties text" — the shell's own collapse class, and
  // the entry itself hidden rather than unmounted (it stays mounted so a
  // later return does not lose the selection it drew).
  await expect(page.getByTestId('shell')).toHaveClass(/e8-side-right-collapsed/);
  await expect(flowRight).toBeHidden();

  await page.getByTestId('activity-flow').click();
  await expect(page.getByTestId('shell')).not.toHaveClass(/e8-side-right-collapsed/);
  await expect(flowRight).toBeVisible();
  await expect(flowRight.getByTestId('prop-id')).toHaveValue('draw');
  await expect(flowRight.getByTestId('prop-kind')).toHaveText('present');
});

test('Symbols: the symbol list is the left sidebar, not part of the document pane', async ({
  page,
}) => {
  await page.goto(`${IDE_URL}#/doc/symbols`);
  await expect(page.getByTestId('symbols-doc')).toBeVisible();

  // A deep link straight onto a document with its own `sidebar` shows it
  // with no click — the tab's own declaration, not the Explorer default.
  await expect(page.getByTestId('sidebar-symbols').getByTestId('symbol-row-1')).toBeVisible();
  // The document pane itself draws none of these rows any more — proven
  // by absence WITHIN the pane, not merely by finding one somewhere on
  // the page (the sidebar copy would satisfy that vacuously).
  await expect(
    page.getByTestId('symbols-doc').locator('[data-testid^="symbol-row-"]'),
  ).toHaveCount(0);

  // The entry fills the column, so the list's "drop here for a new
  // symbol" area stretches down it rather than sitting at its 48px floor.
  const column = (await page.getByTestId('sidebar').boundingBox())!;
  const entry = (await page.getByTestId('sidebar-symbols').boundingBox())!;
  expect(entry.height).toBeGreaterThanOrEqual(column.height - 4);
  expect((await page.getByTestId('symbols-drop-new').boundingBox())!.height).toBeGreaterThan(100);
});

test('Reels: the settings are the right sidebar, and cols 5 to 6 rebuilds the canvas board', async ({
  page,
}) => {
  await page.goto(IDE_URL);
  // The activity only registers once the boot GET's rows include `reels1` — `reels.spec.ts`'s own wait.
  await expect(page.getByTestId('activity-reels')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('activity-reels').click();
  await expect(page.getByTestId('reels-doc')).toBeVisible();

  const settings = page.getByTestId('side-right-reels');
  const cols = settings.locator('#field-reels-reels1-cols');
  await expect(cols).toBeVisible();
  // Not inside the document pane any more — the document is the toolbar
  // and canvas alone since the settings moved out to the right sidebar.
  await expect(page.getByTestId('reels-doc').locator('#field-reels-reels1-cols')).toHaveCount(0);

  const canvas = await readyCanvas(page, REELS_CANVAS);
  const snapshot = () =>
    canvas.evaluate(() => (window as any).__e8edit.snapshot() as { cols: number; rows: number[] });
  await expect.poll(snapshot).toMatchObject({ cols: 5 });

  await cols.fill('6');
  await cols.blur();
  await expect.poll(async () => (await snapshot()).cols).toBe(6);
  await expect.poll(async () => (await snapshot()).rows.length).toBe(6);
});

test('Explorer over Symbols: it yields to a tab with its own sidebar, and returns for one with none', async ({
  page,
}) => {
  await page.goto(`${IDE_URL}#/doc/symbols`);
  await expect(page.getByTestId('symbols-doc')).toBeVisible();
  await expect(page.getByTestId('sidebar-symbols')).toBeVisible();

  await page.getByTestId('activity-explorer').click();
  await expect(page.getByTestId('sidebar-explorer')).toBeVisible();
  await expect(page.getByTestId('sidebar-symbols')).toBeHidden();

  // Flow declares its own left sidebar (`Nodes`): the picked Explorer view
  // yields to it rather than staying pinned over the new tab.
  await page.getByTestId('activity-flow').click();
  await expect(page.getByTestId('sidebar-flow')).toBeVisible();
  await expect(page.getByTestId('sidebar-explorer')).toBeHidden();

  await page.getByTestId('activity-explorer').click();
  await expect(page.getByTestId('sidebar-explorer')).toBeVisible();
  await expect(page.getByTestId('explorer-game/script.spin')).toBeVisible();

  // A code file declares no sidebar of its own, so opening it does not
  // make the picked Explorer view yield the way Flow's tab did above.
  await page.getByTestId('explorer-game/script.spin').click();
  await expect(page.getByTestId('doc-pane-f:game/script.spin')).toBeVisible();
  await expect(page.getByTestId('sidebar-explorer')).toBeVisible();
});
