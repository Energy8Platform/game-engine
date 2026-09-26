/**
 * The acceptance suite for "declared, not agreed" — the slice that gave a
 * row a way to SAY what it needs (`e8.runtime.requires`, task 1), gave
 * `createGame` a way to check that after composition (task 2), gave three
 * hand-rolled collision-and-collect mechanisms one shared implementation
 * (`@energy8engine/registry`, tasks 3–4), and closed the one remaining gap
 * in §8's "the game, the IDE and the agent see the same list" — a host-side
 * `/api/spin` failure that reached the IDE panel but not the running game's
 * own log (task 6), and an editor-side failure that reached the panel only
 * as a count, resolved against nothing (task 7).
 *
 * Three tests, one per promise, each driven through a live `e8 dev` host
 * and a real browser rather than a unit test's mocked `ctx` — the same
 * standard `diagnostics.spec.ts` holds itself to, and for the same reason:
 * every piece here already has unit coverage, and unit coverage is exactly
 * what let the ORIGINAL "one list" defect ship (six healthy rows on the
 * composition screen next to a game sitting under its own failure screen —
 * see that file's own header). What only an end-to-end test can catch is
 * the WIRING between pieces, which is where that defect actually lived.
 *
 * **The lesson this suite is built not to repeat.** An earlier acceptance
 * pass excluded a class of cases on the grounds that they "already work" —
 * a boot failure "already reaches the screen", which is true of the GAME's
 * screen and was quietly false of the EDITOR's, and the acceptance suite
 * never noticed because it never looked at the editor's screen for that
 * case at all. So test 3 below checks both halves of its claim: that the
 * editor's own trouble DOES reach the panel, and that the composition
 * screen does NOT also keep a copy of its own — the second half is exactly
 * the kind of "surely that already works" fact the lesson is about.
 *
 * Every project is a private `projectCopy()`, removed in a `finally` — see
 * `./project-fixture` for why a copy, why it lands beside the checked-in
 * fixture rather than in a temp dir, and for the options this suite adds to
 * it (`removeRowId`, `specId`, `duplicateScreenId`), each documented at its
 * own declaration in that file rather than repeated here.
 */
