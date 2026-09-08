/**
 * The acceptance test for the "one place to look" slice: **the game, the
 * IDE and the agent see the same list** (§8 of the design spec, "Тот же
 * список видят игра, IDE и агент").
 *
 * The debt this closes was recorded, not imagined: the IDE's composition
 * screen could show six healthy rows beside a game sitting under its own
 * failure screen, in a browser tab the editor never looked at.
 * Authoritative-looking, and wrong.
 *
 * Two things are asserted here, and neither is "the panel shows
 * something":
 *
 *  1. **Word for word.** A failure raised inside a running game reaches
 *     the IDE panel carrying the SAME TEXT the game itself shows. A panel
 *     with its own phrasing of the same trouble — a summary, a truncation,
 *     a severity count — would pass a `toContainText('failed')` check and
 *     break §8's promise, which is about one list rather than two views
 *     that agree in spirit. So the game's own line is read off `#log`,
 *     and the panel is required to contain it whole, `fix` clause and all.
 *  2. **Two namespaces, two rows.** `Diagnostic.plugin` is drawn from two
 *     disjoint namespaces (its own doc spells them out): a composition row
 *     id, and a running game's seam or mechanic id. A human is entitled to
 *     write `id: session` into `e8.patch.yml` while a game's own session
 *     seam reports as `plugin: 'session'` too. Both must appear, each
 *     attributed to its own side — never one rendered as the other, and
 *     never one swallowed as a duplicate of the other.
 *
 * **The failures are provoked AFTER boot on purpose.** A boot failure
 * already reaches the screen through `createGame`'s failure screen and
 * `GameApp.diagnostics`, which is the path that existed before this slice;
 * a test that used one would prove the old road, not the new one. So the
 * first test breaks a mechanic that only runs on a click, and the second
 * fails a spin at the host — both of them things that happen to a game
 * that booted perfectly.
 *
 * **The editor is opened last, and is told nothing directly.** In both
 * tests the game reports while no IDE tab exists at all; the panel learns
 * about it from the frame `rpc.ts` retains and re-sends to a connection
 * that arrives afterwards. That is deliberate — a person opens the editor
 * because something looks wrong, which is precisely the moment a panel
 * that only forwards live events would have nothing to say.
 *
 * The project is copied before it is touched, for the reasons
 * `./project-fixture` gives at length, and every copy is removed in
 * `finally`.
 */
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { projectCopy, startDevHost } from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api` and `/ide` to the host on 5679. */
const IDE_URL = 'http://127.0.0.1:5680/';

/**
 * The message the project's own `reel-step` mechanic throws instead of
 * presenting.
 *
 * Long, and specific to this test, on purpose. The claim being checked is
 * that the panel shows the game's text rather than its own account of the
 * same trouble, and a short string ("failed") could be reproduced by any
 * summary that happened to use the same word. This one cannot be arrived
 * at by paraphrase.
 *
 * It begins with `presentation failed` because that is what the game's own
 * page calls this state in `#status`, so the two surfaces of the GAME
 * agree as well.
 */
const THROWN = 'presentation failed: reel-step refused this board (fixture 7f3a)';

/**
 * Makes the copied project's own mechanic throw when it is asked to
 * present — a third-party plugin failing inside a running game, which is
 * exactly the case `MechanicsService.present` exists to catch and report
 * rather than let escape.
 *
 * An edit to the PROJECT's plugin, never to the checked-in fixture: the
 * copy is what runs, and `plugins/reel-step` is served through the same
 * vite instance as the rest of it.
 */
function breakPresentation(dir: string): void {
  const file = join(dir, 'plugins', 'reel-step', 'src', 'mechanic.ts');
  const source = readFileSync(file, 'utf8');
  const broken = source.replace(
    'present: (data) => plan(data as ReelStepStageData),',
    `present: () => {\n    throw new Error(${JSON.stringify(THROWN)});\n  },`,
  );
  expect(broken, "the fixture's mechanic must actually have been edited").not.toBe(source);
  writeFileSync(file, broken);
}

