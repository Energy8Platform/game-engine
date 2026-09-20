import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame } from '@playwright/test';
import { createIdeHost, type IdeHost } from '@energy8engine/ide-host';
import { LOAD_BUDGET_MS } from './project-fixture';

/**
 * The plan's own thesis, proven in a real browser: a knob turned in the
 * IDE's composition screen reaches a REAL running game — served from the
 * SAME server `e8 dev` boots (`dev-game`, composed here exactly the way
 * `engine/apps/cli/src/index.ts`'s `dev` command does) — without a reload
 * of the IDE page, and switching `base_game` from `classic` to `cascade`
 * changes what a spin leaves on the board.
 *
 * "Assert what a person would actually see" (the task brief's own words):
 * the game exposes `window.__e8` (see `engine/examples/first-slot/src
 * /main.ts`'s own module doc for why) so this suite can ask the game what
 * its LIVE board shows after a spin (`symbols()`), and what the spin's
 * result was (`spins()`, the `spin-log` row's record of the server's own
 * answer) — and check the one against the other, under whichever mechanic
 * is currently bound. Checking `e8.yml`'s text, or the raw `/ide`
 * websocket traffic, would only prove a config value changed — not that
 * the board did anything different.
 *
 * **What this file used to read, and cannot any more.** Until the flow
 * editor (slice 19) the page presented a result itself and handed back the
 * PresentationPlan it ran, so this suite compared plans step by step —
 * content and all — against the raw spin data. The flow's `present` node
 * runs the plan now and keeps it in its own `vars`; the spin log's `plan`
 * is `[]` until `present` records what it drew (Task 3 debt: "spin-log
 * plan is [] until present records it"). The step-content assertions are
 * kept below as a skipped test, written against `spins().at(-1).plan`, so
 * un-skipping is the whole edit once the debt is paid. What runs today is
 * the board: under `classic` a spin leaves the reels on the spin's own
 * grid; under `cascade` a winning spin removes and refills, round by
 * round, and leaves the LAST round's grid — which is the same
 * `cascade_history` the old content check read, seen from its end.
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
  const handle = await page.locator('iframe[title="game preview"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('preview iframe has no content frame');
  return frame;
}

test('the running game is visible in the IDE preview, and a spin plays', async ({ page }) => {
  // The load budget, measured the way `e8 shot` measures `loadMs`: the
  // game's own URL, not the IDE page around it, from navigation to
  // `#status` holding text. This is the first load after the host booted,
  // so vite's cold transform is inside the number — as it is for `shot`.
  const t0 = Date.now();
  await page.goto(host.ctx.workspace.state().previewUrl!);
  await expect.poll(() => page.locator('#status').textContent(), { timeout: 30_000 }).toBeTruthy();
  const loadMs = Date.now() - t0;
  expect(
    loadMs,
    `load took ${loadMs} ms; budget ${LOAD_BUDGET_MS} (median × 3, measured 819/808/809 ms on 2026-09-16 — see LOAD_BUDGET_MS)`,
  ).toBeLessThanOrEqual(LOAD_BUDGET_MS);

  await page.goto('/');

  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 15_000 })
    .toBe('ready');

  await frame.locator('#spin').click();
  await expect.poll(() => frame.locator('#status').textContent(), { timeout: 15_000 }).toBe('done');
});

/** The live board, `[col][row]`, as `__e8.symbols()` reads it — and a spin grid in the same shape. */
type Board = (string | null)[][];
const strings = (grid: number[][]): Board => grid.map((col) => col.map(String));
const symbols = (frame: Frame): Promise<Board> =>
  frame.evaluate(() => (window as any).__e8.symbols());

/** One spin's log entry — `request` as posted, `result` as the server answered. */
interface Spin {
  request: Record<string, unknown>;
  result: {
    stage: string;
    win: number;
    data: { grid: number[][]; cascade_history: { grid: number[][]; removed: unknown[] }[] };
  };
  plan: unknown[];
}
const spins = (frame: Frame): Promise<Spin[]> => frame.evaluate(() => (window as any).__e8.spins());
/** The shell's Spin in, the `present` node's exit out; the spin it recorded. */
async function spinOnce(frame: Frame): Promise<Spin> {
  expect(await frame.evaluate(() => (window as any).__e8.spin())).toEqual({ out: 'next' });
  const all = await spins(frame);
  return all[all.length - 1];
}