import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import {
  bootStatus,
  gameBooted,
  gameLog,
  projectCopy,
  spinOnce,
  startDevHost,
} from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api` and `/ide` to the host on 5679. */
const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

/**
 * Promise 1: a row that requires a service nothing provides says so,
 * naming both the service and the row that needed it.
 *
 * `composition.spec.ts` already has a test that removes `reels1` and reads
 * the resulting diagnostic — but it does so by writing a WHOLESALE
 * replacement patch and reloading an already-`ready` page, and it reads the
 * failure screen's own text in `#mount`. This test reaches the same
 * production check (`createGame`'s post-composition `requires` pass, task
 * 2) by a genuinely different road: the row is missing from the very FIRST
 * composition the host ever resolves — no healthy boot, no reload, nothing
 * to race — and what is read is the game's live diagnostics list itself
 * (`ctx.diagnostics` through `__e8.liveDiagnostics()`, the same list
 * `ide-bridge` forwards to the IDE verbatim), not the failure screen's
 * prose. Kept rather than folded into
 * the existing test because a fresh-boot composition and a hot-reloaded one
 * are handled by different code paths on the host (`resolveComposition` at
 * `createIdeHost` startup vs. `ctx.loader`'s config-update path), and this
 * suite's whole reason to exist is not assuming a path already works.
 */
test('a row that requires a missing service says so, naming both', async ({ page }) => {
  const project = projectCopy({ removeRowId: 'reels1' });
  const host = await startDevHost(project);
  try {
    await page.goto(host.gameUrl);
    await gameBooted(page);
    const log = () => gameLog(page);
    // The service `reels1` no longer provides, and the row that declared
    // it could not do without one — `@energy8engine/play-loop`'s own
    // `package.json` (`the "playloop1" row requires "board"…`).
    await expect.poll(log, { timeout: 20_000 }).toContain('board');
    await expect.poll(log, { timeout: 20_000 }).toContain('playloop1');
  } finally {
    await host.stop();
    rmSync(project, { recursive: true, force: true });
  }
});

/**
 * Promise 2: a `POST /api/spin` failure appears in the GAME's own log, not
 * only in the IDE panel.
 *
 * §8's promise was already true for every failure a running game discovers
 * about itself — a mechanic that throws, a stage nothing is bound to. It
 * was NOT true for this one producer: `/api/spin` runs in the HOST process
 * (`dev-game.ts`'s route, a different process from the browser tab
 * entirely), and before task 6 that failure reached the IDE over `/ide`
 * and stopped there — the running game's own list never heard about it,
 * because nothing told the game's `ide-bridge` connection to listen for a
 * frame the HOST itself originated rather than relayed. Task 6 is exactly
 * that one missing line: the bridge now accepts a `game-diagnostics` frame
 * stamped `source: 'host'` and seeds it into the game's own diagnostics
 * list. This is the acceptance version of that fix, with no IDE tab ever
 * opened at all — `ide-bridge` opens its OWN `/ide` connection the moment
 * the game boots, whether or not a human is watching the editor.
 */
test("a /api/spin failure appears in the game's own log, not only in the IDE", async ({ page }) => {
  const project = projectCopy({ specId: 'not-a-game' });
  const host = await startDevHost(project);
  try {
    await page.goto(host.gameUrl);
    // The game itself boots fine — `not-a-game` is only consulted once a
    // spin is actually played, so this is a clean `ready`, not a boot
    // failure that would prove a different path than the one under test.
    await gameBooted(page);
    expect(await bootStatus(page)).toBe('ready');
    await spinOnce(page);
    // `session-dev`'s own message (`spin failed: unknown game "…"`),
    // read off the GAME's list — not `spinOnce`'s "the host reported it to
    // the IDE" sentence, which is the page's OWN words about the spin and
    // would say the same thing whether or not the fix in this test exists.
    await expect.poll(() => gameLog(page), { timeout: 20_000 }).toContain('spin failed');
  } finally {
    await host.stop();
    rmSync(project, { recursive: true, force: true });
  }
});

/**
 * Promise 3: the editor's own trouble appears in the diagnostics panel,
 * attributed to `editor` — and the composition screen no longer keeps a
 * diagnostics list of its own.
 *
 * `duplicateScreenId` (see `./project-fixture`) gives the project a second
 * row naming `screen-demo`, so that one client half is imported twice and
 * registers its button and document under one hardcoded key both times —
 * the exact collision `@energy8engine/registry`'s last-wins policy (task
 * 3) reports rather than silently allows. That reaches `ctx.connection`,
 * which is what `useEditorDiagnostics` reads and `App.tsx`'s
 * `DiagnosticsDocument` (the `shell.panel` entry) hands to
 * `DiagnosticsPanel`'s `editor` prop — task 7's `editorCount → editor:
 * readonly Diagnostic[]` change, proven here for the first time against a
 * REAL collision reported through the REAL `ctx.slots` registry, rather
 * than a `DiagnosticsPanel` handed a hand-built array directly, or a hook
 * driven through a bare `ctx.connection.report()` call with nothing
 * actually colliding.
 *
 * The second half is the one this suite's own lesson is about: before task
 * 7, `CompositionScreen`'s `EditorComposition` rendered this same list a
 * SECOND time, in a `<ul className="e8-diagnostics">` of its own, resolved
 * by row name instead of attributed by origin — a second place to look,
 * exactly what §8 rules out. `.e8-diagnostics` no longer exists anywhere in
 * this app; this asserts that on the live DOM, not by reading the
 * component's source.
 *
 * The game page is visited too, even though nothing this test asserts is
 * about the game: `startDevHost` starts the project's own vite instance
 * unconditionally and hands it the whole row list to pre-bundle
 * (`dev-game.ts`'s `optimizeDeps.entries`), in the background, before any
 * page ever asks for anything. Every other spec in this suite gives that
 * background work time to settle for free, by loading and waiting on the
 * game before it ever calls `host.stop()`. This test used to be the one
 * exception — the fastest-finishing consumer of a real `startDevHost()` in
 * the whole suite — and measured flaky under the full suite for exactly
 * that reason: `host.stop()` tore the vite instance down mid-build often
 * enough to fail on "the build was canceled" well past this test's own
 * assertions had already passed. Visiting the game costs one settle wait
 * and closes the race; it is not part of the claim being proven.
 */
test("the editor's own trouble appears in the panel, and nowhere else", async ({ page }) => {
  const project = projectCopy({ duplicateScreenId: true });
  const host = await startDevHost(project);
  try {
    await page.goto(host.gameUrl);
    await gameBooted(page);

    await page.goto(IDE_URL);
    await expect(page.getByTestId('diagnostics-panel')).toContainText(/editor/i, {
      timeout: 20_000,
    });
    expect(await page.locator('.e8-diagnostics').count()).toBe(0);
  } finally {
    await host.stop();
    rmSync(project, { recursive: true, force: true });
  }
});
