/**
 * Task 7's acceptance suite — the last task of "the shell after VS Code"
 * (`.superpowers/sdd/2026-09-11-the-shell-after-vscode/`), proving what
 * Tasks 1-6 built through a live `e8 dev` host and a real browser: five
 * slots on one `<Shell/>`, every open document mounted and hidden when
 * inactive, one Explorer over the tree, editor and viewer documents, and
 * a deep link that waits for a plugin's half before calling it missing.
 *
 * Every test here is written to fail without the production change it
 * proves — see task-7-report.md for the revert-and-confirm-red check on
 * each. Where the brief's own sketch and the code disagree, the code was
 * measured and the sketch corrected; each such correction is noted at the
 * test it changed.
 *
 * **Cases considered and left OUT, and why each is a genuine "pinned
 * elsewhere" rather than a convenient one:**
 *
 *  - **"The IDE still loads with Monaco in it, console clean"** — the
 *    brief's sixth sketch. `code.spec.ts` carries the identical claim
 *    against the identical fixture, migrated to the shell; a second copy
 *    would drift from the first. What the shell ADDS to that claim —
 *    Monaco re-laid out after its pane was hidden and shown again — is
 *    the tab-switch test below, which collects the console the same way.
 *  - **Closing a clean tab activates the neighbour; Back onto a closed
 *    tab falls back and says so; a second `open()` of the same key only
 *    activates** — hash arithmetic, pinned in `shell.test.tsx` against the
 *    same `location` API a browser has. Nothing about a real browser
 *    changes which neighbour a `Map` picks.
 *  - **Panel and sidebar collapse** — a boolean on `ctx.shell`, pinned in
 *    `shell.test.tsx`; no browser-only mechanism sits between the click
 *    and the `hidden` attribute.
 *  - **The status bar's `e8-server ●` / `restarting` reading** — fed by the
 *    same `/ide` stream `diagnostics.spec.ts` already drives end to end;
 *    the item's own reading of that stream is `status-items.test.tsx`.
 *  - **A save that the host refuses reaching the panel on another
 *    document** — `code.spec.ts`'s own case, migrated (and re-shaped by
 *    Ruling 13, see that file).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { PNG_BYTES, projectCopy, startDevHost, type DevHost } from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api`, `/plugin-client` and `/ide` to the host on 5679. */
const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

/** Every editor test needs Monaco on its textarea input — see `code.spec.ts`'s module doc for the `EditContext` trap this sidesteps. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only: forces Monaco onto its textarea input
    // controller, the one Playwright's keyboard actually drives.
    delete window.EditContext;
  });
});

/**
 * Visits the game and waits for it to settle before going to the IDE at
 * `hash` — the same wait every other spec in this suite gives at length:
 * `startDevHost` pre-bundles every row in the background, and `host.stop()`
 * tearing that down mid-build measured flaky for a test that skipped this.
 */
async function openIde(page: Page, host: DevHost, hash = ''): Promise<void> {
  await page.goto(host.gameUrl);
  await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
  await page.goto(`${IDE_URL}${hash}`);
}

/**
 * Opens `path` from the Explorer and waits for the REAL editor inside its
 * own pane — not merely the host div `<Monaco/>` renders before Monaco has
 * attached anything (see `code.spec.ts`'s second "found by running the
 * draft" item). Scoped to the pane: the shell keeps every open editor
 * mounted, so a bare `getByTestId('editor')` is ambiguous the moment two
 * files are open.
 *
 * Through the Explorer, the way a person first reaches a file. A cold
 * `#/doc/f:<path>` resolves too, since the final fix pass (Ruling 18/22)
 * — `resolveHash` hands a `f:` key to the opener `App` registers — and the
 * reload test below is what pins that.
 */
async function openInEditor(page: Page, path: string): Promise<void> {
  await page.getByTestId(`explorer-${path}`).click();
  await editorReady(page, path);
}

/** Waits for the real Monaco inside `path`'s pane and focuses it. */
async function editorReady(page: Page, path: string): Promise<void> {
  const pane = page.getByTestId(`doc-pane-f:${path}`);
  await expect(pane.locator('.monaco-editor')).toBeVisible({ timeout: 10_000 });
  await pane.getByTestId('editor').click();
}

