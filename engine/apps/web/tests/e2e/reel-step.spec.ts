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
 * **One result, captured once.** Two spins would prove nothing: two random
 * results differ anyway. So a single winning result is taken from
 * `/api/spin` and then handed to the game three times, under three
 * different bindings, and what changes is only which mechanic reads it.
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
 * `refill` naming the wrong board). So every plan below is asserted whole,
 * step by step, against the raw spin `data` as ground truth: the board the
 * reels land on, the cells each round pays, how far each reel scrolls, the
 * board it settles to, and what each reveal is worth. `data` is the
 * server's own answer, not something re-derived from the plan under test.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { FIXTURE, projectCopy, startDevHost } from './project-fixture';

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
  const handle = await page.locator('iframe[title="превью игры"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('preview iframe has no content frame');
  return frame;
}

test('the same spin, presented a third way, by a plugin from the project', async ({ page }) => {
  test.setTimeout(90_000);

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
    await expect(page.getByText('@energy8engine/ide-bridge')).toBeVisible();
    // The stage field beside it is left empty throughout: this project's
    // composition binds exactly one stage, and `ide-bridge` resolves an
    // unnamed stage to that one (see `IdeBridgeSettableConfig.stage`).
    const mechanicField = page.getByLabel('механика стадии');

    // The game boots on `reel-step` — its own `e8.patch.yml` binds it — so
    // every rebind below is a real change driven from the IDE, and the
    // first one moves AWAY from the project's plugin rather than towards a
    // default that happened to suit.
    expect(await frame.evaluate(() => (window as any).__e8.bound('base_game'))).toBe('reel-step');

    // ONE result, captured once, straight from the math. A losing spin
    // presents identically under every mechanic for a boring reason
    // (nothing won, nothing moves), which would prove nothing — so keep
    // asking until one pays. Measured hit rate for this fixture is ~14%.
    const captured = (await frame.evaluate(async () => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const res = await fetch('/api/spin', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        const body = await res.json();
        if (res.ok && body.win > 0) return body;
      }
      return null;
    })) as { stage: string; data: BaseGameData; win: number } | null;

    if (!captured) throw new Error('no winning spin in 200 attempts — math or fixture regressed');
    const data = captured.data;

    /**
     * Binds `base_game` to `mechanic` FROM THE IDE, waits for that write to
     * reach the running game, then presents the ONE captured result under
     * it. The wait is on the binding, not on the plan — see
     * `__e8.bound`'s own doc for why asserting on what you waited for is
     * not a check.
     */
    const planUnder = async (mechanic: string): Promise<Step[]> => {
      await mechanicField.fill(mechanic);
      await expect
        .poll(() => frame.evaluate(() => (window as any).__e8.bound('base_game')), {
          timeout: 25_000,
        })
        .toBe(mechanic);
      const plan = (await frame.evaluate(
        (r) => (window as any).__e8.present(r.stage, r.data),
        captured,
      )) as Step[];

      // The plan is what the mechanic SAID. This is whether the board could
      // actually do it — and the two come apart precisely for a plugin's
      // own step. `executePlan` records a step nothing can perform as a
      // diagnostic and carries on with the rest, so a `reel-step` whose
      // handler never reached the registry would return this exact plan and
      // leave the board sitting still. `presentStage` writes those
      // diagnostics into the page's own log; there must be none.
      expect(
        await frame.locator('#log').textContent(),
        `"${mechanic}" left a problem in the game's own log — the plan was produced but not played`,
      ).not.toContain('presentation problems');
      return plan;
    };

    const classicPlan = await planUnder('classic');
    const cascadePlan = await planUnder('cascade');
    const reelStepPlan = await planUnder('reel-step');

    // ── What a person watching each of the three would actually see ──────
    // Every assertion is against `data`, the server's own answer, not
    // against anything re-derived from the plan being checked.

    // All three land the reels on the SAME board. This is what makes the
    // rest of it one spin told three ways rather than three spins.
    for (const plan of [classicPlan, cascadePlan, reelStepPlan]) {
      expect(plan[0]).toEqual({ kind: 'spinTo', board: data.grid });
    }

    // classic: the board, then the lines that paid on it. Nothing else
    // happens — it never reads `cascade_history` or `reel_steps`.
    expect(classicPlan).toEqual([
      { kind: 'spinTo', board: data.grid },
      { kind: 'revealWins', total: data.base_win, lines: data.lines },
    ]);

    // cascade: cells vanish and the board refills, once per tumble round.
    // Content, not kinds — the bug this file's header names left `remove`
    // and `refill` both present with `refill` naming the NEXT round's
    // board.
    expect(data.cascade_history.length).toBeGreaterThan(0);
    expect(cascadePlan).toHaveLength(1 + data.cascade_history.length * 3);
    data.cascade_history.forEach((round, i) => {
      expect(cascadePlan[1 + i * 3]).toEqual({
        kind: 'revealWins',
        total: round.win,
        lines: [],
      });
      expect(cascadePlan[2 + i * 3]).toEqual({ kind: 'remove', cells: round.removed });
      expect(cascadePlan[3 + i * 3]).toEqual({ kind: 'refill', board: round.grid });
    });

    // reel-step: nothing is removed and nothing refills. Each round pays
    // its winning cells and then every reel SCROLLS DOWN by its own count
    // of them — the distances are the step, which is why this could not be
    // said with `remove` + `refill` and why the plugin brings a step kind
    // of its own. `index` is on the step because the handler is given one
    // step at a time with no idea where in the chain it is.
    expect(data.reel_steps.length).toBeGreaterThan(0);
    expect(reelStepPlan).toHaveLength(1 + data.reel_steps.length * 2);
    data.reel_steps.forEach((round, i) => {
      expect(reelStepPlan[1 + i * 2]).toEqual({
        kind: 'revealWins',
        total: round.win,
        lines: [],
      });
      expect(reelStepPlan[2 + i * 2]).toEqual({
        kind: 'reelStep',
        winning: round.winning,
        shifts: round.shifts,
        settled: round.settled,
        index: i,
      });
    });

    // At least one reel actually moved somewhere in the chain. Without
    // this the block above is satisfiable by an all-zero `shifts`, which
    // is a board that never scrolls — a step that says nothing.
    expect(
      data.reel_steps.some((round) => round.shifts.some((n) => n > 0)),
      'no reel scrolled anywhere in the chain — the reelStep steps assert nothing',
    ).toBe(true);

    // ── And the three are three, not one ─────────────────────────────────
    const kinds = (plan: Step[]): string[] => plan.map((step) => step.kind);
    expect(kinds(reelStepPlan)).not.toEqual(kinds(cascadePlan));
    expect(kinds(reelStepPlan)).not.toEqual(kinds(classicPlan));
    expect(kinds(cascadePlan)).not.toEqual(kinds(classicPlan));

    // The step no engine mechanic can emit, in the plan of the one that
    // came from the project — and in neither of the others.
    expect(kinds(reelStepPlan)).toContain('reelStep');
    expect(kinds(cascadePlan)).not.toContain('reelStep');
    expect(kinds(classicPlan)).not.toContain('reelStep');
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
