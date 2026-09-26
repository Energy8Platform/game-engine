/**
 * The IDE's screens through a live `e8 dev` host and a real browser — first
 * written as the acceptance suite of "a screen is a plugin"
 * (`.superpowers/sdd/2026-09-09-a-screen-is-a-plugin/`), rewritten for
 * slice 39, where the Preview stopped being a wall of tiles and became ONE
 * frame with the legacy harness's toolbar (`Preview.tsx`).
 *
 * Two cases the first suite could have carried live elsewhere, and a
 * second copy would only drift from the first:
 *
 *  - "a project plugin's screen appears in the navigation" is
 *    `screen-demo.spec.ts`'s "a project plugin brings its own screen, no
 *    engine change required".
 *  - "a screen that throws leaves the rest of the IDE usable" is
 *    `screen-demo.spec.ts`'s "the demo screen can be made to fail as data,
 *    on request, without taking the IDE down".
 *
 * Here:
 *
 *  1. The IDE opens ON a document (not merely lists one), and a second
 *     document is one real `ctx.shell.openContributed()` round trip away.
 *  2. A deep link — a hard navigation straight to `#/doc/preview`, the way
 *     a bookmark or a typed address would arrive — opens on the screen it
 *     names, not the default. A different code path from #1: this is the
 *     hash read at `ready()`, before any `hashchange` has ever fired.
 *  3. The Preview is one frame at the first preset's size (Desktop,
 *     1200×675), and the game inside it is laid out at that size.
 *  4. The toolbar reaches the GAME, not only the frame: a Mobile preset
 *     resizes the frame and relaunches the game as a mobile session, and
 *     Rotate swaps the frame's sides without relaunching it.
 *  5. Currency, balance and social reach the game's own `session.init`
 *     (`__e8.session()` — `/api/session`'s answer to the address
 *     `session-host` forwarded), and the choice survives a reload.
 *  6. The diagnostics panel is visible while the Preview is open.
 *
 * **What went with the wall.** The first suite's "two tiles reporting
 * trouble both appear, attributed to their tiles" is gone, not moved:
 * there are no tiles, and the one frame carries no `?game=` identity (slice
 * 39's plan amendment 1 — one frame is the anonymous game), so there is
 * nothing left to attribute a row to. Its second half — a page that
 * connects late learns what the game said from the host's retained frame,
 * replayed on connect — is `diagnostics.spec.ts`'s for the one game, whose
 * every test opens the editor last and tells it nothing directly.
 *
 * Every project here is a private `projectCopy()`, removed in a `finally`
 * — see `./project-fixture`. Every test visits the game and waits for it
 * to settle before touching the IDE at all — the same reason
 * `declared.spec.ts` and `screen-demo.spec.ts` both give at length:
 * `startDevHost` starts the project's own vite instance unconditionally and
 * hands it every row to pre-bundle in the background before any page ever
 * asks for anything, and `host.stop()` tearing that down mid-build measured
 * flaky under the full suite for a test that skipped this wait.
 */
