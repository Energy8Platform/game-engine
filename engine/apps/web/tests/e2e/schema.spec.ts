/**
 * What a person actually SEES when the math cannot describe itself.
 *
 * The slice that taught a game to read its own `game/script.spin` also
 * gave the reader a veto it was never meant to have: the host reported a
 * missing or unreadable `.spin` at `severity: 'error'`, `/api/composition`
 * merged it in with the rows, and `createGame` paints the failure screen
 * over the mount on ANY error diagnostic. A project with no `.spin` at all
 * composed and played fine before that slice and showed "This game could
 * not start" after it.
 *
 * Three projects, three screens, all measured in a real browser rather
 * than inferred from a severity constant:
 *
 *  1. no `game/script.spin` at all — the state of a project whose math has
 *     not been written yet;
 *  2. a `.spin` the parser can only half-read — one unterminated `record`,
 *     everything else fine. Half a schema plus a diagnostic is the
 *     parser's whole design, and it is worth nothing downstream if half a
 *     schema still blanks the screen.
 *  3. a `.spin` whose parse loss lands on the very field the bound
 *     mechanic requires — the hardest of the three, because until the
 *     schema carried its own partiality the pre-flight check answered it
 *     with a sentence that was FALSE, at `error` severity, over a game
 *     that would have played.
 *
 * All three must leave a game a person can play. The canvas is read the
 * same honest way `composition.spec.ts` reads it — four quadrants, four
 * different pictures — because "a canvas element exists" is also true of a
 * game that drew nothing at all.
 */
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { projectCopy, startDevHost } from './project-fixture';

/** Same wait `composition.spec.ts` uses: `#status` is written exactly once `createGame` resolves. */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
}

/** Four quadrants of the game canvas as hashes; all four equal means nothing is drawn. */
async function canvasQuadrants(page: Page): Promise<string[]> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas to read');
  const hashes: string[] = [];
  for (const [qx, qy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const shot = await page.screenshot({
      clip: {
        x: box.x + (qx * box.width) / 2,
        y: box.y + (qy * box.height) / 2,
        width: box.width / 2,
        height: box.height / 2,
      },
    });
    hashes.push(createHash('sha256').update(shot).digest('hex'));
  }
  return hashes;
}

/**
 * Clicks Spin, waits for the spin to finish, and requires that nothing was
 * thrown on the page along the way.
 *
 * The last part used to be missing, and its absence hid a real fault for a
 * whole slice: clicking Spin raised two `TypeError: currentTarget.
 * isInteractive is not a function` from pixi's federated event system, on
 * an unmodified project as well as on these edited ones. That was not
 * something an unreadable `.spin` caused — it was `dev-game`'s vite
 * re-optimizing dependencies mid-load on a cold cache, leaving the page
 * with two generations of `pixi.js`. It is fixed at the cause (see
 * `dev-game.ts`'s `warmupEntries`), so the assertion belongs here, where a
 * regression would be caught by the tests that actually click.
 *
 * `errors` is the caller's own array, still collecting: a `pageerror`
 * raised by the click lands in it before this returns.
 */
async function expectSpinRuns(page: Page, errors: string[]): Promise<void> {
  await page.locator('#spin').click();
  await expect(page.locator('#status')).toHaveText('done', { timeout: 20_000 });
  expect(errors, 'a spin should raise nothing on the page').toEqual([]);
}

/** The game is on screen and playable — board drawn, Spin live, no failure text. */
async function expectPlayable(page: Page): Promise<void> {
  await expect(page.locator('canvas')).toBeVisible();
  const quadrants = await canvasQuadrants(page);
  expect(new Set(quadrants).size, 'the board should be drawn on the canvas').toBeGreaterThan(1);
  await expect(page.locator('#spin')).toBeEnabled();
  await expect(page.locator('#mount')).not.toContainText('This game could not start');
}

