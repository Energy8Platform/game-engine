/**
 * The acceptance test for the slice: **a third mechanic, living in the
 * project's own `plugins/` directory, plays the same spin a third way, and
 * nothing in the engine was changed for it.**
 *
 * Two tests, because the claim has two halves that are checked in
 * completely different ways. The first watches the game do it. The second
 * reads the engine's source and confirms the name never got in there —
 * which is the half that would fail if someone "made it work" by
 * special-casing the mechanic in the runtime, and the first test could not
 * tell the difference.
 *
 * **Each mechanic's own reading of a spin, on the board.** A spin's data
 * carries all three stories at once — `grid`, `cascade_history`,
 * `reel_steps` — and each mechanic reads a different one; where the board
 * comes to rest after a winning spin says which was read: classic leaves
 * the grid the reels landed on; cascade the last round's refilled grid;
 * reel-step the last round's `settled` board. Those are three different
 * boards for one and the same spin data, so the reel-step spin is also
 * checked against what cascade's reading of ITS data would have left.
 * (Until the flow editor, one captured result was handed to the page
 * three times through `__e8.present`; the flow's `present` node presents
 * the spin's own result and nothing else, so each binding gets a spin of
 * its own.)
 *
 * **Rebinding goes through the IDE's composition screen**, the way
 * `runtime.spec.ts` already does it — not through a helper on
 * `window.__e8`, which exposes no `bind()`. Going through the IDE is also
 * the stronger claim, since it exercises the whole pipe (a text box on the
 * composition screen -> `composition.update()` -> `e8.yml` -> fiber restart
 * -> `/ide` broadcast -> `ide-bridge` inside the game) rather than the
 * mechanic alone. The field is a free TEXT BOX, not a `<select>`: which
 * mechanics exist is whatever a composition registered at runtime, and a
 * project's own third mechanic has to be nameable.
 *
 * **Kinds are not enough, and this is where the last round was lost.**
 * A list of step kinds cannot tell a correctly-different presentation from
 * a differently-broken one — `runtime.spec.ts` documents a real cascade bug
 * that shipped past exactly that check (`remove` and `refill` both present,
 * `refill` naming the wrong board). The whole-plan check — every step
 * against the raw spin `data`: the board the reels land on, the cells each
 * round pays, how far each reel scrolls, the board it settles to, what each
 * reveal is worth — is the second test below: it reads the plan the game
 * ran, off the spin log (`spins().at(-1).plan`), which the flow's `present`
 * node records once it has drawn it.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { FIXTURE, projectCopy, startDevHost } from './project-fixture';
// The band rule is imported, not restated: it is demo data the mechanic
// invents (a `6` gets its row's band), not the math's, so the plugin's own
// function is the only ground truth there is for it.
import { banded } from '../../../../examples/first-slot/plugins/reel-step/src/mechanic';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(__dirname, '..', '..', '..', '..');

/** One cell of the board, addressed the way the math and the step vocabulary both address it. */
interface Cell {
  col: number;
  row: number;
}

/** One round of the ReelStep chain, as `game/script.spin` emits it. */
interface ReelStepRound {
  winning: Cell[];
  shifts: number[];
  settled: number[][];
  win: number;
}

/** One round of the tumble, as `game/script.spin` emits it. */
interface CascadeRound {
  grid: number[][];
  removed: Cell[];
  win: number;
}

interface BaseGameData {
  grid: number[][];
  win: number;
  base_win: number;
  lines: unknown[];
  cascade_history: CascadeRound[];
  reel_steps: ReelStepRound[];
}

interface Step {
  kind: string;
  [field: string]: unknown;
}

/**
 * The game itself, inside the IDE's preview iframe. Same accessor
 * `runtime.spec.ts` uses, and for the same reason: `Locator.contentFrame()`
 * hands back a `FrameLocator` with no `.evaluate()`, while
 * `ElementHandle.contentFrame()` hands back the real `Frame`.
 */
async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.locator('iframe[title="game preview"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('preview iframe has no content frame');
  return frame;
}