import { rmSync } from 'node:fs';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { gameBooted, previewFrame, projectCopy, startDevHost } from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api`, `/plugin-client` and `/ide` to the host on 5679. */
const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

/** The Preview document's one game frame. */
const PREVIEW = 'iframe[title="game preview"]';

/** The game's own `session.init`, as `__e8.session()` answers it. */
interface SessionInit {
  balance: number;
  currency: { code: string };
  device?: string;
  social?: boolean;
}

/**
 * The Preview's game once the frame's address carries `param` — a toolbar
 * change that alters the address RELAUNCHES the frame (a new element), so
 * the address is waited on first and the frame read fresh after it.
 */
async function relaunched(page: Page, param: RegExp): Promise<Frame> {
  await expect(page.locator(PREVIEW)).toHaveAttribute('src', param);
  const frame = await previewFrame(page);
  await gameBooted(frame);
  return frame;
}

const session = (frame: Frame) =>
  frame.evaluate(() => (window as any).__e8.session() as SessionInit);
/** The size the game itself is laid out at — the frame's inside, not its border. */
const viewport = (frame: Frame) => frame.evaluate(() => [innerWidth, innerHeight]);

test('the IDE opens on a screen, and a second screen is one click away', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await gameBooted(page);

    await page.goto(IDE_URL);
    // "Opens ON a screen": the first tab is not just present, it is the
    // CURRENT one — `App` opening the composition for an empty hash, not
    // the shell merely listing what got registered.
    const compositionTab = page.getByTestId('doc-composition');
    await expect(compositionTab).toBeVisible({ timeout: 20_000 });
    await expect(compositionTab).toHaveAttribute('aria-selected', 'true');

    // "One click away": a real `ctx.shell.openContributed()` round trip —
    // the address hash changes, `Shell` re-renders, and the DOCUMENT'S OWN
    // CONTENT (not just its tab) draws — the game frame, never the preview
    // document's own empty or loading state.
    await page.getByTestId('activity-preview').click();
    await expect(page.getByTestId('doc-preview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(PREVIEW)).toBeVisible();
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deep link opens the screen it names', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await gameBooted(page);

    // A hard navigation straight to the address, the way a bookmark or a
    // typed URL would arrive — never a click, which is the test above's
    // own path through the activity bar. This one is the hash read at
    // `ready()`, before any `hashchange` event has ever fired.
    await page.goto(`${IDE_URL}#/doc/preview`);
    await expect(page.getByTestId('doc-preview')).toHaveAttribute('aria-selected', 'true', {
      timeout: 20_000,
    });
    await expect(page.locator(PREVIEW)).toBeVisible();
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Preview is one frame, at the Desktop preset’s 1200×675', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await gameBooted(page);

    await page.goto(`${IDE_URL}#/doc/preview`);
    // One, not three: the wall's tiles are gone.
    await expect(page.locator(PREVIEW)).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId('preview-preset')).toHaveValue('Desktop');
    await expect(page.locator(PREVIEW)).toHaveAttribute('width', '1200');
    await expect(page.locator(PREVIEW)).toHaveAttribute('height', '675');
    const frame = await previewFrame(page);
    await gameBooted(frame);
    expect(await viewport(frame)).toEqual([1200, 675]);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Mobile S makes the game a 320×568 mobile session; Rotate swaps the frame without relaunching it', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await gameBooted(page);
    await page.goto(`${IDE_URL}#/doc/preview`);
    const desktop = await previewFrame(page);
    await gameBooted(desktop);
    // The control: a desktop preset says nothing about the device.
    expect((await session(desktop)).device).toBeUndefined();

    await page.getByTestId('preview-preset').selectOption('Mobile S');
    const mobile = await relaunched(page, /[?&]device=mobile(&|$)/);
    await expect(page.locator(PREVIEW)).toHaveAttribute('width', '320');
    await expect(page.locator(PREVIEW)).toHaveAttribute('height', '568');
    expect(await viewport(mobile)).toEqual([320, 568]);
    expect((await session(mobile)).device).toBe('mobile');

    // Rotate is a RESIZE of the running game, not a new one: the element
    // (stamped) and the game inside it (its session) are the same after.
    await page.locator(PREVIEW).evaluate((el) => el.setAttribute('data-e8-marker', 'kept'));
    await page.getByTestId('preview-rotate').click();
    await expect(page.locator(PREVIEW)).toHaveAttribute('width', '568');
    await expect(page.locator(PREVIEW)).toHaveAttribute('height', '320');
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-e8-marker', 'kept');
    await expect.poll(() => viewport(mobile)).toEqual([568, 320]);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('currency, balance and social reach the game’s own session, and survive a reload', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await gameBooted(page);
    await page.goto(`${IDE_URL}#/doc/preview`);
    const before = await previewFrame(page);
    await gameBooted(before);
    // The control: the dev host's own defaults, before the toolbar says anything.
    expect(await session(before)).toMatchObject({ balance: 1000, currency: { code: 'USD' } });
    expect((await session(before)).social).toBeUndefined();

    await page.getByTestId('preview-currency').selectOption('EUR');
    await relaunched(page, /[?&]currency=EUR(&|$)/);
    // The balance commits on Enter (or blur), not per keystroke.
    await page.getByTestId('preview-balance').fill('250');
    await page.getByTestId('preview-balance').press('Enter');
    await relaunched(page, /[?&]balance=250(&|$)/);
    await page.getByTestId('preview-social').check();
    const after = await relaunched(page, /[?&]social=1(&|$)/);
    expect(await session(after)).toMatchObject({
      balance: 250,
      currency: { code: 'EUR' },
      social: true,
    });

    // The toolbar is remembered (`localStorage['e8.preview']`): a reload
    // comes back with the same choice, and the game with the same session.
    await page.reload();
    await expect(page.getByTestId('preview-currency')).toHaveValue('EUR', { timeout: 20_000 });
    await expect(page.getByTestId('preview-balance')).toHaveValue('250');
    await expect(page.getByTestId('preview-social')).toBeChecked();
    const reloaded = await relaunched(page, /[?&]social=1(&|$)/);
    expect(await session(reloaded)).toMatchObject({
      balance: 250,
      currency: { code: 'EUR' },
      social: true,
    });
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The panel is chrome — present under every document, the Preview
 * included — so it is right there with no diagnostic raised and no second
 * page opened.
 */
test('the diagnostics panel is visible while the Preview is open', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await gameBooted(page);

    await page.goto(`${IDE_URL}#/doc/preview`);
    await expect(page.locator(PREVIEW)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('diagnostics-panel')).toBeVisible();
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
