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
  host = await createIdeHost({ cwd: WORKSPACE, port: 5679 });
});

test.afterAll(async () => {
  await host.stop();
  writeFileSync(COMPOSITION, original);
});

test('a third-party plugin brings its own UI without the shell being rebuilt', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('e8-example-probe')).toBeVisible();
  await expect(page.getByText('Эта карточка пришла из плагина, а не из оболочки.')).toBeVisible();
});

test('the restart cost of a field is visible before it is clicked', async ({ page }) => {
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
