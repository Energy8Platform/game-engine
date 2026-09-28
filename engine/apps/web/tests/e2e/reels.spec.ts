/**
 * The Reels document, end to end (Task 7): `reels1`'s config edited from
 * the document's own sections lands in `e8.patch.yml` AND reaches the reel
 * lab canvas (`editor.html?reels=`) over its `rows` rpc, without a remount
 * — the same claim `reels-document.test.tsx` proves against a fake
 * `gameComposition`/canvas, now against the real host, the real
 * `first-slot` project (`e8-base` composes all five reel rows:
 * `reels1`/`motion1`/`anticipation1`/`cascade1`/`features1`) and a real
 * `<iframe>`.
 *
 * Same fixture and idioms as `symbols.spec.ts`: a private `projectCopy()`
 * served by `startDevHost`, and `frameOf`/`readyCanvas` — its own
 * `readyCanvas` generalised to any canvas selector, reused here verbatim
 * for `iframe[title="reels canvas"]`.
 *
 * The patch file is read with `js-yaml`'s `load` (`project-fixture.ts`
 * already depends on it for the same reason) rather than matched with a
 * regex: a nested path four keys deep (`grid.frameStyle.idle.color`) is a
 * parse-and-read, not a pattern a hand-written regex could track through
 * `yaml.dump`'s own indentation without becoming as long as the parser
 * itself.
 *
 * One field id per assertion (`#field-reels-reels1-cols`,
 * `#field-reels-anticipation1-enabled`, `#field-reels-reels1-frameStyle-idle`
 * — the Reels document prefixes its forms' `rowId` with `reels-` so they
 * never collide with Composition's copy of the same rows) rather than
 * `getByLabelText` — `SchemaForm`'s own doc explains why: `frameStyle`
 * carries the SAME field names (`color`, `alpha`, and a `color hex`
 * textbox) once for every one of its four states (`idle`,
 * `winning`, `removed`, `fresh`), and Anticipation's own `zoom` group
 * repeats `enabled` a second time under a different id — `getByLabelText`
 * would go ambiguous on either. `hot-fork.spec.ts`'s `commit()` helper
 * reads a game row's field the same way, one level shallower.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;
const REELS_CANVAS = 'iframe[title="reels canvas"]';

// `| undefined`, RESET after each test's own cleanup: a test that throws
// before ever calling `boot()` (a bad `writeFileSync`, say) must not leave
// a stale reference to the PREVIOUS test's already-stopped `host`/removed
// `dir` for ITS OWN `afterEach` to act on.
let dir: string | undefined;
let host: DevHost | undefined;

test.beforeEach(() => {
  dir = projectCopy();
});

test.afterEach(async () => {
  await host?.stop();
  host = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/**
 * Starts the host over `dir` — split out of `beforeEach` so a test
 * may edit the project's files first, the way `declared.spec.ts`'s inline
 * edits do. Needed here because `startDevHost` boots vite over `dir`
 * straight away and hands it every row to pre-bundle in the background
 * (`project-fixture.ts`'s own doc on `startDevHost`); an edit to
 * `src/editor.ts` made only AFTER that has started risks the canvas iframe
 * being served the version vite already read, not the one the test wrote.
 * `dir!`: always set by `beforeEach` before any test body (and so before
 * `boot()`) runs.
 */
async function boot(): Promise<void> {
  host = await startDevHost(dir!);
}

/** `e8.patch.yml`, parsed — the config object a patch row currently carries, or `undefined` for a row the patch does not mention at all yet. */
function patchConfig(id: string): Record<string, any> | undefined {
  const doc = load(readFileSync(join(dir!, 'e8.patch.yml'), 'utf8')) as {
    rows: { id: string; config?: Record<string, unknown> }[];
  };
  return doc.rows.find((row) => row.id === id)?.config;
}

async function frameOf(page: Page, selector: string): Promise<Frame> {
  const handle = await page.locator(selector).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`${selector} has no content frame`);
  return frame;
}

