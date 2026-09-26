/**
 * Slice 26 ("shell, session, build"): `first-slot` plays through the shell,
 * proven in a real browser — spec §9's `game-shell.spec.ts`, six cases:
 *
 *  1. Boot: the shell is up with what the session row answered —
 *     `bet === defaultBet` (`spec.json`'s `betLevels[0]`), `balance ===
 *     1000`, `availableBets` = the spec's ladder.
 *  2. The shell's own Spin: `on shell.spin → … → present → ack → free`,
 *     the bar `busy` during the run and released after, `state.win` the
 *     result's `totalWinAmount`, `state.balance` the dev wallet's answer.
 *  3. `stepBet(1)` then a spin — the request's `betLevel` is the NEW bet:
 *     the flow's `spin` node reads `$shell.bet` live, at spin time.
 *  4. `startAutoplay(2)` — two spins in one run (`autoin → busy → … →
 *     free → auto → tick → more → pause → again → busy → …`), then the
 *     readout is `{ active: false, remaining: 0 }`.
 *  5. A tap on the canvas during `present` skips it (`playloop1`'s
 *     `skipEvents: [ui.skip, ui.tap]` in `e8.patch.yml`).
 *  6. The scene editor page (`editor.html`, `without: ['ui.shell']`) has no
 *     `shell` service — the pair of case 1's "the game page has one".
 *
 * Same fixture and idioms as `tempo.spec.ts`: a private `projectCopy()`
 * served by `startDevHost`, the game on its own URL (`host.gameUrl` — no
 * IDE, no iframe) and its `window.__e8` — here `shell()` (a copy of the
 * shell's state), `shellAction(name, ...args)` (a press on one of the
 * bar's own controls), `flowTrace()` and `spins()`. One host for the whole
 * file (serial): every case starts on a fresh page, so the dev wallet is
 * back at `init.balance` and the flow's trace starts over.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { bootStatus, gameBooted, projectCopy, startDevHost, type DevHost } from './project-fixture';

test.describe.configure({ mode: 'serial' });

interface FlowTraceEntry {
  run: number;
  node: string;
  out: string | null;
  at: number;
}

/** `ShellState`, the fields this file reads. */
interface ShellState {
  bet: number;
  balance: number;
  win: number;
  busy: boolean;
  availableBets: number[];
  autoplay: { active: boolean; remaining: number };
}

/** One spin-log entry — `request` as the flow posted it, `result` as `session-host` answered. */
interface Spin {
  request: { action: string; betLevel?: number };
  result: { balance?: number; winAmount?: number; totalWinAmount?: number };
}

let dir: string;
let host: DevHost;
/** `game/spec.json`'s `betLevels` — what `GET /api/session` builds the shell's ladder from. */
let betLevels: number[];

test.beforeAll(async () => {
  dir = projectCopy();
  betLevels = (JSON.parse(readFileSync(join(dir, 'game', 'spec.json'), 'utf8')) as {
    betLevels: number[];
  }).betLevels;
  host = await startDevHost(dir);
});

