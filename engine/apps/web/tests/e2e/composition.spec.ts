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
 * into an assertion with no image library at all: screenshot the canvas
 * in QUADRANTS and compare the PNG bytes to each other. A canvas with a
 * board on it has four different quadrants; a canvas with nothing on it
 * is a single flat fill, so all four quadrants are byte-identical. That
 * is an exact comparison, not a tolerance — same pixels, same encoder,
 * same dimensions — and it is measured within ONE screenshot pass, so no
 * GPU or antialiasing difference between runs can reach it.
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
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { createIdeHost, type IdeHost } from '@energy8engine/ide-host';
import * as devGame from '@energy8engine/ide-host/dev-game';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(__dirname, '..', '..', '..', '..', 'examples');
const FIXTURE = join(EXAMPLES, 'first-slot');

/** A private, writable copy of `first-slot`. Never the checked-in example itself. */
function projectCopy(): string {
  const dir = mkdtempSync(join(EXAMPLES, 'e8-compose-'));
  cpSync(FIXTURE, dir, {
    recursive: true,
    // The fixture's `node_modules` holds nothing but vite's own
    // optimize-deps cache. Copying it hands the new server a cache keyed
    // to a different root — the stale-bundle trap; let vite build its own.
    filter: (src) => !src.endsWith('/node_modules'),
  });
  return dir;
}

interface DevHost {
  /** Origin of the running GAME — `dev-game`'s catch-all owns `/` on the host's own port. */
  gameUrl: string;
  stop(): Promise<void>;
}

/** Boots `e8 dev` in `dir`: the same host, with the same `dev-game` on top, the CLI's `dev` command boots. */
async function startDevHost(dir: string): Promise<DevHost> {
  const gamesDir = join(dir, 'game');
  // Read from the project, the way the CLI does — not hardcoded here, so
  // a fixture that renamed its game could not silently keep passing.
  const spec = JSON.parse(readFileSync(join(gamesDir, 'spec.json'), 'utf8')) as {
    id: string;
    betLevels?: number[];
  };
  const host: IdeHost = await createIdeHost({ cwd: dir, port: 5679 });
  await host.ctx.plugin(devGame, {
    root: dir,
    gamesDir,
    gameId: spec.id,
    betLevel: spec.betLevels?.[0] ?? 1,
    port: 0,
  });
  // `host.stop()` awaits the fiber's disposal, which closes the HTTP
  // server — the next spec file may bind 5679 the moment this resolves.
  return { gameUrl: host.url, stop: () => host.stop() };
}

/**
 * The fixture's own patch with exactly ONE row changed: `reels1` stops
 * carrying a grid and asks to be removed.
 *
 * Spelled out in full rather than written as the single removal row
 * alone, because everything else has to stay identical for the test to
 * mean anything. Drop `renderer1`'s size and `stage1`'s design along with
 * it and the game would change for those reasons too — a screen that went
 * empty could no longer be attributed to the reels row, and the test
 * would be passing through a branch other than the one it names.
 */
