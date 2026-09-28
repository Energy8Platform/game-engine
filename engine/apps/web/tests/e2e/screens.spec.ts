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
  /** The bet-multiplier price of each named action (`session-host`'s own `init.actions`) — fixed for the life of the seed, unaffected by any play. */
  actions?: Record<string, number>;
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

/**
 * The shell's own live readout (`build.spec.ts`'s and `game-shell.spec.ts`'s
 * own window onto the RUNNING wallet) — `balance` starts at the one the game
 * opened with and is what the flow's `bal` node last landed there from a
 * spin's own result, `bet` the current bet level. Unlike `session(frame)`
 * above (the balance the game STARTED with, never touched by a play), this
 * is the one signal that reflects what `session-host`'s own in-memory
 * `balance` actually is right now.
 */
const shellState = (frame: Frame) =>
  frame.evaluate(() => (window as any).__e8.shell()!.state as { balance: number; bet: number });

/** One spin's own result, off the durable spin log (`build.spec.ts`'s own read) — `.balance` the running total AFTER this spin, `.winAmount` what it paid. */
const lastResult = (frame: Frame) =>
  frame.evaluate(
    () => (window as any).__e8.spins().at(-1).result as { balance: number; winAmount: number },
  );

/**
 * One spin on `frame`, asserting its result CONTINUES the running wallet
 * from `start` at `price` (bet × `session().actions.spin`) — the same
 * arithmetic `build.spec.ts` checks (`result.balance ≈ start - bet×price +
 * winAmount`). This is the only check in this test that actually exercises
 * `session-host`'s own READ of a persisted wallet: `__e8.session()` never
 * changes after boot, whatever a play stores, and a raw
 * `sessionStorage` read only proves a PRIOR write landed — never that the
 * CURRENT page's own code read it back. A `session-host` that silently
 * ignored the address's `wallet=` (or its stored value) would still leave
 * the old bytes sitting there for a naive storage read to find, but this
 * spin's own resulting balance would betray it — it would continue from
 * the wrong `start`. Returns the resulting balance, so a caller can chain
 * `start` into the next `spinFrom` call.
 */
