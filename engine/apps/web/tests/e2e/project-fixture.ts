/**
 * A private, writable copy of `first-slot`, and the `e8 dev` host that
 * serves it — shared by every spec that needs to run a real project without
 * writing into the checked-in one.
 *
 * Extracted from `composition.spec.ts`, which is where both of these were
 * worked out and where their reasons were measured. They are here rather
 * than duplicated because a second copy would drift from the first, and
 * every constraint below is one a second author would have to rediscover
 * the hard way.
 *
 * NOT a `.spec.ts`: Playwright's default `testMatch` collects only files
 * whose name ends in `.spec` or `.test`, so this one is importable from a
 * spec without becoming one.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdeHost, type IdeHost } from '@energy8engine/ide-host';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** `engine/examples` — where the checked-in fixture lives and where every copy lands. */
export const EXAMPLES = join(__dirname, '..', '..', '..', '..', 'examples');

/** The checked-in reference project. Read from; never written to. */
export const FIXTURE = join(EXAMPLES, 'first-slot');

/**
 * A private, writable copy of `first-slot`. Never the checked-in example
 * itself: this repo's own suite runs against that one, and so does the
 * developer's `e8 dev`.
 *
 * The copy lands BESIDE the original, in `engine/examples/`, rather than in
 * `os.tmpdir()`. Both halves of that are load-bearing, and both were
 * measured rather than guessed:
 *
 *  - Inside the repo, because a project resolves its rows' packages by
 *    ordinary node resolution from its own directory (`readPackageJson` in
 *    `engine/ide/host/src/resolvePackage.ts`) and vite serves each row's
 *    runtime half over `/@fs/<realpath>`, which is confined to the vite
 *    workspace root. A copy under `/var/folders/...` has neither: every row
 *    resolves to `null` and the game composes nothing at all.
 *  - At the same DEPTH, because the project carries its own relative paths
 *    — `tsconfig.json` extends `../../../tsconfig.base.json`, which vite's
 *    esbuild transform reads for every `.ts` it serves. One level off and
 *    every module 500s.
 *
 * `engine/examples/e8-compose-*` is gitignored. Callers remove the copy in
 * a `finally`.
 */
export interface ProjectCopyOptions {
  /**
   * Append a patch row with this id — a row a human wrote into
   * `e8.patch.yml` by hand, addressing nothing any bundle placed and
   * carrying no `name` to insert one.
   *
   * The copy then resolves with exactly ONE project diagnostic, whose
   * `plugin` is this id (`Diagnostic.plugin`'s namespace 1 — a composition
   * row id), and with its rows otherwise untouched: the row is dropped, so
   * the game composes and plays exactly as the unmodified fixture does.
   *
   * It exists for `diagnostics.spec.ts`'s namespace test, which needs one
   * id to occur on BOTH sides of the panel — and `session` is the word the
   * design spec picks for that, because a running game's own session seam
   * reports under exactly that name (see `Diagnostic.plugin`'s doc).
   */
  patchRowId?: string;

  /**
   * Append a `remove: true` patch row for this id — the mirror image of
   * `patchRowId`, just above: instead of addressing an id nothing placed,
   * this addresses one the bundle already did, and takes it back out.
   *
   * Appended AFTER the fixture's own rows, never written in place of them,
   * for the same reason `patchRowId` appends rather than replaces — and
   * appending is enough to win: `resolveComposition`
   * (`engine/core/project/src/index.ts`) walks one patch layer's rows in
   * FILE ORDER against a single map, so a `remove: true` entry that comes
   * after an earlier entry for the same id (the fixture's own `reels1`
   * row, config and all) simply overwrites what that earlier entry did.
   * No hand-edited YAML in a spec file, and no wholesale second copy of
   * `e8.patch.yml` — this fixture already owns knowing how the file is
   * shaped, which is the same reason `patchRowId` exists.
   *
   * It exists for `declared.spec.ts`'s "names both" test. Removing
   * `reels1` this way drops the one row that provides the `board`
   * service — legal composition on its own, nothing throws — and is
   * exactly the case `@energy8engine/play-loop`'s `e8.runtime.requires:
   * ["board"]` (task 1) and `createGame`'s post-composition check (task
   * 2) exist to catch: `playloop1` still applies, finds nothing behind
   * `ctx.board`, and the resulting diagnostic names both the service and
   * the row that needed it.
   */
  removeRowId?: string;

