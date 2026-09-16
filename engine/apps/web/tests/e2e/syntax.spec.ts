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
 * **Three corrections to the brief's own sketch, all found by running it.**
 *
 *  1. `fn pay_for(` sits at line 126 of `first-slot`'s 392-line
 *     `game/script.spin` — not "near the end" as the brief's comment for
 *     it claimed. `Control+End` lands the caret (and Monaco's virtualised
 *     viewport) at line 392, and line 126 is not among the lines that
 *     virtualisation actually renders there, so `pay_for` is never on
 *     screen to find a class for. The brief's own pre-approved fallback is
 *     used instead: `record`/`Vars` off `record Vars {` at line 39 — but
 *     see correction 3, that line is not on screen "at any reasonable
 *     viewport" either, and getting it there takes real navigation, not
 *     just a move to the document top.
 *  2. Neither `Control+End` nor `Control+Home` is Monaco's own binding for
 *     "document end"/"document top" on a Mac — `code.spec.ts`'s module doc
 *     measured this once already for `End` (`cursorBottom`'s mac override
 *     replaces it with `Cmd+DownArrow`); `coreCommands.js` shows the same
 *     shape for `cursorTop` (`Cmd+UpArrow`). `moveCursorToDocumentEnd`/
 *     `moveCursorToDocumentTop` below are this file's own copies of
 *     `code.spec.ts`'s helper (`debts.spec.ts` already keeps its own copy
 *     too — the suite's convention is one copy per spec).
 *  3. Measured directly: `game/script.spin` opens with a 38-line `--`
 *     header comment (line 39 is `record Vars {`) and `src/main.ts` opens
 *     with a 75-line JSDoc-style header comment — both longer than a
 *     1280×720 Playwright viewport's ~37 rendered lines. A freshly opened
 *     file therefore paints ONE token colour (`comment`), not "more than
 *     one" — not a grammar defect, a fixture-content one: `e8.yml` (an
 *     18-line header, then real rows) and `game/spec.json` (no header at
 *     all) both clear their own comment block inside the same viewport,
 *     which is why only two of the four loop cases failed. Every loop
 *     case now moves to the document's end before counting colours, where
 *     every one of the four fixture files has real content (measured:
 *     `script.spin` ends mid-function, `main.ts` ends mid-function,
 *     `e8.yml` and `spec.json` end on ordinary rows) — this is still "the
 *     file has more than one colour", just measured off content that is
 *     guaranteed to be there rather than off however many comment lines
 *     happen to precede it. The keyword/name test needs the OPPOSITE
 *     direction — line 39, near the top — so it drives there directly:
 *     `moveCursorToDocumentTop` (a no-op when the viewport is already
 *     there, which it is on a fresh open) followed by 38 `ArrowDown`
 *     presses, which Monaco reveals into view as the caret moves.
 *  4. Dumped directly: line 39 renders as three spans, `<span
 *     class="mtk8">record</span><span class="mtk1">&nbsp;Vars&nbsp;</span>
 *     <span class="mtk9 …">{</span>`. Monaco's renderer merges a run of
 *     ADJACENT tokens that resolve to the same theme colour into one span
 *     — `identifier` carries no colour of its own under `inherit: true`
 *     with no token rules (see this task's own `DESIGN.md` sentence), so
 *     it shares its class with plain whitespace, and `Vars` merges with
 *     the space on both sides into one span whose text is `" Vars "`, not
 *     `"Vars"`. `classOf` below compares `textContent.trim()`, not
 *     `textContent`, for exactly this reason — the brief's own version
 *     compares the untrimmed string, which never matches a merged span.
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

/**
 * The `mtk*` class of the first painted span whose text, trimmed, is
 * exactly `word` — trimmed because Monaco merges a same-coloured token
 * with its neighbouring whitespace into one span (see the module doc's
 * correction 4); an untrimmed compare never matches such a span.
 */
async function classOf(page: Page, word: string): Promise<string | null> {
  return page.evaluate((w) => {
    for (const span of document.querySelectorAll('.view-line span')) {
      if (span.textContent?.trim() === w) {
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
    // See the module doc's correction 3: two of these four files open on
    // a header comment alone, so this moves to the document's end, where
    // every one of the four has real content.
    await page.getByTestId('editor').click();
    await moveCursorToDocumentEnd(page);
    await expect
      .poll(async () => (await tokenClasses(page)).length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2);
  });
}

test('in .spin a keyword and a name are painted differently', async ({ page }) => {
  await page.goto(IDE_URL);
  await open(page, 'game/script.spin');
  // `record Vars {` is line 39 — see the module doc's corrections 1 and 3
  // for why this drives the caret there directly (`fn pay_for(` at line
  // 126, the brief's own choice, is never on screen after `Control+End`;
  // line 39 is not on screen on a fresh open either) rather than reusing
  // the brief's own `Control+End` + `fn pay_for(`.
  await page.getByTestId('editor').click();
  await moveCursorToDocumentTop(page);
  for (let i = 0; i < 38; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(() => classOf(page, 'record'), { timeout: 10_000 }).not.toBeNull();
  const keyword = await classOf(page, 'record');
  const name = await classOf(page, 'Vars');
  expect(
    name,
    'Vars should be visible after moving to line 39 (record Vars { is line 39)',
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