test.afterAll(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * The game's own page, booted to `ready` — `tempo.spec.ts`'s reader — with
 * its hooks installed: `main.ts` installs `window.__e8` at the point it
 * used to write its boot status, so the one wait answers both (it once
 * took two — a cold first load wrote `ready` before the hooks existed).
 */
async function readyPage(page: Page): Promise<void> {
  await page.goto(host.gameUrl);
  await gameBooted(page);
  expect(await bootStatus(page)).toBe('ready');
}

const shellState = (page: Page): Promise<ShellState | null> =>
  page.evaluate(() => (window as any).__e8.shell()?.state ?? null);
const flowTrace = (page: Page): Promise<FlowTraceEntry[]> =>
  page.evaluate(() => (window as any).__e8.flowTrace());
const spins = (page: Page): Promise<Spin[]> => page.evaluate(() => (window as any).__e8.spins());
/** A press on one of the bar's own controls — `shell.actions[name](...args)`; `true` when there was one. */
const press = (page: Page, name: string, ...args: unknown[]): Promise<boolean> =>
  page.evaluate(([n, a]) => (window as any).__e8.shellAction(n, ...a), [name, args] as const);

/** The newest run's `node:out` pairs, in order — `flow.spec.ts`'s own reading of the trace. */
function lastRun(entries: FlowTraceEntry[]): string[] {
  const last = Math.max(...entries.map((e) => e.run));
  return entries.filter((e) => e.run === last).map((e) => `${e.node}:${e.out}`);
}

/**
 * Waits for the newest run to reach `end` — its LAST node's exit (`auto:
 * false` for a manual spin, `more:false` for an autoplay), never merely
 * `free:next`: the next case presses Spin right after, and the flow's `on`
 * trigger drops a press while any branch is still live. Answers the run.
 */
async function settled(page: Page, end = 'auto:false'): Promise<string[]> {
  await expect.poll(async () => lastRun(await flowTrace(page)), { timeout: 20_000 }).toContain(end);
  return lastRun(await flowTrace(page));
}

test('boot: the shell is up with the session’s ladder, default bet and balance', async ({
  page,
}) => {
  await readyPage(page);
  const state = await shellState(page);
  expect(state, 'the game page composes shell1').not.toBeNull();
  expect(state!.bet).toBe(betLevels[0]);
  expect(state!.balance).toBe(1000);
  expect(state!.availableBets).toEqual(betLevels);
  expect(state!.busy).toBe(false);
});

test('the shell’s Spin runs the flow: busy during, released after, win and balance from the result', async ({
  page,
}) => {
  await readyPage(page);
  expect(await press(page, 'spin')).toBe(true);
  // The bar is disabled while the round plays (`busy` node), and back
  // before `auto` ends the run (`free` node) — polled, since a spin takes
  // about a second and the assertion below reads the state after it.
  await expect.poll(async () => (await shellState(page))?.busy, { timeout: 5000 }).toBe(true);

  const run = await settled(page);
  expect(
    run.filter((pair) => ['idle:next', 'draw:next', 'ack:next', 'free:next'].includes(pair)),
  ).toEqual(['idle:next', 'draw:next', 'ack:next', 'free:next']);

  const state = (await shellState(page))!;
  const result = (await spins(page)).at(-1)!.result;
  expect(state.busy).toBe(false);
  expect(state.win).toBe(result.totalWinAmount);
  // `session-host`'s dev wallet: charged the bet at the spin, credited
  // `winAmount` on the answer (the row's own arithmetic — `totalWinAmount`
  // happens to equal it on a one-spin round, but is not what it adds),
  // echoed on the result the `bal` node then showed.
  expect(state.balance).toBe(result.balance);
  expect(state.balance).toBeCloseTo(1000 - betLevels[0] + result.winAmount!, 6);
});

test('stepBet(1) then Spin: the request carries the new bet — $shell.bet is read live', async ({
  page,
}) => {
  await readyPage(page);
  expect(await press(page, 'stepBet', 1)).toBe(true);
  expect((await shellState(page))!.bet).toBe(betLevels[1]);

  expect(await press(page, 'spin')).toBe(true);
  await settled(page);
  const state = (await shellState(page))!;
  expect((await spins(page)).at(-1)!.request.betLevel).toBe(state.bet);
  expect(state.bet).toBe(betLevels[1]);
});

test('startAutoplay(2): two spins in one run, then the readout is off', async ({ page }) => {
  await readyPage(page);
  const before = (await spins(page)).length;
  expect(await press(page, 'startAutoplay', 2)).toBe(true);

  // One run, entered at `autoin`: the chain plays, `tick` counts the
  // readout down, `more` sends it round once more, and `false` ends it.
  const run = await settled(page, 'more:false');
  expect(run[0]).toBe('autoin:null');
  expect(run.filter((pair) => pair === 'spin:result')).toHaveLength(2);
  expect((await spins(page)).length).toBe(before + 2);
  expect((await shellState(page))!.autoplay).toEqual({ active: false, remaining: 0 });
  expect((await shellState(page))!.busy).toBe(false);
});

/**
 * Case 5, measured the way `tempo.spec.ts`'s own skip case measures: the
 * press left un-awaited, a bounded poll for the run's `draw:null` (the
 * `present` node entered — it starts `play.execute` synchronously on
 * entry, so by the time the entry is readable from outside the board's
 * spin is under way and `play.skip`'s "no run in flight" guard is past),
 * then a click on the canvas — `ui.tap`, emitted by the `scenes1` row off
 * the stage's `pointerdown`, one of `playloop1`'s two `skipEvents`. The
 * `draw` node's exit within 1 s of the click is the proof. Measured on
 * 2026-09-20 (Apple M4 Max, the checked-in `first-slot` under
 * `reel-step`, five runs): `draw` leaves 10–83 ms after the tap as this
 * test's 25 ms poll sees it (27–57 ms in all); a played-out `draw` on the
 * same fixture is 1828–1859 ms — the bound tells the two apart.
 */
test('a tap on the canvas during present skips it — draw leaves within 1 s of the tap', async ({
  page,
}) => {
  await readyPage(page);
  expect(await press(page, 'spin')).toBe(true);
  await expect
    .poll(async () => lastRun(await flowTrace(page)).includes('draw:null'), {
      timeout: 10_000,
      intervals: [10],
    })
    .toBe(true);

  const box = await page.locator('#mount canvas').first().boundingBox();
  if (!box) throw new Error('the mount has no canvas');
  const tapAt = Date.now();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(async () => lastRun(await flowTrace(page)).includes('draw:next'), {
      timeout: 5000,
      intervals: [25],
    })
    .toBe(true);
  const elapsedMs = Date.now() - tapAt;

  const draw = (await flowTrace(page)).filter((e) => e.node === 'draw');
  const drawMs = draw.at(-1)!.at - draw.find((e) => e.out === null)!.at;
  expect(elapsedMs, `draw took ${drawMs} ms in all`).toBeLessThan(1000);
  await settled(page);
});

test('the scene editor page composes without a shell', async ({ page }) => {
  await page.goto(`${host.gameUrl}/editor.html?scene=base_game`);
  // `__e8editor` lands once `createGame` has composed — `hasShell()` reads
  // the `shell` service leniently, so `false` is "composed, and none".
  await expect
    .poll(() => page.evaluate(() => (window as any).__e8editor?.hasShell()), { timeout: 30_000 })
    .toBe(false);
});