  /**
   * Overwrite `game/spec.json`'s own `id` field before the host ever
   * reads it — the same edit `diagnostics.spec.ts` makes inline, in three
   * places, to stage a failure without touching the composition at all.
   * Generalized here rather than copied a fourth time.
   *
   * The project scope reads this id straight off the project (the way
   * the CLI used to) and hands it to `session-dev` as the game to load, so a value
   * nothing under `--games-dir` answers to turns every `POST /api/spin`
   * into a failure INSIDE THE HOST PROCESS — a different producer, and a
   * different kind of failure, than anything a patch row can stage: the
   * game itself still boots to `ready` (the id is only consulted once a
   * spin is actually played), and what fails is a process this page never
   * runs in. It exists for `declared.spec.ts`'s test of the one producer
   * that, before task 6, never reached the running game's own list.
   */
  specId?: string;

  /**
   * Insert a SECOND editor-side row naming `screen-demo` — the project
   * already carries `screendemo1` in its own `e8.yml`, so this makes two
   * rows importing that one client half.
   *
   * That half registers its button and document under a key HARDCODED in
   * it (`'demo'`, `plugins/screen-demo/src/client.js`), never derived from
   * the row id. So the second row's `apply` calls `ctx.slots.register({
   * name: 'shell.activity', key: 'demo', … })` over a key that is already
   * taken, and that is exactly the collision `@energy8engine/registry`'s
   * last-wins policy (task 3) exists to REPORT rather than silently allow
   * — see `plugins/slots.tsx`'s own comment for why that collection stays
   * a replace, not a refusal, and reports the replace anyway.
   *
   * **Two rows of the same CLIENT-ONLY package, both enabled.** This used
   * to stage the same collision through `e8-example-probe` and its
   * `composition.card` slot key, with the second row `disabled: true` —
   * which worked only because a disabled row's client half was imported
   * and applied anyway, the very defect the final review found. Now it is
   * not, so a disabled row stages nothing at all. Enabling both probe rows
   * instead was rejected: that package's SERVER half calls
   * `ctx.provide('probe', …)`, cordis refuses a second provider, and the
   * refusal arrives as an unhandled rejection the host can only recognize
   * after the fact (see `composition.ts`'s own comment on
   * `ensureUnhandledRejectionGuard`) — a race that crashed the host under
   * Playwright when it was last tried. `screen-demo` declares no
   * `e8.runtime` at all, so there is no server half to collide, and both
   * rows can simply be on.
   */
  duplicateScreenId?: boolean;
}

export function projectCopy(options: ProjectCopyOptions = {}): string {
  const dir = mkdtempSync(join(EXAMPLES, 'e8-compose-'));
  cpSync(FIXTURE, dir, {
    recursive: true,
    // The fixture's `node_modules` holds nothing but vite's own
    // optimize-deps cache. Copying it hands the new server a cache keyed
    // to a different root — the stale-bundle trap; let vite build its own.
    // (This also skips `plugins/reel-step/node_modules`, which is the same
    // kind of thing and resolves fine from the repo root without it.)
    filter: (src) => !src.endsWith('/node_modules'),
  });
  // Appended rather than written over the whole file, so every row the
  // fixture already carries — and every reason its comments give for them —
  // stays exactly as it is. The one thing that changes is the one thing the
  // caller asked for.
  if (options.patchRowId) {
    appendFileSync(join(dir, 'e8.patch.yml'), `  - id: ${options.patchRowId}\n    config: {}\n`);
  }
  if (options.removeRowId) {
    appendFileSync(join(dir, 'e8.patch.yml'), `  - id: ${options.removeRowId}\n    remove: true\n`);
  }
  if (options.specId) {
    const specFile = join(dir, 'game', 'spec.json');
    const spec = JSON.parse(readFileSync(specFile, 'utf8')) as Record<string, unknown>;
    writeFileSync(specFile, JSON.stringify({ ...spec, id: options.specId }, null, 2));
  }
  if (options.duplicateScreenId) {
    appendFileSync(join(dir, 'e8.yml'), '\n- id: screendemo2\n  name: screen-demo\n  config: {}\n');
  }
  return dir;
}

