/**
 * The acceptance test for the whole slice: **a game's composition comes
 * from its project files.** Editing one of those files changes what the
 * running game is made of, with no edit to the engine, to the project's
 * own `src/main.ts`, or to anything else that is code — and a person
 * looking at the screen can see the difference.
 *
 * **Two of the three tests below fail, and are left failing on purpose.**
 * They are not flaky and they are not a regression: each records a half
 * of the criterion the slice did not deliver, measured and explained at
 * the test itself. The composition pipeline works — the row list really
 * does come from the project files, and removing a row really does change
 * what is on screen — but nobody is TOLD about it: the game shows no
 * reason when a row it needs is missing, and the IDE's composition screen
 * is never handed the rows to list. See `task-11-report.md`. Weakening
 * either test to make this file green would be the exact mistake this
 * plan already spent a round on.
 *
 * Every assertion below is on what a person would see, never on what a
 * file says. A test that read `e8.patch.yml` back and confirmed it
 * contains `remove: true` would prove the file was written, which was
 * never in doubt; it would be checking the wrong end of the pipe. So the
 * first test asserts on the PIXELS of the game's own canvas, the second
 * on the text in the game's mount, and the third on the IDE's composition
 * screen.
 *
 * **Reading the canvas without a PNG decoder.** The board is drawn in
 * WebGL, so there is no DOM node per reel cell to assert on, and an
 * in-page `drawImage(canvas)` readback comes back empty (pixi runs with
 * `preserveDrawingBuffer: false` — measured, not assumed). What does work
 * is Playwright's own compositing screenshot. The trick that turns it
 * into an assertion with no image library at all: clip the screenshot to
 * a REGION OF THE BOARD alone — the canvas's own box, offset by the
 * scenes container's fit (`__e8.fit()`) and the `board` node's own
 * position (`__e8.nodeProps('base_game', 'board')`), sized to the bottom
 * row of the 5x3 grid (`BOARD_LOCAL`, below — not the whole grid; see its
 * own doc for why) — and hash the PNG bytes before and after
 * `__e8.spin()`. A quadrant-of-the-whole-canvas version of this used to
 * stand in for "the board is drawn", comparing the four quarters of a
 * full-canvas screenshot to each other; that is vacuous, because the
 * in-canvas chrome around the board (the shell's bar along the bottom,
 * the floating dev toolbar along the top) makes the four quarters differ
 * even over an EMPTY board. Clipped to the grid and compared before/after
 * a spin, the hashes can only match if the spin drew nothing there — an
 * exact comparison, not a tolerance, measured across two screenshot
 * passes of the identical region rather than within one.
 *
 * The project is **copied** before it is touched. `engine/examples
 * /first-slot` is checked in, this test writes a patch file, and writing
 * into the example would corrupt it for every other test in this suite
 * (`runtime.spec.ts` runs against it) and for the developer's own
 * `e8 dev`.
 *
 * The copy lands BESIDE the original, in `engine/examples/`, rather than
 * in `os.tmpdir()`. Both halves of that are load-bearing, and both were
 * measured rather than guessed:
 *
 *  - Inside the repo, because a project resolves its rows' packages by
 *    ordinary node resolution from its own directory (`readPackageJson`
 *    in `engine/ide/host/src/resolvePackage.ts`) and vite serves each
 *    row's runtime half over `/@fs/<realpath>`, which is confined to the
 *    vite workspace root. A copy under `/var/folders/...` has neither:
 *    every row resolves to `null` and the game composes nothing at all.
 *  - At the same DEPTH, because the project carries its own relative
 *    paths — `tsconfig.json` extends `../../../tsconfig.base.json`, which
 *    vite's esbuild transform reads for every `.ts` it serves. One level
 *    off and every module 500s.
 *
 * `engine/examples/e8-compose-*` is gitignored, and every copy is removed
 * again in `finally`.
 *
 * The host is booted the way `runtime.spec.ts` boots it — in-process
 * `createIdeHost` on the fixed port 5679, plus `dev-game`, composed
 * exactly as `engine/apps/cli/src/index.ts`'s `dev` command composes it —
 * rather than by spawning the CLI. Two reasons: 5679 is the port
 * `vite.config.ts`'s proxy hardcodes as its target, so the last test
 * (which goes through the IDE on 5680) needs the host to be exactly
 * there; and `stop()` has to be able to WAIT for the port to be free,
 * since `playwright.config.ts` runs this suite with `workers: 1` and the
 * next spec file binds the same port.
 *
 * Both of those — the copy and the host — now live in `./project-fixture`,
 * because `reel-step.spec.ts` needs the same two and a second copy of them
 * would drift. The reasoning that shaped each one moved with it.
 */
