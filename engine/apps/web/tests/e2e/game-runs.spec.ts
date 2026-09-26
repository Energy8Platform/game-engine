/**
 * Task 8b's acceptance proof: **the project's game runs from the moment a
 * project is open — nobody has to open the Preview tab first.**
 *
 * Slice 39 took the game out of the composition document (it used to be
 * embedded there, so a fresh IDE always had one running) and put it only on
 * the Preview document, which nobody opens by default. The IDE depends on a
 * running game for real work that has nothing to do with the Preview tab
 * itself: `ide-bridge` is what sends the node-type registry, the Flow
 * palette's node kinds and edges, transitions, `game-status` (the status
 * bar's `status-game`), and it is the first speaker on `/ide` that turns
 * `status-session` from `e8-server ○` to `e8-server ●`. So `App.tsx`'s
 * fresh-project default now opens the Preview too, in the BACKGROUND
 * (`ctx.shell.openContributed('preview', { background: true })` — see that
 * method's own doc in `shell.tsx`): mounted, never shown.
 *
 * Both tests below are written to go RED without that default — see
 * `task-8b-report.md` for the revert-and-confirm-red check on each — and
 * neither test ever clicks `activity-preview` or otherwise looks at the
 * Preview tab. If either did, it would no longer be proving the claim: a
 * person who opens the Preview themselves has always booted its game.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { load } from 'js-yaml';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

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

test('the project\'s game runs from the moment it opens — the hidden Preview boots and reports, with nobody opening its tab', async ({
  page,
}) => {
  await page.goto(IDE_URL);
  // The composition default (App.tsx's `decide()`): the one document a
  // fresh load with a project open shows.
  await expect(page.getByTestId('doc-pane-composition')).toBeVisible({ timeout: 30_000 });

  // NEVER click `activity-preview` — the whole point is that its game is
  // already running without that click. `status-game` is fed by the
  // running game's own `ide-bridge` (`game-status` frames), and
  // `status-session` by whatever first speaks on `/ide` — both are the
  // hidden Preview's game, or nothing here reports at all.
  await expect(page.getByTestId('status-game')).toHaveText('● ready', { timeout: 30_000 });
  await expect(page.getByTestId('status-session')).toHaveText('e8-server ●', { timeout: 30_000 });

  // The tab exists — `background` added it — but Composition, not Preview,
  // is what is actually on screen.
  await expect(page.getByTestId('doc-preview')).toBeAttached();
  await expect(page.getByTestId('doc-pane-composition')).toBeVisible();
  await expect(page.getByTestId('doc-pane-preview')).toBeHidden();
});

interface FlowDoc {
  nodes: { id: string; kind: string }[];
  edges: { from: string; to: string; out?: string }[];
}

const flowFile = (): FlowDoc => load(readFileSync(join(dir, 'flow.yml'), 'utf8')) as FlowDoc;

const centre = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

test('the Flow document draws all 27 edges after a palette edit — its node kinds came from the hidden Preview\'s game, never shown', async ({
  page,
}) => {
  // Same edit `flow.spec.ts`'s "the palette adds wait-1…" case makes, but
  // reached with the Preview NEVER opened — `flow.spec.ts` boots the
  // running game itself (a visit to `host.gameUrl`, then `previewFrame`)
  // because until Task 8b nothing else did. Here the fresh-project default
  // alone has to be enough: the Flow document's ports and palette both
  // depend on the game's node kinds, relayed live over `/ide` by whichever
  // game instance is running — the hidden Preview's, if the claim holds.
  await page.goto(IDE_URL);
  await page.getByTestId('activity-flow').click();
  await expect(page.getByTestId('flow-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('flow-node-draw')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('flow-port-draw-next')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('flow-canvas').locator('.react-flow__edge')).toHaveCount(26);

  await page.getByTestId('flow-add-wait').click();
  const added = page.getByTestId('flow-node-wait-1');
  await expect(added).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => flowFile().nodes.map((n) => n.id)).toContain('wait-1');

  const from = await page.getByTestId('flow-port-draw-next').boundingBox();
  const to = await added.locator('.react-flow__handle.target').boundingBox();
  if (!from || !to) throw new Error('a handle has no box');
  const a = centre(from);
  const b = centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => flowFile().edges, { timeout: 10_000 })
    .toContainEqual({ from: 'draw', out: 'next', to: 'wait-1' });
  expect(flowFile().edges).toHaveLength(27);
  await expect(page.getByTestId('flow-canvas').locator('.react-flow__edge')).toHaveCount(27);

  // Never touched, the whole way through.
  await expect(page.getByTestId('doc-preview')).not.toHaveAttribute('aria-selected', 'true');
});
