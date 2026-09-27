/**
 * The Reels document, end to end (Task 7): `reels1`'s config edited from
 * the document's own sections lands in `e8.patch.yml` AND reaches the reel
 * lab canvas (`editor.html?reels=`) over its `rows` rpc, without a remount
 * — the same claim `reels-document.test.tsx` proves against a fake
 * `gameComposition`/canvas, now against the real host, the real
 * `first-slot` project (`e8-base` composes all five reel rows:
 * `reels1`/`motion1`/`anticipation1`/`cascade1`/`features1`) and a real
 * `<iframe>`.
 *
 * Same fixture and idioms as `symbols.spec.ts`: a private `projectCopy()`
 * served by `startDevHost`, and `frameOf`/`readyCanvas` — its own
 * `readyCanvas` generalised to any canvas selector, reused here verbatim
 * for `iframe[title="reels canvas"]`.
 *
 * The patch file is read with `js-yaml`'s `load` (`project-fixture.ts`
 * already depends on it for the same reason) rather than matched with a
 * regex: a nested path four keys deep (`grid.frameStyle.idle.color`) is a
 * parse-and-read, not a pattern a hand-written regex could track through
 * `yaml.dump`'s own indentation without becoming as long as the parser
 * itself.
 *
 * One field id per assertion (`#field-reels1-cols`,
 * `#field-anticipation1-enabled`, `#field-reels1-frameStyle-idle`) rather
 * than `getByLabelText` — `SchemaForm`'s own doc explains why: `frameStyle`
 * carries the SAME field names (`color`, `alpha`, and a "hex" textbox with
 * no scoping of its own) once for every one of its four states (`idle`,
 * `winning`, `removed`, `fresh`), and Anticipation's own `zoom` group
 * repeats `enabled` a second time under a different id — `getByLabelText`
 * would go ambiguous on either. `hot-fork.spec.ts`'s `commit()` helper
 * reads a game row's field the same way, one level shallower.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

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

/** `e8.patch.yml`, parsed — the config object a patch row currently carries, or `undefined` for a row the patch does not mention at all yet. */
function patchConfig(id: string): Record<string, any> | undefined {
  const doc = load(readFileSync(join(dir, 'e8.patch.yml'), 'utf8')) as {
    rows: { id: string; config?: Record<string, unknown> }[];
  };
  return doc.rows.find((row) => row.id === id)?.config;
}

async function frameOf(page: Page, selector: string): Promise<Frame> {
  const handle = await page.locator(selector).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`${selector} has no content frame`);
  return frame;
}

/** Polls a canvas iframe's `__e8edit.emitted()` for a `ready` event — `symbols.spec.ts`'s `readyCanvas`, generalised to any canvas selector. */
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

type ReelsSnapshot = {
  mode: 'reels';
  cols: number;
  rows: number[];
  fitted: { w: number; h: number };
  busy: boolean;
};

async function openReels(page: Page): Promise<void> {
  await page.goto(IDE_URL);
  // The activity only registers once the boot GET's rows include `reels1`
  // (`reels.tsx`'s own doc) — `symbols.spec.ts`'s Explorer wait is the same
  // kind of race, just on a different slot.
  await expect(page.getByTestId('activity-reels')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('activity-reels').click();
  await expect(page.getByTestId('reels-doc')).toBeVisible();
}

test('the Reels document edits the reel rows, rebuilds the lab board, spins it, writes a colour as a number and resets a value', async ({
  page,
}) => {
  await openReels(page);

  // `e8-base` composes all five reel rows, so every section draws.
  for (const name of ['grid', 'win', 'board', 'motion', 'anticipation', 'cascade', 'features']) {
    await expect(page.getByTestId(`reels-section-${name}`)).toBeVisible();
  }

  const canvas = await readyCanvas(page, REELS_CANVAS);
  const snapshot = () => canvas.evaluate(() => (window as any).__e8edit.snapshot() as ReelsSnapshot);
  await expect.poll(async () => (await snapshot()).cols).toBe(5);

  await test.step('cols to 6 (blur): the patch and the canvas both pick it up', async () => {
    const cols = page.locator('#field-reels1-cols');
    await cols.fill('6');
    await cols.blur();
    await expect.poll(() => patchConfig('reels1')?.grid?.cols).toBe(6);
    await expect.poll(async () => (await snapshot()).cols).toBe(6);
  });

  await test.step('reels-action-spin: busy true then false, no failure', async () => {
    await page.getByTestId('reels-action-spin').click();
    // Tight polling for the `true` window — the same reasoning
    // `symbols.spec.ts`'s frame-0 poll gives for a short-lived state.
    await expect.poll(async () => (await snapshot()).busy, { intervals: [10, 20, 50] }).toBe(true);
    await expect.poll(async () => (await snapshot()).busy).toBe(false);
    await expect(page.getByTestId('reels-action-status')).toHaveText('');
  });

  await test.step("reels-action-scatters gates on Anticipation's own enabled, off by default", async () => {
    await expect(page.getByTestId('reels-action-scatters')).toBeDisabled();
    // Scoped to the Reels document's own section: Composition (open in the
    // background — the IDE opens it on project open, and it stays mounted
    // while hidden) draws the SAME row's whole config, unrooted, so its
    // own `#field-anticipation1-enabled` collides with this one.
    const anticipation = page.getByTestId('reels-section-anticipation');
    // `.click()`, not `.check()`: the write round-trips through the real
    // host before this controlled checkbox's own `checked` reflects it, so
    // `.check()`'s own "did it change" verification fires before the PUT
    // resolves. The button's own state is the thing the brief cares about.
    await anticipation.locator('#field-anticipation1-enabled').click();
    await expect(page.getByTestId('reels-action-scatters')).toBeEnabled({ timeout: 10_000 });
  });

  await test.step('a colour under Grid > frameStyle > idle > color writes a number', async () => {
    const idle = page.locator('#field-reels1-frameStyle-idle');
    const hex = idle.getByRole('textbox', { name: 'hex' });
    await hex.fill('#ff0000');
    await hex.blur();
    await expect.poll(() => patchConfig('reels1')?.grid?.frameStyle?.idle?.color).toBe(16711680);
  });

  await test.step('reset cols: the patch drops it, the default (5) stands', async () => {
    const grid = page.getByTestId('reels-section-grid');
    await grid.getByRole('button', { name: 'reset cols' }).click();
    await expect.poll(() => patchConfig('reels1')?.grid?.cols).toBeUndefined();
    await expect.poll(async () => (await snapshot()).cols).toBe(5);
  });

  await test.step('Composition shows reels1 with no unsupported union', async () => {
    await page.getByTestId('activity-composition').click();
    await expect(page.getByTestId('row-reels1')).not.toContainText('unsupported (union)');
  });
});
