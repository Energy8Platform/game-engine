/**
 * The hot fork, proven in a real browser (spec §5, Playwright): a GAME
 * row edited from the IDE's composition screen reaches the running game
 * one of two ways, and the host decides which — a hot row (`reels1`) is
 * re-applied in place and the session lives on; a cold row (`renderer1`)
 * reloads the preview and the session starts over.
 *
 * "Assert what a person would actually see": the frame's own `#status`,
 * its `window.__e8` (`spins()` — the durable log; `gridSize()`/`symbols()`
 * — the LIVE board, added for this suite next to `bound()`), and whether the
 * `<iframe>` element in the IDE is the same one. The patch file on disk
 * is read too, but last, and only as the fourth thing — the other three
 * are the ones a file check could never stand in for.
 *
 * The iframe it watches is the composition document's own `Preview`
 * (`iframe[title="game preview"]`), not the wall on `#/doc/preview`: both
 * key their frame on the same `gameComposition.reloads` count, and the
 * one frame beside the form is the one a person editing that form is
 * looking at. One game per test, no tab switch.
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
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api` and `/ide` to the host on 5679. */
const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

/** The same settle `shell.spec.ts` gives: the game up once on its own URL, then the IDE. */
async function openComposition(page: Page, host: DevHost): Promise<void> {
  await page.goto(host.gameUrl);
  await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
  await page.goto(`${IDE_URL}#/doc/composition`);
}

const PREVIEW = 'iframe[title="game preview"]';

/** The real `Frame` behind the composition document's preview — re-fetched after a remount, since the old one is detached. */
async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.locator(PREVIEW).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('preview iframe has no content frame');
  return frame;
}

async function status(frame: Frame): Promise<string | null> {
  return frame.locator('#status').textContent();
}

async function spins(frame: Frame): Promise<number> {
  return frame.evaluate(() => (window as any).__e8.spins().length);
}

/**
 * One click on the game's own button, waited to `done` — the click sets
 * `spinning…` synchronously, so `done` here is this spin's.
 *
 * The preview is brought into view on the IDE's page FIRST. A `fill` on a
 * row's field below it scrolls the doc pane so the iframe sits well above
 * the viewport, and Chromium pauses `requestAnimationFrame` in an
 * offscreen cross-origin iframe — which Playwright's own "stable" check
 * before a click is built on. Measured 2026-09-20: with the game's canvas
 * filling the iframe (slice 27 — `#mount` is the window, `renderer1`
 * names no size) that check never settles (60 s, rAF silent throughout);
 * with a fixed 480×288 canvas in the same offscreen iframe it settled in
 * 17 ms. The outer-page scroll is what un-throttles the frame (rAF back
 * within 40 ms), and it is the IDE's own element, so it is scrolled from
 * the IDE's side rather than through the frame.
 */
async function spinOnce(page: Page, frame: Frame): Promise<void> {
  await page.locator(PREVIEW).scrollIntoViewIfNeeded();
  await frame.locator('#spin').click();
  await expect.poll(() => status(frame), { timeout: 15_000 }).toBe('done');
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
    const frame = await gameFrame(page);
    await expect.poll(() => status(frame), { timeout: 20_000 }).toBe('ready');
    expect(await frame.evaluate(() => (window as any).__e8.gridSize())).toEqual({
      cols: 5,
      rows: 3,
    });

    await spinOnce(page, frame);
    const before = await spins(frame);
    expect(before).toBe(1);

    await page.locator(PREVIEW).evaluate((el) => {
      el.setAttribute('data-e8-marker', 'kept');
    });

    await commit(page, 'field-reels1-grid-cols', '4');

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
    await spinOnce(page, frame);
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
    const first = await gameFrame(page);
    await expect.poll(() => status(first), { timeout: 20_000 }).toBe('ready');
    await spinOnce(page, first);
    expect(await spins(first)).toBe(1);

    await page.locator(PREVIEW).evaluate((el) => {
      el.setAttribute('data-e8-marker', 'kept');
    });

    await commit(page, 'field-renderer1-width', '500');

    // A remount: a new element, without the stamp.
    await expect(page.locator(PREVIEW)).not.toHaveAttribute('data-e8-marker', 'kept', {
      timeout: 10_000,
    });
    const second = await gameFrame(page);
    await expect.poll(() => status(second), { timeout: 20_000 }).toBe('ready');
    expect(await spins(second)).toBe(0);

    expect(readFileSync(join(dir, 'e8.patch.yml'), 'utf8')).toContain('width: 500');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