test('a failure inside the running game reaches the IDE panel, word for word', async ({
  page,
  context,
}) => {
  const project = projectCopy();
  breakPresentation(project);
  const host = await startDevHost(project);
  try {
    // The game page first: provoke a failure AFTER boot, not at boot — a boot
    // failure already reaches the screen, and would prove the old path.
    const game = await context.newPage();
    await game.goto(host.gameUrl);
    // 20s, the same wait every spec in this suite gives a first load: the
    // copy excludes `node_modules`, so vite's dependency optimizer is cold.
    await expect(game.locator('#status')).toHaveText('ready', { timeout: 20_000 });
    await game.locator('#spin').click(); // the fixture's bound mechanic fails to present
    await expect(game.locator('#log')).toContainText('presentation failed', { timeout: 20_000 });
    const onTheGame = await game.locator('#log').textContent();

    // Now the editor, which was never told anything directly.
    await page.goto(IDE_URL);
    const panel = page.getByTestId('diagnostics-panel');
    await expect(panel).toContainText('presentation failed', { timeout: 20_000 });

    // §8's promise, checked rather than assumed: the same list, not a summary.
    const message = /presentation failed[^\n]*/.exec(onTheGame ?? '')![0];
    // Guards this assertion against passing on a stub of itself: if the
    // game's line were somehow just the words searched for, containing it
    // would prove nothing about the panel.
    expect(
      message.length,
      "the game's own line must be more than the words searched for",
    ).toBeGreaterThan('presentation failed'.length + 20);
    await expect(panel).toContainText(message);
  } finally {
    await host.stop();
    rmSync(project, { recursive: true, force: true });
  }
});

test('one id in both namespaces renders as two rows, not one', async ({ page }) => {
  // A project row the human named `session`, plus the game's own `session`
  // seam diagnostic. The panel must show both and attribute each correctly.
  const project = projectCopy({ patchRowId: 'session' });
  // And the game's half of the collision. `session-dev` reports a failed
  // spin as `plugin: 'session'` (namespace 2 — a runtime seam id), and the
  // cheapest honest way to fail one is to ask the math for a game it does
  // not have: `startDevHost` reads this id out of the project, exactly as
  // the CLI's `dev` command does, so nothing here reaches around the
  // product to stage the failure.
  const specFile = join(project, 'game', 'spec.json');
  const spec = JSON.parse(readFileSync(specFile, 'utf8')) as { id: string };
  writeFileSync(specFile, JSON.stringify({ ...spec, id: 'not-a-game' }, null, 2));

  const host = await startDevHost(project);
  try {
    // The spin that produces the game's half, clicked on the game's own
    // page: `POST /api/spin` fails in the host process, the route answers
    // `502 { diagnostics }`, and the host broadcasts them as a
    // `game-diagnostics` frame of its own.
    //
    // The page shows a failure screen here, and that is correct rather than
    // incidental: a patch row nothing can place is an `error`, and a
    // composition with an error in it is not a game a player should be
    // looking at. Spin still works — the button is not in the mount — which
    // is all this test needs from it.
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
    await page.locator('#spin').click();
    await expect(page.locator('#status')).toContainText('spin failed', { timeout: 20_000 });

    await page.goto(IDE_URL);
    const rows = page.getByTestId(/^diag-/);
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    await expect(rows.nth(0)).toContainText(/project/i);
    await expect(rows.nth(1)).toContainText(/game/i);
    // Both really are the same id — otherwise the two rows above would be
    // telling apart two things that were never in danger of being confused.
    await expect(rows.nth(0)).toContainText('session');
    await expect(rows.nth(1)).toContainText('session');
  } finally {
    await host.stop();
    rmSync(project, { recursive: true, force: true });
  }
});

