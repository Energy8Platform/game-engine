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
 * **Where a failure of either half actually surfaces — measured, not
 * assumed (fix round 1).** Neither `readGameConfig`'s `assemble()` refusal
 * (`plugin: 'spec'`) nor `spinSchema`'s own (`plugin: 'schema'`) reaches
 * the GAME's own `ctx.diagnostics` — `window.__e8.liveDiagnostics()` reads
 * that service, browser-side, and neither producer runs inside the
 * composed game at all: `assemble()`/`readGameConfig` run in the HOST
 * process, before `dev-game` (which owns the game's own composition) ever
 * plugs. A `spec` refusal is reported through
 * `ctx.ideRpc.reportGameDiagnostics('dev-game', …)`
 * (`project-scope.ts`), which always ships `source: 'host'` on the wire
 * regardless of the speaker string (`rpc.ts`'s own `reportGameDiagnostics`
 * stamps it, not the caller) — so it lands in the IDE's
 * `game-diagnostics` group, never in `GET /api/composition`'s
 * `diagnostics` (that field is `ctx.project.diagnostics` +
 * `ctx.spinSchema.diagnostics` only — `runtime-assets.ts`'s `composition`
 * route — `spec` diagnostics are not part of either array). `schema`'s
 * own diagnostics run the other way: they ARE part of
 * `ctx.spinSchema.diagnostics`, so they DO ride `GET /api/composition`,
 * but never reach the game process either.
 *
 * The one place both actually land, side by side, is the IDE's
 * **Diagnostics panel** (`engine/ide/client/src/screens/DiagnosticsPanel
 * .tsx`, `data-testid="diagnostics-panel"`, mounted in the app chrome —
 * see `App.tsx` — so no particular `#/doc/…` route is required to read
 * it): its `project` rows come from `GET /api/composition`'s own
 * `diagnostics` (covers `schema`) and its `game` rows come from the
 * `game-diagnostics` wire (covers `spec`, stamped `source: 'host'`,
 * rendered with the `speakerLabel` "the host" — see `contract.spec.ts`'s
 * mask case and `debts.spec.ts`'s `panel()` helper for the same read).
 * Confirmed by breaking the copy's `spec.json` (`delete spec.maxWin`) in a
 * scratch run before writing this test: the panel showed exactly one
 * `data-severity="error"` row reading `game the host error spec ·
 * game/spec.json: game/spec.json is a GameSpec missing a number the
 * generated prelude needs: maxWin — give maxWin a number in
 * game/spec.json` — the panel selector below, `:has(.e8-diagnostic-plugin
 * :text-is("spec"))`, matches it. Not committed as a test case (the brief
 * asks only that this be provable, not permanently red-and-green); this
 * comment is the record.
 *
 * Same fixture and idioms as `contract.spec.ts`: a private `projectCopy()`,
 * its files edited BEFORE `startDevHost`, the composition document's
 * `Preview` (`iframe[title="game preview"]`) and the game's own
 * `window.__e8`.
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

/**
 * An `error`-severity row in the Diagnostics panel whose `plugin` is
 * exactly `spec` or `schema` — the two speakers this task's prelude path
 * can actually fail through (see the module doc above for where each
 * lands). `:text-is` rather than `hasText`, so a message that merely
 * mentions "spec.json" in its text can never false-match.
 */
function specOrSchemaError(page: Page) {
  return page
    .getByTestId('diagnostics-panel')
    .locator(
      '.e8-diagnostic-row[data-severity="error"]:has(.e8-diagnostic-plugin:text-is("spec")), ' +
        '.e8-diagnostic-row[data-severity="error"]:has(.e8-diagnostic-plugin:text-is("schema"))',
    );
}

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

  await expect(page.getByTestId('diagnostics-panel')).toBeVisible();
  await expect(specOrSchemaError(page)).toHaveCount(0);
});