/**
 * The `spin-log` row, in a real composed game — the only place the claim
 * "the composition brings a durable log and the flow's `spin` node writes
 * to it" can actually be checked. Its unit tests prove the log keeps a
 * record and that `play.record` reaches one; neither of them proves any
 * row composes a log or that anything calls `record`, which is precisely
 * how a feature ends up wired to nothing.
 *
 * The other half is the distinction the package exists for: a
 * presentation is not a spin. The flow's boot run put `base_game` on
 * screen — a scene shown, nothing played — and the log says nothing.
 */
test("the spin that played is written down — request and the server's own result; a scene shown at boot is not", async ({
  page,
}) => {
  await page.goto('/');
  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 15_000 })
    .toBe('ready');

  // The boot run showed a scene and the log stayed empty. Also the check
  // that `spins()` is reaching a real log rather than answering `[]`
  // because no `spin-log` row composed — the assertions below would fail
  // on that, this one would not.
  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.scenesVisible()), { timeout: 10_000 })
    .toEqual(['base_game']);
  expect(await spins(frame)).toEqual([]);

  const recorded = await spinOnce(frame);
  expect(await spins(frame)).toHaveLength(1);
  // What was asked. Not empty any more: the flow's `spin` node now posts
  // `{ action: 'spin' }` (the schema's own default) with the shell's bet
  // (`betLevel: $shell.bet` — `spec.json`'s `betLevels[0]`, the ladder
  // `GET /api/session` answers, untouched on this page), and `present`
  // records that same body — not a placeholder.
  expect(recorded.request).toEqual({ action: 'spin', betLevel: 0.2 });
  // What happened: the server's result, whole — the stage the `present`
  // node then presented, and the 5×3 board it spun to.
  expect(recorded.result.stage).toBe('base_game');
  expect(recorded.result.data.grid).toHaveLength(5);
  for (const col of recorded.result.data.grid) expect(col).toHaveLength(3);
  expect(typeof recorded.result.win).toBe('number');
});

test('switching base_game from classic to cascade in the IDE changes what a spin leaves on the board — live, with no reload', async ({
  page,
}) => {
  // Two spins at least, one of them a search for a winning one (measured:
  // ~2 s a spin, ~14-25 % hit rate); the file-wide 60 s is tight for that.
  test.setTimeout(120_000);
  await page.goto('/');
  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 15_000 })
    .toBe('ready');

  // The composition screen shows the ide-bridge row (this project's e8.yml
  // names it), schema-driven form and all — the same proven path
  // `composition-screen.test.tsx`/`skeleton.spec.ts` already exercise.
  await expect(page.getByText('@energy8engine/ide-bridge')).toBeVisible();
  const mechanicField = page.getByLabel('stage mechanic');
  const stageField = page.getByLabel('stage (empty — the single one the composition bound)');
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
  //
  // Propagation is asynchronous (composition.update() -> e8.yml write and
  // fiber restart -> /ide broadcast -> ide-bridge's own websocket handler
  // inside the iframe): the wait is on the BINDING, read off the game's
  // registry — not on the spin about to be asserted (see `__e8.bound`'s
  // own doc for why waiting on the thing under test is not a check).
  const bound = () => frame.evaluate(() => (window as any).__e8.bound('base_game'));
  await mechanicField.fill('classic');
  await expect.poll(bound, { timeout: 20_000 }).toBe('classic');

  // What a person watching the classic presentation sees: the reels land
  // on the spin's grid and stay there — win or lose, classic never reads
  // `cascade_history`, so nothing is removed and nothing refills.
  const classic = await spinOnce(frame);
  expect(await symbols(frame)).toEqual(strings(classic.result.data.grid));

  // Turn the knob again — in the IDE, not in the game's own local <select>.
  await mechanicField.fill('cascade');
  await expect.poll(bound, { timeout: 20_000 }).toBe('cascade');

  // A losing spin presents identically under every mechanic for a boring
  // reason (nothing to remove, nothing to refill) — that would prove
  // nothing. Find a winning one whose last round's grid actually differs
  // from the grid the reels landed on (a refill can, rarely, put the same
  // symbols back). Every winning spin cascades: round 0 always pushes at
  // least one `cascade_history` entry (see `mechanic-cascade`'s module doc).
  let cascade: Spin | undefined;
  for (let attempt = 0; attempt < 40 && !cascade; attempt += 1) {
    const spin = await spinOnce(frame);
    const rounds = spin.result.data.cascade_history;
    const last = rounds[rounds.length - 1];
    if (spin.result.win > 0 && last && !equal(last.grid, spin.result.data.grid)) cascade = spin;
  }
  if (!cascade)
    throw new Error(
      'no winning cascade spin found in 40 attempts — math, fixture, or the IDE rebind regressed',
    );

  // What a person watching the cascade presentation sees instead: cells
  // removed and the board refilled, once per round, so what they are left
  // looking at is the LAST round's own post-collapse board — not the grid
  // the reels landed on (which is where classic would have stopped), and
  // not the round after it, which is the off-by-one a shipped bug once had.
  const rounds = cascade.result.data.cascade_history;
  expect(await symbols(frame)).toEqual(strings(rounds[rounds.length - 1].grid));
  expect(await symbols(frame)).not.toEqual(strings(cascade.result.data.grid));

  // Neither page reloaded at any point during the live rebind.
  expect(await page.evaluate(() => (window as any).__ideMarker)).toBe('still-here');
  expect(await frame.evaluate(() => (window as any).__gameMarker)).toBe('still-here');
});

