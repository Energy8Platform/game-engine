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
 * Two projects, two screens, both measured in a real browser rather than
 * inferred from a severity constant:
 *
 *  1. no `game/script.spin` at all — the state of a project whose math has
 *     not been written yet;
 *  2. a `.spin` the parser can only half-read — one unterminated `record`,
 *     everything else fine. Half a schema plus a diagnostic is the
 *     parser's whole design, and it is worth nothing downstream if half a
 *     schema still blanks the screen.
 *
 * Both must leave a game a person can play. The canvas is read the same
 * honest way `composition.spec.ts` reads it — four quadrants, four
 * different pictures — because "a canvas element exists" is also true of a
 * game that drew nothing at all.
 *
 * NOT covered here, and deliberately: a parse loss that lands on the very
 * field the bound mechanic requires. That one still stops the game, from
 * `game-runtime`'s pre-flight `checkAgainstSchema`, which cannot tell a
 * schema that parsed cleanly from one that half-parsed. See
 * final-fix-report.md.
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
 * Clicks Spin and waits for the spin to finish.
 *
 * Kept apart from the `pageErrors` assertion above it in each test, and
 * that ordering is deliberate: clicking Spin in this harness raises two
 * `TypeError: currentTarget.isInteractive is not a function` from pixi's
 * federated event system, and it does so on a completely UNMODIFIED
 * project too (measured — the same two, with `game/script.spin` intact and
 * `#status` reading `ready`). It is a pre-existing artifact of this page's
 * pixi setup, not something an unreadable `.spin` causes, so folding it
 * into "the page should degrade, not throw" would make that assertion
 * about the wrong thing.
 */
async function expectSpinRuns(page: Page): Promise<void> {
  await page.locator('#spin').click();
  await expect(page.locator('#status')).toHaveText('done', { timeout: 20_000 });
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
    // that is not there. Asserted BEFORE the click on purpose — see
    // `expectSpinRuns`.
    expect(pageErrors, 'the page should degrade, not throw').toEqual([]);

    // And a spin still runs end to end, through a mechanic whose
    // `requires` were never checked against a schema because there is
    // none to check against.
    await expectSpinRuns(page);
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
    // edit. `CellPos` is chosen because nothing the bound `classic`
    // mechanic REQUIRES is typed by it, so this measures the half-parse
    // rule itself and not the pre-flight check's separate behaviour.
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

    await expectSpinRuns(page);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
