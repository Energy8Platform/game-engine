/**
 * Modern UI (VS Code 1.137.0) geometry, measured in a real browser: a
 * jsdom test cannot see a gap, a corner, or whether a line under the tabs
 * is gone. Every number here is from the spec's measurement table
 * (`docs/superpowers/specs/2026-09-13-modern-ui-design.md` §2): 4px gaps,
 * 8px card corners, 4px element corners, a 56px activity bar.
 */
import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { IDE_WEB_PORT } from '../../e2e-ports';
import { projectCopy, startDevHost, type DevHost } from './project-fixture';

const IDE_URL = `http://127.0.0.1:${IDE_WEB_PORT}/`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only: forces Monaco onto its textarea input
    delete window.EditContext;
  });
});

async function openIde(page: Page, host: DevHost, hash = ''): Promise<void> {
  await page.goto(host.gameUrl);
  await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });
  await page.goto(`${IDE_URL}${hash}`);
  await expect(page.getByTestId('activity-explorer')).toBeVisible({ timeout: 20_000 });
}

/** A `:root` token as the browser resolved it. */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );
}

/** `#rrggbb` → the `rgb(r, g, b)` form `getComputedStyle` returns for backgrounds. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

function style(page: Page, selector: string, prop: string, pseudo?: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (el, [p, ps]) => getComputedStyle(el, ps || null).getPropertyValue(p),
      [prop, pseudo ?? ''],
    );
}

test('activity bar and sidebar are one card, the editor another, the panel a third — 4px apart, 8px corners', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    const sidebar = (await page.getByTestId('sidebar').boundingBox())!;
    const editors = (await page.locator('.e8-editors').boundingBox())!;
    const panel = (await page.getByTestId('panel').boundingBox())!;
    const activity = (await page.getByTestId('activity-bar').boundingBox())!;
    expect(Math.abs(sidebar.x + sidebar.width + 4 - editors.x)).toBeLessThan(0.5);
    expect(Math.abs(editors.y + editors.height + 4 - panel.y)).toBeLessThan(0.5);
    expect(activity.width).toBe(56);
    expect(await style(page, '.e8-editors', 'border-top-left-radius')).toBe('8px');
    expect(await style(page, '[data-testid="activity-bar"]', 'border-top-left-radius')).toBe('8px');
    expect(await style(page, '[data-testid="activity-bar"]', 'border-top-right-radius')).toBe(
      '0px',
    );
    expect(await style(page, '[data-testid="activity-bar"]', 'border-right-width')).toBe('0px');
    expect(await style(page, '[data-testid="sidebar"]', 'border-top-left-radius')).toBe('0px');
    expect(await style(page, '[data-testid="sidebar"]', 'border-top-right-radius')).toBe('8px');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with the sidebar collapsed the activity bar closes its own card', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    await page.getByTestId('activity-explorer').click();
    await expect(page.getByTestId('sidebar')).toBeHidden();
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      expect(await style(page, '[data-testid="activity-bar"]', `border-${corner}-radius`)).toBe(
        '8px',
      );
    }
    expect(await style(page, '[data-testid="activity-bar"]', 'border-right-width')).toBe('1px');
    const activity = (await page.getByTestId('activity-bar').boundingBox())!;
    const editors = (await page.locator('.e8-editors').boundingBox())!;
    expect(Math.abs(activity.x + activity.width + 4 - editors.x)).toBeLessThan(0.5);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the active tab is a pill on the selected colour, with no line under it or the strip', async ({
  page,
}) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    const tab = '[data-testid="doc-composition"]';
    await expect(page.locator(tab)).toHaveAttribute('aria-selected', 'true');
    expect(await style(page, tab, 'border-bottom-width')).toBe('0px');
    expect(await style(page, tab, 'border-right-width')).toBe('0px');
    expect(await style(page, tab, 'border-top-left-radius')).toBe('4px');
    expect(await style(page, tab, 'background-color')).toBe(
      rgb(await token(page, '--e8-selected')),
    );
    expect(await style(page, '[data-testid="doc-tabs"]', 'border-bottom-width')).toBe('0px');
    const strip = (await page.getByTestId('doc-tabs').boundingBox())!;
    const pill = (await page.locator(tab).boundingBox())!;
    expect(strip.height).toBe(32);
    expect(pill.height).toBe(24);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the pressed activity button is a filled square, not an accent stripe', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    // `aria-pressed` follows the SIDEBAR (Shell.tsx: `entry.opens === 'sidebar'
    // && sidebar === entry.key`); a document button such as `composition` is
    // never pressed. Explorer is the sidebar the shell opens with.
    const button = '[data-testid="activity-explorer"]';
    await expect(page.locator(button)).toHaveAttribute('aria-pressed', 'true');
    // The 32×32 indicator is the button's `::before` layer (styles.css); the
    // button's own background stays transparent by design (Ruling 2).
    expect(await style(page, button, 'background-color', '::before')).not.toBe('rgba(0, 0, 0, 0)');
    expect(await style(page, button, 'color')).toBe(rgb(await token(page, '--e8-fg')));
    expect(await style(page, button, 'border-left-width')).toBe('0px');
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the status bar lies on the window ground with no line above it', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    expect(await style(page, '[data-testid="status-bar"]', 'border-top-width')).toBe('0px');
    expect(await style(page, '[data-testid="status-bar"]', 'background-color')).toBe(
      rgb(await token(page, '--e8-shell-bg')),
    );
    expect(await style(page, '[data-testid="shell"]', 'background-color')).toBe(
      rgb(await token(page, '--e8-shell-bg')),
    );
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing in the shell casts a shadow', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    for (const sel of [
      '[data-testid="shell"]',
      '[data-testid="sidebar"]',
      '.e8-editors',
      '[data-testid="panel"]',
      '[data-testid="status-bar"]',
      '[data-testid="doc-composition"]',
      '[data-testid="activity-bar"]',
    ]) {
      expect(await style(page, sel, 'box-shadow'), sel).toBe('none');
    }
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the light theme repaints the ground, the cards and Monaco together', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await openIde(page, host, '#/doc/composition');
    await page.getByTestId('explorer-game/script.spin').click();
    const pane = page.getByTestId('doc-pane-f:game/script.spin');
    await expect(pane.locator('.monaco-editor')).toBeVisible({ timeout: 10_000 });
    const monacoBg = () =>
      pane
        .locator('.monaco-editor')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(await token(page, '--e8-shell-bg')).toBe('#181818');
    expect(await style(page, '.e8-editors', 'background-color')).toBe('rgb(31, 31, 31)');
    await expect.poll(monacoBg).toBe('rgb(31, 31, 31)');

    await page.getByTestId('status-theme').locator('button').click();
    await expect.poll(() => token(page, '--e8-shell-bg')).toBe('#f8f8f8');
    expect(await style(page, '.e8-editors', 'background-color')).toBe('rgb(255, 255, 255)');
    await expect.poll(monacoBg).toBe('rgb(255, 255, 255)');
    expect(await style(page, '[data-testid="status-bar"]', 'background-color')).toBe(
      'rgb(248, 248, 248)',
    );
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
