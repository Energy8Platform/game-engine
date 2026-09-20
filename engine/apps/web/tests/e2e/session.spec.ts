/**
 * Sessions and the `step` flow kind, proven in a real browser (Task 5 of
 * "sessions and the spec prelude"): a round that does NOT complete on its
 * first response, driven end to end through `flow.yml`'s already-looped
 * nineteen nodes (`flow.spec.ts` proves the loop's shape; this proves what
 * runs through it when a round actually needs it).
 *
 * `first-slot`'s own math completes every round on the first `spin`, so its
 * `step` node has never fired outside a fault test. `session-fixture`
 * (`engine/game/session-dev/tests/fixtures/session`) exists for exactly
 * this: `action spin` always opens a 2-spin `free_spin` session, so one
 * `spin` plus two `Step`s is what it takes to finish a round, every time.
 * Its `SpinData` (`grid`/`win`/`base_win`/`lines`/`reel_steps`) is
 * `first-slot`'s own shape, so the project's existing `reel-step` mechanic
 * presents it with no fixture-specific plumbing.
 *
 * The copy's `game/script.spin` and `game/spec.json` become the fixture's
 * (its `spec.json` already carries `id: "session-fixture"`, which is what
 * `readGameConfig` hands `dev-game` as the game to load), and
 * `e8.patch.yml`'s `mechanics1.stages` gains `free_spins: reel-step`
 * alongside the fixture's own `base_game: reel-step` — the session's second
 * stage needs a mechanic bound too, or its own `present` node has nothing
 * to draw with.
 *
 * Same fixture and idioms as `contract.spec.ts`/`flow.spec.ts`: a private
 * `projectCopy()`, its files edited BEFORE `startDevHost` (the running host
 * reads them once, at boot), the composition document's `Preview`
 * (`iframe[title="game preview"]`) and the game's own `window.__e8`.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump, load } from 'js-yaml';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IDE_URL = 'http://127.0.0.1:5680/';
const PREVIEW = 'iframe[title="game preview"]';

/** `engine/game/session-dev/tests/fixtures/session` — id `session-fixture`. */
const SESSION_FIXTURE = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'game',
  'session-dev',
  'tests',
  'fixtures',
  'session',
);

let dir: string;
let host: DevHost;

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.locator(PREVIEW).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('preview iframe has no content frame');
  return frame;
}

/** The composition's preview, booted to `ready` — same reader as `contract.spec.ts`. */
async function readyFrame(page: Page): Promise<Frame> {
  const frame = await gameFrame(page);
  await expect
    .poll(() => frame.locator('#status').textContent(), { timeout: 20_000 })
    .toBe('ready');
  return frame;
}

interface PatchDoc {
  rows: { id: string; config?: { stages?: Record<string, string> } }[];
}

test('a session opens on the first spin, and Step finishes the round — three spins, one round, every draw presented', async ({
  page,
}) => {
  dir = projectCopy();

  cpSync(join(SESSION_FIXTURE, 'script.spin'), join(dir, 'game', 'script.spin'));
  cpSync(join(SESSION_FIXTURE, 'spec.json'), join(dir, 'game', 'spec.json'));

  const patchFile = join(dir, 'e8.patch.yml');
  const patch = load(readFileSync(patchFile, 'utf8')) as PatchDoc;
  const mechanics = patch.rows.find((r) => r.id === 'mechanics1')!;
  mechanics.config = { ...mechanics.config, stages: { ...mechanics.config?.stages, free_spins: 'reel-step' } };
  writeFileSync(patchFile, dump(patch, { noRefs: true }));

  host = await startDevHost(dir);
  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await readyFrame(page);

  // The shell's Spin in, the FIRST `present` node's exit out — the round is still
  // open at this point (`roundComplete: false`, `nextActions: ['free_spin']`
  // — session.test.ts measures it at the host level); the flow's own
  // `done → step → draw → done` loop keeps running past this resolve with
  // no further input, so everything below is polled rather than read once.
  const outcome = await frame.evaluate(() => (window as any).__e8.spin());
  expect(outcome).toEqual({ out: 'next' });

  await expect
    .poll(() => frame.evaluate(() => (window as any).__e8.spins().length), { timeout: 20_000 })
    .toBe(3);

  const spins = (await frame.evaluate(() => (window as any).__e8.spins())) as {
    request: Record<string, unknown>;
    result: { roundId: string; roundComplete: boolean };
  }[];
  // One `spin` request (no roundId) plus two `step` requests (the prior
  // response's roundId) — all three landed on the SAME open round.
  expect(new Set(spins.map((s) => s.result.roundId)).size).toBe(1);
  expect(spins[spins.length - 1].result.roundComplete).toBe(true);

  const trace = (await frame.evaluate(() => (window as any).__e8.flowTrace())) as {
    run: number;
    node: string;
    out: string | null;
  }[];
  // The `step` node ran exactly twice — `session-fixture`'s `spin` always
  // awards 2 free spins (session.test.ts pins this at the host level), so
  // the round needs exactly two Steps to close, no more, no fewer — and
  // left by `result` both times, the `failed` port never taken.
  expect(trace.filter((e) => e.node === 'step' && e.out === 'result').length).toBe(2);
  // Every draw the loop made presented cleanly — `draw`'s last exit is
  // `next`, the port `present` takes on success (`failed` is the other).
  const draws = trace.filter((e) => e.node === 'draw');
  expect(draws[draws.length - 1].out).toBe('next');
});
