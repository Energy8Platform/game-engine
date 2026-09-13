import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createIdeHost, type IdeHost } from '@energy8engine/ide-host';

// `package.json` sets `"type": "module"`, so this file runs as ESM (no
// `__dirname`) — derive the same directory from `import.meta.url` instead.
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(__dirname, '..', '..', '..', '..', 'examples', 'workspace');
const COMPOSITION = join(WORKSPACE, 'e8.yml');

let host: IdeHost;
let original: string;

// The host runs in-process: one less moving part than spawning the CLI, and the
// browser cannot tell the difference — it only ever sees port 5679.
test.beforeAll(async () => {
  original = readFileSync(COMPOSITION, 'utf8');
  host = await createIdeHost({ root: WORKSPACE, port: 5679 });
});

test.afterAll(async () => {
  // Restore first, stop second — and stopping must not be able to block the
  // restore. Test 3 lands a real write on `e8.yml`; `host.stop()` is
  // `await ctx.fiber.dispose()` with no guard around it, and cordis's
  // teardown calls each disposable synchronously with nothing catching a
  // throw, so a throwing plugin dispose would otherwise propagate straight
  // out and skip the write-back, leaving a tracked file dirty. The restore
  // runs unconditionally first; `host?.stop()` is then best-effort (`host`
  // is also optional here so a `beforeAll` failure before assignment can't
  // throw a second error on top of whatever already failed).
  writeFileSync(COMPOSITION, original);
  await host?.stop().catch(() => {});
});

test('a third-party plugin brings its own UI without the shell being rebuilt', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('e8-example-probe')).toBeVisible();
  await expect(page.getByText('Эта карточка пришла из плагина, а не из оболочки.')).toBeVisible();
});

test('a field the plugin declared restart-requiring shows the restart badge', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('перезапуск')).toBeVisible();
});

test('turning a knob lands on disk', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('скорость барабана').fill('5');
  await expect
    .poll(() => readFileSync(COMPOSITION, 'utf8'), { timeout: 10_000 })
    .toContain('speed: 5');
});
