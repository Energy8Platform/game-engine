/**
 * The acceptance test for the other half of task 7: **a project plugin
 * nobody on the core team wrote can add its own screen to the IDE.**
 *
 * `screen-demo` (`engine/examples/first-slot/plugins/screen-demo/`) is
 * written against nothing but `ctx.layout.screen` and the React the shell
 * publishes on `globalThis.__E8_IDE__` — see that plugin's own `src/client
 * .js` for the full account, including why the crash it can be made to
 * throw is reachable through a URL flag rather than hard-coded. This file
 * is the other half of the same claim: not "the code compiles", but "a
 * person opens the real IDE and the screen is there" — the same standard
 * `skeleton.spec.ts` holds a project plugin's card to, one layer up (a
 * SCREEN rather than a composition-card slot entry).
 *
 * `screendemo1` is a permanent row in `first-slot`'s own `e8.yml` — see
 * that file's comment on why it lives there and not in `e8.patch.yml`
 * (the GAME's composition, a genuinely separate service from the EDITOR's;
 * only the latter's rows get a `clientUrl` broadcast to `modules.ts`). So
 * every spec in this suite that boots `first-slot` — including the ones
 * that never look at the IDE at all — carries this plugin along; nothing
 * here needs a fixture option to turn it on.
 */
import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { projectCopy, startDevHost } from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api`, `/plugin-client` and `/ide` to the host on 5679. */
const IDE_URL = 'http://127.0.0.1:5680/';

test('a project plugin brings its own screen, no engine change required', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    // `startDevHost` starts the project's own vite instance unconditionally
    // and hands it every row to pre-bundle, in the background, before any
    // page ever asks for anything (`dev-game.ts`'s `optimizeDeps.entries`).
    // Visiting the game first and waiting for it to settle gives that work
    // room to finish on a cold dependency-optimizer cache, the same way
    // `declared.spec.ts`'s editor-diagnostics test does — skipping it here
    // measured as an occasional 30s timeout on `tab-demo` under the full
    // suite, the IDE's own vite instance racing the same re-optimize.
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    await page.goto(IDE_URL);

    // Structure: a tab exists for the registered screen, addressed by id —
    // the same split `apps/web/tests/App.test.tsx` draws between "a tab
    // exists" (testid) and "it says the right thing" (role name), so a
    // wording change alone cannot make this half look broken.
    const tab = page.getByTestId('tab-demo');
    await expect(tab, "screen-demo's apply(ctx) must have called ctx.layout.screen").toBeVisible({
      timeout: 20_000,
    });

    // Wording: screen headings in this IDE are Russian, matching
    // `Состав`/`Превью` — a plugin nobody on the team wrote follows the
    // same convention because `ctx.layout.screen`'s `title` is the one
    // thing that decides it, not a hard-coded position in `Layout.tsx`.
    await expect(page.getByRole('tab', { name: 'Демо' })).toBeVisible();

    // Content: clicking through actually draws what the plugin registered
    // — `React.createElement` off the shell's own `globalThis.__E8_IDE__`
    // React, not a stub the test would pass against for the wrong reason.
    await tab.click();
    await expect(page.getByTestId('demo-screen')).toHaveText('a screen from a project plugin');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the demo screen can be made to fail as data, on request, without taking the IDE down', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    // Same settle-visit as the test above, and the same reason.
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    // The crash toggle lives entirely in the URL — see `client.js`'s own
    // `shouldCrash()` — because this plugin has no runtime half and no
    // config a row could carry to it; a query flag is the one piece of
    // "configuration" a browser module with no build step can read.
    await page.goto(`${IDE_URL}?screen-demo-crash=1`);

    const tab = page.getByTestId('tab-demo');
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await tab.click();

    // What replaces the screen is a message that says what happened, not a
    // blank pane — measured, not assumed: this is the layout's own error
    // boundary talking, and its exact words are Layout.tsx's to own, not
    // this plugin's, so only the part this plugin's own thrown `Error`
    // actually said is pinned here.
    await expect(page.locator('body')).toContainText(
      'screen-demo: forced failure (the URL carried ?screen-demo-crash)',
    );

    // The rest of the shell is unharmed: the composition tab is still
    // there and still switchable, which a page-level crash would have
    // taken down along with everything else.
    const compositionTab = page.getByTestId('tab-composition');
    await expect(compositionTab).toBeVisible();
    await compositionTab.click();
    await expect(compositionTab).toHaveAttribute('aria-selected', 'true');

    // `aria-selected` alone lives in `Layout.tsx`'s `<nav>` and flips on
    // `current?.id` regardless of whether `<main>` actually recovered — it
    // would read exactly this way even if `<ScreenBoundary>` stayed stuck
    // showing the crashed screen's own stale fallback. `key={current.id}`
    // on that boundary (`Layout.tsx`'s own doc explains why at length) is
    // what makes React discard the errored instance instead of reusing it,
    // and this is the one assertion that actually depends on that: the
    // composition screen's own unconditional heading, which only a fresh,
    // successfully-rendered `CompositionScreen` puts on the page.
    await expect(page.getByRole('heading', { name: 'Состав' })).toBeVisible();
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