/**
 * A real 1x1 PNG — the same bytes `engine/ide/host/tests/fixtures/files
 * /with-png/art/logo.png` carries — so a real browser hands a screen an
 * actual image file rather than an empty stub with a `.png` name glued on.
 * Here rather than in `assets.spec.ts`, where it started, because
 * `shell.spec.ts` stages the same file on disk.
 */
export const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b' +
    '4944415478da6364f80f00010501012718e3660000000049454e44ae426082',
  'hex',
);

/**
 * How long a game may take to come up: `page.goto(gameUrl)` → `#status`
 * holds text (spec §9's readiness — the same span `e8 shot` reports as
 * `loadMs`). A number from a measurement, not from a head (spec §3):
 * `runtime.spec.ts`'s first test, run three times alone on 2026-09-16
 * (Apple M4 Max, 36 GB, macOS 26.6.2, node 22.16, Playwright 1.63.0,
 * the checked-in `first-slot` with a warm vite cache): **819, 808, 809
 * ms**. Median 809 × 3 = 2427, rounded up to the nearest 500. Shared by
 * `runtime.spec.ts` (Playwright's own load) and `headless.spec.ts` (the
 * CLI's `loadMs`), so both measure against one number.
 *
 * Halving it (1250) would still clear the median, so a budget mutation
 * that is meant to go red has to go well under 809, not to half.
 *
 * `E8_LOAD_BUDGET_MS` overrides it for a machine this number was not
 * measured on (CI, a laptop on battery) — an override, not a re-measure:
 * the number in the file stays the one from the measurement above.
 */
export const LOAD_BUDGET_MS = Number(process.env.E8_LOAD_BUDGET_MS) || 2500;

export interface DevHost {
  /** The IDE host's own origin (5679) — `/api/*`, `/ide`, `/plugin-client`. */
  url: string;
  /** Origin of the running GAME — its own server (spec §6), a free port here; never the host's 5679. */
  gameUrl: string;
  stop(): Promise<void>;
}

/**
 * Boots `e8 dev` in `dir`: the same host `engine/apps/cli/src/index.ts`'s
 * `dev` command boots — in process rather than by spawning the CLI. `dir`
 * holds `e8.yml`, so it is the one project and opens at boot; its scope
 * reads `game/spec.json` and brings `dev-game` up itself.
 *
 * Port 5679 is fixed, not incidental: it is the target `vite.config.ts`'s
 * dev-server proxy hardcodes, so a spec that goes through the IDE on 5680
 * needs the host to be exactly there. `playwright.config.ts` runs this
 * suite with `workers: 1` for the same reason — one fixed-port host at a
 * time — and `stop()` awaits the fiber's disposal, which closes the HTTP
 * server, so the next spec file may bind 5679 the moment it resolves.
 */
export async function startDevHost(dir: string): Promise<DevHost> {
  const host: IdeHost = await createIdeHost({ root: dir, port: 5679, previewPort: 0 });
  return {
    url: host.url,
    gameUrl: host.ctx.workspace.state().previewUrl!,
    stop: () => host.stop(),
  };
}

/**
 * A temp ROOT that is not a project, holding `n` copies of `first-slot` as
 * `slot-1..n` — what `e8` (no `dev`) in a folder of projects sees (spec
 * §3/§4). Same place and same reasons as `projectCopy`, plus one thing a
 * copy one level DEEPER needs: every `tsconfig.json` in the fixture (its
 * own, and `plugins/reel-step`'s — `TSCONFIGS`) extends
 * `tsconfig.base.json` by RELATIVE path, which vite's esbuild transform
 * reads for every `.ts` it serves, so each copy's `extends` is rewritten
 * to the absolute path (measured: one level off and every module 500s —
 * `projectCopy`'s doc; the plugin's was the second one to, on the first run).
 * The shipped template needs none of this: its `tsconfig.json` is
 * self-contained (`template.test.ts` pins it), so a project the host
 * creates under this root boots as it is.
 *
 * The second copy differs in TWO measured ways, one per reader:
 *  - `game/spec.json` gets `name: 'Second Slot'` — what the HOST's
 *    `projectName` reads for the sidebar and the status bar. (The
 *    checked-in spec has no `name` at all, so `slot-1` is listed under
 *    its id.)
 *  - `index.html`'s `<title>` becomes `Second Slot — e8 dev` — the one
 *    thing the running GAME shows that a spec field does not drive:
 *    `spec.json` is "not read by e8-server or this task's runtime" (its
 *    own `note`), `#status` reads `ready`/`done` for both, and the only
 *    spec field the scope forwards (`betLevels[0]`) is never rendered.
 */
