/**
 * Task 8's acceptance suite: the last task of "a screen is a plugin"
 * (`.superpowers/sdd/2026-09-09-a-screen-is-a-plugin/`), proving what Tasks
 * 1-7 built through a live `e8 dev` host and a real browser rather than the
 * plugin unit tests and vitest component tests each task already shipped
 * alongside its own code.
 *
 * The brief sketches six cases. Two of them are NOT here — not skipped,
 * moved, because the previous task already wrote them against the real
 * pipeline and a second copy would only drift from the first:
 *
 *  - "a project plugin's screen appears in the navigation" is
 *    `screen-demo.spec.ts`'s "a project plugin brings its own screen, no
 *    engine change required" — the same claim, the same fixture plugin
 *    (`screendemo1`, a permanent row in `first-slot`'s own `e8.yml`), the
 *    same real `modules.ts` import path.
 *  - "a screen that throws leaves the rest of the IDE usable" is
 *    `screen-demo.spec.ts`'s "the demo screen can be made to fail as data,
 *    on request, without taking the IDE down". The brief's own sketch
 *    shapes this as `projectCopy({ crashingScreen: true })`; the previous
 *    task built `?screen-demo-crash=1` instead, because `modules.ts` never
 *    threads a row's `config` into its dynamically-imported CLIENT half —
 *    there is no config path a fixture option could reach through. A URL
 *    flag is the only "configuration" a browser module with no build step
 *    can read, and it is exactly as reachable from a test as a fixture
 *    option would have been.
 *
 * Both were read before this file was written, not taken on faith. Each
 * already drives a live host and a real browser, addresses its tab by
 * `data-testid` and its wording by role name separately (so a translated
 * label cannot make either kind of assertion pass or fail for the wrong
 * reason), and asserts on content a stub could not fake — the plugin's own
 * rendered text, and the layout boundary's own error message. Neither
 * needed strengthening.
 *
 * The other four are here, each written to fail without the production
 * change it proves — see task-8-report.md for the revert-and-confirm-red
 * check on all four:
 *
 *  1. The IDE opens ON a screen (not merely lists one), and a second
 *     screen is one real `ctx.layout.go()` round trip away.
 *  2. A deep link — a hard navigation straight to `#/preview`, the way a
 *     bookmark or a typed address would arrive — opens on the screen it
 *     names, not the default. A different code path from #1: this is
 *     `hashId()` read at mount, before any `hashchange` has ever fired.
 *  3. The preview screen is a WALL — several tiles at once — not the old
 *     single zoomed frame. `PreviewWall`'s own default selection is the
 *     first three of `SCREEN_PRESETS`, so this checks for three, not one;
 *     a regression to the old `Preview` component would show ZERO
 *     `tile-*` elements (it carries no such testid at all), not one.
 *  4. Two tiles, each its own running game, each its own `?game=`
 *     identity, both in trouble at once — attributed each to its own row
 *     in the panel, never merged into one and never swapped. This is "the
 *     defect Tasks 4 and 5 fixed" the brief names, proved through the
 *     ACTUAL preview wall rather than two bare pages hand-built to the
 *     same URL shape: real tiles, real distinct Pixi instances, the same
 *     `tileUrl()` a human's own preview wall builds.
 *
 * **On not excluding a class of cases.** The previous two slices each lost
 * real coverage this way once — `declared.spec.ts`'s own header records one
 * of them. The temptation here was case 4: two DIFFERENT PAGES, each opened
 * directly at `?game=A`/`?game=B`, would have been simpler to write than
 * driving two real wall tiles through `ElementHandle.contentFrame()`, and
 * would have exercised the identical `ide-bridge`/`rpc.ts`/
 * `game-diagnostics.tsx` machinery underneath. It was rejected for exactly
 * the reason the lesson warns about: it would have proven the plumbing
 * works for two arbitrary addresses that happen to carry that query
 * param, never that the WALL — the thing Task 6 actually shipped, and the
 * thing a human actually opens — wires its own tiles up to it. So case 4
 * drives the real `PreviewWall` component; anything less would not have
 * earned the name "acceptance test of the wall".
 *
 * Every project here is a private `projectCopy()`, removed in a `finally`
 * — see `./project-fixture`. None of the four needed a new fixture option:
 * nothing here mutates the project on disk. Cases 1-3 read the SHIPPED
 * screens (`composition`/`preview`, both registered directly in `App.tsx`
 * — nothing a fixture flag could add or remove), and case 4 raises its two
 * diagnostics at runtime, through the same `window.__e8.present(<stage
 * nothing binds>, {})` device `diagnostics.spec.ts` already uses for a
 * single game.
 *
 * Every test visits the game (or a tile) and waits for it to settle before
 * touching the IDE at all — the same reason `declared.spec.ts` and
 * `screen-demo.spec.ts` both give at length: `startDevHost` starts the
 * project's own vite instance unconditionally and hands it every row to
 * pre-bundle in the background before any page ever asks for anything, and
 * `host.stop()` tearing that down mid-build measured flaky under the full
 * suite for a test that skipped this wait.
 */
