/**
 * Debts A, B and D paid, proved in a browser — spec §5's Playwright items
 * 1–4 and 6 (`docs/superpowers/specs/2026-09-14-debts-a-b-d-design.md`;
 * item 5 is the rest of this suite). Every test here fails without the
 * production change it proves; task-7-report.md has the mutation table,
 * and each sketch the brief gave that the code contradicted is corrected
 * at the test it changed.
 *
 * Helpers are this file's own copies of `shell.spec.ts`'s (`openIde`,
 * `openInEditor`) and `code.spec.ts`'s (`moveCursorToDocumentEnd`) — the
 * suite's convention is one copy per spec; only `serverPids` moved to the
 * fixture, because killing a pid and counting pids is the same `pgrep`.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import {
  projectCopy,
  serverPids,
  startDevHost,
  startHost,
  workspaceCopy,
  type DevHost,
} from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api`, `/plugin-client` and `/ide` to the host on 5679. */
const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

const MAC = process.platform === 'darwin';
const SAVE_KEY = MAC ? 'Meta+s' : 'Control+s';
const UNDO_KEY = MAC ? 'Meta+z' : 'Control+z';

/** Monaco on its textarea input — see `code.spec.ts`'s module doc for the `EditContext` trap. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only: forces Monaco onto its textarea input
    // controller, the one Playwright's keyboard actually drives.
    delete window.EditContext;
  });
});

/** Visits the game until it settles, then the IDE at `hash` — `shell.spec.ts`'s own wait, for the same reason. */
async function openIde(page: Page, host: DevHost, hash = ''): Promise<void> {
  await page.goto(host.gameUrl);
  await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
  await page.goto(`${IDE_URL}${hash}`);
}

/** Opens `path` from the Explorer and waits for the REAL Monaco inside its own pane, then focuses it. */
async function openInEditor(page: Page, path: string): Promise<void> {
  await page.getByTestId(`explorer-${path}`).click();
  const pane = page.getByTestId(`doc-pane-f:${path}`);
  await expect(pane.locator('.monaco-editor')).toBeVisible({ timeout: 10_000 });
  await pane.getByTestId('editor').click();
}

/** `Cmd+Down` on a Mac, `Ctrl+End` elsewhere — Monaco's own bindings, measured in `code.spec.ts`. */
async function moveCursorToDocumentEnd(page: Page): Promise<void> {
  await page.keyboard.press(MAC ? 'Meta+ArrowDown' : 'Control+End');
}

/**
 * Undoes until `text` is no longer among the rendered lines — Monaco
 * groups a typed burst into undo stops of its own choosing (measured:
 * `\nrecord {\n}\n` takes FIVE, the `{` auto-closing a `}` on the way),
 * so counting presses would pin an editor internal for no gain. The
 * rendered lines are the document's tail — the cursor sits at its end —
 * so the fixture's own `record Vars {` at line 39 is never among them.
 * Bounded, so a burst that never leaves fails loudly.
 */
async function undoUntilGone(page: Page, text: RegExp): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(UNDO_KEY);
    const shown = (await page.locator('.monaco-editor .view-lines').textContent()) ?? '';
    if (!text.test(shown)) return;
  }
  throw new Error(`${text} still in the editor after 8 undos`);
}

const panel = (page: Page) => page.getByTestId('diagnostics-panel');
const sessionStatus = (page: Page) => page.getByTestId('status-session');

