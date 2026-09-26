/**
 * The hot fork, proven in a real browser (spec §5, Playwright): a GAME
 * row edited from the IDE's composition screen reaches the running game
 * one of two ways, and the host decides which — a hot row (`reels1`) is
 * re-applied in place and the session lives on; a cold row (`renderer1`)
 * reloads the preview and the session starts over.
 *
 * "Assert what a person would actually see": the frame's own status (what
 * its boot and each spin came to — `bootStatus`/`spinOnce`), its
 * `window.__e8` (`spins()` — the durable log; `gridSize()`/`symbols()` —
 * the LIVE board, added for this suite next to `bound()`), and whether the
 * `<iframe>` element in the IDE is the same one. The patch file on disk
 * is read too, but last, and only as the fourth thing — the other three
 * are the ones a file check could never stand in for.
 *
 * The iframe it watches is the Preview document's
 * (`iframe[title="game preview"]`) — the IDE's one game frame, since the
 * composition document stopped embedding one. It keys on the same
 * `gameComposition.reloads` count the composition's own frame did. So the
 * edit is made on the Composition tab and read back on the Preview tab:
 * open documents stay mounted while hidden, so the element survives the
 * switch unless the host's verdict remounts it, and `previewFrame` makes
 * the Preview the active tab before anything is read (a hidden pane's
 * frame may not paint). One game per test.
 *
 * **Identity.** The iframe carries no nonce attribute (its React `key` is
 * not in the DOM), so the test stamps `data-e8-marker` on the element
 * itself before the edit. A remount is a new element with no stamp; a
 * frame the IDE kept still carries it — the same trick `runtime.spec.ts`
 * plays on the game's `window`, one level up.
 *
 * `runtime.spec.ts`'s mechanic switch is the regression reference for
 * `bridge1` rebinding live — not duplicated here.
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
  spinOnce,
  startDevHost,
  type DevHost,
} from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api` and `/ide` to the host on 5679. */
const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

/** The same settle `shell.spec.ts` gives: the game up once on its own URL, then the IDE. */
async function openComposition(page: Page, host: DevHost): Promise<void> {
  await page.goto(host.gameUrl);
  await gameBooted(page);
  await page.goto(`${IDE_URL}#/doc/composition`);
}

const PREVIEW = 'iframe[title="game preview"]';

/** The Preview's game, booted to `ready` — a fresh `Frame` each call, since a remounted element's old one is detached. */
async function readyFrame(page: Page): Promise<Frame> {
  const frame = await previewFrame(page);
  await gameBooted(frame);
  expect(await bootStatus(frame)).toBe('ready');
  return frame;
}

async function spins(frame: Frame): Promise<number> {
  return frame.evaluate(() => (window as any).__e8.spins().length);
}

/** Back to the Composition tab, where the rows' forms are. */
async function toComposition(page: Page): Promise<void> {
  await page.getByTestId('activity-composition').click();
}

/** Types `value` and leaves the field — a game row's form commits on blur (`commit="blur"`). */
async function commit(page: Page, fieldId: string, value: string): Promise<void> {
  const field = page.locator(`#${fieldId}`);
  await field.fill(value);
  await field.blur();
}

test('game rows: a hot row has a form, a cold row says so, a schemaless row has none', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openComposition(page, host);
    const reels = page.getByTestId('row-reels1');
    await expect(reels.locator('#field-reels1-grid-cols')).toHaveValue('5', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('row-reels1-cold')).toHaveCount(0);

    const renderer = page.getByTestId('row-renderer1');
    // Empty, not `480`: the fixture's `renderer1` names no size any more —
    // the canvas follows the page's `#mount` (slice 27) — and the form
    // shows the absent field as such.
    await expect(renderer.locator('#field-renderer1-width')).toHaveValue('');
    await expect(renderer.getByTestId('row-renderer1-cold')).toHaveText('cold');
    // The badge on the field is the plugin's own word (`applies: 'restart'`).
    await expect(
      renderer
        .locator('.e8-field', { has: page.locator('#field-renderer1-width') })
        .locator('.e8-badge'),
    ).toHaveText('restart');

    const spinlog = page.getByTestId('row-spinlog1');
    await expect(spinlog).toBeVisible();
    await expect(spinlog.locator('input')).toHaveCount(0);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a hot edit reaches the live board and keeps the session: same iframe, same log, next spin plays', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openComposition(page, host);
    const frame = await readyFrame(page);
    expect(await frame.evaluate(() => (window as any).__e8.gridSize())).toEqual({
      cols: 5,
      rows: 3,
    });

    expect(await spinOnce(frame)).toBe('done');
    const before = await spins(frame);
    expect(before).toBe(1);

    await page.locator(PREVIEW).evaluate((el) => {
      el.setAttribute('data-e8-marker', 'kept');
    });

    await toComposition(page);
    await commit(page, 'field-reels1-grid-cols', '4');
    // Back to the Preview, whose `frame` is read below: the SAME one, if
    // the edit kept the game.
    await previewFrame(page);

    // The edit lands asynchronously (PUT → patch write → frame → ide-bridge
    // → `gameRows.update` → a new board). Wait on the board itself.
    await expect
      .poll(() => frame.evaluate(() => (window as any).__e8.gridSize()?.cols), {
        timeout: 10_000,
      })
      .toBe(4);

    // The SAME frame answered — and the element around it was never remounted.
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-e8-marker', 'kept');
    expect(await spins(frame)).toBe(before);

    // The new board is a fresh one — nothing has been drawn on it yet.
    const symbols = () => frame.evaluate(() => (window as any).__e8.symbols());
    const fresh = await symbols();
    expect(fresh).toHaveLength(4);
    expect(fresh.flat().every((symbol: unknown) => symbol === null)).toBe(true);

    // The play loop reads the board lazily: the next spin runs on the NEW
    // board, not the destroyed one a boot-time capture would still hold.
    // A spin on the dead board resolves and gets recorded all the same
    // (measured), so the log growing is not enough — the board on stage
    // has to be the one that changed.
    expect(await spinOnce(frame)).toBe('done');
    expect(await spins(frame)).toBe(before + 1);
    const drawn = await symbols();
    expect(drawn).toHaveLength(4);
    expect(drawn.flat().every((symbol: unknown) => typeof symbol === 'string')).toBe(true);

    expect(readFileSync(join(dir, 'e8.patch.yml'), 'utf8')).toContain('cols: 4');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a cold edit reloads the preview: a new iframe, a fresh game, an empty log', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openComposition(page, host);
    const first = await readyFrame(page);
    expect(await spinOnce(first)).toBe('done');
    expect(await spins(first)).toBe(1);

    await page.locator(PREVIEW).evaluate((el) => {
      el.setAttribute('data-e8-marker', 'kept');
    });

    await toComposition(page);
    await commit(page, 'field-renderer1-width', '500');

    // A remount: a new element, without the stamp.
    await expect(page.locator(PREVIEW)).not.toHaveAttribute('data-e8-marker', 'kept', {
      timeout: 10_000,
    });
    const second = await readyFrame(page);
    expect(await spins(second)).toBe(0);

    expect(readFileSync(join(dir, 'e8.patch.yml'), 'utf8')).toContain('width: 500');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