/**
 * Two speakers reach the panel over the `game-diagnostics` wire — a running
 * game's own `ide-bridge`, and the host itself for the one producer that is
 * not in the browser at all (`dev-game`'s `/api/spin` route, which runs in
 * the host process). Each sends its WHOLE list, which is the right design
 * for a reader that may have just connected; what it must not mean is that
 * one speaker's whole list replaces the OTHER speaker's.
 *
 * Measured before the fix: the game reported two things, the host then
 * reported one, and the panel showed only the host's — terminally, because
 * nothing makes the game speak again afterwards. A panel whose whole job is
 * being trustworthy, quietly dropping two real failures the moment a third
 * arrives.
 */
test('a host-side failure does not erase what the game already reported', async ({
  page,
  context,
}) => {
  const project = projectCopy();
  // Makes `POST /api/spin` fail in the HOST process — the math is asked for
  // a game it does not have — so the host speaks on the same wire the game
  // does. The game itself boots and runs perfectly: the id is only consulted
  // when a spin is actually played.
  const specFile = join(project, 'game', 'spec.json');
  const spec = JSON.parse(readFileSync(specFile, 'utf8')) as { id: string };
  writeFileSync(specFile, JSON.stringify({ ...spec, id: 'not-a-game' }, null, 2));

  const host = await startDevHost(project);
  try {
    const game = await context.newPage();
    await game.goto(host.gameUrl);
    await expect(game.locator('#status')).toHaveText('ready', { timeout: 20_000 });

    // The game reports two things of its own, through the same
    // `mechanics.present` path a click goes through — two stages nothing in
    // this composition binds.
    await game.evaluate(() => (window as any).__e8.present('first-unbound', {}));
    await game.evaluate(() => (window as any).__e8.present('second-unbound', {}));
    await expect(game.locator('#log')).toContainText('first-unbound');
    await expect(game.locator('#log')).toContainText('second-unbound');

    // …and THEN the host reports one of its own, on the same wire.
    await game.locator('#spin').click();
    await expect(game.locator('#status')).toContainText('spin failed', { timeout: 20_000 });

    // The editor arrives afterwards and must be told all three — the two the
    // game said and the one the host said.
    await page.goto(IDE_URL);
    const panel = page.getByTestId('diagnostics-panel');
    await expect(panel).toContainText('unknown game "not-a-game"', { timeout: 20_000 });
    await expect(
      panel,
      "the host's own frame must not replace what the game reported",
    ).toContainText('first-unbound');
    await expect(panel).toContainText('second-unbound');
  } finally {
    await host.stop();
    rmSync(project, { recursive: true, force: true });
  }
});

/**
 * The slice's own disease in its last form. `createGame` mirrors the HOST's
 * project diagnostics into the game's `ctx.diagnostics` on purpose — `boot`
 * paints one list and the page reads one list — and `ide-bridge` forwards
 * that list onward. So the editor, which already has those diagnostics from
 * `/api/composition`, received them a second time and rendered them again,
 * the second copy labelled `game`.
 *
 * The invariant: each diagnostic appears exactly once, attributed to where
 * it actually came from. And the game's own list stays COMPLETE — that half
 * is asserted here too, on the game's page, because the obvious wrong fix is
 * to stop mirroring and leave `boot` with nothing to paint.
 */
