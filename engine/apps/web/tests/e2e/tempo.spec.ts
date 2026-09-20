/**
 * Slice 25 ("tempo"), the last task: the page's turbo checkbox and its
 * skip-on-second-click, proven end to end in a real browser. Spec
 * `docs/superpowers/specs/2026-09-20-tempo-design.md` §8's four e2e cases:
 *
 *  1. `mechanics1.config.tumble: true` over `base_game: cascade` — a
 *     winning spin's plan carries at least one `tumble` step.
 *  2. The turbo checkbox: `__e8.spin({ turbo: true })` reaches the board
 *     (`lastStepOpts()`) and the run is measurably faster than a plain one.
 *  3. `skip()` 100 ms into a spin collapses the presentation — the spin
 *     resolves within 1 s of the skip.
 *  4. The flow palette lists `audio` (`flow-fx`'s third kind, alongside
 *     `tween`/`sound` — `fx.spec.ts`'s own case for those two).
 *
 * Same fixture and idioms as `flow.spec.ts`/`fx.spec.ts`: a private
 * `projectCopy()` served by `startDevHost`, and the game's own
 * `window.__e8` — here `spin(opts)`, `skip()`, `lastStepOpts()`,
 * `flowTrace()` and `spins()`, all Task 4's own hooks (`spin` grew an
 * `opts` parameter; `skip`/`lastStepOpts` are new).
 *
 * Cases 1-3 talk to the game directly on its own URL (`host.gameUrl`) —
 * `window.__e8` lives there regardless of whether the IDE is even open,
 * and every other case in this file that doesn't need the Flow document's
 * UI skips it the same way `runtime.spec.ts`'s own first test does. Case 4
 * is the one exception: the palette is IDE chrome, so it visits the game
 * once (to let `flow1`/`fx1` report their node kinds to the host) and then
 * the IDE's composition document, exactly like `fx.spec.ts`'s own palette
 * case.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import { expect, test, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = 'http://127.0.0.1:5680/';

interface PatchDoc {
  rows: {
    id: string;
    config?: { stages?: Record<string, string>; tumble?: boolean };
  }[];
}

interface Step {
  kind: string;
  [field: string]: unknown;
}

interface FlowTraceEntry {
  run: number;
  node: string;
  out: string | null;
  at: number;
}

let dir: string;
let host: DevHost;

test.beforeEach(() => {
  dir = projectCopy();
});

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** The game's own page, booted to `ready` — no IDE, no iframe; `runtime.spec.ts`'s own first test reads it the same way. */
async function readyPage(page: Page): Promise<void> {
  await page.goto(host.gameUrl);
  await expect.poll(() => page.locator('#status').textContent(), { timeout: 20_000 }).toBe('ready');
}

/**
 * Case 1. `mechanics1`'s own row config carries `tumble` (`engine/game/
 * runtime/src/schema.ts`'s `Config.tumble`, sibling to `stages`) —
 * `plugins/mechanics.ts` reads it once at apply time and threads it as
 * `{ tumble }` through every `mechanic.present(data, { tumble })` call
 * (`mechanics.ts:347`). `mechanic-cascade`'s own `plan()` is what actually
 * reads `options?.tumble` and swaps `remove` + `refill` for one `tumble`
 * step per round (`engine/game/mechanic-cascade/src/index.ts:119-140`) — so
 * the edit below sets it on `mechanics1`, NOT on any row of `mechanic-
 * cascade`'s own (there isn't one; that package is a plain library
 * `mechanics1` imports and registers, per Task 2's own report).
 *
 * A `tumble` step only lands on a round that actually cleared something
 * (`round.win > 0 || round.removed.length > 0`), so a losing spin's plan
 * is `[spinTo]` alone — the same reason `reel-step.spec.ts`/`runtime.
 * spec.ts` spin in a loop rather than asserting on the first roll.
 */
test("mechanics1.config.tumble: true over base_game: cascade — a winning spin's plan carries a tumble step", async ({
  page,
}) => {
  const patchFile = join(dir, 'e8.patch.yml');
  const patch = load(readFileSync(patchFile, 'utf8')) as PatchDoc;
  const mechanics = patch.rows.find((r) => r.id === 'mechanics1')!;
  mechanics.config = {
    ...mechanics.config,
    stages: { ...mechanics.config?.stages, base_game: 'cascade' },
    tumble: true,
  };
  writeFileSync(patchFile, dump(patch, { noRefs: true }));

  host = await startDevHost(dir);
  await readyPage(page);

  let plan: Step[] | undefined;
  for (let attempt = 0; attempt < 40 && !plan; attempt += 1) {
    const outcome = await page.evaluate(() => (window as any).__e8.spin());
    expect(outcome).toEqual({ out: 'next' });
    const spins = (await page.evaluate(() => (window as any).__e8.spins())) as { plan: Step[] }[];
    const candidate = spins[spins.length - 1].plan;
    if (candidate.some((s) => s.kind === 'tumble')) plan = candidate;
  }
  if (!plan) throw new Error('no tumble step in 40 attempts — math or fixture regressed');
  expect(plan.filter((s) => s.kind === 'tumble').length).toBeGreaterThanOrEqual(1);
});