/** Polls a canvas iframe's `__e8edit.emitted()` for a `ready` event — `symbols.spec.ts`'s `readyCanvas`, generalised to any canvas selector. */
async function readyCanvas(page: Page, selector: string): Promise<Frame> {
  const frame = await frameOf(page, selector);
  await expect
    .poll(
      () =>
        frame.evaluate(
          () =>
            (window as any).__e8edit
              ?.emitted()
              .some((e: { event: string }) => e.event === 'ready') ?? false,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  return frame;
}

type ReelsSnapshot = {
  mode: 'reels';
  cols: number;
  rows: number[];
  fitted: { w: number; h: number };
  busy: boolean;
  symbols: (string | null)[][] | null;
  frame: { idleAlpha: number } | null;
};

async function openReels(page: Page): Promise<void> {
  await page.goto(IDE_URL);
  // The activity only registers once the boot GET's rows include `reels1`
  // (`reels.tsx`'s own doc) — `symbols.spec.ts`'s Explorer wait is the same
  // kind of race, just on a different slot.
  await expect(page.getByTestId('activity-reels')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('activity-reels').click();
  await expect(page.getByTestId('reels-doc')).toBeVisible();
}

test('the Reels document edits the reel rows, rebuilds the lab board, spins it, writes a colour as a number, resets a value and paints a start board', async ({
  page,
}) => {
  await boot();
  await openReels(page);

  // `e8-base` composes all five reel rows, so every section draws.
  for (const name of ['grid', 'win', 'board', 'motion', 'anticipation', 'cascade', 'features']) {
    await expect(page.getByTestId(`reels-section-${name}`)).toBeVisible();
  }

  const canvas = await readyCanvas(page, REELS_CANVAS);
  const snapshot = () => canvas.evaluate(() => (window as any).__e8edit.snapshot() as ReelsSnapshot);
  await expect.poll(snapshot).toMatchObject({ mode: 'reels', cols: 5 });

  await test.step('cols to 6 (blur): the patch and the canvas both pick it up', async () => {
    const cols = page.locator('#field-reels-reels1-cols');
    await cols.fill('6');
    await cols.blur();
    await expect.poll(() => patchConfig('reels1')?.grid?.cols).toBe(6);
    await expect.poll(async () => (await snapshot()).cols).toBe(6);
  });

  await test.step('reels-action-spin: busy true then false, no failure', async () => {
    await page.getByTestId('reels-action-spin').click();
    // Tight polling for the `true` window — the same reasoning
    // `symbols.spec.ts`'s frame-0 poll gives for a short-lived state.
    await expect.poll(async () => (await snapshot()).busy, { intervals: [10, 20, 50] }).toBe(true);
    await expect.poll(async () => (await snapshot()).busy).toBe(false);
    await expect(page.getByTestId('reels-action-status')).toHaveText('');
  });

  await test.step("reels-action-scatters gates on Anticipation's own enabled, off by default", async () => {
    await expect(page.getByTestId('reels-action-scatters')).toBeDisabled();
    // Scoped to the Reels document's own section: Composition (open in the
    // background — the IDE opens it on project open, and it stays mounted
    // while hidden) draws the SAME row's whole config as
    // `#field-anticipation1-enabled`; this one is `reels-`-prefixed.
    const anticipation = page.getByTestId('reels-section-anticipation');
    // `.click()`, not `.check()`: the write round-trips through the real
    // host before this controlled checkbox's own `checked` reflects it, so
    // `.check()`'s own "did it change" verification fires before the PUT
    // resolves. The button's own state is the thing the brief cares about.
    await anticipation.locator('#field-reels-anticipation1-enabled').click();
    await expect(page.getByTestId('reels-action-scatters')).toBeEnabled({ timeout: 10_000 });
  });

  await test.step('a colour under Grid > frameStyle > idle > color writes a number, and the alpha the picker never touched stays the default on the live board (frame-alpha slice)', async () => {
    const idle = page.locator('#field-reels-reels1-frameStyle-idle');
    const hex = idle.getByRole('textbox', { name: 'color hex' });
    await hex.fill('#ff0000');
    await hex.blur();
    await expect.poll(() => patchConfig('reels1')?.grid?.frameStyle?.idle?.color).toBe(16711680);
    // The colour picker writes ONLY `color` — `alpha` must not appear in
    // the patch at all (a shallow merge on the read side would have lost
    // it to `undefined`/NaN instead; a deep-per-state one, which
    // `resolveFrameStyle` now is, never touches it).
    expect(patchConfig('reels1')?.grid?.frameStyle?.idle?.alpha).toBeUndefined();
    // …and the lab canvas still draws a finite (default) alpha for it —
    // `frame.idleAlpha`, off the live board's first cell frame (real
    // `SymbolCell`s are reachable `Container`s; see `scene-edit`'s
    // `idleAlphaOf`).
    await expect.poll(async () => (await snapshot()).frame?.idleAlpha).toBe(0.34);
  });

  await test.step('reset cols: the patch drops it, the default (5) stands', async () => {
    const grid = page.getByTestId('reels-section-grid');
    await grid.getByRole('button', { name: 'reset cols' }).click();
    await expect.poll(() => patchConfig('reels1')?.grid?.cols).toBeUndefined();
    await expect.poll(async () => (await snapshot()).cols).toBe(5);
  });

  await test.step('a painted start board cell reaches the canvas board', async () => {
    const board = page.getByTestId('reels-section-board');
    await board.getByTestId('board-cell-0-0').click();
    // The popup's entries: `empty`, then the project's symbol ids.
    const pick = board.getByRole('group', { name: 'symbol for reel 0 row 0' }).getByRole('button').nth(1);
    const id = (await pick.textContent())!.trim();
    await pick.click();
    await expect.poll(() => patchConfig('reels1')?.board?.[0]?.[0]).toBe(id);
    // `reels1` re-applied with that start board: the rebuilt grid's cell
    // holds the id (a plain id used to seat an empty cell).
    await expect.poll(async () => (await snapshot()).symbols?.[0]?.[0]).toBe(id);
  });

  await test.step('Composition draws reels1 with its real union widgets, not a fallback', async () => {
    await page.getByTestId('activity-composition').click();
    const row = page.getByTestId('row-reels1');
    // Positive first: the row is actually there (composition.spec.ts's own
    // "lists the rows the profile resolved to" test reads the same two
    // things) — the negative check below would otherwise pass vacuously
    // against a row that never rendered at all.
    await expect(row).toBeVisible();
    await expect(row).toContainText('@energy8engine/reels');
    // One of the exact fields Task 1 fixed: `colGap` is `number | number[]`
    // — before that fix it fell through to `UnsupportedField` (a read-only
    // text input plus " unsupported (union)"); now it draws the `one`/`per
    // reel` radio switch. Scoped to colGap's OWN `.e8-field` row (found by
    // its field id, unrooted here since Composition draws the whole row) —
    // `.filter({ has })` also matches the OUTER `.e8-field` that wraps the
    // whole `grid` fieldset (colGap is a descendant of that one too, and so
    // is `rowGap`'s identical, identically-labelled switch); `.last()` is
    // colGap's own, innermost wrapper, in document order.
    const colGapField = row
      .locator('.e8-field')
      .filter({ has: page.locator('#field-reels1-grid-colGap') })
      .last();
    await expect(colGapField.getByRole('radio', { name: 'one' })).toBeChecked();
    await expect(colGapField.getByRole('radio', { name: 'per reel' })).toBeVisible();
    await expect(row).not.toContainText('unsupported (union)');
  });
});

/**
 * `first-slot`'s OWN `src/editor.ts`, before slice 43 stopped it parsing
 * the address at all — the exact shape paper-duel's own
 * `editor.ts` never got past: it still reads `?scene=`/`?symbol=` off
 * `location.search` and passes them (plus `parentOrigin`) to `sceneEdit`
 * explicitly, but it never knew `reels` was a thing, so it never reads or
 * forwards `?reels=` either way.
 */
const PRE_SLICE_43_EDITOR_TS = `import { createGame } from '@energy8engine/game-runtime';
import * as sceneEdit from '@energy8engine/scene-edit';

const params = new URLSearchParams(location.search);
const safeBottom = Number(params.get('safeBottom') ?? 0) || 0;
const game = await createGame({
  mount: document.getElementById('mount')!,
  without: ['ui.shell'],
  provide: { safeArea: { top: 0, right: 0, bottom: safeBottom, left: 0 }, editorPage: true },
});
const parentOrigin = document.referrer ? new URL(document.referrer).origin : '*';
await game.ctx.plugin(sceneEdit, {
  scene: params.get('scene') ?? '',
  symbol: params.has('symbol') ? params.get('symbol')! : undefined,
  parentOrigin,
});
`;

/**
 * A project whose `editor.ts` never names `reels` at all still opens the
 * Reels document's canvas in reels mode, because the Reels document's own
 * iframe addresses it with `editor.html?reels=` regardless of what the
 * project's `editor.ts` does with that query string (`ReelsDocument.tsx`),
 * and `scene-edit` reads the mode from the page itself whenever the
 * plugin's own config leaves it out (`pageMode`: `config.reels !==
 * undefined ? config.reels : p.has('reels')`). Without that fallback this
 * project's canvas would fall through to plain scene mode instead (no
 * `reels`/`symbol` in the plugin config, and no `scene` param on the
 * address either), whose `snapshot()` carries no `mode` field at all — so
 * the first assertion below is exactly the one a regression in that
 * fallback would turn red.
 *
 * `first-slot` composes no `reels1.board`, so the board is EMPTY until
 * something fills it — this project runs no flow on the editor page
 * (`editorPage: true`), so the only thing that ever will is `scene-edit`'s
 * `fillIfEmpty`, and it does so at once, before any lab action.
 */
test('a project whose editor page passes no reels mode still shows a filled board, no Spin needed', async ({
  page,
}) => {
  writeFileSync(join(dir!, 'src', 'editor.ts'), PRE_SLICE_43_EDITOR_TS);
  await boot();
  await openReels(page);

  const canvas = await readyCanvas(page, REELS_CANVAS);
  const snapshot = () => canvas.evaluate(() => (window as any).__e8edit.snapshot() as ReelsSnapshot);
  await expect.poll(snapshot).toMatchObject({ mode: 'reels', cols: 5 });
  // Every cell, not merely some — `randomBoard` (the fill's board) never
  // leaves a gap, and this is the fill, not a lab `spin()` this test never
  // presses.
  await expect
    .poll(async () => (await snapshot()).symbols?.every((col) => col.every((cell) => cell !== null)))
    .toBe(true);
});
