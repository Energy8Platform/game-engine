/**
 * One process over N projects, proved with a live `e8` and a real browser
 * — spec §12's Playwright cases 1–4, 6 and 7 (5 is the existing suite
 * under `e8 dev` semantics, untouched). Every test here fails without the
 * production change it proves; task-7-report.md has the mutation table.
 *
 * `e8-server` is counted by pid through `serverPids` (`./project-fixture`,
 * where its `pgrep` shape is explained) — moved there once `debts.spec.ts`
 * needed the same pid to kill.
 */
import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import {
  IDE_HOST_PORT,
  SECOND_NAME,
  gameBooted,
  previewFrame,
  serverPids,
  startHost,
  workspaceCopy,
  type WorkspaceHost,
} from './project-fixture';

/** The IDE app — vite on 5680, proxying to the host on `IDE_HOST_PORT` (every case but 6). */
const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;
/** The host itself: `/api/*`, `/ide`, and — with `dist` built — the IDE (case 6). */
const HOST_URL = `http://127.0.0.1:${IDE_HOST_PORT}/`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only: forces Monaco onto its textarea input
    // controller, the one Playwright's keyboard actually drives.
    delete window.EditContext;
  });
});

/**
 * Opens `id` from the «Projects» sidebar and waits until its game is really
 * up: `status-project` carries the name (the host answered `open`), the
 * Preview's iframe points where `/api/workspace` says, and the game inside
 * it booted (`window.__e8` installed — which is also what makes `stop()`
 * safe: `startDevHost`'s doc on tearing vite down mid-bundle). The Preview
 * is brought in front to read it; its activity is a document, so the
 * sidebar stays as it was.
 */
async function openProject(page: Page, host: WorkspaceHost, id: string, name: string) {
  await page.getByTestId(`project-${id}`).click();
  await expect(page.getByTestId('status-project')).toHaveText(name, { timeout: 20_000 });
  await expect(page.getByTestId(`project-${id}`)).toHaveAttribute('aria-current', 'true');
  const previewUrl = host.previewUrl();
  expect(previewUrl).not.toBeNull();
  const body = (await (await page.request.get(`${HOST_URL}api/workspace`)).json()) as {
    active: string;
    previewUrl: string;
  };
  expect(body.active).toBe(id);
  expect(body.previewUrl).toBe(previewUrl);
  const frame = page.locator('iframe').first();
  await expect(frame).toHaveAttribute(
    'src',
    new RegExp(`^${previewUrl!.replace(/[./]/g, '\\$&')}`),
  );
  await gameBooted(await previewFrame(page));
}

