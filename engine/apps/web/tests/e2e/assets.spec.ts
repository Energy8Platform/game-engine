/**
 * Task 8's acceptance suite: the last task of "the project is editable"
 * (`.superpowers/sdd/2026-09-10-the-project-is-editable/`), proving what
 * Tasks 1-7 built — a host `files` service, four routes over it, a client
 * service, and the `Ассеты` screen with upload/delete — through a live
 * `e8 dev` host, a real browser, and the real filesystem, rather than the
 * host-level `files.test.ts`, the client's `assets-screen.test.tsx`, or
 * either one's fakes.
 *
 * Four cases, each written to fail without the change it proves (see
 * task-8-report.md for the revert-and-confirm-red check on all four):
 *
 *  1. The screen draws the PROJECT's own tree, not a fixture baked into a
 *     test double — `explorer-game/script.spin` is a real file this fixture
 *     ships, read off disk by the host and rendered by the screen.
 *  2. A file chosen through the real `<input type="file">` in a real
 *     browser lands on disk, where a person's own file manager would look
 *     for it — not merely "the mocked `fetch` in `assets-screen.test.tsx`
 *     saw a PUT".
 *  3. A delete confirmed through the real confirm row removes the file
 *     from disk, the same asymmetric proof as #2.
 *  4. A path that climbs out of the project through the real `/api/files`
 *     route — not the service function called directly — is refused with
 *     a diagnostic a human can read, per §8 of the design spec. The one
 *     case here that talks to the host without going through the screen
 *     at all, because the screen itself can never construct such a path:
 *     `AssetsScreen` only ever asks for paths it read off `ctx.files
 *     .tree()`, so proving the refusal needs a client that isn't the
 *     screen — `curl`, or here, a raw request.
 *
 * **On the `page.request.get`/`fetch()` gotcha (see task-8-report.md,
 * "correction A").** The brief's own sketch for #4 uses `page.request
 * .get()`. Measured directly before trusting it: `page.request` is
 * Playwright's own Node-side HTTP client, not the browser's `fetch`, but it
 * goes through the same WHATWG URL parsing on the way out — a throwaway
 * probe (`http.createServer` plus `request.newContext().get()`) showed the
 * server receiving `/etc/passwd`, the `..` segments already collapsed
 * before the request left the process. Exactly the trap `files.test.ts`'s
 * own `rawGet` helper exists to route around (see its doc comment there),
 * for the identical reason: `node:http`'s `path` option goes onto the
 * request line unparsed. Reused here rather than reinvented, aimed at
 * `host.url` — the IDE host's own origin, where `/api/files` lives. (It
 * was aimed at `host.gameUrl` while the game shared that port; since the
 * game moved to its own server — spec §6 — the game's origin answers
 * `/api/files/…` with its SPA fallback, 200 and index.html, which is not
 * the route under test at all.)
 *
 * A second gotcha turned up running this file, not reading it: the brief's
 * own three `..` segments land INSIDE this repo (`projectCopy()` nests
 * `e8-compose-*` deep under `engine/examples/`), at a `game-engine/etc`
 * that does not exist — read `readOne` (`files.ts:265`) closely and the
 * realpath check that decides "outside the project" runs AFTER a
 * `realpathSync` that a nonexistent target fails first, so this landed on
 * "was not found" (404), never reaching the containment branch the test
 * means to prove. See `ESCAPE_PATH`'s own comment below for the fix.
 *
 * **On not excluding a class of cases.** The temptation was to treat #4 as
 * already proven — Task 3's `files.test.ts` already drives the exact same
 * route with the exact same escape path, host-level, and Task 1/2 attacked
 * containment from six more directions the brief never listed. But every
 * one of those runs `startHost`, never `startDevHost`: no `dev-game`
 * plugin. When the game shared the host's port, `/api/files/*splat` had to
 * win against `dev-game`'s catch-all on the same server; the game now has
 * its own server and the root has no catch-all, so that particular race is
 * gone — #4 stays anyway, run against the real composed host, because it
 * is the one place the route is exercised with a project's game up.
 *
 * Cases considered and left OUT, and why each is a genuine "already proven
 * elsewhere" rather than a convenient one:
 *
 *  - **Six more escape shapes** (symlink in/out, absolute path, NUL byte,
 *    bare `..`, percent-encoded `..`, a literal unencoded `+`) — all
 *    host-level in `files.test.ts`, none of them routing-order-sensitive
 *    the way the `dev-game` catch-all makes #4 above. One escape path,
 *    proven through the ACTUAL composed host, stands for the class; the
 *    other six are about the containment WALK itself, which does not
 *    change depending on which other plugins share the process.
 *  - **Directory delete refused** — `files.test.ts`'s host-level test and
 *    `assets-screen.test.tsx`'s client-level test between them already
 *    cover both halves of this exact causal chain (the service refuses,
 *    the screen shows the refusal); no browser- or real-disk-specific
 *    behaviour sits between them that only a live host could surface.
 *  - **Content-type of a served file, image preview, text preview, the
 *    5MB/binary-sniff refusals** — `files.test.ts` proves the header
 *    per-extension, `assets-screen.test.tsx` proves the screen's branch
 *    per content shape; nothing about EITHER changes when the bytes cross
 *    a real socket instead of a mocked `fetch`, unlike upload/delete (#2,
 *    #3 above), where "the screen believes it happened" and "it actually
 *    happened on disk" are two different claims by design.
 *  - **The diagnostics panel visible while the preview wall is open** — the
 *    brief's own fifth case, and genuinely a `screens.spec.ts` concern (the
 *    panel is chrome now, not an assets concept); added there instead of
 *    here, alongside where the panel's OTHER acceptance cases already live.
 *
 * Every project here is a private `projectCopy()`, removed in a `finally`
 * — see `./project-fixture`. Every test visits the game and waits for it
 * to settle before doing anything else, including test #4, which never
 * looks at the game page again afterwards — the same reason `declared
 * .spec.ts`/`screen-demo.spec.ts`/`screens.spec.ts` all give at length:
 * `startDevHost` starts the project's own vite instance unconditionally,
 * pre-bundling every row in the background, and `host.stop()` tearing that
 * down mid-build measured flaky under the full suite for a test that
 * skipped this wait.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PNG_BYTES, projectCopy, startDevHost, type DevHost } from './project-fixture';

/**
 * The IDE app — vite on 5680, proxying `/api`, `/plugin-client` and `/ide`
 * to the host on 5679. No `#/assets` any more: the tree is the Explorer
 * sidebar, open on every fresh load, and its rows are `explorer-<path>`.
 */
