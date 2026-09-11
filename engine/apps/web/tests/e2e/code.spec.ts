/**
 * Task 7's acceptance suite — the last task of "the math is edited by
 * mouse" (`.superpowers/sdd/2026-09-11-the-math-is-edited-by-mouse/`),
 * proving what Tasks 1-6 built (`Diagnostic.at`, `POST /api/check`,
 * `ctx.check`, `<Monaco/>`, the `Код` screen, the save-restarts-`e8-server`
 * wiring) through a live `e8 dev` host and a real browser, rather than any
 * of those tasks' own unit or jsdom-level tests.
 *
 * **Two corrections to the brief, both ruled by the controller before this
 * file was written.** `DevHost` exposes `gameUrl` and `stop()`, never
 * `.url` (`./project-fixture`) — every test below uses those. And the
 * brief's own sketch calls a `provokeRefusedSave(page)` helper that has
 * never existed anywhere in this suite; `./provokeRefusedSave` below
 * (right here, not imported) is what it stands for — see that function's
 * own doc for the shape a real refusal takes.
 *
 * **A third correction, found by running the brief's own sketch rather
 * than trusting it.** The brief's draft asserts `.squiggly-error` for a
 * `record {}` mistake. Measured directly against a live `/api/check`:
 * every diagnostic it returns is a `warning`, on purpose —
 * `engine/ide/host/src/plugins/schema.ts`'s own `asWarning` re-stamps
 * every `spin-parser` diagnostic before it reaches the wire, because a
 * parse problem in text nobody has saved is not the same severity as one
 * that reached disk. Monaco therefore draws `.squiggly-warning`, never
 * `.squiggly-error`, for anything `ctx.check` reports — both tests below
 * that look for a marker look for the right class.
 *
 * **Two more things this task's own brief warned would be needed and
 * were, found the same way — by running the draft, not by reading it.**
 *
 *  1. Chromium's newer text-input path (`EditContext`, feature-detected by
 *     `typeof globalThis.EditContext === 'function'` — see
 *     `nativeEditContextRegistry.js` in `monaco-editor`) swallows
 *     Playwright's synthetic keystrokes entirely: focus lands on a
 *     `div.native-edit-context` and typed text never reaches the model
 *     (measured: typing landed nowhere, silently). `beforeEach` below
 *     deletes `window.EditContext` before any page script runs, which
 *     makes Monaco fall back to its classic `<textarea class="inputarea">`
 *     — the one Playwright's `keyboard.type()` has always driven reliably.
 *     Not a change to what a person's own browser does; a change to which
 *     of Monaco's two equally-real input controllers this suite drives.
 *  2. `data-testid="editor"` is the HOST div `<Monaco/>` renders on its
 *     very first render, before `monaco.editor.create()` — an async import
 *     — has attached anything interactive inside it. Clicking that div
 *     before `.monaco-editor` itself exists focuses nothing useful, and a
 *     later click never arrives to recover it. Every interaction below
 *     waits for `.monaco-editor` to be visible before it clicks into
 *     `editor` — skipping that wait was measured to make the very next
 *     keystroke land nowhere, silently, exactly like the `EditContext` trap
 *     above and just as easy to mistake for a passing test that typed
 *     nothing.
 *
 * **Cases considered and left OUT, and why each already has real
 * coverage rather than a convenient excuse:**
 *
 *  - **The debounce and the stale-answer guard** — both proven at the
 *    client level already (`code-screen.test.tsx`'s "debounces rapid
 *    typing" and the sequence-number tests next to it), against a fake
 *    `ctx.check`/`ctx.files` where the RACE can be forced deterministically
 *    (a fake whose promise resolves whenever the test says so). A live
 *    host's network can be reordered by nothing this suite controls, so a
 *    live-host test here could show the guard working by chance and could
 *    never show it FAILING by chance — it would not be a stronger version
 *    of the same claim, only a slower and less certain one.
 *  - **The binary-file refusal reused from the assets screen** — proven
 *    once, at the unit level, for both screens
 *    (`assets-screen.test.tsx`/`code-screen.test.tsx`'s own binary-sniff
 *    cases) and once end-to-end for the assets screen itself
 *    (`assets.spec.ts` doesn't even re-run it — see that file's own "left
 *    out" list). `looksBinary` is one function, imported, not
 *    reimplemented, by `CodeScreen.tsx` — nothing about crossing a real
 *    socket changes a byte-sniffing decision made entirely in the browser
 *    before any request is sent.
 *  - **Switching FILES with unsaved changes asks first** — the brief's own
 *    test 5 exercises the CROSS-TAB half of the same guard (`ctx.layout
 *    .guard`); the same-screen half (switching to a different file) is
 *    already `code-screen.test.tsx`'s "leaving with unsaved changes asks
 *    first", and nothing about a real browser changes whether a `useState`
 *    comparison notices `text !== savedText`.
 *  - **The restart-serialises / dispose-mid-restart guarantees Task 6
 *    built** — that task's own host-level tests
 *    (`engine/ide/host/tests/*.test.ts`) already drive the real
 *    subprocess; this suite's own save-changes-disk test below (test 2)
 *    is what proves a save reaches that machinery through the real Save
 *    button at all, which is the one thing only a live host and a real
 *    click can show. Re-driving two overlapping saves here would restate
 *    Task 6's own coverage through a slower door.
 */
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { projectCopy, startDevHost } from './project-fixture';

