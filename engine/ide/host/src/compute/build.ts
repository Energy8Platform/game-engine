/**
 * `e8 build` — a static `dist/` from a composed project (spec §6). One
 * rule, the same as `check`/`spin`/`shot`: every failure is a diagnostic
 * in the result, never a throw, and the host booted here is stopped
 * whatever happened.
 *
 * Four steps. (1) Boot the host `e8 dev` boots over `cwd` — minus its game
 * server (`previewPort: null`) — and read `/api/composition` off it: the
 * SAME resolution the page gets, host diagnostics included. (2) Read `/api/flow`, `/api/scenes`, `/api/symbols`
 * as text and write them under `dist/api/` byte for byte: the rows fetch
 * those same-origin URLs, so a static server answering with these files
 * is, to a row, the dev host. The composition is written the same way with
 * one edit per row — `runtimeUrl` becomes the row ID (what the bundled
 * `virtual:e8-rows` map is keyed by; `null` when the row has no runtime
 * half) and `clientUrl` is `null` (nothing serves an editor half). (3)
 * `vite build` over the project with `viteRows(map)` supplying that
 * module, and `import.meta.env.E8_TARGET` defined so `createGame`'s seam
 * choice (`session-sdk` under `platform`) is baked in. The page and the
 * `api/` files land in the same `dist/`; vite's `emptyOutDir` runs first,
 * so the files are written AFTER it. (4) `assets/` copied whole — the
 * documents name assets by relative path, nothing in the bundle
 * references them statically.
 *
 * All four reads go to the host's root server. The game's own preview
 * server, when there is one, answers the same routes through the same
 * handler functions (`attachGameRoutes` registers the very closures the
 * root has), so the bytes are the page's bytes.
 *
 * Nothing serves `dist/` — any static server does. `dist/api/*` are frozen
 * at build time; an edit to a `.yml` needs a rebuild (spec §10).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { build as viteBuild } from 'vite';
import {
  diagnostic,
  type Diagnostic,
  type GameCompositionResponse,
} from '@energy8engine/contracts';
import { createIdeHost, type IdeHost } from '../index';
import { runtimeEntryMap } from '../plugins/runtime-assets';
import { viteRows } from '../vite-rows';

export interface BuildInput {
  /** Project directory — the host's `root`, as with `e8 dev`. */
  cwd: string;
  /** `import.meta.env.E8_TARGET` in the bundle — `createGame`'s `buildTarget`. Default: unset. */
  target?: string;
  /** Vite's `base` — where `dist/` will be served from. Default `/`. */
  base?: string;
  /** Output directory, relative to `cwd`. Default `dist`. */
  out?: string;
}

export interface BuildResult {
  /** The absolute output directory. */
  out: string;
  /** Every file under `out`, relative to it, posix-separated, sorted. */
  files: string[];
  diagnostics: Diagnostic[];
}

/** The documents the rows fetch same-origin at boot — frozen under `dist/api/`. */
const DOCUMENTS = ['flow', 'scenes', 'symbols'] as const;

