/**
 * Mod+Z / Mod+Shift+Z / Mod+Y against a real project: the undo/redo
 * history that scenes, Flow, the Reels/Composition rows and the Explorer
 * each record a step into, the keyboard router that sends Mod+Z/Y to the
 * right one, the status line that reports what happened, and the scene
 * canvas's own forwarding of those keys into the IDE — proven together,
 * in a real browser, the way every other document's own e2e spec proves
 * its document.
 *
 * Every scenario reads back what a removed feature would leave wrong: the
 * scene file's `x`, the patch's `cols`, the flow file's node list, or the
 * removed file's own bytes on disk — never only the status line, which
 * could say the right thing while nothing underneath moved. Each edit is
 * polled onto disk BEFORE the undo key is pressed: a write still being
 * saved answers "a save is still in flight" rather than undoing something
 * stale, so a scenario that presses too early would flake on that, not
 * prove undo.
 *
 * Same fixture and idioms as `canvas.spec.ts`, `reels.spec.ts`,
 * `flow.spec.ts` and `explorer.spec.ts` — a private `projectCopy()` served
 * by `startDevHost`, and each of those files' own small per-canvas
 * helpers, duplicated here rather than imported (none of the four spec
 * files export them; each keeps its own copy already, one file for the
 * scene canvas, one for the reels canvas, one for `flow.yml`'s nodes —
 * a second file doing the same is the established shape, not a new one).
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import {
  gameBooted,
  previewFrame,
  projectCopy,
  startDevHost,
  type DevHost,
} from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

// The same `MAC`/`*_KEY` shape `debts.spec.ts` already uses for its own
// Monaco-level Mod+S/Mod+Z presses — Playwright's own key names, not the
// physical `code` the client also accepts (that path is `history-keys
// .test.tsx`'s to cover; a real keyboard press here already reports the
// `key` a Latin layout would).
const MAC = process.platform === 'darwin';
const UNDO_KEY = MAC ? 'Meta+z' : 'Control+z';
const REDO_SHIFT_KEY = MAC ? 'Meta+Shift+z' : 'Control+Shift+z';
const REDO_Y_KEY = MAC ? 'Meta+y' : 'Control+y';

let dir: string;
let host: DevHost;

test.beforeEach(async () => {
  dir = projectCopy();
  host = await startDevHost(dir);
});

test.afterEach(async () => {
  if (host) await host.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------
// Scene canvas — `canvas.spec.ts`'s own helpers, unchanged.
// ---------------------------------------------------------------------

const CANVAS = 'iframe[title="scene canvas"]';

async function frameOf(page: Page, selector: string): Promise<Frame> {
  const handle = await page.locator(selector).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error(`${selector} has no content frame`);
  return frame;
}

async function readyCanvas(page: Page): Promise<Frame> {
  const frame = await frameOf(page, CANVAS);
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

const selectedOf = (frame: Frame) =>
  frame.evaluate(() => (window as any).__e8edit.snapshot().selected as string | null);

async function mapper(
  iframe: Locator,
): Promise<(x: number, y: number) => { x: number; y: number }> {
  const box = await iframe.boundingBox();
  const width = Number(await iframe.getAttribute('width'));
  if (!box || !width) throw new Error('canvas iframe has no box');
  const zoom = box.width / width;
  return (x, y) => ({ x: box.x + x * zoom, y: box.y + y * zoom });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function openSceneTab(page: Page): Promise<void> {
  await page.goto(IDE_URL);
  await gameBooted(await previewFrame(page));
  await page.getByTestId('activity-scenes').click();
  await expect(page.getByTestId('scene-base_game')).toBeVisible();
  await page.getByTestId('scene-base_game').dblclick();
  await expect(page.getByTestId('scene-doc-base_game')).toBeVisible();
}

/** `scenes/base_game.scene.yml`'s `logo` node's own `x` — 240 in the fixture (`portrait` carries a second, unrelated override). */
function sceneLogoX(): number | undefined {
  const doc = load(readFileSync(join(dir, 'scenes', 'base_game.scene.yml'), 'utf8')) as {
    nodes: { id: string; props: { x?: number } }[];
  };
  return doc.nodes.find((n) => n.id === 'logo')?.props.x;
}