/** The IDE app — vite on 5680, proxying `/api`, `/plugin-client` and `/ide` to the host on 5679. */
const IDE_URL = 'http://127.0.0.1:5680/#/code';

test.beforeEach(async ({ page }) => {
  // See the module doc's first "found by running the draft" item. Applied
  // to every test uniformly — harmless for the one test that never types
  // (Monaco only instantiates its input controller once something asks to
  // interact with it), and load-bearing for every other one.
  await page.addInitScript(() => {
    // @ts-expect-error test-only: forces Monaco onto its textarea input
    // controller, the one Playwright's keyboard actually drives.
    delete window.EditContext;
  });
});

/** Opens `game/script.spin` and waits for the REAL editor — not merely the host div `<Monaco/>` renders before Monaco has attached anything. See the module doc's second "found by running the draft" item. */
async function openScriptSpin(page: Page): Promise<void> {
  await page.getByTestId('file-game/script.spin').click();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('editor').click();
}

/**
 * What the brief's own `provokeRefusedSave(page)` stands for: a save the
 * host refuses. It cannot be built the way the assets screen's own escape
 * test is (a raw request past the screen, with a literal `..`) — the
 * refusal has to land on `ctx.connection.report()`, which only `CodeScreen
 * .save()`'s own `.then()` calls, so it has to go through the real Save
 * button.
 *
 * And it cannot be a path the screen merely TYPES, either: every path
 * `ctx.files.write` ever sees here is one `ctx.files.read` already
 * accepted for the same file a moment earlier, because `CodeScreen` never
 * offers anything but a path off its own `ctx.files.tree()` listing. Read
 * and write share exactly one containment check (`describeRefusal` in
 * `engine/ide/host/src/plugins/files.ts`), applied to the exact same
 * `target` — so a file that opened cleanly cannot, by construction, ever
 * fail to SAVE for a containment reason unless something on disk changes
 * IN BETWEEN. And `tree()` never lists a symlink at all (a plain
 * `readdirSync` dirent is neither `isFile()` nor `isDirectory()` for one),
 * so there is no already-broken path sitting in the file list to click
 * either.
 *
 * So this does the one thing left: open the file, type an edit, and only
 * THEN swap `game/` for a symlink leading outside the project — the same
 * escape `engine/ide/host/tests/files.test.ts`'s own "refuses to write
 * THROUGH a symlink that leads out" already proves at the host level,
 * driven here through the real Save button instead of the service
 * directly. `game/script.spin`'s own ancestor (not its leaf — a
 * leaf-symlink refusal reads "is a symlink", never "outside the project")
 * is what has to move for the write-time ancestor walk
 * (`nearestExistingAncestor`) to land outside the root; swapping the whole
 * `game/` directory is the shortest way there.
 */
async function provokeRefusedSave(page: Page, dir: string): Promise<void> {
  await openScriptSpin(page);
  await page.keyboard.type('\n// edited from the browser\n');
  const outside = mkdtempSync(join(tmpdir(), 'e8-code-outside-'));
  rmSync(join(dir, 'game'), { recursive: true, force: true });
  symlinkSync(outside, join(dir, 'game'));
  await page.getByRole('button', { name: /save/i }).click();
}

/**
 * `Control+End`/`Cmd+End` is NOT Monaco's default "go to end of document"
 * binding on a Mac — measured directly against `coreCommands.js`: the
 * `cursorBottom` command's default is `Ctrl+End`, but its `mac` override
 * replaces that with `Cmd+DownArrow`. Neither `Control+End` nor `Meta+End`
 * does anything at all on this platform; only the arrow form does.
 */
async function moveCursorToDocumentEnd(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
}

/**
 * The line a `.squiggly-warning` decoration sits on, read off the DOM —
 * not assumed, not re-derived from `Diagnostic.at` (which is the thing
 * under test). Monaco virtualizes both the gutter and the decoration
 * layer independently, each only rendering the currently visible rows, so
 * neither carries the line number as a plain attribute; what both DO
 * share is the page's own coordinate space. Measured directly against a
 * live editor: a marker's `getBoundingClientRect().y` lands EXACTLY on the
 * `y` of its own `.line-numbers` gutter row (not merely close — identical,
 * to the sub-pixel, in every run), so the gutter row closest to the
 * marker's `y` is the line the marker is actually on.
 */
