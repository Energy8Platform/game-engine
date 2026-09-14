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
 * rendered text, and the document boundary's own error message. Neither
 * needed strengthening.
 *
 * The other five are here, each written to fail without the production
 * change it proves — see task-8-report.md for the revert-and-confirm-red
 * check on all five:
 *
 *  1. The IDE opens ON a document (not merely lists one), and a second
 *     document is one real `ctx.shell.openContributed()` round trip away.
 *  2. A deep link — a hard navigation straight to `#/doc/preview`, the way
 *     a bookmark or a typed address would arrive — opens on the screen it
 *     names, not the default. A different code path from #1: this is the
 *     hash read at `ready()`, before any `hashchange` has ever fired.
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
 *  5. The diagnostics panel is visible while the preview wall is open, with
 *     no diagnostics needed to prove it and no second page either. This is
 *     "the project is editable" slice's own Task 8, closing debt THIS
 *     file's own case #4 used to carry (see the comment below, on the
 *     `context.newPage()` inside it, for what changed and what did not).
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
 * **On the workaround this task removes, and what does not go with it.**
 * Case 4, before this task, opened a second browser page for a reason that
 * had nothing to do with replay: the diagnostics panel was a card on the
 * composition screen alone, invisible on `#/preview`, and navigating the
 * wall's own page away to go look at it would have unmounted both tiles
 * and closed the very sockets the test needed to stay open. Task 7 of "the
 * project is editable" (the slice this task belongs to) made the panel
 * chrome — present under every screen, `#/preview` included — so that
 * reason is gone, and case 5 above is the direct proof of it: it opens no
 * second page at all. Case 4's OWN second page stays, but not for that
 * reason anymore. Its comment, at the `context.newPage()` call itself,
 * always also said why: connecting fresh, AFTER both tiles already
 * reported, it never receives either event over a live socket — whatever
 * it learns, it learns solely from the host's retained per-tile frames,
 * replayed on connect. That is a genuinely different property from "the
 * panel is visible", provable only by a connection that was never part of
 * the conversation, and it does not become true just because the panel
 * turned into chrome — so it is kept, its comment corrected rather than
 * the code deleted, per this task's own instruction that the replay
 * coverage must not dissolve along with the workaround it used to double
 * as. A first check now runs on `page` itself first, live, chrome and all,
 * proving the reason for the second page is gone before the second page's
 * remaining, narrower reason is exercised.
 *
 * Every project here is a private `projectCopy()`, removed in a `finally`
 * — see `./project-fixture`. None of the five needed a new fixture option:
 * nothing here mutates the project on disk. Cases 1-3 and 5 read the
 * SHIPPED screens (`composition`/`preview`, both registered directly in
 * `App.tsx` — nothing a fixture flag could add or remove), and case 4
 * raises its two diagnostics at runtime, through the same
 * `window.__e8.present(<stage nothing binds>, {})` device
 * `diagnostics.spec.ts` already uses for a single game.
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
    // CURRENT one — `App` opening the composition for an empty hash, not
    // the shell merely listing what got registered.
    const compositionTab = page.getByTestId('doc-composition');
    await expect(compositionTab).toBeVisible({ timeout: 20_000 });
    await expect(compositionTab).toHaveAttribute('aria-selected', 'true');

    // "One click away": a real `ctx.shell.openContributed()` round trip —
    // the address hash changes, `Shell` re-renders, and the DOCUMENT'S OWN
    // CONTENT (not just its tab) draws — a wall tile, never the preview
    // document's own empty or loading state.
    await page.getByTestId('activity-preview').click();
    await expect(page.getByTestId('doc-preview')).toHaveAttribute('aria-selected', 'true');
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
    // own path through the activity bar. This one is the hash read at
    // `ready()`, before any `hashchange` event has ever fired.
    await page.goto(`${IDE_URL}#/doc/preview`);
    await expect(page.getByTestId('doc-preview')).toHaveAttribute('aria-selected', 'true', {
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

    await page.goto(`${IDE_URL}#/doc/preview`);
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
 * Task 8's own case, and the direct proof that the workaround the header
 * comment describes is really gone: no diagnostic is raised here, no
 * second page is opened, and the panel is still right there. Before Task 7
 * of this slice, this test could not have been written at all — the panel
 * did not exist anywhere outside the composition screen, so there would
 * have been nothing at `diagnostics-panel` to find.
 */
test('the diagnostics panel is visible while the preview wall is open', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    await page.goto(`${IDE_URL}#/doc/preview`);
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('diagnostics-panel')).toBeVisible();
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
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    // The wall's own default selection includes both Desktop and Laptop —
    // no checkbox needed to bring either tile up.
    await page.goto(`${IDE_URL}#/doc/preview`);
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

    // The panel is chrome now (Task 7): both faults show up right here, on
    // `page` itself, without ever leaving `#/preview` — where the earlier
    // acceptance suite had no choice but to look somewhere else entirely
    // (see the file header). This is the reason the second page below is
    // no longer a VIEWING workaround; it is checked here, live, first.
    const panel = page.getByTestId('diagnostics-panel');
    await expect(panel).toContainText('wall-desktop-fault', { timeout: 20_000 });
    await expect(panel).toContainText('wall-laptop-fault');

    // A second, independent page — kept on purpose, and not for the reason
    // it used to be here for. Connecting fresh, AFTER both tiles already
    // reported, it never receives either event over a live socket at all;
    // whatever it learns, it learns solely from the host's own retained
    // per-tile frames, replayed on connect — the same replay
    // `diagnostics.spec.ts` relies on for a single game, checked here for
    // two at once. Navigating `page` itself instead of opening a new one
    // would unmount both tiles and close their sockets, releasing exactly
    // the retained entries this needs to still be there (Task 5's own
    // release-on-close) — a page that was never part of the conversation
    // is the only way to observe replay rather than a live push.
    const panelPage = await context.newPage();
    await panelPage.goto(IDE_URL);
    const replayPanel = panelPage.getByTestId('diagnostics-panel');
    await expect(replayPanel).toContainText('wall-desktop-fault', { timeout: 20_000 });
    await expect(replayPanel).toContainText('wall-laptop-fault');

    // Not just "both messages appear somewhere" — each on ITS OWN row,
    // carrying ITS OWN tile's identity. Two tiles silently sharing one
    // slot (the pre-Task-5 defect: one retained frame for the whole `game`
    // speaker) would show only the LAST one to report; two tiles merged
    // into one unlabelled bucket (the pre-Task-4 defect: no `?game=` at
    // all) would show both messages with no `game "…"` tag telling them
    // apart. Either failure mode is exactly what this comparison catches —
    // checked on the replayed copy, which is the one a person who opens
    // the editor late (the common case) would actually see.
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