test('a canvas move: Mod+Z with focus in the canvas puts the old x back on disk, Mod+Shift+Z moves it again', async ({
  page,
}) => {
  await openSceneTab(page);
  const frame = await readyCanvas(page);
  const at = await mapper(page.locator(CANVAS));
  const centre = at(240, 40);
  expect(sceneLogoX()).toBe(240);

  await page.mouse.click(centre.x, centre.y);
  await expect.poll(() => selectedOf(frame)).toBe('logo');

  await drag(page, centre, at(280, 40));
  await expect.poll(sceneLogoX, { timeout: 10_000 }).toBe(280);

  // The drag's own press/move/up happened inside the iframe, which is what
  // gives it document focus — `canvas.spec.ts`'s own `]` key press test
  // relies on the same fact — so this key lands in `scene-edit`, which
  // forwards `undo`/`redo` into the IDE rather than the browser ever
  // seeing a Mod+Z of its own.
  await page.keyboard.press(UNDO_KEY);
  await expect.poll(sceneLogoX, { timeout: 10_000 }).toBe(240);
  await expect(page.getByTestId('history-status')).toHaveText('Undo: scene base_game');

  await page.keyboard.press(REDO_SHIFT_KEY);
  await expect.poll(sceneLogoX, { timeout: 10_000 }).toBe(280);
  await expect(page.getByTestId('history-status')).toHaveText('Redo: scene base_game');
});

// ---------------------------------------------------------------------
// Reels ↔ Composition — `reels.spec.ts`'s own helpers, unchanged.
// ---------------------------------------------------------------------

function patchConfig(id: string): Record<string, any> | undefined {
  const doc = load(readFileSync(join(dir, 'e8.patch.yml'), 'utf8')) as {
    rows: { id: string; config?: Record<string, unknown> }[];
  };
  return doc.rows.find((row) => row.id === id)?.config;
}