/** The live board, `[col][row]`, as `__e8.symbols()` reads it — and a grid in the same shape. */
type Board = (string | null)[][];
const strings = (grid: number[][]): Board => grid.map((col) => col.map(String));
const equal = (a: number[][] | undefined, b: number[][] | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

/** One spin's log entry, as `__e8.spins()` hands it back. */
interface Spin {
  result: { stage: string; data: BaseGameData; win: number };
  plan: Step[];
}

/**
 * Binds `base_game` to `mechanic` FROM THE IDE (unless it already is),
 * waits for that write to reach the running game, then spins until a
 * winning spin `usable` accepts — and hands back that spin with the board
 * it left on stage. The wait is on the binding, not on the spin — see
 * `__e8.bound`'s own doc for why asserting on what you waited for is not
 * a check. A losing spin is never accepted: it presents identically under
 * every mechanic (nothing won, nothing moves), which would prove nothing.
 */
async function winUnder(
  page: Page,
  frame: Frame,
  mechanic: string,
  usable: (data: BaseGameData) => boolean,
): Promise<{ spin: Spin; board: Board }> {
  const bound = () => frame.evaluate(() => (window as any).__e8.bound('base_game'));
  if ((await bound()) !== mechanic) {
    await page.getByLabel('stage mechanic').fill(mechanic);
    await expect.poll(bound, { timeout: 25_000 }).toBe(mechanic);
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    expect(await frame.evaluate(() => (window as any).__e8.spin())).toEqual({ out: 'next' });
    const all = (await frame.evaluate(() => (window as any).__e8.spins())) as Spin[];
    const spin = all[all.length - 1];
    if (spin.result.win > 0 && usable(spin.result.data)) {
      return { spin, board: await frame.evaluate(() => (window as any).__e8.symbols()) };
    }
  }
  throw new Error(
    `no usable winning spin under "${mechanic}" in 40 attempts — math or fixture regressed`,
  );
}

test('a winning spin under each of three bindings leaves the board where that mechanic says — the third from the project', async ({
  page,
}) => {
  // Three searches for a winning spin (measured: ~2 s a spin, ~14-25 % hit rate).
  test.setTimeout(150_000);

  // A copy, never the checked-in fixture: rebinding from the IDE rewrites
  // `e8.yml` (and does not preserve its comments).
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto('/');
    const frame = await gameFrame(page);
    await expect
      .poll(() => frame.locator('#status').textContent(), { timeout: 20_000 })
      .toBe('ready');

    // The composition screen, with this project's `ide-bridge` row on it.
    // The stage field beside the mechanic one is left empty throughout:
    // this project's composition binds exactly one stage, and `ide-bridge`
    // resolves an unnamed stage to that one (see `IdeBridgeSettableConfig.stage`).
    await expect(page.getByText('@energy8engine/ide-bridge')).toBeVisible();

    // The game boots on `reel-step` — its own `e8.patch.yml` binds it — so
    // the project's plugin goes first, on the binding it booted with, and
    // every rebind after is a real change driven from the IDE, AWAY from
    // the project's plugin rather than towards a default that happened to suit.
    expect(await frame.evaluate(() => (window as any).__e8.bound('base_game'))).toBe('reel-step');

    // ── reel-step: each round pays its cells and every reel SCROLLS DOWN by
    // its own count of them; the board settles where the LAST round says.
    // Usable: the chain actually moved something, and where it settled is
    // neither the grid the reels landed on (classic's answer) nor the last
    // refilled board (cascade's reading of the SAME data) — so the board on
    // stage can only be the plugin's own doing.
    const reelStep = await winUnder(page, frame, 'reel-step', (d) => {
      const settled = d.reel_steps.at(-1)?.settled;
      return (
        d.reel_steps.some((round) => round.shifts.some((n) => n > 0)) &&
        d.cascade_history.length > 0 &&
        !equal(settled, d.grid) &&
        !equal(settled, d.cascade_history.at(-1)?.grid)
      );
    });
    const rsData = reelStep.spin.result.data;
    expect(reelStep.board).toEqual(strings(rsData.reel_steps.at(-1)!.settled));
    expect(reelStep.board).not.toEqual(strings(rsData.grid));
    expect(reelStep.board).not.toEqual(strings(rsData.cascade_history.at(-1)!.grid));
    // The plan is what the mechanic SAID; this is whether the board could
    // actually do it — and the two come apart precisely for a plugin's own
    // step. `executePlan` records a step nothing can perform as a
    // diagnostic (`plugin: 'play-loop'`) and carries on, so a `reelStep`
    // whose handler never reached the registry would leave the board
    // sitting on the grid and this word in the game's own log.
    expect(
      await frame.locator('#log').textContent(),
      '"reel-step" left a problem in the game\'s own log — the plan was produced but not played',
    ).not.toContain('play-loop');

    // ── classic: the board, then the lines that paid on it. Nothing else
    // happens — it never reads `cascade_history` or `reel_steps`.
    const classic = await winUnder(page, frame, 'classic', () => true);
    expect(classic.board).toEqual(strings(classic.spin.result.data.grid));

    // ── cascade: cells vanish and the board refills, once per tumble
    // round; the board is the last round's own — never the grid the reels
    // landed on. Usable: a refill that, rarely, puts the same symbols back
    // would make the two indistinguishable.
    const cascade = await winUnder(page, frame, 'cascade', (d) => {
      const last = d.cascade_history.at(-1)?.grid;
      return last !== undefined && !equal(last, d.grid);
    });
    const cData = cascade.spin.result.data;
    expect(cascade.board).toEqual(strings(cData.cascade_history.at(-1)!.grid));
    expect(cascade.board).not.toEqual(strings(cData.grid));
    expect(await frame.locator('#log').textContent()).not.toContain('play-loop');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The whole-plan check — see the file header. The spin log's `plan` is what
 * the flow's `present` node recorded (`spins().at(-1).plan`). Each binding
 * gets a winning spin of its own; every plan is asserted whole, step by
 * step, against that spin's `data` as ground truth. `data` is the server's
 * own answer, not something re-derived from the plan.
 */
test("the plan under each binding, step by step, against the spin's own data", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto('/');
    const frame = await gameFrame(page);
    await expect
      .poll(() => frame.locator('#status').textContent(), { timeout: 20_000 })
      .toBe('ready');
    await expect(page.getByText('@energy8engine/ide-bridge')).toBeVisible();

    const classic = await winUnder(page, frame, 'classic', () => true);
    const cascade = await winUnder(page, frame, 'cascade', () => true);
    const reelStep = await winUnder(page, frame, 'reel-step', (d) =>
      d.reel_steps.some((round) => round.shifts.some((n) => n > 0)),
    );

    // Every plan lands the reels on ITS spin's board first — reel-step's
    // with each orb (`6`) wrapped in the band its row gives it (`banded`).
    for (const { spin } of [classic, cascade]) {
      expect(spin.plan[0]).toEqual({ kind: 'spinTo', board: spin.result.data.grid });
    }
    expect(reelStep.spin.plan[0]).toEqual({
      kind: 'spinTo',
      board: banded(reelStep.spin.result.data.grid),
    });

    // classic: the board, then the lines that paid on it. Nothing else
    // happens — it never reads `cascade_history` or `reel_steps`.
    const cl = classic.spin.result.data;
    expect(classic.spin.plan).toEqual([
      { kind: 'spinTo', board: cl.grid },
      { kind: 'revealWins', total: cl.base_win, lines: cl.lines },
    ]);

    // cascade: cells vanish and the board refills, once per tumble round.
    // Content, not kinds — the bug this file's header names left `remove`
    // and `refill` both present with `refill` naming the NEXT round's board.
    const ca = cascade.spin.result.data;
    expect(ca.cascade_history.length).toBeGreaterThan(0);
    expect(cascade.spin.plan).toHaveLength(1 + ca.cascade_history.length * 3);
    ca.cascade_history.forEach((round, i) => {
      expect(cascade.spin.plan[1 + i * 3]).toEqual({
        kind: 'revealWins',
        total: round.win,
        lines: [],
      });
      expect(cascade.spin.plan[2 + i * 3]).toEqual({ kind: 'remove', cells: round.removed });
      expect(cascade.spin.plan[3 + i * 3]).toEqual({ kind: 'refill', board: round.grid });
    });

    // reel-step: nothing is removed and nothing refills. Each round pays
    // its winning cells, those cells then play the `pop` state the
    // project's own `symbols.yml` gives them, and only then does every reel
    // SCROLL DOWN by its own count of them — the distances are the step,
    // which is why this could not be said with `remove` + `refill` and why
    // the plugin brings a step kind of its own. `index` is on the step
    // because the handler is given one step at a time with no idea where in
    // the chain it is.
    const rs = reelStep.spin.result.data;
    expect(rs.reel_steps.length).toBeGreaterThan(0);
    expect(reelStep.spin.plan).toHaveLength(1 + rs.reel_steps.length * 3);
    rs.reel_steps.forEach((round, i) => {
      expect(reelStep.spin.plan[1 + i * 3]).toEqual({
        kind: 'revealWins',
        total: round.win,
        lines: [],
      });
      // `playState` is a KNOWN kind, not this plugin's — the mechanic only
      // names which state, on which cells (the ones the reveal just paid).
      expect(reelStep.spin.plan[2 + i * 3]).toEqual({
        kind: 'playState',
        cells: round.winning,
        state: 'pop',
        wait: true,
      });
      expect(reelStep.spin.plan[3 + i * 3]).toEqual({
        kind: 'reelStep',
        winning: round.winning,
        shifts: round.shifts,
        settled: banded(round.settled),
        index: i,
      });
    });

    // The step no engine mechanic can emit, in the plan of the one that
    // came from the project — and in neither of the others.
    const kinds = (plan: Step[]): string[] => plan.map((step) => step.kind);
    expect(kinds(reelStep.spin.plan)).toContain('reelStep');
    expect(kinds(cascade.spin.plan)).not.toContain('reelStep');
    expect(kinds(classic.spin.plan)).not.toContain('reelStep');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Every `.ts`/`.tsx` file under the `src/` of every package in `roots`.
 * `node_modules` is skipped: an installed dependency's own sources are not
 * this engine's code.
 */
function engineSources(roots: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  };
  for (const root of roots) {
    for (const pkg of readdirSync(root)) {
      const src = join(root, pkg, 'src');
      if (existsSync(src)) walk(src);
    }
  }
  return files;
}

/**
 * The lines of `file` that mention `needle` in CODE — a line whose mention
 * sits in a comment does not count.
 *
 * A line-based rule rather than a parser, and deliberately the crude
 * version: a line counts as a comment only when it starts with a line
 * comment, a block-comment opener, or a JSDoc continuation or terminator
 * (see `COMMENT_STARTS` below). Every failure mode of that rule is in the
 * safe direction — a code line carrying a trailing comment is reported as
 * code, so the check complains rather than quietly passing. The unsafe
 * direction (real code hidden from the scan) would need a line that begins
 * as a comment and later stops being one, which is not a thing.
 */
const COMMENT_STARTS = ['//', '/' + '*', '*'];

function codeMentions(file: string, needle: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => {
      if (!line.includes(needle)) return false;
      const trimmed = line.trimStart();
      // `'*'` covers both a JSDoc continuation and its terminator.
      return !COMMENT_STARTS.some((start) => trimmed.startsWith(start));
    })
    .map((line) => `${file}: ${line.trim()}`);
}

test("the third mechanic is genuinely the project's, not the engine's", () => {
  // 1. It lives in the project — a hand-placed directory, not an installed
  //    package and not a workspace.
  expect(existsSync(join(FIXTURE, 'plugins', 'reel-step', 'package.json'))).toBe(true);
  // And it is NOT installed, which is the other half of "lives in the
  // project": ordinary node resolution from the project's own directory —
  // the exact fallback `readPackageJson` uses when `plugins/` has nothing —
  // must not find it. Without this, a `reel-step` that had quietly become a
  // workspace package would satisfy the check above unchanged.
  const resolveFromProject = createRequire(join(FIXTURE, 'noop.js'));
  expect(() => resolveFromProject.resolve('reel-step/package.json')).toThrow();

  // 2. The engine never learned its name. This is the assertion that would
  //    fail if someone made the mechanic work by special-casing it in the
  //    runtime — the browser test above cannot tell that apart from the
  //    real thing.
  //
  //    Narrowed from the plain `grep -rl` the plan wrote, and narrowed in
  //    two places, both measured rather than assumed:
  //
  //     - to CODE. Seven files under these roots mention `reel-step` in
  //       prose — `contracts/manifest.ts` documents the `plugins/`
  //       convention with this very directory as its example,
  //       `session-dev/types.ts` explains where its chain's payouts sit.
  //       A plain grep calls those hits. Prose naming a worked example is
  //       not the engine knowing a mechanic.
  //     - to `src/`. Two test files pass the string as a sample mechanic
  //       id (`contracts/tests/mechanic-open.test.ts`,
  //       `ide-bridge/tests/index.test.ts` — the id a free-text field must
  //       accept). A special case in a test cannot make a mechanic play.
  //
  //    What is left is exactly the claim: no engine source file names it.
  const sources = engineSources([join(ENGINE, 'game'), join(ENGINE, 'core')]);
  // Not a vacuous scan: it has to have found the engine to say anything
  // about it.
  expect(sources.length).toBeGreaterThan(20);
  const hits = sources.flatMap((file) => codeMentions(file, 'reel-step'));
  expect(hits).toEqual([]);

  // 3. And the scan is capable of finding one. Run over the plugin's own
  //    source, the same rule must report the mechanic's id — otherwise
  //    step 2 is a check that can only ever pass.
  const plugin = join(FIXTURE, 'plugins', 'reel-step', 'src', 'mechanic.ts');
  expect(codeMentions(plugin, 'reel-step').length).toBeGreaterThan(0);
});

/**
 * Slice 35's F9, read off the screen: a `refill` that changes ONE cell
 * rebuilds only that cell's view — every other cell keeps the very same
 * view object. `__e8.viewIds()` numbers views by identity, so "kept its
 * view" is an equal number across the two reads; a `setData` that always
 * destroys and re-resolves makes every number change, and this fails.
 */
test('a refill that changes one cell rebuilds only that cell’s view', async ({ page }) => {
  test.setTimeout(60_000);
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto('/');
    const frame = await gameFrame(page);
    await expect
      .poll(() => frame.locator('#status').textContent(), { timeout: 20_000 })
      .toBe('ready');
    // A seated board: every cell holds a symbol, so every cell has a view.
    expect(await frame.evaluate(() => (window as any).__e8.spin())).toEqual({ out: 'next' });
    const board = (await frame.evaluate(() => (window as any).__e8.symbols())) as Board;
    const before = (await frame.evaluate(() => (window as any).__e8.viewIds())) as number[][];
    expect(before.flat().every((id) => typeof id === 'number')).toBe(true);

    // A real symbol id from this board, just not the one at (0, 0).
    const other = board.flat().find((s) => s !== board[0][0]);
    if (!other)
      throw new Error('the spun board holds one symbol only — nothing to change (0, 0) to');
    await frame.evaluate((s) => (window as any).__e8.refillCell(0, 0, s), other);

    const now = (await frame.evaluate(() => (window as any).__e8.symbols())) as Board;
    expect(now[0][0]).toBe(other);
    const after = (await frame.evaluate(() => (window as any).__e8.viewIds())) as number[][];
    const changed = before.flatMap((col, c) =>
      col.flatMap((id, r) => (after[c][r] === id ? [] : [`${c},${r}`])),
    );
    expect(changed).toEqual(['0,0']);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
