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
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
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
export function projectCopy(): string {
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
