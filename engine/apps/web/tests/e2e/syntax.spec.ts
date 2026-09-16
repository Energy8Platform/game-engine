import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

/**
 * Highlighting in a real browser: every file kind a project is made of
 * opens with more than one token colour, and `.spin`'s own grammar tells
 * a keyword from a name. Monaco paints each token as a `<span>` with a
 * theme class `mtk<N>`; two different classes on one line is what "has
 * highlighting" means here, and it is measured on the rendered
 * `.view-line`s, not on any model. The `check` markers of `code.spec.ts`
 * are re-asserted once because the tokenizer and the marker decorations
 * share the same line renderer.
 *
 * **Two corrections to the brief's own sketch, both found by running it.**
 *
 *  1. `fn pay_for(` sits at line 126 of `first-slot`'s 392-line
 *     `game/script.spin` — not "near the end" as the brief's comment for
 *     it claimed. `Control+End` lands the caret (and Monaco's virtualised
 *     viewport) at line 392, and line 126 is not among the lines that
 *     virtualisation actually renders there, so `pay_for` is never on
 *     screen to find a class for. The brief's own pre-approved fallback is
 *     used instead: go to the document's TOP, and `record`/`Vars` off
 *     `record Vars {` at line 39, which sits inside the first screenful at
 *     any reasonable viewport.
 *  2. Neither `Control+End` nor `Control+Home` is Monaco's own binding for
 *     "document end"/"document top" on a Mac — `code.spec.ts`'s module doc
 *     measured this once already for `End` (`cursorBottom`'s mac override
 *     replaces it with `Cmd+DownArrow`); `coreCommands.js` shows the same
 *     shape for `cursorTop` (`Cmd+UpArrow`). `moveCursorToDocumentEnd`/
 *     `moveCursorToDocumentTop` below are this file's own copies of
 *     `code.spec.ts`'s helper (`debts.spec.ts` already keeps its own copy
 *     too — the suite's convention is one copy per spec).
 */
const IDE_URL = 'http://127.0.0.1:5680/';
const MAC = process.platform === 'darwin';

/** `Cmd+Down` on a Mac, `Ctrl+End` elsewhere — Monaco's own binding, measured in `code.spec.ts`. */
async function moveCursorToDocumentEnd(page: Page): Promise<void> {
  await page.keyboard.press(MAC ? 'Meta+ArrowDown' : 'Control+End');
}

/** `Cmd+Up` on a Mac, `Ctrl+Home` elsewhere — the mirror-image binding for `cursorTop`. */
async function moveCursorToDocumentTop(page: Page): Promise<void> {
  await page.keyboard.press(MAC ? 'Meta+ArrowUp' : 'Control+Home');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only: see code.spec.ts — Monaco's textarea input is the one Playwright drives.
    delete window.EditContext;
  });
});

let dir: string;
let host: DevHost;

test.beforeEach(async () => {
  dir = projectCopy();
  host = await startDevHost(dir);
});

test.afterEach(async () => {
  await host.stop();
  rmSync(dir, { recursive: true, force: true });
});

/** Opens a file from the Explorer and waits for Monaco to have painted at least one line. */
async function open(page: Page, path: string): Promise<void> {
  await page.getByTestId(`explorer-${path}`).click();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.view-line').first()).toBeVisible();
}

/** The distinct `mtk*` classes painted across the visible lines. */
async function tokenClasses(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const classes = new Set<string>();
    for (const span of document.querySelectorAll('.view-line span'))
      for (const cls of span.classList) if (/^mtk\d+$/.test(cls)) classes.add(cls);
    return [...classes].sort();
  });
}

/** The `mtk*` class of the first painted span whose text is exactly `word`. */
async function classOf(page: Page, word: string): Promise<string | null> {
  return page.evaluate((w) => {
    for (const span of document.querySelectorAll('.view-line span')) {
      if (span.textContent === w) {
        const cls = [...span.classList].find((c) => /^mtk\d+$/.test(c));
        if (cls) return cls;
      }
    }
    return null;
  }, word);
}

for (const path of ['game/script.spin', 'e8.yml', 'src/main.ts', 'game/spec.json']) {
  test(`${path} opens with more than one token colour`, async ({ page }) => {
    await page.goto(IDE_URL);
    await open(page, path);
    await expect
      .poll(async () => (await tokenClasses(page)).length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2);
  });
}

test('in .spin a keyword and a name are painted differently', async ({ page }) => {
  await page.goto(IDE_URL);
  await open(page, 'game/script.spin');
  // `record Vars {` is line 39, inside the first screenful; see the module
  // doc for why this uses `moveCursorToDocumentTop` rather than the
  // brief's own `Control+End` + `fn pay_for(`.
  await page.getByTestId('editor').click();
  await moveCursorToDocumentTop(page);
  await expect.poll(() => classOf(page, 'record'), { timeout: 10_000 }).not.toBeNull();
  const keyword = await classOf(page, 'record');
  const name = await classOf(page, 'Vars');
  expect(
    name,
    'Vars should be visible after moving to the document top (record Vars { is line 39)',
  ).not.toBeNull();
  expect(keyword).not.toBe(name);
});

test('the check marker is still drawn on a highlighted .spin', async ({ page }) => {
  await page.goto(IDE_URL);
  await open(page, 'game/script.spin');
  await page.getByTestId('editor').click();
  await moveCursorToDocumentEnd(page);
  await page.keyboard.type('\nrecord {');
  await expect(page.locator('.squiggly-warning').first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await tokenClasses(page)).length).toBeGreaterThanOrEqual(2);
});