test('a project failure appears once, on the project side', async ({ page, context }) => {
  const project = projectCopy({ patchRowId: 'session' });
  const host = await startDevHost(project);
  try {
    const game = await context.newPage();
    await game.goto(host.gameUrl);
    await expect(game.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    // Half one: the game's own list is still complete. The project's
    // complaint is in it, where `boot` and this page both need it.
    await expect(
      game.locator('#log'),
      "the game's own list must still carry what the host said about the project",
    ).toContainText('which no bundle placed');

    // Something of the game's own, so the bridge actually forwards.
    await game.evaluate(() => (window as any).__e8.present('unbound-stage', {}));
    await expect(game.locator('#log')).toContainText('unbound-stage');

    await page.goto(IDE_URL);
    const rows = page.getByTestId(/^diag-/);
    const projectRow = rows.filter({ hasText: 'which no bundle placed' });
    const gameRow = rows.filter({ hasText: 'unbound-stage' });

    // The game's own report FIRST, and it is what arms everything below.
    // The project half is rendered from `/api/composition`, which the editor
    // fetches on its own; the game half arrives a moment later, over the
    // socket. Counting the project rows before that second frame lands would
    // find one of them and pass through a branch this test does not name —
    // measured, not guessed: that is exactly how it passed spuriously the
    // first time it was run against the unfixed code, and the duplicate was
    // caught one line further down by luck rather than by design.
    await expect(gameRow, "the game's own report must still arrive").toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(gameRow).toContainText(/game/i);

    // Half two, now that the whole picture is in: exactly one row for the
    // project's complaint, and it is the project's. Before the fix there were
    // two, the second wearing `game`.
    await expect(projectRow, 'the project row must appear once, not once per side').toHaveCount(1);
    await expect(projectRow).toContainText(/project/i);
  } finally {
    await host.stop();
    rmSync(project, { recursive: true, force: true });
  }
});

/**
 * **A failure at BOOT.** The suite above provokes every failure AFTER the
 * game is up, on the reasoning that a boot failure "already reaches the
 * screen". That is true of the GAME's screen — `createGame` paints it — and
 * false of the IDE's, which is the half this slice built. So the case the
 * whole slice exists for was the one case the acceptance suite could not
 * express.
 *
 * Measured on a live host before the fix, on a project plugin whose `apply`
 * throws:
 *
 *     GAME #status: composition has errors — see log
 *     GAME #log:    [error] reelstep1 (runtime): …boot-failure-probe…
 *     IDE PANEL:    Diagnostics  no game connected yet
 *     IDE ROWS:     0
 *
 * The recorded defect exactly — an authoritative-looking editor beside a
 * game lying under a failure screen — reached by the commonest failure
 * there is. The cause was one missing line in `attachDiagnosticsForwarding`:
 * everything `createGame` collects is already in the log by the time the
 * bridge attaches, so a game that failed at boot had no later CHANGE to
 * forward and therefore said nothing.
 *
 * Three fixtures, one per boot-time row of the spec's §11 table that a
 * project can actually reach: a plugin that fails to load, a seam with two
 * providers, and a mechanic whose `expects` does not meet the math's
 * schema. All three were equally invisible.
 */
interface BootFailure {
  /** What goes wrong, as a test name. */
  what: string;
  /** Breaks the copied project. */
  prepare(dir: string): void;
  /** A distinctive fragment of the diagnostic, used to find the line on both surfaces. */
  fragment: string;
}

/** Rewrites one file in the copy, refusing to pass if the edit found nothing. */
function patchFile(file: string, find: string, replace: string): void {
  const source = readFileSync(file, 'utf8');
  const next = source.replace(find, replace);
  expect(next, `the fixture edit must actually have changed ${file}`).not.toBe(source);
  writeFileSync(file, next);
}

const BOOT_FAILURES: BootFailure[] = [
  {
    what: 'a project plugin whose apply throws',
    prepare: (dir) =>
      patchFile(
        join(dir, 'plugins', 'reel-step', 'src', 'index.ts'),
        'export function apply(ctx: Context, config: ReelStepRowConfig = {}): void {',
        "export function apply(ctx: Context, config: ReelStepRowConfig = {}): void {\n  throw new Error('boot-failure-probe: the reel-step row refused to apply');",
      ),
    fragment: 'boot-failure-probe',
  },
  {
    what: 'a seam with two default providers',
    // §11: "Конфликт провайдера шва — ноль кандидатов или двое: error с
    // перечислением кандидатов и их матчеров." A second row of the same
    // renderer package is the cheapest way for a project to reach it, and
    // it is a plausible mistake: a patch that adds a renderer without
    // removing the bundle's.
    prepare: (dir) =>
      appendFileSync(
        join(dir, 'e8.patch.yml'),
        "  - id: renderer2\n    name: '@energy8engine/renderer-pixi'\n    config: {}\n",
      ),
    fragment: 'default providers',
  },
  {
    what: 'a mechanic expecting a field the math never declares',
    // §11: "`expects` механики не сходится со `SpinSchema` — error с именем
    // стадии, ожидаемым полем и его формой." Checked before the first spin
    // by `checkAgainstSchema`, so it is a BOOT diagnostic — and `bonus_wild`
    // is genuinely absent from the schema rather than dropped by the parser,
    // which is the case that is deliberately NOT reported (see
    // `schema.spec.ts`).
    prepare: (dir) =>
      patchFile(
        join(dir, 'plugins', 'reel-step', 'src', 'mechanic.ts'),
        "fields: { grid: 'grid', reel_steps: 'list' },",
        "fields: { grid: 'grid', reel_steps: 'list', bonus_wild: 'number' },",
      ),
    fragment: 'bonus_wild',
  },
];

for (const failure of BOOT_FAILURES) {
  test(`a boot failure reaches the IDE panel: ${failure.what}`, async ({ page, context }) => {
    const project = projectCopy();
    failure.prepare(project);
    const host = await startDevHost(project);
    try {
      const game = await context.newPage();
      await game.goto(host.gameUrl);
      // Not `ready`: this game did not start. The page says so, which was
      // never the problem — the problem was that only the page said so.
      await expect(game.locator('#status')).toHaveText('composition has errors — see log', {
        timeout: 20_000,
      });
      await expect(game.locator('#log')).toContainText(failure.fragment);
      const onTheGame = await game.locator('#log').textContent();

      await page.goto(IDE_URL);
      const panel = page.getByTestId('diagnostics-panel');
      await expect(
        panel,
        'a game that failed at boot must reach the editor, not only its own screen',
      ).toContainText(failure.fragment, { timeout: 20_000 });

      // Word for word, the same check the after-boot acceptance makes: the
      // panel shows the game's line, not its own account of it.
      const line = new RegExp(`${failure.fragment}[^\\n]*`).exec(onTheGame ?? '')![0];
      await expect(panel).toContainText(line);

      // And attributed to the game, not to the project: these are the
      // GAME's own diagnostics (`report`), not the host's seeded ones.
      await expect(page.getByTestId(/^diag-/).filter({ hasText: failure.fragment })).toContainText(
        /game/i,
      );
    } finally {
      await host.stop();
      rmSync(project, { recursive: true, force: true });
    }
  });
}

/**
 * The mirror of the same missing line, and the more insidious half: a
 * failure that has been FIXED went on being shown by the IDE forever.
 *
 * `rpc.ts` retains the last frame per source and deliberately never clears
 * it — a game going quiet because it crashed is exactly when its last words
 * matter most. The only thing that can replace a stale `game` slot is the
 * game saying what is true NOW, and a healthy game had nothing to say.
 * Measured before the fix: the game's own log empty, the panel still showing
 * the old error.
 */
test('a failure that has been fixed stops being shown', async ({ page, context }) => {
  const project = projectCopy();
  const pluginEntry = join(project, 'plugins', 'reel-step', 'src', 'index.ts');
  const healthy = readFileSync(pluginEntry, 'utf8');
  BOOT_FAILURES[0].prepare(project);

  const host = await startDevHost(project);
  try {
    const game = await context.newPage();
    await game.goto(host.gameUrl);
    await expect(game.locator('#log')).toContainText('boot-failure-probe', { timeout: 20_000 });

    // The editor sees it — the state this test is about undoing.
    await page.goto(IDE_URL);
    const panel = page.getByTestId('diagnostics-panel');
    await expect(panel).toContainText('boot-failure-probe', { timeout: 20_000 });

    // The developer fixes it and reloads the game. The editor tab is left
    // open, exactly as a person would leave it.
    writeFileSync(pluginEntry, healthy);
    await game.reload();
    await expect(game.locator('#status')).toHaveText('ready', { timeout: 20_000 });
    await expect(game.locator('#log'), "the game's own list is clean now").not.toContainText(
      'boot-failure-probe',
    );

    await expect(
      panel,
      'a fixed failure must stop being shown, not be shown until something else happens',
    ).not.toContainText('boot-failure-probe', { timeout: 20_000 });
  } finally {
    await host.stop();
    rmSync(project, { recursive: true, force: true });
  }
});
