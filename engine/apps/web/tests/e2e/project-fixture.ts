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
import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdeHost, type IdeHost } from '@energy8engine/ide-host';
import * as devGame from '@energy8engine/ide-host/dev-game';

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
   * `startDevHost` reads this id straight off the project (see its own
   * doc) and hands it to `session-dev` as the game to load, so a value
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
   * Insert two editor-side rows into `e8.yml`, both naming
   * `e8-example-probe` (`engine/examples/probe-plugin` — the same package
   * `examples/workspace/e8.yml` composes ONE of, and `skeleton.spec.ts`
   * already proves renders live, card text and all) — the second one
   * `disabled: true`.
   *
   * That package's client half (`src/client.js`) registers into the
   * `composition.card` slot under a key HARDCODED in that file —
   * `'probe'` — never derived from the row id, and never consulting
   * whether the ROW is disabled: `modules.ts` imports and applies a row's
   * `clientUrl` on its `clientUrl` alone, and a disabled entry's manifest
   * — hence its `clientUrl` — resolves exactly the same as an enabled
   * one's (`composition.ts`'s snapshot reads the package, not the fiber).
   * So two rows importing the same module both call
   * `ctx.slots.register({ name: 'composition.card', key: 'probe' }, …)`
   * with the identical key, and the second call is exactly the collision
   * `@energy8engine/registry`'s last-wins policy (task 3) exists to REPORT
   * rather than silently allow — see `plugins/slots.tsx`'s own comment for
   * why that collection stays a replace, not a refusal, and reports the
   * replace anyway.
   *
   * `disabled: true` is load-bearing, not decoration. That package's
   * SERVER half (`src/index.ts`) also calls `ctx.provide('probe', …)`,
   * and cordis refuses a second provider of a service already provided —
   * fine for ONE extra row (`composition.ts`'s per-entry failure tracking
   * turns that into a plain `apply` diagnostic, same as any other broken
   * row), except that the failure is delivered by an UNHANDLED REJECTION
   * the host can only recognize AFTER THE FACT (see that file's own long
   * comment on `ensureUnhandledRejectionGuard`), which measured out as a
   * genuine, occasional race against Node's own unhandled-rejection
   * detection — this fixture crashed the host process under Playwright on
   * exactly this timing before `disabled: true` was added, even though a
   * standalone repro of the same two rows (no Playwright involved) did
   * not. A disabled entry never applies at all — no fiber runs, no second
   * `ctx.provide`, nothing to race — so the ONLY collision left is the one
   * this option exists to stage, on the browser side, every time.
   */
  duplicateSlotKey?: boolean;
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
  if (options.duplicateSlotKey) {
    appendFileSync(
      join(dir, 'e8.yml'),
      '\n- id: probe1\n  name: e8-example-probe\n  config: {}\n' +
        '- id: probe2\n  name: e8-example-probe\n  disabled: true\n  config: {}\n',
    );
  }
  return dir;
}

export interface DevHost {
  /** Origin of the running GAME — `dev-game`'s catch-all owns `/` on the host's own port. */
  gameUrl: string;
  stop(): Promise<void>;
}

/**
 * Boots `e8 dev` in `dir`: the same host, with the same `dev-game` on top,
 * that `engine/apps/cli/src/index.ts`'s `dev` command boots — in process
 * rather than by spawning the CLI.
 *
 * Port 5679 is fixed, not incidental: it is the target `vite.config.ts`'s
 * dev-server proxy hardcodes, so a spec that goes through the IDE on 5680
 * needs the host to be exactly there. `playwright.config.ts` runs this
 * suite with `workers: 1` for the same reason — one fixed-port host at a
 * time — and `stop()` awaits the fiber's disposal, which closes the HTTP
 * server, so the next spec file may bind 5679 the moment it resolves.
 */
export async function startDevHost(dir: string): Promise<DevHost> {
  const gamesDir = join(dir, 'game');
  // Read from the project, the way the CLI does — not hardcoded here, so
  // a fixture that renamed its game could not silently keep passing.
  const spec = JSON.parse(readFileSync(join(gamesDir, 'spec.json'), 'utf8')) as {
    id: string;
    betLevels?: number[];
  };
  const host: IdeHost = await createIdeHost({ cwd: dir, port: 5679 });
  await host.ctx.plugin(devGame, {
    root: dir,
    gamesDir,
    gameId: spec.id,
    betLevel: spec.betLevels?.[0] ?? 1,
    port: 0,
  });
  return { gameUrl: host.url, stop: () => host.stop() };
}
