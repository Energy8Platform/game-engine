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
 * mechanic is currently bound — the same full plan (step kind AND content
 * — which board `spinTo`/`refill` name, which cells `remove` names)
 * `@energy8engine/play-loop`'s `executePlan` actually draws to the board.
 * Checking `e8.yml`'s text, or the raw `/ide` websocket traffic, would only
 * prove a config value changed — not that the board did anything
 * different; this suite deliberately asks the game's own executed plan
 * instead. Step KIND alone is not enough either — a `remove` step that is
 * never followed by a `refill`, or one naming cells on the wrong board,
 * still says `'remove'` in a kind list; the assertions below check the
 * plan's content against the raw spin data for exactly that reason.
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
    | {
        result: { stage: string; data: Record<string, unknown>; win: number };
        steps: { kind: string; [key: string]: unknown }[];
      }
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
  const classicStepKinds = classicResult.steps.map((s) => s.kind);

  // What a person watching the classic presentation would see: the board
  // spins to a result and (since this one won) reveals lines — never cells
  // disappearing and refilling, because classic never reads cascade_history.
  expect(classicStepKinds).toContain('spinTo');
  expect(classicStepKinds).not.toContain('remove');
  expect(classicStepKinds).not.toContain('refill');

  // Turn the knob — in the IDE, not in the game's own local <select>.
  await mechanicField.selectOption('cascade');

  // Propagation is asynchronous (composition.update() -> e8.yml write and
  // fiber restart -> /ide broadcast -> ide-bridge's own websocket handler
  // inside the iframe) — poll the SAME captured result under whatever is
  // CURRENTLY bound until it visibly differs from the classic run, then
  // capture that final value directly (not derived from the poll's own
  // return, which asserts rather than yields).
  const presentSameResultAgain = (): Promise<{ kind: string; [key: string]: unknown }[]> =>
    frame.evaluate(({ stage, data }) => (window as any).__e8.present(stage, data), {
      stage: classicResult!.result.stage,
      data: classicResult!.result.data,
    });
  await expect
    .poll(async () => (await presentSameResultAgain()).map((s) => s.kind), { timeout: 20_000 })
    .not.toEqual(classicStepKinds);
  const cascadeSteps = await presentSameResultAgain();
  const cascadeStepKinds = cascadeSteps.map((s) => s.kind);

  // What a person watching the cascade presentation of the IDENTICAL
  // result would see instead: cells removed from the board — Task 9's real
  // `remove` primitive, driven by the SAME data the classic run above just
  // presented without ever touching it.
  expect(cascadeStepKinds).toContain('remove');
  expect(cascadeStepKinds).not.toEqual(classicStepKinds);

  // Kind alone is not enough to catch a real bug that shipped here: the
  // mechanic used to spin to the wrong board and refill round `i` from
  // round `i + 1`'s grid instead of its own, so the last round of every
  // chain — the common case, a single-round win — never refilled at all
  // and left a permanent hole in the board. `stepKinds` alone (`'remove'`,
  // `'refill'` present or not) passed just as happily on that bug, which
  // is exactly why it survived to review. Assert CONTENT instead, against
  // the raw spin `data` as ground truth — not against boards diffed out of
  // the plan itself, which would just be re-deriving the same claim the
  // mechanic already got wrong.
  type Cell = { col: number; row: number };
  type CascadeRound = { grid: number[][]; removed: Cell[]; win: number };
  const data = classicResult.result.data as unknown as {
    grid: number[][];
    cascade_history: CascadeRound[];
  };

  // Do not silently pass on an empty list: this whole content check is
  // only meaningful if the captured spin actually cascaded. Every winning
  // spin does — round 0 always pushes at least one `cascade_history` entry
  // (see `mechanic-cascade`'s module doc) — and the retry loop above only
  // ever accepts a winning spin, but assert it rather than lean on that
  // invariant silently.
  expect(
    data.cascade_history.length,
    'captured spin never cascaded — the remove/refill content assertions below would be vacuous',
  ).toBeGreaterThan(0);

  const spinToStep = cascadeSteps.find((s) => s.kind === 'spinTo') as
    | { board: number[][] }
    | undefined;
  expect(spinToStep, 'cascade must spin to a board').toBeTruthy();
  // The board the reels land on is the PRE-cascade board (`data.grid`) —
  // not round 0's post-collapse board, which is what the bug spun to.
  expect(spinToStep!.board).toEqual(data.grid);

  const removeSteps = cascadeSteps.filter((s) => s.kind === 'remove') as { cells: Cell[] }[];
  const refillSteps = cascadeSteps.filter((s) => s.kind === 'refill') as {
    board: number[][];
  }[];

  // No remove goes unrefilled. This is the visible symptom the bug left on
  // screen: a chain's last round removed cells and nothing ever replaced
  // them.
  expect(
    refillSteps.length,
    'a remove step has no matching refill — cells were cleared and never replaced',
  ).toBe(removeSteps.length);

  for (let i = 0; i < removeSteps.length; i += 1) {
    const round = data.cascade_history[i];

    // The cells named at this point in the presentation are exactly what
    // the math measured for this round.
    expect(removeSteps[i].cells).toEqual(round.removed);

    // The board shown right after is THIS round's own post-collapse board
    // — not the round after it, which is the off-by-one the bug had.
    expect(refillSteps[i].board).toEqual(round.grid);

    // "What disappears is what was there": at least one of the cells this
    // round names must actually change between the board displayed before
    // this round ran and the refill board after it. Not EVERY named cell —
    // first-slot's refill is a weighted random draw over 6 symbols, so a
    // freshly-dropped symbol can legitimately land back on the value a
    // removed cell held (this happens in real measured data — see
    // `@energy8engine/session-dev`'s `SpinResult` doc, whose worked example
    // has exactly one such coincidental match). Requiring every cell to
    // differ would make this assertion flaky against real spins, not
    // stronger.
    const before = i === 0 ? data.grid : data.cascade_history[i - 1].grid;
    const changed = round.removed.some(
      (cell) => before[cell.col]?.[cell.row] !== round.grid[cell.col]?.[cell.row],
    );
    expect(changed, `round ${i} removed cells but none of them changed after the refill`).toBe(
      true,
    );
  }

  // Neither page reloaded at any point during the live rebind.
  expect(await page.evaluate(() => (window as any).__ideMarker)).toBe('still-here');
  expect(await frame.evaluate(() => (window as any).__gameMarker)).toBe('still-here');
});