const equal = (a: number[][], b: number[][]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The step-content half of the old thesis: it reads the plan the game ran
 * off the spin log (`spins().at(-1).plan`), which the flow's `present` node
 * records once it has drawn it.
 *
 * Kind alone was never enough to catch a real bug that shipped here: the
 * mechanic used to spin to the wrong board and refill round `i` from
 * round `i + 1`'s grid instead of its own, so the last round of every
 * chain — the common case, a single-round win — never refilled at all and
 * left a permanent hole in the board. `stepKinds` alone (`'remove'`,
 * `'refill'` present or not) passed just as happily on that bug, which is
 * exactly why it survived to review. The test above sees the same bug
 * from the board's end (the last round's grid IS on screen); this one
 * names every step.
 */
test("under cascade the plan removes exactly what each round measured and refills each round's own board", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 15_000 })
    .toBe('ready');
  const bound = () => frame.evaluate(() => (window as any).__e8.bound('base_game'));
  await page.getByLabel('stage mechanic').fill('cascade');
  await expect.poll(bound, { timeout: 20_000 }).toBe('cascade');

  let cascade: Spin | undefined;
  for (let attempt = 0; attempt < 40 && !cascade; attempt += 1) {
    const spin = await spinOnce(frame);
    if (spin.result.win > 0) cascade = spin;
  }
  if (!cascade) throw new Error('no winning cascade spin found in 40 attempts');
  const data = cascade.result.data;
  expect(data.cascade_history.length).toBeGreaterThan(0);

  type Cell = { col: number; row: number };
  const steps = cascade.plan as { kind: string; board?: number[][]; cells?: Cell[] }[];
  expect(steps.map((s) => s.kind)).toContain('remove');

  // The board the reels land on is the PRE-cascade board (`data.grid`) —
  // not round 0's post-collapse board, which is what the bug spun to.
  const spinTo = steps.find((s) => s.kind === 'spinTo');
  expect(spinTo, 'cascade must spin to a board').toBeTruthy();
  expect(spinTo!.board).toEqual(data.grid);

  const removes = steps.filter((s) => s.kind === 'remove');
  const refills = steps.filter((s) => s.kind === 'refill');
  // No remove goes unrefilled. This is the visible symptom the bug left on
  // screen: a chain's last round removed cells and nothing ever replaced them.
  expect(
    refills.length,
    'a remove step has no matching refill — cells were cleared and never replaced',
  ).toBe(removes.length);
  for (let i = 0; i < removes.length; i += 1) {
    const round = data.cascade_history[i];
    // The cells named at this point in the presentation are exactly what
    // the math measured for this round …
    expect(removes[i].cells).toEqual(round.removed);
    // … and the board shown right after is THIS round's own post-collapse
    // board — not the round after it.
    expect(refills[i].board).toEqual(round.grid);
  }
});
