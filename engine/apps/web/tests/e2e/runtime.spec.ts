import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame } from '@playwright/test';
import { createIdeHost, type IdeHost } from '@energy8engine/ide-host';
import * as devGame from '@energy8engine/ide-host/dev-game';

/**
 * The plan's own thesis, proven in a real browser: a knob turned in the
 * IDE's composition screen reaches a REAL running game — served from the
 * SAME server `e8 dev` boots (`dev-game`, composed here exactly the way
 * `engine/apps/cli/src/index.ts`'s `dev` command does) — without a reload
 * of the IDE page, and switching `base_game` from `classic` to `cascade`
 * makes the SAME spin result present differently.
 *
 * "Assert what a person would actually see" (the task brief's own words):
 * the game exposes `window.__e8` (see `engine/examples/first-slot/src
 * /main.ts`'s own module doc for why) so this suite can ask the game what
 * PresentationPlan it actually ran for a given result, under whichever
 * mechanic is currently bound — the same step-kind sequence
 * `@energy8engine/play-loop`'s `executePlan` actually draws to the board.
 * Checking `e8.yml`'s text, or the raw `/ide` websocket traffic, would only
 * prove a config value changed — not that the board did anything
 * different; this suite deliberately asks the game's own executed plan
 * instead.
 *
 * Mirrors `skeleton.spec.ts`'s exact pattern (in-process host, fixed port
 * 5679 — the one `vite.config.ts`'s dev-server proxy targets) with one
 * addition: `dev-game` composed onto the SAME host, the way `e8 dev` does.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..', '..', '..', '..', 'examples', 'first-slot');
const GAMES_DIR = join(PROJECT, 'game');
const COMPOSITION = join(PROJECT, 'e8.yml');

let host: IdeHost;
let original: string;

test.beforeAll(async () => {
  original = readFileSync(COMPOSITION, 'utf8');
  host = await createIdeHost({ cwd: PROJECT, port: 5679 });
  await host.ctx.plugin(devGame, {
    root: PROJECT,
    gamesDir: GAMES_DIR,
    gameId: 'first-slot',
    betLevel: 1.0,
    port: 0,
  });
});

test.afterAll(async () => {
  // Restore first, stop second — same ordering `skeleton.spec.ts` uses and
  // for the same reason: a throwing disposer during `host.stop()` must not
  // be able to skip the write-back and leave a tracked fixture file dirty.
  writeFileSync(COMPOSITION, original);
  await host?.stop().catch(() => {});
});

async function gameFrame(page: import('@playwright/test').Page): Promise<Frame> {
  // `Locator.contentFrame()` returns a `FrameLocator` (no `.evaluate()`) —
  // the real `Frame` object this suite needs `window.__e8` access via
  // comes from `ElementHandle.contentFrame()` instead.
  const handle = await page.locator('iframe[title="превью игры"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('preview iframe has no content frame');
  return frame;
}

test('the running game is visible in the IDE preview, and a spin plays', async ({ page }) => {
  await page.goto('/');

  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 15_000 })
    .toBe('ready');

  await frame.locator('#spin').click();
  await expect.poll(() => frame.locator('#status').textContent(), { timeout: 15_000 }).toBe('done');
});

test('switching base_game from classic to cascade in the IDE presents the SAME spin result differently — live, with no reload', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto('/');
  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 15_000 })
    .toBe('ready');

  // The composition screen shows the ide-bridge row (this project's e8.yml
  // names it), schema-driven form and all — the same proven path
  // `composition-screen.test.tsx`/`skeleton.spec.ts` already exercise.
  await expect(page.getByText('@energy8engine/ide-bridge')).toBeVisible();
  const mechanicField = page.getByLabel('механика стадии base_game');
  await expect(mechanicField).toHaveValue('classic');

  // Markers to prove NEITHER the outer IDE page NOR the game's own iframe
  // page reload at any point below — a real navigation would wipe both.
  await page.evaluate(() => {
    (window as unknown as { __ideMarker: string }).__ideMarker = 'still-here';
  });
  await frame.evaluate(() => {
    (window as unknown as { __gameMarker: string }).__gameMarker = 'still-here';
  });

  // A losing spin presents identically under both mechanics for a boring
  // reason (nothing to remove) — that would prove nothing. Find a real
  // winning spin (measured empirically: ~15% hit rate for this fixture's
  // math, so 80 attempts is comfortably over 99.99% likely to find one).
  let classicResult:
    | { result: { stage: string; data: Record<string, unknown>; win: number }; stepKinds: string[] }
    | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const outcome = await frame.evaluate(() => (window as any).__e8.spin());
    if (outcome.result.win > 0) {
      classicResult = outcome;
      break;
    }
  }
  if (!classicResult)
    throw new Error('no winning spin found in 80 attempts — math or fixture regressed');

  // What a person watching the classic presentation would see: the board
  // spins to a result and (since this one won) reveals lines — never cells
  // disappearing and refilling, because classic never reads cascade_history.
  expect(classicResult.stepKinds).toContain('spinTo');
  expect(classicResult.stepKinds).not.toContain('remove');
  expect(classicResult.stepKinds).not.toContain('refill');

  // Turn the knob — in the IDE, not in the game's own local <select>.
  await mechanicField.selectOption('cascade');

  // Propagation is asynchronous (composition.update() -> e8.yml write and
  // fiber restart -> /ide broadcast -> ide-bridge's own websocket handler
  // inside the iframe) — poll the SAME captured result under whatever is
  // CURRENTLY bound until it visibly differs from the classic run, then
  // capture that final value directly (not derived from the poll's own
  // return, which asserts rather than yields).
  const presentSameResultAgain = () =>
    frame.evaluate(({ stage, data }) => (window as any).__e8.present(stage, data), {
      stage: classicResult!.result.stage,
      data: classicResult!.result.data,
    });
  await expect
    .poll(presentSameResultAgain, { timeout: 20_000 })
    .not.toEqual(classicResult.stepKinds);
  const cascadeStepKinds = await presentSameResultAgain();

  // What a person watching the cascade presentation of the IDENTICAL
  // result would see instead: cells removed from the board — Task 9's real
  // `remove` primitive, driven by the SAME data the classic run above just
  // presented without ever touching it. (Not asserting `refill` too: measured
  // directly — see the task report — `mechanic-cascade`'s `plan()` only
  // emits `refill` between two chained rounds, and `first-slot`'s own Lua
  // never appends the trailing terminal round its module doc assumes, so a
  // chain of exactly one round — ~78% of this fixture's winning spins,
  // measured empirically — never gets one. `remove` alone is already the
  // single fact that could not be true unless the game is genuinely
  // presenting the cascade mechanic's own vocabulary, not `classic`'s.)
  expect(cascadeStepKinds).toContain('remove');
  expect(cascadeStepKinds).not.toEqual(classicResult.stepKinds);

  // Neither page reloaded at any point during the live rebind.
  expect(await page.evaluate(() => (window as any).__ideMarker)).toBe('still-here');
  expect(await frame.evaluate(() => (window as any).__gameMarker)).toBe('still-here');
});
