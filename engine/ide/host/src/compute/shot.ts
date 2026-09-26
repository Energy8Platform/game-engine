/**
 * `e8 shot` — a PNG of the running game (or of the IDE shell, `--ide`),
 * plus how long the game took to come up. Boots the same host `e8 dev`
 * does over `cwd`, opens its `previewUrl` in Chromium, waits for
 * `window.__e8` (the game's own test hooks — spec §9's readiness) to be
 * defined, and shoots.
 *
 * `playwright` is the CLI's dependency, not this package's: it is loaded
 * here dynamically, and a `launch` can be injected instead (tests). The
 * specifier is widened to `string` so `tsc` does not try to resolve the
 * module — it happens to be hoisted in this repo's `node_modules`, which
 * is exactly why an `@ts-expect-error` would not survive: it would be
 * "unused" here and needed in a checkout without it.
 *
 * Every failure is a diagnostic in the result (spec §4): no project, no
 * game, no browser, a shell that is not built. A readiness miss is a
 * `warning` and the screenshot is still taken — whatever is on screen is
 * the evidence. The host and the browser are closed in `finally`, so a
 * `shot` that fails leaves no process behind.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { IDE_BUILD_HINT, createIdeHost } from '../index';

/** The slice of Playwright's `Page` this module uses — what a test fakes. */
export interface PageLike {
  goto(url: string): Promise<{ status(): number } | null>;
  waitForFunction(
    pageFunction: (arg: string) => unknown,
    arg: string,
    options: { timeout: number },
  ): Promise<unknown>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  close(): Promise<void>;
}

export interface BrowserLike {
  newPage(options: { viewport: { width: number; height: number } }): Promise<PageLike>;
  close(): Promise<void>;
}

export interface ShotInput {
  /** Project directory — the host's `root`, as with `e8 dev`. */
  cwd: string;
  /** PNG path (default `<cwd>/.e8/shots/<timestamp>.png`); relative to `cwd`. */
  out?: string;
  /** Default 480×288. */
  viewport?: { width: number; height: number };
  /** Call `window.__e8.spin()` and wait for it to settle before shooting. */
  spin?: boolean;
  /** Shoot the IDE shell at the host's root instead of the game (needs `dist`); refused with `spin`. */
  ide?: boolean;
  /** Readiness budget, default 30000. */
  budgetMs?: number;
  /** Default: `(await import('playwright')).chromium.launch()`. */
  launch?: () => Promise<BrowserLike>;
}

export interface ShotResult {
  path: string | null;
  /** The viewport — the PNG itself is the whole page (`fullPage`), so it may be taller. */
  width: number;
  height: number;
  /** `goto` → readiness, or `null` when readiness missed the budget. */
  loadMs: number | null;
  diagnostics: Diagnostic[];
}

const IDE_READY = '[data-testid="activity-explorer"]';

async function launchChromium(): Promise<BrowserLike> {
  const pw = (await import('playwright' as string)) as {
    chromium: { launch(): Promise<BrowserLike> };
  };
  return pw.chromium.launch();
}