export async function build(input: BuildInput): Promise<BuildResult> {
  const cwd = resolve(input.cwd);
  const out = resolve(cwd, input.out ?? 'dist');
  const diagnostics: Diagnostic[] = [];
  const failed = (step: string, error: unknown) =>
    diagnostics.push(
      diagnostic('error', 'build', step, error instanceof Error ? error.message : String(error)),
    );
  const result = (): BuildResult => ({ out, files: existsSync(out) ? filesUnder(out) : [], diagnostics });

  let host: IdeHost;
  try {
    // `previewPort: null`: the four reads below are the root server's; a
    // game server (vite, a spawned e8-server) would only be started to be
    // stopped a second later — and vite closed mid dependency-scan logs a
    // page of esbuild errors on the way out (measured).
    host = await createIdeHost({ root: cwd, port: 0, previewPort: null });
  } catch (error) {
    failed(cwd, `the host did not start: ${error instanceof Error ? error.message : String(error)}`);
    return result();
  }
  let composition: GameCompositionResponse | null = null;
  const documents = new Map<string, string>();
  try {
    // The same two refusals `shot` makes, in the same words: a folder that
    // is not a project, or one whose scope did not come up.
    const state = host.ctx.workspace.state();
    if (state.active === null) {
      diagnostics.push(
        ...state.diagnostics,
        diagnostic(
          'error',
          'build',
          cwd,
          existsSync(join(cwd, 'e8.yml'))
            ? 'the project did not start'
            : `${cwd} is not a project (no e8.yml)`,
        ),
      );
      return result();
    }

    const read = async (path: string): Promise<string> => {
      const res = await fetch(`${host.url}${path}`);
      if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
      return res.text();
    };
    try {
      composition = JSON.parse(await read('/api/composition')) as GameCompositionResponse;
      diagnostics.push(...composition.diagnostics);
    } catch (error) {
      failed('/api/composition', error);
    }
    for (const name of DOCUMENTS) {
      try {
        documents.set(name, await read(`/api/${name}`));
      } catch (error) {
        failed(`/api/${name}`, error);
      }
    }
  } finally {
    // Everything the host is for has been read; the bundle needs no server.
    await host.stop();
  }
  const map = composition ? runtimeEntryMap(cwd, composition.rows) : new Map<string, string>();

  // `NODE_ENV` decides `import.meta.env.DEV`/`PROD` — vite reads it, not
  // `mode` (`isProduction = process.env.NODE_ENV === 'production'`), and it
  // only defaults it to `production` for a build when nothing set it. In
  // THIS process something did: the host's `dev-game` created a dev server
  // moments ago, which set `development` for the whole process (vite's own
  // `resolveConfig`), and a test runner sets `test`. Measured: without
  // this the bundle kept `import.meta.env.DEV` true — the page's dev-only
  // branch (the IDE bridge) came along, and pixi shipped its development
  // build. Set for the build's duration and put back after.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await viteBuild({
      root: cwd,
      base: input.base ?? '/',
      logLevel: 'silent',
      configFile: false,
      define: { 'import.meta.env.E8_TARGET': JSON.stringify(input.target ?? '') },
      plugins: [viteRows(map)],
      // `es2022`, not vite's `modules` default (chrome87/es2020): the page
      // is a top-level-await module (`const game = await createGame(...)`),
      // and esbuild refuses TLA below es2022 — the projects' tsconfig
      // target. `emptyOutDir` explicitly, so an `--out` outside the
      // project is cleared too (vite only warns for one by default).
      //
      // TWO chunks — the page, and everything else — not Rollup's own
      // split, and not one file either. Measured, both: with Rollup's
      // split the page hung forever after fetching its first row chunk;
      // with `inlineDynamicImports` every row failed with "Cannot access
      // 'X' before initialization". One cause: the entry is a top-level-
      // await module, parked at `await createGame(...)` when it imports a
      // row. Rollup puts every module the rows share with the page
      // (`diagnostics`, `contracts`, cordis) INTO the entry chunk, so a
      // row chunk statically imports the entry, whose evaluation cannot
      // complete until the row's does — a cycle. In one file the rows'
      // declarations sit AFTER the entry's `await` and are in their TDZ
      // when the row namespace is read. So: the entry chunk holds only the
      // entry itself (vite's proxy for `index.html` — `import "/src/
      // main.ts"`; assigning THAT to a manual chunk makes the manual chunk
      // the entry and everything one file again, measured), the page's own
      // `src/` modules and vite's `\0`-prefixed helpers (the
      // `virtual:e8-rows` map among them); every other module — rows,
      // engine packages, node_modules, the project's own `plugins/` — is
      // the `game` chunk, a plain module the entry imports statically and
      // the row map imports dynamically, which never imports the entry
      // back. Per-row code-splitting is lost, and buys nothing: every row
      // applies at boot; only a seam's losing candidate is code nobody
      // runs.
      build: {
        outDir: out,
        emptyOutDir: true,
        target: 'es2022',
        rollupOptions: {
          output: {
            manualChunks: (id, { getModuleInfo }) =>
              getModuleInfo(id)?.isEntry ||
              id.startsWith(join(cwd, 'src') + sep) ||
              id.startsWith('\0')
                ? undefined
                : 'game',
          },
        },
      },
    });
  } catch (error) {
    failed('vite', error);
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }

  // After vite: `emptyOutDir` would have taken these with it.
  const write = (rel: string, body: string) => {
    const file = join(out, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  };
  if (composition) {
    write(
      'api/composition',
      JSON.stringify({
        ...composition,
        rows: composition.rows.map((row) => ({
          ...row,
          runtimeUrl: map.has(row.id) ? row.id : null,
          clientUrl: null,
        })),
      }),
    );
  }
  for (const [name, body] of documents) write(`api/${name}`, body);

  const assets = join(cwd, 'assets');
  if (existsSync(assets)) {
    try {
      cpSync(assets, join(out, 'assets'), { recursive: true });
    } catch (error) {
      failed('assets', error);
    }
  }
  return result();
}

/** Every file under `dir`, relative to it, posix-separated, sorted. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .map((rel) => rel.split(sep).join('/'))
    .sort();
}