import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { projectCopy, startDevHost } from './project-fixture';

/**
 * The fixture's own patch with exactly ONE row changed: `reels1` stops
 * carrying a grid and asks to be removed.
 *
 * Spelled out in full rather than written as the single removal row
 * alone, because everything else has to stay identical for the test to
 * mean anything. Drop `renderer1`'s background and `scenes1`'s design along
 * with it and the game would change for those reasons too — a screen that
 * went empty could no longer be attributed to the reels row, and the test
 * would be passing through a branch other than the one it names. (Since
 * slice 27 the fixture's `renderer1` carries no size — the canvas follows
 * `#mount` — and `scenes1` carries the portrait design; these copies say
 * the same.)
 */
const PATCH_WITHOUT_REELS = `rows:
  - id: renderer1
    config:
      background: '#10121a'
  - id: scenes1
    config:
      design:
        width: 480
        height: 288
      portrait:
        width: 288
        height: 480
  - id: reels1
    remove: true
  - id: mechanics1
    config:
      stages:
        base_game: classic
`;

/**
 * The fixture's own patch with `reels1`'s package NAME misspelled — the
 * row is present, correctly configured, and points at a package that does
 * not exist.
 *
 * This is the single most likely first-run mistake there is, and until
 * this wave it was the quietest: the host resolved the package to
 * `null`, dropped the fact, served `runtimeUrl: null`, and the loader
 * skipped the row without a word — the same treatment a package that
 * legitimately has no runtime half gets. Everything else in this patch is
 * byte-identical to the fixture's, so anything that changes on screen is
 * attributable to the one misspelled `name`.
 */
const PATCH_WITH_MISSPELLED_REELS = `rows:
  - id: renderer1
    config:
      background: '#10121a'
  - id: scenes1
    config:
      design:
        width: 480
        height: 288
      portrait:
        width: 288
        height: 480
  - id: reels1
    name: '@energy8engine/reeels'
    config:
      config:
        grid:
          cols: 5
          rows: 3
  - id: mechanics1
    config:
      stages:
        base_game: classic
`;

/** Every row present, including the registry — but no stage bound to anything. */
const PATCH_WITH_NOTHING_BOUND = `rows:
  - id: renderer1
    config:
      background: '#10121a'
  - id: scenes1
    config:
      design:
        width: 480
        height: 288
      portrait:
        width: 288
        height: 480
  - id: reels1
    config:
      config:
        grid:
          cols: 5
          rows: 3
  - id: mechanics1
    config:
      stages: {}
`;

// `reelstep1` goes with it, and that is the whole point of this fixture's
// shape: the patch replaces the file wholesale, so every row that needs
// `mechanics` leaves in the same edit. It briefly carried a `reelstep1`
// row, which kept this test green through that row's declared
// `e8.runtime.requires: ["mechanics"]` while excluding the case a person
// actually reaches by deleting one row from a patch. The page states its
// own needs now (`need()` in `first-slot`'s `main.ts`), so the
// composition below is reported by the thing that reads `ctx.mechanics`
// with no row left to speak for it.
const PATCH_WITHOUT_MECHANICS = `rows:
  - id: renderer1
    config:
      background: '#10121a'
  - id: scenes1
    config:
      design:
        width: 480
        height: 288
      portrait:
        width: 288
        height: 480
  - id: reels1
    config:
      config:
        grid:
          cols: 5
          rows: 3
  - id: mechanics1
    remove: true
`;