const IDE_URL = 'http://127.0.0.1:5680/';

/**
 * `node:http`'s `path` sent unparsed, straight onto the request line — see
 * `files.test.ts`'s own `rawGet` (same shape, reused rather than
 * reinvented) and this file's header comment for why `page.request`/
 * `fetch()` cannot deliver a literal `..` at all.
 */
function rawGet(host: DevHost, rawPath: string): Promise<{ status: number; text: string }> {
  const url = new URL(host.url);
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: rawPath, method: 'GET' },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolveRequest({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('the assets screen shows the real project on disk', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    await page.goto(IDE_URL);
    await expect(page.getByTestId('explorer-game/script.spin')).toBeVisible({ timeout: 20_000 });
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file uploaded through the screen is on disk afterwards', async ({ page }) => {
  // Through a live host and a real browser: the screen, the route, the
  // disk — not `assets-screen.test.tsx`'s mocked `fetch`, which can only
  // ever prove the screen BELIEVES a PUT went out, never that anything
  // landed anywhere real.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    await page.goto(IDE_URL);
    await expect(page.getByTestId('explorer-game/script.spin')).toBeVisible({ timeout: 20_000 });

    await page
      .getByTestId('explorer-upload')
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_BYTES });
    await expect(page.getByTestId('explorer-logo.png')).toBeVisible({ timeout: 20_000 });
    expect(existsSync(join(dir, 'logo.png'))).toBe(true);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file deleted through the screen is gone from disk', async ({ page }) => {
  const dir = projectCopy();
  writeFileSync(join(dir, 'bye.txt'), 'x');
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    await page.goto(IDE_URL);
    await expect(page.getByTestId('explorer-bye.txt')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('explorer-delete-bye.txt').click();
    await page.getByTestId('confirm-yes').click();
    await expect(page.getByTestId('explorer-bye.txt')).toHaveCount(0, { timeout: 20_000 });
    expect(existsSync(join(dir, 'bye.txt'))).toBe(false);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Twenty `..` segments, not three. Measured directly, the way
 * `files.test.ts`'s own comment on rooting its fixture at literal `/tmp`
 * insists on: `projectCopy()` lands under `engine/examples/e8-compose-*`,
 * which is deeper below the real filesystem root than `/etc/passwd` has
 * `..` segments to climb — three only reaches `readOne`'s realpath check
 * (`files.ts:286`) as far as this REPO's own root, where `etc/passwd`
 * usually does not exist, and a target that does not exist reads as "was
 * not found" (404) rather than "outside the project" (400), the exact
 * "wrong branch" shape this suite's header warns about. `path.resolve`
 * clamps any `..` climbed past the real root back to the root itself
 * (verified directly: `resolve('/a/b/c', '../'.repeat(10) + 'etc/passwd')`
 * is `/etc/passwd` regardless of how deep `/a/b/c` actually is) — twenty is
 * comfortably past any depth this repo, or a CI checkout of it, is ever
 * nested at, so this reaches the real `/etc/passwd` and the real
 * containment check no matter where `e8-compose-*` happens to land.
 */
const ESCAPE_PATH = `/api/files/${'../'.repeat(20)}etc/passwd`;

test('a path that climbs out of the project is refused, and says why', async ({ page }) => {
  // Through the route, because the screen itself can never build such a
  // path — every request it makes carries a path read off its own tree
  // fetch. `curl` can; so can this.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).not.toHaveText('', { timeout: 20_000 });

    const res = await rawGet(host, ESCAPE_PATH);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.text) as { diagnostics: Array<{ message: string }> };
    expect(body.diagnostics[0].message).toMatch(/outside the project/i);
  } finally {
    await host.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
