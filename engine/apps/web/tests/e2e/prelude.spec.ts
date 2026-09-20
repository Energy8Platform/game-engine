/**
 * The spec prelude, proven in a real browser (Task 5 of "sessions and the
 * spec prelude"): a project authored as a `GameSpec` — `game/spec.json`
 * with `type: 'slot'`, `game/script.spin` holding LOGIC ONLY (no `SYM`/
 * `PAY_<ID>` — those come from the prelude `defineGame(spec).spinPrelude`
 * generates) — boots and spins exactly like a project whose `script.spin`
 * is hand-written in full.
 *
 * `assemble()` (`engine/ide/host/src/plugins/spec.ts`) is what closes the
 * gap: it writes `prelude ⧺ logic` to `.e8/game/script.spin` and hands
 * `readGameConfig` that directory as `dev-game`'s `gamesDir`, so e8-server
 * never sees the author's file, which does not compile on its own. The
 * `spinSchema` service reads the AUTHORED file instead, deliberately (its
 * own doc) — `parseSpinSchema` only reads declarations, never the `const`s
 * the prelude would have added, so the two readings agree.
 *
 * The fixture — `engine/ide/host/tests/fixtures/project-spec/game` — is a
 * faithful `first-slot` with its prelude stripped out by hand (its own
 * header comment says so): same grid, same `reel_steps` shape, so the
 * copy's untouched `e8.patch.yml`/`flow.yml` (still bound `base_game:
 * reel-step`) need no edit at all — only `game/` moves.
 *
 * Same fixture and idioms as `contract.spec.ts`: a private `projectCopy()`,
 * its files edited BEFORE `startDevHost`, the composition document's
 * `Preview` (`iframe[title="game preview"]`) and the game's own
 * `window.__e8`. The diagnostics check follows `contract.spec.ts`'s mask
 * case: `liveDiagnostics()` re-reads the GAME's own service rather than the
 * frozen boot-time snapshot; `GET /api/composition`'s own `diagnostics`
 * (`ctx.project.diagnostics` + `ctx.spinSchema.diagnostics`, per
 * `runtime-assets.ts`'s `composition` route) is the host-side half — where
 * an `assemble()` refusal (`plugin: 'spec'`) or an unparseable `.spin`
 * (`plugin: 'schema'`) would actually show up.
 */
import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IDE_URL = 'http://127.0.0.1:5680/';
const PREVIEW = 'iframe[title="game preview"]';

/** `engine/ide/host/tests/fixtures/project-spec/game` — a GameSpec `spec.json` plus logic-only `script.spin`. */
const PROJECT_SPEC_GAME = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'ide',
  'host',
  'tests',
  'fixtures',
  'project-spec',
  'game',
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

/** The two speakers `assemble()`/`spinSchema` report under, plus the game's own session seam. */
const PRELUDE_SPEAKERS = new Set(['spec', 'schema', 'session']);

test('a GameSpec project — spec.json + logic-only script.spin — boots and spins, with no assemble/schema diagnostics', async ({
  page,
}) => {
  dir = projectCopy();
  cpSync(PROJECT_SPEC_GAME, join(dir, 'game'), { recursive: true });

  host = await startDevHost(dir);
  await page.goto(`${IDE_URL}#/doc/composition`);
  const frame = await readyFrame(page);

  const outcome = await frame.evaluate(() => (window as any).__e8.spin());
  expect(outcome).toEqual({ out: 'next' });

  const live = (await frame.evaluate(() => (window as any).__e8.liveDiagnostics())) as {
    severity: string;
    plugin: string;
  }[];
  expect(live.filter((d) => d.severity === 'error' && PRELUDE_SPEAKERS.has(d.plugin))).toEqual([]);

  const composition = (await (
    await page.request.get(`${host.url}/api/composition`)
  ).json()) as { diagnostics: { severity: string; plugin: string }[] };
  expect(
    composition.diagnostics.filter((d) => d.severity === 'error' && PRELUDE_SPEAKERS.has(d.plugin)),
  ).toEqual([]);
});