const TSCONFIGS = ['tsconfig.json', 'plugins/reel-step/tsconfig.json'];

/** Rewrites `file`'s relative `extends` to where it resolved from `originalDir`. */
function absolutizeExtends(file: string, originalDir: string): void {
  const tsconfig = JSON.parse(readFileSync(file, 'utf8')) as { extends: string };
  tsconfig.extends = join(originalDir, tsconfig.extends);
  writeFileSync(file, JSON.stringify(tsconfig, null, 2));
}

export function workspaceCopy(n: number): string {
  const root = mkdtempSync(join(EXAMPLES, 'e8-compose-'));
  for (let i = 1; i <= n; i++) {
    const dir = join(root, `slot-${i}`);
    cpSync(FIXTURE, dir, { recursive: true, filter: (src) => !src.endsWith('/node_modules') });
    for (const rel of TSCONFIGS) absolutizeExtends(join(dir, rel), join(FIXTURE, dirname(rel)));
    if (i === 2) {
      const specFile = join(dir, 'game', 'spec.json');
      const spec = JSON.parse(readFileSync(specFile, 'utf8')) as Record<string, unknown>;
      writeFileSync(specFile, JSON.stringify({ ...spec, name: SECOND_NAME }, null, 2));
      const htmlFile = join(dir, 'index.html');
      writeFileSync(
        htmlFile,
        readFileSync(htmlFile, 'utf8').replace('<title>first-slot', `<title>${SECOND_NAME}`),
      );
    }
  }
  return root;
}

/** What `workspaceCopy`'s second project is called — in its spec and in its page title. */
export const SECOND_NAME = 'Second Slot';

export interface WorkspaceHost {
  /** The IDE host's own origin (5679). */
  url: string;
  /** Where the OPEN project's game is served; `null` while none is. */
  previewUrl(): string | null;
  stop(): Promise<void>;
}

/**
 * Boots `e8` over `root` — a folder OF projects, so nothing opens at boot
 * and `previewUrl()` starts `null`. Port 5679 for the reason
 * `startDevHost` gives; `previewPort: 0` so the game lands on a free port
 * and never fights another spec's 5681 — a test that needs the SAME port
 * across a switch (workspace.spec's fixed-port case) passes its own.
 */
export async function startHost(
  root: string,
  options: Pick<Parameters<typeof createIdeHost>[0], 'ideDist' | 'previewPort'> = {},
): Promise<WorkspaceHost> {
  const host: IdeHost = await createIdeHost({ root, port: 5679, previewPort: 0, ...options });
  return {
    url: host.url,
    previewUrl: () => host.ctx.workspace.state().previewUrl,
    stop: () => host.stop(),
  };
}

/**
 * The pids of every `e8-server` alive right now — counted by
 * `workspace.spec.ts` across a switch, and killed by `debts.spec.ts` to
 * stage a death. `pgrep` runs WITHOUT a shell and on the binary's own argv
 * shape (`--games-dir` follows the name): a bare `e8-server` pattern also
 * matched the shell that launched Playwright whenever ITS command line
 * mentioned the word (measured: two extra pids).
 */
export function serverPids(): number[] {
  try {
    // POSIX ERE — macOS pgrep has no `\S`/`\d`.
    return execFileSync('pgrep', ['-f', 'e8-server[^ ]* --port [0-9]+ --games-dir '], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .map(Number);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}