async function spinFrom(frame: Frame, start: number, price: number): Promise<number> {
  const bet = (await shellState(frame)).bet;
  await frame.evaluate(() => (window as any).__e8.spin());
  const result = await lastResult(frame);
  expect(result.balance).toBeCloseTo(start - bet * price + result.winAmount, 6);
  return result.balance;
}

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
    // The control: the Preview's OWN default (`DEFAULT_PREVIEW_STATE.balance`,
    // slice 43), before the toolbar says anything — not the dev host's bare
    // fallback, since the Preview's address always carries a `balance=`.
    expect(await session(before)).toMatchObject({ balance: 10_000, currency: { code: 'USD' } });
    expect((await session(before)).social).toBeUndefined();

    await page.getByTestId('preview-currency').selectOption('EUR');
    await relaunched(page, /[?&]currency=EUR(&|$)/);
    // A pick commits at once — `preview-balance` is a `<select>` of the
    // harness's own levels (slice 43), not a free-typed amount.
    await page.getByTestId('preview-balance').selectOption({ label: '1K' });
    await relaunched(page, /[?&]balance=1000(&|$)/);
    await page.getByTestId('preview-social').check();
    const after = await relaunched(page, /[?&]social=1(&|$)/);
    expect(await session(after)).toMatchObject({
      balance: 1000,
      currency: { code: 'EUR' },
      social: true,
    });

    // The toolbar is remembered (`localStorage['e8.preview']`): a reload
    // comes back with the same choice, and the game with the same session.
    await page.reload();
    await expect(page.getByTestId('preview-currency')).toHaveValue('EUR', { timeout: 20_000 });
    await expect(page.getByTestId('preview-balance')).toHaveValue('1000');
    await expect(page.getByTestId('preview-social')).toBeChecked();
    const reloaded = await relaunched(page, /[?&]social=1(&|$)/);
    expect(await session(reloaded)).toMatchObject({
      balance: 1000,
      currency: { code: 'EUR' },
      social: true,
    });
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * `↻` is a RELAUNCH AT THE SAME ADDRESS (`Preview.tsx`'s own doc): a new
 * frame element, but `previewAddress` unchanged, so `session-host`'s
 * wallet key (`e8:wallet:<gameId>:<balance>:<currency>:<wallet>`) is
 * unchanged too and the dev wallet survives — even though the iframe
 * ELEMENT itself is new (a marker attribute proves that, the same way
 * "Rotate swaps the frame without relaunching it" above proves the
 * opposite for a resize). `↺` instead bumps the address's own `wallet=<n>`
 * (the key's last segment) WITHOUT touching `balance`/`currency` — a fresh
 * key, so the wallet starts over at the seed.
 *
 * Every checkpoint reads the LIVE wallet — the shell's balance as the new
 * frame boots, then a spin through `spinFrom` — not `sessionStorage`'s raw
 * bytes (see `spinFrom`'s own doc for why a storage-only read cannot tell a
 * working persistence from a `session-host` that silently ignores it).
 */
test('↻ relaunches the game at the same address and keeps its wallet; ↺ bumps the address and starts over', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await gameBooted(page);
    await page.goto(`${IDE_URL}#/doc/preview`);
    const frame1 = await previewFrame(page);
    await gameBooted(frame1);
    const srcBefore = await page.locator(PREVIEW).getAttribute('src');
    const price = (await session(frame1)).actions?.spin ?? 1;

    // A spin that wins back exactly its price leaves the seed's 10 000, and
    // a kept wallet at 10 000 cannot be told from a reset one — so spin
    // until the leftover differs from the seed (bounded).
    let postSpin = 10_000;
    for (let i = 0; i < 10 && Math.abs(postSpin - 10_000) < 1e-6; i++) {
      postSpin = await spinFrom(frame1, postSpin, price);
    }
    expect(postSpin).not.toBeCloseTo(10_000, 6);

    // ↻: a genuinely NEW frame element (a plain `src` reassignment on the
    // same node would have kept this marker) at the SAME address, whose
    // shell opens on `postSpin`, not the seed, and a spin on it continues
    // the wallet from there.
    await page.locator(PREVIEW).evaluate((el) => el.setAttribute('data-e8-marker', 'pre-refresh-1'));
    await page.getByTestId('preview-refresh').click();
    await expect(page.locator(PREVIEW)).not.toHaveAttribute('data-e8-marker', 'pre-refresh-1');
    expect(await page.locator(PREVIEW).getAttribute('src')).toBe(srcBefore);
    const frame2 = await previewFrame(page);
    await gameBooted(frame2);
    expect((await shellState(frame2)).balance).toBeCloseTo(postSpin, 6);
    const postRefresh1 = await spinFrom(frame2, postSpin, price);

    // A second ↻ is no different — nothing about the wallet is tied to how
    // many times the button has been pressed.
    await page.locator(PREVIEW).evaluate((el) => el.setAttribute('data-e8-marker', 'pre-refresh-2'));
    await page.getByTestId('preview-refresh').click();
    await expect(page.locator(PREVIEW)).not.toHaveAttribute('data-e8-marker', 'pre-refresh-2');
    const frame3 = await previewFrame(page);
    await gameBooted(frame3);
    await spinFrom(frame3, postRefresh1, price);

    // ↺: the address's `wallet=` bumps by one — a fresh key nothing has
    // written to yet, so a spin here must continue from the FULL SEED
    // again, not from wherever the depleted wallet left off.
    const walletBefore = new URL(srcBefore!).searchParams.get('wallet');
    const nextWallet = String(Number(walletBefore) + 1);
    await page.getByTestId('preview-balance-reset').click();
    const frame4 = await relaunched(page, new RegExp(`[?&]wallet=${nextWallet}(&|$)`));
    expect((await shellState(frame4)).balance).toBe(10_000);
    await spinFrom(frame4, 10_000, price);
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