/**
 * Waits for the game to have finished composing. `src/main.ts` writes
 * `#status` exactly once `createGame` has resolved, so an empty `#status`
 * means "still booting" — and asserting on the canvas before that point
 * is how a reload race quietly turns into a green "the board is gone".
 */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
}

/**
 * The BOTTOM ROW of the 5x3 reel grid, in the `board` scene node's OWN
 * local space: cell (0,0)'s centre sits at local (0,0)
 * (`@energy8platform/game-engine`'s `slot/grid/geometry.ts`), cellSize 96,
 * gap 6 — so the full grid's bounding box would be x -48..456, y -48..252
 * around wherever `nodeProps('base_game', 'board')` says the node itself
 * sits, and row 2 (the third and last row) is y 156..252 of that.
 *
 * Only row 2, not the whole grid — measured, not guessed. `first-slot`'s
 * own `index.html` floats the dev toolbar and the diagnostics log over the
 * TOP of the canvas (`#controls` then `#log`, `top: 3.75rem` + `max-height:
 * 6rem` — up to 156 screen px of chrome, however little or much is
 * logged), and row 0 sits right under it: `board`'s own y is 0, so row 0's
 * local -48..48 is the first 48 design px of the scene, no safe-area inset
 * carves any of that out for the toolbar. Two `base_game.scene.yml` nodes
 * — `logo` (a static image, harmless) and `coin` (an 8fps spritesheet that
 * keeps looping with no spin at all — confirmed by diffing two idle
 * screenshots 300ms apart) — sit in that same band too. Row 2 is clear of
 * all three, so a hash of just it can only differ between two shots if a
 * spin drew something there.
 */
const BOARD_LOCAL = { left: -48, top: 156, right: 456, bottom: 252 };

/**
 * A hash of the BOARD REGION of the game canvas — see the module doc for
 * why this, rather than quadrants of the whole canvas, is the honest way
 * to read a WebGL surface here.
 *
 * The clip is built from the game page's own hooks, not a guessed
 * rectangle: the canvas's page-relative box
 * (`page.locator('canvas').boundingBox()`) plus the scenes container's
 * fit (`__e8.fit()` — `screen = fit.x + design·scale`) plus the `board`
 * node's own design-space x/y (`__e8.nodeProps('base_game', 'board')`)
 * plus the grid's local extents around that node's origin (`BOARD_LOCAL`).
 * `sha1` because this is an identity check on PNG bytes, not a digest
 * anyone verifies by hand.
 */
async function boardRegionHash(page: Page): Promise<string> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas to read');
  const fit = (await page.evaluate(() => (window as any).__e8.fit())) as {
    scale: number;
    x: number;
    y: number;
  } | null;
  if (!fit) throw new Error('no fit — the scenes row has not laid out yet');
  const board = (await page.evaluate(() =>
    (window as any).__e8.nodeProps('base_game', 'board'),
  )) as { x: number; y: number } | null;
  if (!board) throw new Error('no "board" node in the base_game scene');

  const left = board.x + BOARD_LOCAL.left;
  const top = board.y + BOARD_LOCAL.top;
  const right = board.x + BOARD_LOCAL.right;
  const bottom = board.y + BOARD_LOCAL.bottom;
  const shot = await page.screenshot({
    clip: {
      x: box.x + fit.x + left * fit.scale,
      y: box.y + fit.y + top * fit.scale,
      width: (right - left) * fit.scale,
      height: (bottom - top) * fit.scale,
    },
  });
  return createHash('sha1').update(shot).digest('hex');
}