test('two projects: both listed, none open, the projects sidebar first', async ({ page }) => {
  const root = workspaceCopy(2);
  const host = await startHost(root);
  try {
    await page.goto(IDE_URL);
    await expect(page.getByTestId('sidebar-workspace')).toBeVisible();
    // `slot-1` under its id — the checked-in spec has no `name`; the second under the name its spec was given.
    await expect(page.getByTestId('project-slot-1')).toContainText('slot-1');
    await expect(page.getByTestId('project-slot-2')).toContainText(SECOND_NAME);
    await expect(page.locator('[aria-current="true"]')).toHaveCount(0);
    await expect(page.getByTestId('status-project')).toHaveText('no project');
    // Spec §5 (4): with no project open the document group is empty and
    // points at Projects — not a composition saying «connecting…».
    await expect(page.getByTestId('doc-none')).toContainText('open a project from Projects');
    // Document tabs only: the panel's tab strip (Diagnostics) is chrome,
    // there with or without a project.
    await expect(page.getByTestId('doc-tabs').getByRole('tab')).toHaveCount(0);
    expect(host.previewUrl()).toBeNull();
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a click opens the project: its tree, its name, its game in the frame', async ({ page }) => {
  const root = workspaceCopy(2);
  const host = await startHost(root);
  try {
    await page.goto(IDE_URL);
    await openProject(page, host, 'slot-1', 'slot-1');
    await page.getByTestId('activity-explorer').click();
    await expect(page.getByTestId('explorer-game/script.spin')).toBeVisible();
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a second click swaps the game process and closes the first project’s files', async ({
  page,
}) => {
  const root = workspaceCopy(2);
  const host = await startHost(root);
  try {
    await page.goto(IDE_URL);
    await openProject(page, host, 'slot-1', 'slot-1');
    await page.getByTestId('activity-explorer').click();
    await page.getByTestId('explorer-game/script.spin').click();
    await expect(page.getByTestId('doc-f:game/script.spin')).toBeVisible();
    const before = serverPids();
    expect(before).toHaveLength(1);
    const firstPreview = host.previewUrl();

    await page.getByTestId('activity-workspace').click();
    await openProject(page, host, 'slot-2', SECOND_NAME);
    const after = serverPids();
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
    expect(host.previewUrl()).not.toBe(firstPreview);
    await expect(page.getByTestId('doc-f:game/script.spin')).toHaveCount(0);
    // The second game, not the first one reloaded: the page title is the
    // one thing the fixture's second copy shows differently (fixture doc).
    // `frame.title()`, not a `<title>` locator: `toHaveText` reads "" off
    // an element in `<head>` (measured).
    await expect
      .poll(() =>
        page
          .frames()
          .find((f) => f.url().startsWith(host.previewUrl()!))
          ?.title(),
      )
      .toBe(`${SECOND_NAME} — e8 dev`);
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('on a fixed preview port the switch still shows the second game — same url, new frame', async ({
  page,
}) => {
  // `previewPort: 0` above gives every project a fresh port, so a new
  // `previewUrl` alone remounts the iframe. In production the port is
  // FIXED (5681): the url does not change across a switch, and only the
  // active project's id in the frame's key (`Preview`) makes the iframe
  // a new element showing the new game rather than the old one, kept.
  const root = workspaceCopy(2);
  const host = await startHost(root, { previewPort: 5683 });
  try {
    await page.goto(IDE_URL);
    await openProject(page, host, 'slot-1', 'slot-1');
    const firstPreview = host.previewUrl();
    // The «Projects» sidebar is still up (nothing else was opened); a click
    // on its activity button would toggle it AWAY (measured).
    await openProject(page, host, 'slot-2', SECOND_NAME);
    expect(host.previewUrl()).toBe(firstPreview);
    await expect
      .poll(() =>
        page
          .frames()
          .find((f) => f.url().startsWith(host.previewUrl()!))
          ?.title(),
      )
      .toBe(`${SECOND_NAME} — e8 dev`);
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unsaved file makes the switch ask; No keeps everything, Yes discards and says so', async ({
  page,
}) => {
  const root = workspaceCopy(2);
  const host = await startHost(root);
  try {
    await page.goto(IDE_URL);
    await openProject(page, host, 'slot-1', 'slot-1');
    await page.getByTestId('activity-explorer').click();
    await page.getByTestId('explorer-game/script.spin').click();
    const pane = page.getByTestId('doc-pane-f:game/script.spin');
    await expect(pane.locator('.monaco-editor')).toBeVisible({ timeout: 10_000 });
    await pane.getByTestId('editor').click();
    await page.keyboard.type('x');
    const tab = page.getByTestId('doc-f:game/script.spin');
    await expect(tab).toContainText('●');

    await page.getByTestId('activity-workspace').click();
    await page.getByTestId('project-slot-2').click();
    await expect(page.getByTestId('project-confirm')).toBeVisible();
    await page.getByTestId('confirm-no').click();
    await expect(page.getByTestId('project-confirm')).toHaveCount(0);
    await expect(tab).toContainText('●');
    await expect(page.getByTestId('status-project')).toHaveText('slot-1');
    expect(serverPids()).toHaveLength(1);

    await page.getByTestId('project-slot-2').click();
    await page.getByTestId('confirm-yes').click();
    await expect(page.getByTestId('status-project')).toHaveText(SECOND_NAME, { timeout: 20_000 });
    await expect(tab).toHaveCount(0);
    await expect(page.getByTestId('diagnostics-panel')).toContainText(
      'unsaved changes discarded on project switch: game/script.spin',
    );
    await gameBooted(await previewFrame(page));
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the host serves the built IDE itself, and a project opens from there', async ({ page }) => {
  const root = workspaceCopy(2);
  const host = await startHost(root);
  try {
    await page.goto(HOST_URL);
    await expect(page.getByTestId('activity-workspace')).toBeVisible();
    await openProject(page, host, 'slot-1', 'slot-1');
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('without dist the host says so on / and still answers /api', async ({ request }) => {
  const root = workspaceCopy(2);
  const host = await startHost(root, { ideDist: '/nonexistent' });
  try {
    const page = await request.get(HOST_URL);
    expect(page.status()).toBe(503);
    expect(await page.text()).toContain('shell not built');
    const api = await request.get(`${HOST_URL}api/workspace`);
    expect(api.status()).toBe(200);
    expect(((await api.json()) as { projects: unknown[] }).projects).toHaveLength(2);
    // An `/api/*` path NO route answers (files belongs to the open project,
    // and none is) is the host's own 404 — not the shell's 503 page:
    // `ide-static` never matches `/api/`. `/api/workspace` above cannot
    // show this: its route is registered before `ide-static` and wins on
    // order alone (measured — the exclusion mutation left it 200 JSON).
    const files = await request.get(`${HOST_URL}api/files`);
    expect(files.status()).toBe(404);
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
