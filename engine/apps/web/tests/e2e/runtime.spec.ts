import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame } from '@playwright/test';
import { createIdeHost, type IdeHost } from '@energy8engine/ide-host';

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
 * 5679 — the one `vite.config.ts`'s dev-server proxy targets); the project
 * is the root, so it opens at boot and its scope brings `dev-game` up off
 * `game/spec.json`, the way `e8 dev` does.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..', '..', '..', '..', 'examples', 'first-slot');
const COMPOSITION = join(PROJECT, 'e8.yml');

let host: IdeHost;
let original: string;

test.beforeAll(async () => {
  original = readFileSync(COMPOSITION, 'utf8');
  host = await createIdeHost({ root: PROJECT, port: 5679, previewPort: 0 });
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

/**
 * The `spin-log` row, in a real composed game — the only place the claim
 * "the composition brings a durable log and the play loop writes to it"
 * can actually be checked. Its unit tests prove the log keeps a record and
 * that `play.record` reaches one; neither of them proves any row composes
 * a log or that anything calls `record`, which is precisely how a feature
 * ends up wired to nothing.
 *
 * The second half is the distinction the package exists for: a
 * re-presentation is not a spin. `__e8.present()` runs a whole plan
 * through the board again — everything a viewer would see — and the log
 * must not grow, because nothing happened.
 */
test('the spin that played is written down, and re-presenting it is not a second spin', async ({
  page,
}) => {
  await page.goto('/');
  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 15_000 })
    .toBe('ready');

  // Nothing has happened yet, so there is nothing to have recorded. Also
  // the check that `spins()` is reaching a real log rather than answering
  // `[]` because no `spin-log` row composed — the assertions below would
  // fail on that, this one would not.
  expect(await frame.evaluate(() => (window as any).__e8.spins())).toEqual([]);

  const outcome = await frame.evaluate(() => (window as any).__e8.spin());
  const recorded = await frame.evaluate(() => (window as any).__e8.spins());

  expect(recorded).toHaveLength(1);
  // What happened: the server's result, whole and unedited.
  expect(recorded[0].result).toEqual(outcome.result);
  // And how it was shown: the same plan the board was actually asked to
  // run, content and all — not a summary of it, and not the kinds alone.
  expect(recorded[0].plan).toEqual(outcome.steps);
  // What was asked. Empty today (this page has no bet control), but it is
  // the body that was actually posted, not a placeholder.
  expect(recorded[0].request).toEqual({});

  // Drawing the same result again is not a second spin.
  await frame.evaluate(() => (window as any).__e8.present());
  expect(await frame.evaluate(() => (window as any).__e8.spins())).toHaveLength(1);
});

test('switching base_game from classic to cascade in the IDE presents the SAME spin result differently — live, with no reload', async ({
  page,
}) => {
  await page.goto('/');
  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 15_000 })
    .toBe('ready');

  // The composition screen shows the ide-bridge row (this project's e8.yml
  // names it), schema-driven form and all — the same proven path
  // `composition-screen.test.tsx`/`skeleton.spec.ts` already exercise.
  await expect(page.getByText('@energy8engine/ide-bridge')).toBeVisible();
  const mechanicField = page.getByLabel('механика стадии');
  const stageField = page.getByLabel('стадия (пусто — та единственная, что связал состав)');
  // Both empty, and both free text boxes rather than closed `<select>`s.
  // Which mechanics exist is what a composition registered at runtime, and
  // which stages a game has is what its math declares — so neither is an
  // enum a schema in this repo could write. Neither carries a default
  // either: a value nobody wrote used to be pushed over `e8.patch.yml`'s
  // own binding on the first `/ide` snapshot after boot. See
  // `IdeBridgeSettableConfig`.
  await expect(mechanicField).toHaveValue('');
  await expect(stageField).toHaveValue('');

  // Markers to prove NEITHER the outer IDE page NOR the game's own iframe
  // page reload at any point below — a real navigation would wipe both.
  await page.evaluate(() => {
    (window as unknown as { __ideMarker: string }).__ideMarker = 'still-here';
  });
  await frame.evaluate(() => {
    (window as unknown as { __gameMarker: string }).__gameMarker = 'still-here';
  });

  // Bind `classic` FROM THE IDE first. This project's own `e8.patch.yml`
  // binds `base_game` to `reel-step` (its `plugins/reel-step` row), so
  // `classic` is no longer what the game boots on — and the point of this
  // test is the IDE driving the binding, which now means driving it in both
  // directions rather than only away from a default that happened to suit.
  //
  // The stage field is left empty on purpose: `first-slot`'s composition
  // binds exactly one stage, and `ide-bridge` resolves an unnamed stage to
  // that one. Naming it here would test the explicit path (which
  // `ide-bridge`'s own suite covers) instead of the one a person actually
  // meets on a one-stage game.
  await mechanicField.fill('classic');

  // A losing spin presents identically under every mechanic for a boring
  // reason (nothing to remove, nothing to scroll) — that would prove
  // nothing. Find a real winning spin (measured empirically: ~14% hit rate
  // for this fixture's math). The `reelStep` exclusion is what makes this
  // loop also the wait for the rebind to land: a winning spin under
  // `reel-step` ALWAYS carries a `reelStep` step (the math's `reel_steps`
  // is non-empty exactly when the spin paid), so an accepted outcome is
  // proof the IDE's write has reached the running game.
  let classicResult:
    | {
        result: { stage: string; data: Record<string, unknown>; win: number };
        steps: { kind: string; [key: string]: unknown }[];
      }
    | undefined;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const outcome = await frame.evaluate(() => (window as any).__e8.spin());
    if (
      outcome.result.win > 0 &&
      !outcome.steps.some((s: { kind: string }) => s.kind === 'reelStep')
    ) {
      classicResult = outcome;
      break;
    }
  }
  if (!classicResult)
    throw new Error(
      'no winning classic spin found in 200 attempts — math, fixture, or the IDE rebind regressed',
    );
  const classicStepKinds = classicResult.steps.map((s) => s.kind);

  // What a person watching the classic presentation would see: the board
  // spins to a result and (since this one won) reveals lines — never cells
  // disappearing and refilling, because classic never reads cascade_history.
  expect(classicStepKinds).toContain('spinTo');
  expect(classicStepKinds).not.toContain('remove');
  expect(classicStepKinds).not.toContain('refill');

  // Turn the knob again — in the IDE, not in the game's own local <select>.
  await mechanicField.fill('cascade');

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
    { board: number[][] } | undefined;
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
  }

  // Neither page reloaded at any point during the live rebind.
  expect(await page.evaluate(() => (window as any).__ideMarker)).toBe('still-here');
  expect(await frame.evaluate(() => (window as any).__gameMarker)).toBe('still-here');
});