/**
 * The control every other test in this file was missing: an UNMODIFIED
 * project, booted and clicked, with nothing removed.
 *
 * It is here because of what its absence hid. Every spec in this suite
 * either avoided clicking Spin or clicked it without watching for page
 * errors, so a `TypeError` raised on every pointer interaction over the
 * canvas — twice per click, from pixi's federated event system — went
 * unnoticed through an entire slice. Nothing in the game caused it: a
 * first `e8 dev` in a project has a cold dependency-optimizer cache, and
 * the row runtime halves the browser imports by URL brought a dependency
 * vite had not prebundled, so vite re-optimized mid-load and the page
 * finished with two generations of `pixi.js` — two `Container` classes,
 * one of which never received pixi's own event mixin. `dev-game` now names
 * the row entries to vite's optimizer up front; see that plugin's
 * `warmupEntries`.
 *
 * `projectCopy()` is what makes this measure anything: the copy excludes
 * `node_modules`, so this test always runs against a COLD optimizer, which
 * is the only state the fault appeared in.
 */
test('an unmodified project boots and spins with nothing thrown on the page', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await page.goto(host.gameUrl);
    await settled(page);
    await expect(page.locator('#status')).toHaveText('ready');

    // The click is the point: the fault this guards against needed a
    // pointer event over the canvas to appear at all.
    await page.locator('#spin').click();
    await expect(page.locator('#status')).toHaveText('done', { timeout: 20_000 });

    expect(pageErrors, 'a spin should raise nothing on the page').toEqual([]);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removing the reels row from the patch takes the board off the screen', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await page.goto(host.gameUrl);
    await settled(page);

    // Before the edit: a real game. The canvas is on screen because the
    // `renderer1` ROW attached it, and every row — `reels1` included —
    // composed without an error.
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('#status')).toHaveText('ready');

    // The board CHANGES: a hash of the reel grid's bottom row, taken
    // before and after ONE spin, has to differ. The board is a node of
    // the `base_game` scene (`scenes/base_game.scene.yml`), which
    // `flow.yml`'s `show` node puts up at boot with its cells still
    // empty; the spin is what fills them, so a hash of only that board
    // region — not the whole canvas, which also carries the shell's bar
    // and the floating dev toolbar — can only come out the same if the
    // spin drew nothing.
    const beforeSpin = await boardRegionHash(page);
    await page.locator('#spin').click();
    await expect(page.locator('#status')).toHaveText('done', { timeout: 20_000 });
    const afterSpin = await boardRegionHash(page);
    expect(afterSpin, 'the board should change on the canvas after a spin').not.toBe(beforeSpin);

    // The one edit in this test, and it is to a project FILE. No code
    // changes: not the engine's, not this project's own `src/main.ts`.
    writeFileSync(join(dir, 'e8.patch.yml'), PATCH_WITHOUT_REELS);

    // Composition is not hot — the plan says so explicitly and promises
    // nothing else. A reload is what picks the edited file up.
    await page.reload();
    await settled(page);

    // What a person sees now: the board is gone — the surface it was
    // drawn on is not on the page at all, because the failure screen
    // replaced the mount's children. NOT a check that the YAML contains
    // `remove: true`, and not a check that a fetch returned different
    // JSON: either would only prove the file was written, which was never
    // in question. The quadrant measurement above is what makes this
    // assertion mean something — without it, "no canvas" would also be
    // true of a game that had never drawn a board in the first place.
    await expect(page.locator('canvas'), 'the board should be gone from the screen').toHaveCount(0);

    // And the game still RUNS. It did not hang, it did not blank the
    // page, and nothing escaped as an uncaught error: the composition
    // simply came out one row lighter.
    await expect(page.locator('#spin')).toBeEnabled();
    await expect(page.locator('#status')).not.toHaveText('');
    expect(pageErrors, 'the page should degrade, not throw').toEqual([]);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The other half of the same criterion: the board going is not enough —
 * the person has to be told which row went.
 *
 * Rephrased in place of a stale claim, not a new test: this used to say
 * "nothing in the ENGINE can say this" and route the whole check through
 * `first-slot/src/main.ts`'s own hand-rolled `REQUIRES` list — because
 * removing a row is a legal edit, and only THIS game knew it could not do
 * without a board. That routing is gone (`main.ts` keeps no such list any
 * more; see its own module doc). The engine now says it: `@energy8engine
 * /play-loop`'s `package.json` declares `e8.runtime.requires: ["board"]`
 * — a play loop with no board to run a plan against cannot do the one
 * thing it exists for — and `createGame` checks that after every row has
 * applied. So the row this test now expects to see named is `playloop1`,
 * the row that DECLARED it needed a board, not `reels1`, the row that is
 * simply gone; naming the row that noticed over the row that vanished is
 * exactly what lets this same mechanism also cover a `reels1` that is
 * still THERE but whose own half failed (see `compose.test.ts`'s "names a
 * row that failed to apply beside the unmet requirement").
 */
test('… and says which row went missing', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await settled(page);
    await expect(page.locator('canvas')).toBeVisible();

    writeFileSync(join(dir, 'e8.patch.yml'), PATCH_WITHOUT_REELS);
    await page.reload();
    await settled(page);

    // A reason, where the board used to be, naming the row that DECLARED
    // it needed a board — so the person is told WHICH part of their
    // composition noticed, not that something somewhere went wrong.
    await expect(
      page.locator('#mount'),
      'acceptance criterion: with reels1 removed the game must say so, naming the row that required "board"',
    ).toContainText(/playloop/i);
    await expect(page.locator('#mount')).toContainText('This game could not start');
    // And the half-built game is not left underneath the explanation.
    await expect(page.locator('canvas')).toHaveCount(0);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The row that IS there and whose package is not: a typo in `name`.
 *
 * This is the case the whole "failures are data" rule was failing on. The
 * row resolves, the composition lists it, the IDE shows it as healthy —
 * and the host, the ONE place that knows the package could not be
 * resolved, threw that fact away and answered `runtimeUrl: null`, which
 * the loader is right to skip in silence because that is also what a
 * package with no runtime half looks like. Nothing downstream could
 * re-derive it. Result: a blank board and not one word anywhere.
 *
 * Asserted on the screen, in the game's own mount — not on
 * `/api/composition`'s JSON, which would only prove the host computed
 * something. The two strings that matter are the two halves of the
 * address a person needs to fix it: WHICH row, and which name on it did
 * not resolve.
 */
test('a misspelled package name on a row says so, naming the row and the package', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await settled(page);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('#status')).toHaveText('ready');

    writeFileSync(join(dir, 'e8.patch.yml'), PATCH_WITH_MISSPELLED_REELS);
    await page.reload();
    await settled(page);

    const mount = page.locator('#mount');
    await expect(mount).toContainText('This game could not start');
    await expect(mount, 'the diagnostic must name the row whose name is wrong').toContainText(
      'reels1',
    );
    await expect(
      mount,
      'the diagnostic must name the package that could not be resolved',
    ).toContainText('@energy8engine/reeels');

    // And the page's own REQUIRES message no longer contradicts it. It
    // used to assert the row "is not there", which is false here — the row
    // is right there in the patch, and its package name is the problem.
    await expect(mount).not.toContainText('is not there');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * `mechanics` was missing from `first-slot`'s own `REQUIRES` list while
 * `main.ts` read `ctx.mechanics` unguarded in two places. So removing
 * `mechanics1` — a legal patch edit — booted the page to `ready` over a
 * canvas that could never present anything, and threw on the first click.
 *
 * The defect came back once, in the slice that was meant to close it.
 * `main.ts` handed its whole `REQUIRES` list to `e8.runtime.requires`,
 * which is a field of a package.json and therefore only ever a ROW's to
 * declare — and the only row left declaring `mechanics` was
 * `plugins/reel-step`, which this same patch removes. So this test was
 * kept green by adding a `reelstep1` row back into the fixture, under a
 * comment excluding the case where it leaves too. It was not the
 * mechanism that held; it was the fixture.
 *
 * What holds it now is the page: `first-slot`'s `need()` records the
 * services `main.ts` itself reads off `ctx` — `mechanics` and `board`
 * (`play` left the page with the spin loop: the flow's `present` node is
 * what reads it now) — and reports and draws them the same way
 * `createGame` does for a row's. So the row named here is `mechanics1`,
 * as the thing that normally provides the service; the message is careful
 * not to claim it was removed, because the same absence is reachable with
 * the row present and failing (see the misspelled-package test above,
 * which pins that wording).
 */
test('removing the mechanics row says so instead of booting to ready', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await settled(page);
    await expect(page.locator('#status')).toHaveText('ready');

    writeFileSync(join(dir, 'e8.patch.yml'), PATCH_WITHOUT_MECHANICS);
    await page.reload();
    await settled(page);

    await expect(
      page.locator('#status'),
      'a composition with no mechanic registry must not read as ready',
    ).not.toHaveText('ready');
    const mount = page.locator('#mount');
    await expect(mount).toContainText('This game could not start');
    await expect(
      mount,
      'the screen must name the row that normally provides the registry',
    ).toContainText('mechanics1');

    // And a click on Spin still fails — the flow's `present` node asks
    // for the registry and there is none — but the reason is not repeated
    // from scratch: the boot diagnostic naming `mechanics1` is still
    // sitting in the same bounded log, above the node's own report,
    // exactly where it landed before the click.
    await page.locator('#spin').click();
    const log = page.locator('#log');
    await expect(log).toContainText('mechanics1', { timeout: 20_000 });
    await expect(log, 'the diagnostic names the missing service, not just the throw').toContainText(
      'nothing in the composition provided "mechanics"',
    );
    // The node's own words travel too (`plugin: 'flow'`, `where: draw`):
    // they are what tells "failed for the reason we predicted" apart from
    // "failed for another reason while a row happened to be missing".
    await expect(log).toContainText("flow (draw): no 'mechanics' service in this composition");
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * `ctx.play` — the service the flow's `present` node hands a plan and a
 * board (`play.execute(plan, board)`, in `@energy8engine/flow`'s
 * `kinds.ts`). It used to be the page's own read, recorded by `need()`,
 * and this edit used to be caught on the failure screen by the page's
 * word; the spin loop left `main.ts` with the flow editor and took that
 * read with it, so nothing on the page speaks for `play` any more. Two
 * things still do, and both are asserted because they say different
 * things: at boot, the row that needs what `playloop1` ALSO provided —
 * `ctx.steps`, the registry `reelstep1`'s step handler registers into —
 * names itself (`removeRowId` rather than a wholesale patch, so that row
 * is still here); and on the first click, the `present` node names the
 * service it could not find, in the game's own log, where before this
 * page recorded its needs the click gave `Cannot read properties of
 * undefined (reading 'execute')`.
 */
test('removing the play loop row says so at boot, and the first click names the missing service', async ({
  page,
}) => {
  const dir = projectCopy({ removeRowId: 'playloop1' });
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await settled(page);

    await expect(
      page.locator('#status'),
      'a composition with no play loop must not read as ready',
    ).not.toHaveText('ready');
    const mount = page.locator('#mount');
    await expect(mount).toContainText('This game could not start');
    await expect(
      mount,
      'the row whose step handler had nowhere to register names itself',
    ).toContainText('the "reelstep1" row requires "steps"');

    // The spin still runs — the button is not in the mount — and its
    // `present` says which service the presentation needed.
    await page.locator('#spin').click();
    await expect(page.locator('#log')).toContainText(
      "flow (draw): no 'play' service in this composition",
      { timeout: 20_000 },
    );
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The third of the page's own needs, and until this task the one that was
 * never actually recorded — only inferred. `presentStage` hands
 * `play.execute` a `board` two lines below `play` itself
 * (`play.execute(plan, board)`), and that read was safe only because
 * `play` is evaluated first in the same expression: with `play` present
 * and `board` absent, the call itself would still have blown up on its
 * second argument, with nothing here to say why, the moment a play loop
 * ever stopped declaring `requires: ["board"]` on its own account.
 *
 * `declared.spec.ts`'s "a row that requires a missing service says so,
 * naming both" already proves the ROW's half of this — `playloop1`'s own
 * `e8.runtime.requires: ["board"]`, read off `#log` right after boot. This
 * test proves the other half, the one this task added: the PAGE's own
 * words, on the failure screen, naming `reels1` as what normally provides
 * `board` — independent of whatever any other row happens to declare.
 */
test('removing the reels row says so from the page\'s own read of "board", not only the row', async ({
  page,
}) => {
  const dir = projectCopy({ removeRowId: 'reels1' });
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await settled(page);

    const mount = page.locator('#mount');
    await expect(mount).toContainText('This game could not start');
    await expect(
      mount,
      'the page must name its own need for "board", not merely inherit playloop1\'s row-level one',
    ).toContainText('this page needs a board');
    await expect(mount, 'and the row that would normally have provided it').toContainText('reels1');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A composition that HAS a mechanic registry and binds nothing to the
 * stage. Legal — `mechanics1.stages` is a project's to fill in — and it is
 * the one case where the game reaches the board and stops there.
 *
 * The status line used to say `done` for it. `presentStage` reported the
 * failure and set the status to match, and the spin handler then wrote
 * `done` straight over it: a spin that never reached the board, announced
 * as finished, with the reason sitting in the log underneath. Found while
 * reproducing the raw-`TypeError` message above, not looked for.
 */
test('a spin that could not be presented does not report itself as done', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    writeFileSync(join(dir, 'e8.patch.yml'), PATCH_WITH_NOTHING_BOUND);
    await page.goto(host.gameUrl);
    await settled(page);

    // The registry is there, so nothing is missing and the page is not a
    // failure screen — this is a working game with an unbound stage.
    await expect(page.locator('#status')).toHaveText('ready');

    await page.locator('#spin').click();
    const log = page.locator('#log');
    // The words the REGISTRY wrote, not a sentence the page wrapped around
    // them. `#log` used to be a place `main.ts` printed to, and what it
    // printed here was its own "could not present this stage: <the
    // diagnostics, as JSON>"; the element renders `ctx.diagnostics` now, so
    // what a person reads is `MechanicsService.check`'s own message — which
    // names the actual cause (nothing is bound) where the page's wrapper
    // only said that presenting had failed.
    await expect(log).toContainText('cannot check stage "base_game"', { timeout: 20_000 });
    await expect(log).toContainText('nothing is bound to it');
    await expect(
      page.locator('#status'),
      'a spin that never reached the board must not read as done',
    ).not.toHaveText('done');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The editor's side of the same claim: a person opening the IDE can read
 * what the profile resolved to, and which layer placed each row.
 *
 * This is the one test in the file that goes through the real IDE app on
 * 5680 rather than the game — `CompositionScreen` rendered by
 * `apps/web/src/App.tsx`, fed by `@energy8engine/ide-client`'s
 * `game-composition` plugin over vite's `/api` proxy to the host. Its
 * jsdom sibling (`ide/client/tests/composition-layers.test.tsx`) proves
 * the screen renders a `rows` prop; only this one proves anything ever
 * hands it one.
 */
test('the composition screen lists the rows the profile resolved to', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    // Through the IDE on 5680, not the game on the preview origin — the screen under
    // test is the editor's, and it reaches the host through vite's proxy.
    await page.goto(`http://127.0.0.1:${IDE_WEB_PORT}/`);
    for (const id of ['boot1', 'renderer1', 'scenes1', 'reels1']) {
      await expect(
        page.getByTestId(`row-${id}`),
        `acceptance criterion: the composition screen must list the resolved row ${id}`,
      ).toBeVisible();
    }
    // And which layer placed each one — the two that exist in this
    // project, read off the screen rather than off the files: `boot1`
    // comes from the `e8-base` bundle the profile stacks and nothing
    // overrides it, while `reels1` carries the patch's own grid. Asserting
    // only the first would pass just as happily on a screen that printed
    // the same label on every row.
    await expect(page.getByTestId('row-boot1')).toContainText('e8-base');
    await expect(page.getByTestId('row-reels1')).toContainText('patch');
    // The package name, too — the row is identified by what it actually
    // composes, not only by its id.
    await expect(page.getByTestId('row-reels1')).toContainText('@energy8engine/reels');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
