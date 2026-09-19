/**
 * A project born in the browser — spec §7's Playwright cases for
 * `workspace.create`: the sidebar form over a folder of projects, a real
 * `Create`, the new project open with its game spinning, the two refusals
 * the form shows on its own, and no form at all under `e8 dev`.
 *
 * The created project lands INSIDE the temp workspace copy
 * (`engine/examples/e8-compose-*`), so `rmSync(root)` in each `finally`
 * takes it with it; the last assertion of every test proves
 * `engine/examples/` is back to exactly what is checked in.
 *
 * Templates are the repo's own, used where they ship: the created project
 * sits one level deeper than `engine/examples/<id>` and boots anyway,
 * because the template's `tsconfig.json` is self-contained — the
 * concession `workspaceCopy` makes for its two `first-slot` copies is one
 * a template must never need.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { EXAMPLES, projectCopy, startDevHost, startHost, workspaceCopy } from './project-fixture';

/** The IDE app — vite on 5680, proxying to the host on 5679. */
const IDE_URL = 'http://127.0.0.1:5680/';

function examplesOnDisk(): string[] {
  return readdirSync(EXAMPLES)
    .filter((name) => name !== '.DS_Store')
    .sort();
}

test('Create over two projects: the third is born, opened, and spins; then refused twice', async ({
  page,
}) => {
  // A snapshot, not a hard list: what matters is that this test leaves no
  // junk behind, not the exact contents of a machine's `examples/` (a
  // developer's own untracked example dir is none of this test's business).
  const before = examplesOnDisk();
  const root = workspaceCopy(2);
  const host = await startHost(root);
  try {
    await page.goto(IDE_URL);
    await expect(page.getByTestId('sidebar-workspace')).toBeVisible();
    const select = page.getByTestId('new-project-template');
    await expect(select).toBeVisible();
    await expect(select.locator('option', { hasText: 'Basic slot' })).toHaveCount(1);

    await page.getByTestId('new-project-id').fill('third-slot');
    await page.getByTestId('new-project-create').click();
    await expect(page.getByTestId('project-third-slot')).toHaveAttribute('aria-current', 'true', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('status-project')).toHaveText('third-slot');
    await expect(page.getByTestId('new-project-refusal')).toHaveCount(0);

    // On disk: every `{{id}}` substituted, `package.json` renamed.
    const dir = join(root, 'third-slot');
    const spec = readFileSync(join(dir, 'game', 'spec.json'), 'utf8');
    expect(spec).toContain('"id": "third-slot"');
    expect(spec).not.toContain('{{id}}');
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).not.toContain('{{id}}');
    expect(
      (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string }).name,
    ).toBe('third-slot');

    // The host's view: three projects, the new one active.
    const body = (await (await page.request.get(`${host.url}/api/workspace`)).json()) as {
      active: string | null;
      projects: { id: string }[];
    };
    expect(body.projects.map((p) => p.id)).toEqual(['slot-1', 'slot-2', 'third-slot']);
    expect(body.active).toBe('third-slot');

    // The browser's view: its tree, and its game booted in the frame — a
    // fresh vite root optimizes deps on first boot, hence the longer budget.
    await page.getByTestId('activity-explorer').click();
    await expect(page.getByTestId('explorer-game/script.spin')).toBeVisible();
    const bootStart = Date.now();
    await expect(page.frameLocator('iframe').first().locator('#status')).not.toHaveText('', {
      timeout: 40_000,
    });
    test.info().annotations.push({
      type: 'first-boot-ms',
      description: String(Date.now() - bootStart),
    });

    // Refusals the form shows on its own, in the same host.
    await page.getByTestId('activity-workspace').click();
    await page.getByTestId('new-project-id').fill('third-slot');
    await page.getByTestId('new-project-create').click();
    await expect(page.getByTestId('new-project-refusal')).toContainText('already exists');
    await page.getByTestId('new-project-id').fill('Bad Id');
    await expect(page.getByTestId('new-project-create')).toBeDisabled();
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
  expect(examplesOnDisk()).toEqual(before);
});

test('under e8 dev (a single project) there is no form', async ({ page }) => {
  // Same snapshot approach — see the other test's comment.
  const before = examplesOnDisk();
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(IDE_URL);
    await expect(page.getByTestId('status-project')).not.toHaveText('no project', {
      timeout: 20_000,
    });
    // The sidebar itself is there (one project, listed) — only the form is not.
    await page.getByTestId('activity-workspace').click();
    await expect(page.getByTestId('sidebar-workspace')).toBeVisible();
    await expect(page.locator('[data-testid^="project-"]')).toHaveCount(1);
    await expect(page.getByTestId('new-project-template')).toHaveCount(0);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  expect(examplesOnDisk()).toEqual(before);
});