/**
 * Case 2. `spinTo` — the one board step every mechanic's plan opens with —
 * is the one step every mechanic's plan opens with, and — after a fix this
 * task made alongside it (see the report) — the only one whose OWN
 * duration is turbo-scaled top to bottom under `first-slot`'s default
 * `reel-step` binding: `@energy8platform/game-engine`'s `SpinEngine`
 * halves it (`turboFactor: 0.5`), while `revealWins` never reads `opts` at
 * all (`@energy8engine/reels`' own comment: no artificial hold to halve)
 * and a `reelStep` round's own duration is turbo-scaled only as far as
 * `ReelStepController.step` itself already was.
 *
 * A WINNING spin adds `revealWins`/`reelStep` rounds on top of `spinTo`,
 * and how MANY of those a spin gets is independent of turbo — two
 * independently-random winning spins can differ in round count enough to
 * swamp `spinTo`'s own halving in either direction (measured: an early
 * version of this test compared two raw random spins and the "turbo" one
 * came out slower, 1992 ms vs. 1792 ms, purely from round count). Holding
 * the plan shape to `[spinTo]` alone — a losing spin, spun for on both
 * sides — removes that variable and leaves exactly the one component
 * turbo actually scales.
 *
 * `flowTrace()`'s `at` is a wall-clock ms per entry; the `draw` node
 * (kind `present`) gets one entry on the way in (`out: null`) and one on
 * the way out (`out: 'next'`/`'failed'`) per run — `presentMs` reads the
 * gap between them for one run number, the same shape `flow.spec.ts`'s own
 * trace test pins for every node kind.
 */
test('the turbo checkbox: lastStepOpts reflects it, and the run is measurably faster than a plain one', async ({
  page,
}) => {
  host = await startDevHost(dir);
  await readyPage(page);

  const presentMs = (trace: FlowTraceEntry[], run: number): number => {
    const entries = trace.filter((e) => e.run === run && e.node === 'draw');
    const start = entries.find((e) => e.out === null)?.at;
    const end = entries.find((e) => e.out !== null)?.at;
    if (start === undefined || end === undefined) {
      throw new Error(`no complete 'draw' entry pair for run ${run}`);
    }
    return end - start;
  };
  const lastRun = (trace: FlowTraceEntry[]): number => Math.max(...trace.map((e) => e.run));

  /**
   * Spins at the given tempo until the plan is `[spinTo]` alone (a losing
   * spin — see this test's own doc for why that's the comparable case),
   * then returns that run's `present` duration. Same 40-attempt idiom as
   * `reel-step.spec.ts`'s `winUnder`/`runtime.spec.ts`'s cascade search,
   * just hunting a LOSING spin instead of a winning one.
   */
  const spinToOnlyMs = async (turbo: boolean): Promise<number> => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const outcome = await page.evaluate(
        (t) => (window as any).__e8.spin({ turbo: t }),
        turbo,
      );
      expect(outcome).toEqual({ out: 'next' });
      const spins = (await page.evaluate(() => (window as any).__e8.spins())) as { plan: Step[] }[];
      if (spins[spins.length - 1].plan.length === 1) {
        const trace = (await page.evaluate(() => (window as any).__e8.flowTrace())) as FlowTraceEntry[];
        return presentMs(trace, lastRun(trace));
      }
    }
    throw new Error(`no losing (spinTo-only) spin in 40 attempts at turbo=${turbo} — math or fixture regressed`);
  };

  const plainMs = await spinToOnlyMs(false);
  const turboMs = await spinToOnlyMs(true);

  const lastOpts = await page.evaluate(() => (window as any).__e8.lastStepOpts());
  expect(lastOpts).toEqual({ turbo: true });

  expect(turboMs, `plain run ${plainMs}ms, turbo run ${turboMs}ms`).toBeLessThan(plainMs * 0.7);
});

/**
 * Case 3. `spin()` left un-awaited, a 100 ms real wait (long enough for
 * the flow to have left `idle` and the board's own spin animation to be
 * under way — `spin`'s POST plus `mechanics.present` both settle well
 * under that on a warm dev server), then `skip()` — the same bus event the
 * button's own second click emits, caught by `play-loop`'s subscription,
 * never a flow node. The still-pending `spin()` promise is the proof: it
 * resolves by `next` (the `draw` node's own exit) within 1 s of the skip
 * landing, not merely "eventually".
 */
test('skip, 100 ms into a spin, collapses the presentation — it resolves within 1 s of the skip', async ({
  page,
}) => {
  host = await startDevHost(dir);
  await readyPage(page);

  const spinPromise = page.evaluate(() => (window as any).__e8.spin());
  await new Promise((r) => setTimeout(r, 100));
  const skipAt = Date.now();
  await page.evaluate(() => (window as any).__e8.skip());
  const outcome = await spinPromise;
  const elapsedMs = Date.now() - skipAt;

  expect(outcome).toEqual({ out: 'next' });
  expect(elapsedMs).toBeLessThan(1000);
});

/**
 * Case 4. Same idiom as `fx.spec.ts`'s own palette case (`tween`/`sound`):
 * a direct visit to the game first, so `flow1`/`fx1` report their node
 * kinds to the host before the IDE's boot `GET /api/flow` asks for them,
 * then the palette on the composition document's Flow tab.
 */
test('the flow palette lists audio', async ({ page }) => {
  host = await startDevHost(dir);
  await readyPage(page);
  await page.goto(`${IDE_URL}#/doc/composition`);

  await page.getByTestId('activity-flow').click();
  await expect(page.getByTestId('flow-screen')).toBeVisible();
  const palette = page.getByTestId('flow-palette');
  await expect(palette.getByTestId('flow-add-audio')).toBeVisible({ timeout: 10_000 });
});