test('a dead engine is named in the status bar and the panel, and a save revives it', async ({
  page,
}) => {
  // Item 1. The host hears `session/exited` and says so as the `session`
  // speaker, without waiting for a spin to find the corpse; the next
  // clean restart's empty list takes the row back.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host);
    await expect(sessionStatus(page)).toHaveText('e8-server ●', { timeout: 20_000 });
    const pids = serverPids();
    expect(pids).toHaveLength(1);
    process.kill(pids[0], 'SIGKILL');

    await expect(sessionStatus(page)).toContainText('○ exited', { timeout: 10_000 });
    await expect(
      panel(page)
        .locator('li')
        .filter({ hasText: /exited/ }),
    ).toHaveCount(1);

    await openInEditor(page, 'game/script.spin');
    await moveCursorToDocumentEnd(page);
    await page.keyboard.type('\n-- x\n');
    await page.keyboard.press(SAVE_KEY);

    await expect(sessionStatus(page)).toHaveText('e8-server ●', { timeout: 20_000 });
    await expect(panel(page)).not.toContainText('exited');
    expect(serverPids()).toHaveLength(1);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed restart's row leaves the panel with the save that fixes it", async ({ page }) => {
  // Item 2. `code.spec.ts` proves the row ARRIVES (`failed to restart …
  // script.spin:L:C`); this proves it LEAVES — debt A1, the retract a
  // clean restart's empty `('session', [])` now is.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const before = readFileSync(join(dir, 'game/script.spin'), 'utf8');
  try {
    await openIde(page, host);
    await openInEditor(page, 'game/script.spin');
    await moveCursorToDocumentEnd(page);
    await page.keyboard.type('\nrecord {\n');
    await page.keyboard.press(SAVE_KEY);
    const failed = panel(page)
      .locator('li')
      .filter({ hasText: /failed to restart[\s\S]*script\.spin:\d+:\d+/ });
    await expect(failed).toHaveCount(1, { timeout: 15_000 });

    await undoUntilGone(page, /record/);
    await page.keyboard.press(SAVE_KEY);
    await expect.poll(() => readFileSync(join(dir, 'game/script.spin'), 'utf8')).toBe(before);
    await expect(failed).toHaveCount(0, { timeout: 15_000 });
    await expect(sessionStatus(page)).toHaveText('e8-server ●', { timeout: 20_000 });
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the editor's check reaches the panel, and leaves with the fix, nothing saved", async ({
  page,
}) => {
  // Item 3. Debt B1/B2: `ctx.check`'s answer goes to the one list, and
  // the next answer retracts it — checks used to stay beside the editor
  // only, on purpose, because `report()` had no retract.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const before = readFileSync(join(dir, 'game/script.spin'), 'utf8');
  try {
    await openIde(page, host);
    await openInEditor(page, 'game/script.spin');
    await expect(panel(page).locator('li')).toHaveCount(0);
    await moveCursorToDocumentEnd(page);
    await page.keyboard.type('\nrecord {\n}\n');
    // Measured: `editor  warning spin-parser · line N: record block has no
    // name` — the host's `asWarning` re-stamps every parser row (see
    // `code.spec.ts`'s third correction); `spin-parser` is the `plugin`.
    const row = panel(page)
      .locator('li')
      .filter({ hasText: /spin-parser/ });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await expect(row).toContainText(/editor.*warning.*record block has no name/);

    await undoUntilGone(page, /record/);
    // Back to the text that was read: the shell's own dirty fact says so.
    await expect(page.getByTestId('doc-f:game/script.spin')).not.toContainText('●');
    await expect(row).toHaveCount(0, { timeout: 10_000 });
    expect(readFileSync(join(dir, 'game/script.spin'), 'utf8')).toBe(before);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a folder of projects opens no composition until one is chosen', async ({ page }) => {
  // Item 4 (debt A4). `workspace.spec.ts` asserts the same empty group
  // from the workspace's side; this is the composition rule's own case —
  // the tab, by name, must not exist.
  const root = workspaceCopy(2);
  const host = await startHost(root);
  try {
    await page.goto(IDE_URL);
    await expect(page.getByTestId('sidebar-workspace')).toBeVisible();
    await expect(page.getByTestId('doc-none')).toBeVisible();
    await expect(page.getByTestId('doc-none')).toContainText('open a project from Projects');
    await expect(page.getByRole('tab', { name: 'Composition', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('doc-composition')).toHaveCount(0);
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Cmd/Ctrl+S on the Composition tab is swallowed, with no dialog and no navigation', async ({
  page,
}) => {
  // Item 6 (debt D1). The editor's own listener answers only on its tab;
  // on any other the keystroke used to reach the browser. Measured with
  // the shell's swallow removed: headless Chromium fires NO `dialog`, no
  // `pageerror` and no navigation for an unswallowed save-page shortcut —
  // its save dialog is a native window Playwright never sees — so the
  // three counters below stay green either way and only document the
  // spec's wording. The assertion that goes red is the last one: a
  // synthetic `keydown` dispatched on `window` comes back cancelled only
  // while the shell's listener is there (`[false, false]` without it).
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const dialogs: string[] = [];
  const errors: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await openIde(page, host, '#/doc/composition');
    await expect(page.getByTestId('doc-composition')).toHaveAttribute('aria-selected', 'true');
    const url = page.url();

    await page.keyboard.press('Meta+s');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(500);

    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
    expect(page.url()).toBe(url);
    await expect(page.getByTestId('doc-composition')).toHaveAttribute('aria-selected', 'true');
    // The live assertion — see above.
    const swallowed = await page.evaluate(() =>
      ['metaKey', 'ctrlKey'].map(
        (mod) =>
          !window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 's', [mod]: true, cancelable: true }),
          ),
      ),
    );
    expect(swallowed).toEqual([true, true]);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