/** Resolves `true` when `p` settles fulfilled within `ms`, else `false` — a rejection (Playwright's own timeout) is a miss too. */
async function within(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>((r) => {
    timer = setTimeout(() => r(false), ms);
  });
  try {
    return await Promise.race([
      p.then(
        () => true,
        () => false,
      ),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `within`'s cousin for a promise whose fulfilled VALUE is wanted, not just
 * whether it settled in time: `{ value }` when `p` fulfills within `ms`,
 * `undefined` on a miss — a rejection is not a miss, and propagates out of
 * this `await` same as it would out of a bare `await p`, for the caller's
 * own `catch` to report.
 */
async function withinValue<T>(p: Promise<T>, ms: number): Promise<{ value: T } | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((r) => {
    timer = setTimeout(() => r(undefined), ms);
  });
  try {
    return await Promise.race([p.then((value) => ({ value })), late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function shot(input: ShotInput): Promise<ShotResult> {
  const { width, height } = input.viewport ?? { width: 480, height: 288 };
  const budgetMs = input.budgetMs ?? 30000;
  const diagnostics: Diagnostic[] = [];
  const result = (path: string | null, loadMs: number | null): ShotResult => ({
    path,
    width,
    height,
    loadMs,
    diagnostics,
  });

  if (input.ide && input.spin) {
    diagnostics.push(diagnostic('error', 'compute', '--spin', '--spin has no meaning with --ide'));
    return result(null, null);
  }

  const host = await createIdeHost({ root: input.cwd, port: 0, previewPort: 0 });
  let browser: BrowserLike | undefined;
  let page: PageLike | undefined;
  try {
    const state = host.ctx.workspace.state();
    let url = `${host.url}/`;
    if (!input.ide) {
      if (state.active === null) {
        diagnostics.push(
          ...state.diagnostics,
          existsSync(join(input.cwd, 'e8.yml'))
            ? diagnostic('error', 'compute', input.cwd, 'the project did not start')
            : diagnostic(
                'error',
                'compute',
                input.cwd,
                `${input.cwd} is not a project (no e8.yml)`,
              ),
        );
        return result(null, null);
      }
      if (state.previewUrl === null) {
        diagnostics.push(
          ...state.diagnostics,
          diagnostic('error', 'compute', input.cwd, 'the project has no running game to shoot'),
        );
        return result(null, null);
      }
      url = state.previewUrl;
    }

    try {
      browser = await (input.launch ?? launchChromium)();
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          'compute',
          'playwright',
          `cannot launch Chromium: ${error instanceof Error ? error.message : String(error)}`,
          'npx playwright install chromium',
        ),
      );
      return result(null, null);
    }

    const t0 = Date.now();
    let response: Awaited<ReturnType<PageLike['goto']>>;
    try {
      page = await browser.newPage({ viewport: { width, height } });
      response = await page.goto(url);
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          'compute',
          url,
          `cannot open ${url}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return result(null, null);
    }
    if (input.ide && response?.status() === 503) {
      diagnostics.push(
        diagnostic('error', 'compute', url, 'the IDE shell is not built', IDE_BUILD_HINT),
      );
      return result(null, null);
    }
    const ready = input.ide
      ? page.waitForFunction((sel) => !!document.querySelector(sel), IDE_READY, {
          timeout: budgetMs,
        })
      : page.waitForFunction(() => (window as { __e8?: unknown }).__e8 !== undefined, '', {
          timeout: budgetMs,
        });
    const loadMs = (await within(ready, budgetMs)) ? Date.now() - t0 : null;
    if (loadMs === null) {
      diagnostics.push(
        diagnostic('warning', 'compute', url, `not ready within ${budgetMs}ms; shot taken anyway`),
      );
    }

    if (input.spin) {
      try {
        const settled = page.evaluate(() =>
          (window as unknown as { __e8: { spin(): Promise<{ out: string }> } }).__e8.spin(),
        );
        const raced = await withinValue(settled, budgetMs);
        if (!raced) {
          diagnostics.push(
            diagnostic(
              'warning',
              'compute',
              '__e8.spin',
              `the spin did not settle within ${budgetMs}ms`,
            ),
          );
        } else if (raced.value.out !== 'next') {
          diagnostics.push(
            diagnostic('warning', 'compute', '__e8.spin', `the spin left by "${raced.value.out}"`),
          );
        }
      } catch (error) {
        diagnostics.push(
          diagnostic(
            'warning',
            'compute',
            '__e8.spin',
            `spin failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }

    const path = resolve(
      input.cwd,
      input.out ?? `.e8/shots/${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    );
    try {
      await mkdir(dirname(path), { recursive: true });
      await page.screenshot({ path, fullPage: true });
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          'compute',
          path,
          `cannot write the screenshot: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return result(null, loadMs);
    }
    return result(path, loadMs);
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await host.stop();
  }
}