import { rmSync } from 'node:fs';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectCopy, startDevHost } from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api`, `/plugin-client` and `/ide` to the host on 5679. */
const IDE_URL = 'http://127.0.0.1:5680/';

test('the IDE opens on a screen, and a second screen is one click away', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    await page.goto(IDE_URL);
    // "Opens ON a screen": the first tab is not just present, it is the
    // CURRENT one — `layout.current()` picking `list[0]` for an empty
    // hash, not `Layout` merely listing what got registered.
    const compositionTab = page.getByTestId('tab-composition');
    await expect(compositionTab).toBeVisible({ timeout: 20_000 });
    await expect(compositionTab).toHaveAttribute('aria-selected', 'true');

    // "One click away": a real `ctx.layout.go()` round trip — the address
    // hash changes, `Layout` re-renders, and the SCREEN'S OWN CONTENT (not
    // just its tab) draws — a wall tile, never the preview screen's own
    // empty or loading state.
    await page.getByTestId('tab-preview').click();
    await expect(page.getByTestId('tab-preview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible();
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
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    // A hard navigation straight to the address, the way a bookmark or a
    // typed URL would arrive — never a click, which is the test above's
    // own path through `go()`. This one is `hashId()` read on first mount,
    // before any `hashchange` event has ever fired.
    await page.goto(`${IDE_URL}#/preview`);
    await expect(page.getByTestId('tab-preview')).toHaveAttribute('aria-selected', 'true', {
      timeout: 20_000,
    });
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible();
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the preview wall shows several tiles at once', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    await page.goto(`${IDE_URL}#/preview`);
    // The wall's own default selection (`DEFAULT_PRESET_NAMES` in
    // `PreviewWall.tsx`) is the first three of `SCREEN_PRESETS` — three,
    // not one, is the claim under test: a regression to the old
    // single-frame `Preview` component would leave this at ZERO (that
    // component carries no `tile-*` testid at all), never at one.
    await expect(page.getByTestId(/^tile-/)).toHaveCount(3, { timeout: 20_000 });
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * `Locator.contentFrame()` hands back a `FrameLocator`, which has no
 * `.evaluate()` — the real `Frame` this test needs `window.__e8` access
 * through comes from `ElementHandle.contentFrame()` instead. Same device
 * `runtime.spec.ts`/`reel-step.spec.ts` already use for the composition
 * screen's own single preview iframe, aimed at one wall tile by name.
 */
async function tileFrame(page: Page, name: string): Promise<Frame> {
  const handle = await page.getByTestId(`tile-${name}`).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`preview tile "${name}" has no content frame`);
  return frame;
}

test('two tiles reporting trouble both appear, attributed to their tiles', async ({
  page,
  context,
}) => {
  // Two real Pixi instances booting inside the wall, on top of the usual
  // cold-vite settle wait — `reel-step.spec.ts`/`runtime.spec.ts` reach for
  // the same extension for the same reason on their own heaviest cases.
  test.setTimeout(60_000);

  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    // The wall's own default selection includes both Desktop and Laptop —
    // no checkbox needed to bring either tile up.
    await page.goto(`${IDE_URL}#/preview`);
    const desktop = await tileFrame(page, 'Desktop');
    const laptop = await tileFrame(page, 'Laptop');
    await Promise.all([
      expect(desktop.locator('#status')).toHaveText('ready', { timeout: 20_000 }),
      expect(laptop.locator('#status')).toHaveText('ready', { timeout: 20_000 }),
    ]);

    // Same trigger `diagnostics.spec.ts`'s "a host-side failure does not
    // erase what the game already reported" test uses: a stage nothing in
    // this composition binds, run through the real `mechanics.present`
    // path via `window.__e8` — a third-party mechanic's own failure would
    // reach the same place, this is just the cheapest honest way to raise
    // one on demand, in each tile, independently.
    await desktop.evaluate(() => (window as any).__e8.present('wall-desktop-fault', {}));
    await laptop.evaluate(() => (window as any).__e8.present('wall-laptop-fault', {}));

    // A second, independent page — never a navigation of `page` away from
    // `#/preview`, which would unmount both tiles and close their sockets,
    // releasing exactly the retained per-game entries this test needs to
    // still be there (Task 5's own release-on-close). The host's retained
    // frames are what let a client that connects AFTER the fact still
    // learn what happened — the same replay `diagnostics.spec.ts` relies
    // on for a single game, checked here for two at once.
    const panelPage = await context.newPage();
    await panelPage.goto(IDE_URL);
    const panel = panelPage.getByTestId('diagnostics-panel');
    await expect(panel).toContainText('wall-desktop-fault', { timeout: 20_000 });
    await expect(panel).toContainText('wall-laptop-fault');

    // Not just "both messages appear somewhere" — each on ITS OWN row,
    // carrying ITS OWN tile's identity. Two tiles silently sharing one
    // slot (the pre-Task-5 defect: one retained frame for the whole `game`
    // speaker) would show only the LAST one to report; two tiles merged
    // into one unlabelled bucket (the pre-Task-4 defect: no `?game=` at
    // all) would show both messages with no `game "…"` tag telling them
    // apart. Either failure mode is exactly what this comparison catches.
    const rowTexts = await panelPage.getByTestId(/^diag-/).allTextContents();
    const desktopRow = rowTexts.find((text) => text.includes('wall-desktop-fault'));
    const laptopRow = rowTexts.find((text) => text.includes('wall-laptop-fault'));
    expect(desktopRow, "the Desktop tile's own trouble must have its own row").toBeDefined();
    expect(laptopRow, "the Laptop tile's own trouble must have its own row").toBeDefined();
    expect(desktopRow).toContain('game "Desktop"');
    expect(laptopRow).toContain('game "Laptop"');
    expect(desktopRow).not.toBe(laptopRow);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