test('a project plugin brings an activity button and a document, both usable', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host);
    // The plugin's client half lands AFTER `<Shell/>` mounted — through
    // `modules`, once the snapshot names it — so this button being drawn
    // at all is `<Shell/>` hearing `ctx.slots` (Ruling 14), not a
    // registration that happened to precede the first render.
    await page.getByTestId('activity-demo').click({ timeout: 20_000 });
    await expect(page.getByTestId('doc-demo')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('doc-pane-f:demo')).toHaveCount(0); // a contributed key, not a file
    await expect(page.getByTestId('doc-pane-demo')).toContainText(
      'a document from a project plugin',
    );
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Explorer opens .spin as an editor, PNG as a viewer, a binary as an explanation', async ({
  page,
}) => {
  const dir = projectCopy();
  // Written straight into the copy, the way `assets.spec.ts` stages its
  // `bye.txt`: the fixture has no `withPng`/`withBinary` options and two
  // files do not earn one.
  mkdirSync(join(dir, 'art'));
  writeFileSync(join(dir, 'art', 'logo.png'), PNG_BYTES);
  writeFileSync(join(dir, 'art', 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]));
  const host = await startDevHost(dir);
  try {
    await openIde(page, host);
    await openInEditor(page, 'game/script.spin');

    await page.getByTestId('explorer-art/logo.png').click();
    const png = page.getByTestId('doc-pane-f:art/logo.png');
    await expect(png.getByRole('img')).toBeVisible();

    // On the name, not the row's centre: a row this short has its inline
    // `delete` button right where Playwright would otherwise click.
    await page.getByTestId('explorer-art/blob.bin').click({ position: { x: 40, y: 8 } });
    const bin = page.getByTestId('doc-pane-f:art/blob.bin');
    await expect(bin).toBeVisible();
    await expect(bin).toContainText(/doesn't look like text/);

    // All three are open at once, and only the last one shows.
    await expect(page.getByTestId('doc-tabs').getByRole('tab')).toHaveCount(4); // + composition
    await expect(png).toBeHidden();
    await expect(page.getByTestId('doc-pane-f:game/script.spin')).toBeHidden();
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('typed text survives a tab switch, and the console stays clean', async ({ page }) => {
  // Ruling 13, end to end: the old layout unmounted the editor on a tab
  // switch and lost what was typed. `shell.test.tsx` pins the node
  // surviving under jsdom; only a real browser can show Monaco, hidden to
  // zero height and shown again, re-laying out with the text still there
  // — and throwing nothing on the way.
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host);
    await openInEditor(page, 'game/script.spin');
    await page.keyboard.type('-- typed before the switch');

    await page.getByTestId('activity-preview').click();
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible();
    await expect(page.getByTestId('doc-pane-f:game/script.spin')).toBeHidden();

    await page.getByTestId('doc-f:game/script.spin').click();
    // Polled, not read once: Monaco virtualises a hidden pane to no lines
    // and re-lays out a tick after it is shown again.
    await expect(
      page.getByTestId('doc-pane-f:game/script.spin').locator('.view-lines'),
    ).toContainText('typed before the switch');
    await expect(page.getByTestId('doc-f:game/script.spin')).toContainText('●');
    expect(errors).toEqual([]);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a dirty tab does not close without asking, and beforeunload holds', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host);
    await openInEditor(page, 'game/script.spin');
    await page.keyboard.type('x');

    await page.getByTestId('doc-close-f:game/script.spin').click();
    await expect(page.getByTestId('confirm-yes')).toBeVisible();
    await expect(page.getByTestId('doc-f:game/script.spin')).toBeVisible(); // still there
    await page.getByTestId('confirm-no').click();
    await expect(page.getByTestId('confirm-yes')).toHaveCount(0);

    // The browser's own dialog is the proof, not merely "the editor is
    // still here afterwards": a reload with no listener would also leave
    // the page looking the same for the first few hundred milliseconds.
    // Chromium honours `preventDefault` here only after a user gesture —
    // the typing above is one. `dismiss()` on a beforeunload dialog
    // cancels the navigation, so the reload never commits and its own
    // promise is expected to time out.
    const dialog = page.waitForEvent('dialog');
    await page.reload({ timeout: 2_000 }).catch(() => {});
    const held = await dialog;
    expect(held.type()).toBe('beforeunload');
    await held.dismiss();
    await expect(
      page.getByTestId('doc-pane-f:game/script.spin').locator('.view-lines'),
    ).toContainText('x');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Cmd/Ctrl+S saves the active editor and only it', async ({ page }) => {
  // The keystroke lands in Monaco's own textarea; whether it reaches the
  // window listener, and whether `preventDefault` there beats the
  // browser's Save dialog, is exactly what jsdom cannot show. Two dirty
  // editors, one keystroke, one file changed on disk.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const spinBefore = readFileSync(join(dir, 'game/script.spin'), 'utf8');
  try {
    await openIde(page, host);
    await openInEditor(page, 'game/script.spin');
    await page.keyboard.type('-- not saved');
    await openInEditor(page, 'plugins/reel-step/src/step.ts');
    await page.keyboard.type('// saved by keyboard\n');

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');

    await expect
      .poll(() => readFileSync(join(dir, 'plugins/reel-step/src/step.ts'), 'utf8'))
      .toContain('saved by keyboard');
    await expect(page.getByTestId('doc-f:plugins/reel-step/src/step.ts')).not.toContainText('●');
    await expect(page.getByTestId('doc-f:game/script.spin')).toContainText('●');
    expect(readFileSync(join(dir, 'game/script.spin'), 'utf8')).toBe(spinBefore);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F5 on a file tab reopens the editor, with a clean panel', async ({ page }) => {
  // Ruling 18: `f:` keys existed only once the Explorer opened them, so
  // the most common gesture there is — reload while on a file — landed on
  // the composition with a false "not registered". The address now asks
  // the opener `App` registered, and the Explorer's own chooser picks
  // Monaco.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host);
    await openInEditor(page, 'game/script.spin');
    await page.reload();
    await expect(page.getByTestId('doc-f:game/script.spin')).toHaveAttribute(
      'aria-selected',
      'true',
      {
        timeout: 20_000,
      },
    );
    await editorReady(page, 'game/script.spin');
    await expect(
      page.getByTestId('doc-pane-f:game/script.spin').locator('.view-lines'),
    ).toContainText('game');
    await expect(page.getByTestId('diagnostics-panel')).not.toContainText(/not registered/);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deep link to the preview opens it with no false warning', async ({ page }) => {
  // Slice 6's recorded debt: `ready()` used to run before `preview` was
  // registered, and a deep link to it was reported as not registered.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/preview');
    await expect(page.getByTestId('doc-preview')).toHaveAttribute('aria-selected', 'true', {
      timeout: 20_000,
    });
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('diagnostics-panel')).not.toContainText(/not registered/);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deep link nothing answers to is reported once the loader settles', async ({ page }) => {
  // The other half of the same rule: a key that is neither shipped nor a
  // plugin's is held while client halves are still loading — the demo's
  // is one — and given up on, with a diagnostic, only once they all are.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/ghost');
    const panel = page.getByTestId('diagnostics-panel');
    await expect(panel).toContainText(/"ghost", which is not registered/, { timeout: 20_000 });
    await expect(page.getByTestId('doc-composition')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('doc-opening')).toHaveCount(0);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a document that throws leaves the panel and the other tabs usable', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    // The flag goes BEFORE the hash: the brief's sketch wrote
    // `#/doc/demo?screen-demo-crash=1`, which puts the `?` inside the
    // fragment, where `location.search` — what `shouldCrash()` reads —
    // never sees it. A cold deep link to a PLUGIN's document is also the
    // Ruling 17 path: `demo` is pending until its client half lands.
    await openIde(page, host, '?screen-demo-crash=1#/doc/demo');
    await expect(page.getByTestId('doc-error')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('doc-error')).toContainText(
      'screen-demo: forced failure (the URL carried ?screen-demo-crash)',
    );
    const panel = page.getByTestId('diagnostics-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/document crashed while rendering/);

    await page.getByTestId('activity-composition').click();
    await expect(page.getByTestId('doc-composition')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Composition' })).toBeVisible();
    // The crashed tab is still on the strip, its pane hidden — not gone.
    await expect(page.getByTestId('doc-demo')).toBeVisible();
    await expect(page.getByTestId('doc-error')).toBeHidden();
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the theme toggle persists across a reload', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('status-theme').getByRole('button').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the sidebar can be dragged wider, and stays so after a reload', async ({ page }) => {
  // The one part of Task 6 jsdom cannot drive: the handle captures the
  // pointer, so a drag that crosses the preview's iframe keeps reporting
  // to the handle instead of vanishing into it (`Shell.tsx`'s `useResize`
  // guards the capture call with `?.` for exactly that gap).
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/preview');
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible({ timeout: 20_000 });
    const sidebar = page.getByTestId('sidebar');
    const before = (await sidebar.boundingBox())!.width;

    const handle = (await page.getByTestId('resize-sidebar').boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 150, y, { steps: 5 });
    await page.mouse.up();

    await expect
      .poll(async () => (await sidebar.boundingBox())!.width)
      .toBeCloseTo(before + 150, -1);
    await page.reload();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    expect((await page.getByTestId('sidebar').boundingBox())!.width).toBeCloseTo(before + 150, -1);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