test('a project with no game/script.spin still plays, and says why there is no schema', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    // The one edit, and it is to a project FILE: no math to describe.
    unlinkSync(join(dir, 'game', 'script.spin'));

    await page.goto(host.gameUrl);
    await settled(page);

    await expectPlayable(page);

    // What the person is told: a warning, naming the file, in the log —
    // and a status line that does not call it an error, because the game
    // it would be describing is running in front of them.
    await expect(page.locator('#status')).toHaveText('composition has warnings — see log');
    await expect(page.locator('#log')).toContainText('[warning]');
    await expect(page.locator('#log')).toContainText('script.spin');

    // Nothing escaped as an uncaught error while composing over a `.spin`
    // that is not there. Asserted before the click as well as after it
    // (see `expectSpinRuns`), so a failure says which of the two moments
    // it happened in.
    expect(pageErrors, 'the page should degrade, not throw').toEqual([]);

    // And a spin still runs end to end, through a mechanic whose
    // `requires` were never checked against a schema because there is
    // none to check against.
    await expectSpinRuns(page, pageErrors);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a .spin the parser can only half-read still plays, with the dropped declaration named', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    // One unterminated `record` — an ordinary missing-brace typo, mid
    // edit. `CellPos` is chosen because none of the fields the BOUND
    // mechanic requires is typed by it: `first-slot`'s patch binds
    // `base_game` to `reel-step`, which needs `grid` and `reel_steps`, and
    // both keep their declared types when `CellPos` is dropped. So this
    // measures the half-parse rule itself, not the pre-flight check's
    // separate behaviour.
    const spin = join(dir, 'game', 'script.spin');
    const source = readFileSync(spin, 'utf8');
    const broken = source.replace(
      'record CellPos {\n  col: int\n  row: int\n}',
      'record CellPos {\n  col: int\n  row: int',
    );
    expect(broken, 'the fixture must actually have been edited').not.toBe(source);
    writeFileSync(spin, broken);

    await page.goto(host.gameUrl);
    await settled(page);

    await expectPlayable(page);

    // The loss is named, not silent — and it degrades rather than stops.
    await expect(page.locator('#status')).toHaveText('composition has warnings — see log');
    await expect(page.locator('#log')).toContainText('[warning]');
    await expect(page.locator('#log')).toContainText('CellPos');

    expect(pageErrors, 'the page should degrade, not throw').toEqual([]);

    await expectSpinRuns(page, pageErrors);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a parse loss on the very field the bound mechanic needs still plays, and makes no false claim', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    // Two edits, and both are needed for this to measure anything.
    //
    // The patch binds `base_game` to `reel-step`, which needs `grid` and
    // `reel_steps` — so breaking `lines` under the shipped composition
    // would cost the pre-flight check nothing and prove nothing. `classic`
    // is the mechanic that actually requires `lines` (see
    // `@energy8engine/mechanic-classic`: grid, base_win, lines).
    const patch = join(dir, 'e8.patch.yml');
    const patched = readFileSync(patch, 'utf8').replace(
      'base_game: reel-step',
      'base_game: classic',
    );
    expect(patched, 'the patch must actually have been edited').not.toBe(
      readFileSync(patch, 'utf8'),
    );
    writeFileSync(patch, patched);

    // And the loss itself: one field's type text gone, which is what a
    // half-finished edit looks like. The parser drops the field and says
    // so; the math still declares it.
    const spin = join(dir, 'game', 'script.spin');
    const source = readFileSync(spin, 'utf8');
    const broken = source.replace('lines: [LineWin]', 'lines:');
    expect(broken, 'the fixture must actually have been edited').not.toBe(source);
    writeFileSync(spin, broken);

    await page.goto(host.gameUrl);
    await settled(page);

    // The game is on screen. Before `SpinSchema.gaps`, this is where the
    // failure screen was.
    await expectPlayable(page);

    // The loss is named — by the party that actually saw it.
    await expect(page.locator('#status')).toHaveText('composition has warnings — see log');
    await expect(page.locator('#log')).toContainText('[warning]');
    await expect(page.locator('#log')).toContainText('lines');

    // And the false sentence is nowhere on the page. Asserted against the
    // words `checkAgainstSchema` actually emits, not against a severity
    // count: the math DOES declare `lines`, and nothing may say otherwise.
    await expect(page.locator('#log')).not.toContainText('does not declare');
    await expect(page.locator('#log')).not.toContainText('[error]');
    await expect(page.locator('#mount')).not.toContainText('This game could not start');

    expect(pageErrors, 'the page should degrade, not throw').toEqual([]);

    // `classic` is what is bound, and the spin it presents runs end to
    // end — on the very field the schema could not describe.
    expect(await page.evaluate(() => (window as any).__e8.bound('base_game'))).toBe('classic');
    await expectSpinRuns(page, pageErrors);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