async function markerLine(page: Page): Promise<number> {
  const marker = page.locator('.monaco-editor .squiggly-warning').first();
  await expect(marker).toBeVisible({ timeout: 10_000 });
  return page.evaluate(() => {
    const sq = document.querySelector('.monaco-editor .squiggly-warning') as HTMLElement;
    const markerY = sq.getBoundingClientRect().y;
    const rows = Array.from(
      document.querySelectorAll('.monaco-editor .margin .line-numbers'),
    ) as HTMLElement[];
    const closest = rows.reduce((a, b) =>
      Math.abs(a.getBoundingClientRect().y - markerY) < Math.abs(b.getBoundingClientRect().y - markerY)
        ? a
        : b,
    );
    return Number(closest.textContent);
  });
}

/**
 * Not about the editor's own behaviour — every other test in this file
 * already exercises that — but about whether the dependency Task 4 added
 * still lets the app come up at all. Twice on this branch a third-party
 * package has taken the whole app down at boot (see the module doc's own
 * header on this), through a class of failure only a real build and a
 * real browser can see; Task 4 and Task 5 each checked this by hand, which
 * is exactly the kind of check that stops happening the moment nobody
 * remembers to repeat it. This is that check, committed.
 *
 * Console errors, not merely `pageerror`: a caught-and-logged failure
 * (React's own error boundary, a rejected promise somewhere that never
 * reaches `window.onerror`) would pass a `pageerror`-only check while
 * still being exactly the kind of silent breakage this test exists to
 * catch.
 */
test('the IDE still loads with Monaco in it', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  try {
    await page.goto(IDE_URL);
    await openScriptSpin(page);
    expect(consoleErrors, 'a broken editor dependency must not reach the console').toEqual([]);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('editing the math and saving changes the file on disk', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(IDE_URL);
    await openScriptSpin(page);
    await page.keyboard.type('\n// edited from the browser\n');
    await page.getByRole('button', { name: /save/i }).click();
    // A save restarts `e8-server` (Task 6); this test never spins, so
    // there is nothing here to race against that restart.
    await expect
      .poll(() => readFileSync(join(dir, 'game/script.spin'), 'utf8'))
      .toContain('edited from the browser');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a mistake in the math shows a marker before anything is saved', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const before = readFileSync(join(dir, 'game/script.spin'), 'utf8');
  try {
    await page.goto(IDE_URL);
    await openScriptSpin(page);
    await page.keyboard.type('\nrecord {\n}\n');
    // `.squiggly-warning`, not `-error` — see the module doc's third
    // correction. A marker somewhere is the claim; WHICH class is what
    // the next test pins down further.
    await expect(page.locator('.monaco-editor .squiggly-warning').first()).toBeVisible({
      timeout: 10_000,
    });
    expect(readFileSync(join(dir, 'game/script.spin'), 'utf8')).toBe(before);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the marker is on the line the mistake is on', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    const before = readFileSync(join(dir, 'game/script.spin'), 'utf8');
    // `record` is found by `findBlocks` wherever it occurs in the source
    // (a regex scan, not a position-aware parse), so where the mistake
    // lands does not matter to WHETHER it is caught — only to what line
    // this test has to expect. Placing the cursor at the true end of the
    // document (see `moveCursorToDocumentEnd`) makes that line
    // computable from the ORIGINAL file alone: a fresh `\n` there always
    // opens a new line numbered one past the document's own line count,
    // whether or not the original text ends in its own trailing newline.
    const expectedLine = before.split('\n').length + 1;

    await page.goto(IDE_URL);
    await openScriptSpin(page);
    await moveCursorToDocumentEnd(page);
    await page.keyboard.type('\nrecord {\n}\n');

    expect(await markerLine(page)).toBe(expectedLine);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a refused save reaches the diagnostics panel, on any screen', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(IDE_URL);
    await provokeRefusedSave(page, dir);
    // The refused save leaves the screen dirty (the edit never landed),
    // so the cross-tab leave guard Task 5 added intercepts the tab
    // switch below exactly as it would for a person — confirmed through,
    // same as choosing to discard. Landing on a DIFFERENT screen is the
    // point: the panel has to still be showing the SAME refusal there,
    // not merely on the Code screen that provoked it.
    await page.getByTestId('tab-composition').click();
    await page.getByTestId('confirm-yes').click();
    await expect(page.getByTestId('diagnostics-panel')).toContainText(/outside the project/i);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