const PATCH_WITHOUT_REELS = `rows:
  - id: renderer1
    config:
      width: 480
      height: 288
      background: '#10121a'
  - id: stage1
    config:
      design:
        width: 480
        height: 288
  - id: reels1
    remove: true
  - id: mechanics1
    config:
      stages:
        base_game: classic
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
 * The four quadrants of the game canvas, as PNG bytes. All four equal
 * means the canvas is one flat colour — nothing is drawn on it. See the
 * module doc for why this is the honest way to read a WebGL surface here.
 */
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

    // The board is DRAWN: four quadrants of the canvas, four different
    // pictures. This is the 5x3 grid of reel cells a person sees before
    // ever pressing Spin.
    const withBoard = await canvasQuadrants(page);
    expect(new Set(withBoard).size, 'the board should be drawn on the canvas').toBeGreaterThan(1);

    // The one edit in this test, and it is to a project FILE. No code
    // changes: not the engine's, not this project's own `src/main.ts`.
    writeFileSync(join(dir, 'e8.patch.yml'), PATCH_WITHOUT_REELS);

    // Composition is not hot — the plan says so explicitly and promises
    // nothing else. A reload is what picks the edited file up.
    await page.reload();
    await settled(page);

    // What a person sees now: the board is gone. Every quadrant of the
    // canvas is the same flat background — there is no grid left to look
    // at. NOT a check that the YAML contains `remove: true`, and not a
    // check that a fetch returned different JSON: either would only prove
    // the file was written, which was never in question.
    //
    // The branch is not hedging. Today the canvas survives the removal
    // and comes back empty; once the next test's gap is closed the
    // failure screen will replace the mount's children outright and there
    // will be no canvas at all. Both are "the board is gone from the
    // screen", and this test has to keep being true across that fix
    // rather than pin the shape of a degradation it is not judging.
    if ((await page.locator('canvas').count()) > 0) {
      const withoutBoard = await canvasQuadrants(page);
      expect(new Set(withoutBoard).size, 'the board should be gone from the canvas').toBe(1);
      expect(withoutBoard[0]).not.toBe(withBoard[0]);
    }

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
 * The other half of the same criterion — and it **FAILS TODAY**. It is
 * left red on purpose: this is the acceptance test, and a test that
 * agrees with the code instead of judging it is worth nothing. Do not
 * weaken it, do not annotate it `test.fail()`; it goes green by itself
 * when the gap closes.
 *
 * What was promised: after the reels row is removed, a reason is visible
 * where the board used to be, naming `reels`. What actually happens
 * (measured — see `task-11-report.md`): the row really is gone from
 * `/api/composition` and the board really is gone from the canvas (the
 * test above proves both), but the page still reports `ready`,
 * `createGame` returns ZERO diagnostics, and `#mount` holds an empty
 * canvas and no text at all. A person is shown an empty rectangle with no
 * explanation.
 *
 * Why, precisely: removing a row is a LEGAL composition edit and nothing
 * in the composed graph objects to it. `@energy8engine/reels` declares no
 * seam, so `createGame`'s `REQUIRED_SEAMS` check never looks for it; no
 * other row `inject`s `board`, so cordis has nothing to wait for; and the
 * one component that genuinely needs the board — this project's own
 * `src/main.ts` — declares that need only as an erased `import type {}
 * from '@energy8engine/reels/runtime'`, which by construction cannot be
 * checked at runtime. The absent capability therefore surfaces nowhere
 * until something reads `ctx.board`, which first happens on a spin, and
 * reads `undefined`.
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

    // A reason, where the board used to be, naming the row that went
    // missing — so the person is told WHICH part of their composition is
    // gone, not that something somewhere went wrong.
    await expect(
      page.locator('#mount'),
      'acceptance criterion: with reels1 removed the game must say so, naming reels',
    ).toContainText(/reels/i);
    await expect(page.locator('#mount')).toContainText('This game could not start');
    // And the half-built game is not left underneath the explanation.
    await expect(page.locator('canvas')).toHaveCount(0);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The editor's side of the same claim — and it **FAILS TODAY**, for a
 * different reason from the one above, and a simpler one: the screen is
 * built but not wired.
 *
 * `@energy8engine/ide-client`'s `CompositionScreen` renders exactly these
 * `data-testid="row-<id>"` sections, complete with the layer label, when
 * it is handed a `rows` prop — `ide/client/tests/composition-layers.test
 * .tsx` proves that in jsdom. But the running IDE never hands it one:
 * `engine/apps/web/src/App.tsx` renders `<CompositionScreen ctx={ctx} />`
 * and nothing else, and no client plugin fetches `/api/composition`. So
 * the whole game-composition half of the screen is unreachable from the
 * app a person actually opens. What is on that page instead is only the
 * EDITOR's own rows, from `e8.yml` over the `/ide` socket:
 * `@cordisjs/plugin-include` and `@energy8engine/ide-bridge`, plus the
 * game preview iframe.
 *
 * Left red for the same reason as the test above. It goes green the day
 * something feeds the screen the composition the host already serves.
 */
test('the composition screen lists the rows the profile resolved to', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    // Through the IDE on 5680, not the game on 5679 — the screen under
    // test is the editor's, and it reaches the host through vite's proxy.
    await page.goto('http://127.0.0.1:5680/');
    for (const id of ['boot1', 'renderer1', 'stage1', 'reels1']) {
      await expect(
        page.getByTestId(`row-${id}`),
        `acceptance criterion: the composition screen must list the resolved row ${id}`,
      ).toBeVisible();
    }
    // And where each row came from: `e8-base` is the bundle this
    // project's `e8.profile.yml` stacks. Nothing in the engine names
    // these rows any more.
    await expect(page.getByTestId('row-boot1')).toContainText('e8-base');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