async function openReels(page: Page): Promise<void> {
  await page.goto(IDE_URL);
  await expect(page.getByTestId('activity-reels')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('activity-reels').click();
  await expect(page.getByTestId('reels-doc')).toBeVisible();
}

test('a Reels setting changed in the Reels tab is undone from the Composition tab', async ({
  page,
}) => {
  await openReels(page);
  const cols = page.locator('#field-reels-reels1-cols');
  await cols.fill('6');
  await cols.blur();
  // Landed on disk before the undo key — the write's own PUT already
  // resolved (`reels.spec.ts`'s "cols to 6" proves the same round trip).
  await expect.poll(() => patchConfig('reels1')?.grid?.cols, { timeout: 10_000 }).toBe(6);

  await page.getByTestId('activity-composition').click();
  const reelsRow = page.getByTestId('row-reels1');
  await expect(reelsRow).toBeVisible();
  // Focus on the document, not a field: the row's own header text, never
  // one of the union widgets `composition.spec.ts` already proves this row
  // draws for `reels1`'s real schema.
  await reelsRow.locator('header').click();

  await page.keyboard.press(UNDO_KEY);
  // Every row currently on screen undoes together in the Composition tab
  // (`row:reels1` among them) — the same key the Reels tab's own write
  // recorded under, so the Composition tab's Mod+Z reaches it.
  // The write records the row's whole config, before and after, so the
  // undo puts the whole previous object back rather than clearing just the
  // one field: the fixture's own `e8.patch.yml` already sets
  // `reels1.grid.cols: 5` before this test touches it, so that is exactly
  // the value that comes back — not an absent key the way the Reels
  // document's own "reset" button leaves it (`reels.spec.ts`'s "reset
  // cols" test); either is "no cols: 6".
  await expect.poll(() => patchConfig('reels1')?.grid?.cols, { timeout: 10_000 }).toBe(5);
  await expect(page.getByTestId('history-status')).toHaveText('Undo: reels1 settings');
});

// ---------------------------------------------------------------------
// Flow — `flow.spec.ts`'s own helpers, unchanged.
// ---------------------------------------------------------------------

interface FlowDoc {
  nodes: { id: string; kind: string }[];
  edges: { from: string; to: string; out?: string }[];
}

const flowFile = (): FlowDoc => load(readFileSync(join(dir, 'flow.yml'), 'utf8')) as FlowDoc;

async function openComposition(page: Page): Promise<void> {
  // The game first: this is what reports its node KINDS to the host, which
  // is what gives the Flow palette its buttons at all (`flow.spec.ts`'s own
  // doc on `openComposition`).
  await page.goto(host.gameUrl);
  await gameBooted(page);
  await page.goto(`${IDE_URL}#/doc/composition`);
  await gameBooted(await previewFrame(page));
}

async function openFlow(page: Page): Promise<void> {
  await page.getByTestId('activity-flow').click();
  await expect(page.getByTestId('flow-screen')).toBeVisible();
  await expect(page.getByTestId('flow-node-draw')).toBeVisible();
  await expect(page.getByTestId('flow-port-draw-next')).toBeVisible({ timeout: 10_000 });
}

test('a Flow node added from the palette is undone with Mod+Z, redone with Mod+Y', async ({
  page,
}) => {
  await openComposition(page);
  await openFlow(page);

  await page.getByTestId('flow-add-wait').click();
  await expect(page.getByTestId('flow-node-wait-1')).toBeVisible({ timeout: 10_000 });
  // Landed on disk — the palette's own write resolved — before the undo key.
  await expect
    .poll(() => flowFile().nodes.map((n) => n.id), { timeout: 10_000 })
    .toContain('wait-1');

  // Focus is still on the palette button just clicked: not a field, not
  // the Explorer, so this routes to the active tab's own keys (`flow`).
  await page.keyboard.press(UNDO_KEY);
  await expect
    .poll(() => flowFile().nodes.map((n) => n.id), { timeout: 10_000 })
    .not.toContain('wait-1');
  await expect(page.getByTestId('flow-node-wait-1')).toHaveCount(0);
  await expect(page.getByTestId('history-status')).toHaveText('Undo: flow');

  await page.keyboard.press(REDO_Y_KEY);
  await expect
    .poll(() => flowFile().nodes.map((n) => n.id), { timeout: 10_000 })
    .toContain('wait-1');
  await expect(page.getByTestId('flow-node-wait-1')).toBeVisible();
  await expect(page.getByTestId('history-status')).toHaveText('Redo: flow');
});

// ---------------------------------------------------------------------
// Explorer — `explorer.spec.ts`'s own `row` helper, unchanged.
// ---------------------------------------------------------------------

const row = (page: Page, path: string) => page.getByTestId(`explorer-${path}`);

test('removing a file from the Explorer is undone with Mod+Z, content and all', async ({
  page,
}) => {
  await page.goto(IDE_URL);
  await expect(row(page, 'game/spec.json')).toBeVisible({ timeout: 20_000 });
  const original = readFileSync(join(dir, 'game', 'spec.json'), 'utf8');

  await row(page, 'game/spec.json').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('delete "game/spec.json"?')).toBeVisible();
  await page.getByTestId('confirm-yes').click();

  await expect(row(page, 'game/spec.json')).toHaveCount(0);
  // Landed on disk before the undo key: a remove waits for its own byte
  // read to finish before it actually removes the file, so "yes" having
  // resolved already means the write happened, not just the dialog closing.
  await expect
    .poll(() => existsSync(join(dir, 'game', 'spec.json')), { timeout: 10_000 })
    .toBe(false);

  // No click back into the Explorer first: the confirm's "yes" goes with
  // its row, and the view keeps focus itself, so Mod+Z right away is the
  // Explorer's.
  await page.keyboard.press(UNDO_KEY);
  await expect
    .poll(() => existsSync(join(dir, 'game', 'spec.json')), { timeout: 10_000 })
    .toBe(true);
  expect(readFileSync(join(dir, 'game', 'spec.json'), 'utf8')).toBe(original);
  await expect(row(page, 'game/spec.json')).toBeVisible();
  await expect(page.getByTestId('history-status')).toHaveText('Undo: remove game/spec.json');
});

// ---------------------------------------------------------------------
// A text field's own undo — the one case the IDE must stay OUT of.
// ---------------------------------------------------------------------

test('a SchemaForm number field keeps its own undo — Mod+Z there never reaches the IDE history', async ({
  page,
}) => {
  await openReels(page);
  const cols = page.locator('#field-reels-reels1-cols');
  const original = await cols.inputValue();
  await expect(page.getByTestId('history-status')).toHaveText('');

  await cols.click();
  await cols.selectText();
  await cols.pressSequentially('9');
  await expect(cols).toHaveValue('9');

  // Still focused in the field: `isEditableTarget` (`historyKeys.ts`)
  // matches any `input`, so `runHistoryKey` never calls `ctx.history` at
  // all here, and the browser's own edit-undo is what answers this key.
  await page.keyboard.press(UNDO_KEY);
  await expect(cols).toHaveValue(original);
  await expect(page.getByTestId('history-status')).toHaveText('');
});
