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
 * at build time; an edit to a `.yml` needs a rebuild (spec §10). `--base`
 * moves the page's own assets only: the rows fetch `/api/*` at the origin
 * root whatever the base, so a base other than `/` is a warning here —
 * serve `dist/api` at the root, or proxy it.
 *
 * `logLevel: 'silent'` keeps vite off stdout (the CLI's contract is one
 * JSON document there) — and it swallows rollup's own warnings with the
 * rest: a chunk over the size limit, a circular import. A failed build
 * still surfaces, as the `vite` diagnostic; a warning does not.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { build as viteBuild, normalizePath } from 'vite';
import {
  diagnostic,
  type Diagnostic,
  type GameCompositionResponse,
} from '@energy8engine/contracts';
import { createIdeHost, type IdeHost } from '../index';
import { runtimeEntryMap } from '../plugins/runtime-assets';
import { ROWS_ID, viteRows } from '../vite-rows';

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
const DOCUMENTS = ['flow', 'scenes', 'symbols', 'spec'] as const;

export async function build(input: BuildInput): Promise<BuildResult> {
  // Real-pathed, because vite's module ids are: `manualChunks` below
  // compares them against this directory, and a root reached through a
  // symlink (or spelled with a different case) would otherwise put the
  // page itself into the `game` chunk — the TLA cycle that layout exists
  // to avoid. A directory that is not on disk keeps its lexical form; the
  // host says "not a project" about it a few lines down.
  const cwd = realpath(resolve(input.cwd));
  // Real-pathed too, or the guard below compares a symlink's spelling
  // against the physical project: `--out /link/proj` with `/link/proj →
  // <cwd>` read as a sibling (`relative` gave `../real-proj`) and vite's
  // `emptyDir` followed the link into the real project. A `dist/` that
  // does not exist yet resolves through its deepest existing ancestor.
  const out = realpath(resolve(cwd, input.out ?? 'dist'));
  const diagnostics: Diagnostic[] = [];
  const failed = (step: string, error: unknown) =>
    diagnostics.push(
      diagnostic('error', 'build', step, error instanceof Error ? error.message : String(error)),
    );
  const result = (): BuildResult => ({ out, files: existsSync(out) ? filesUnder(out) : [], diagnostics });

  // Before anything else: vite's `emptyOutDir` empties `out` the moment
  // the bundle succeeds, so an `--out` that IS the project, or contains it
  // (`.`, `..`, an ancestor), would delete the project — measured: `--out
  // .` left `api assets index.html` and nothing else. `relative(out, cwd)`
  // is `''` for the project itself and a plain child path for an ancestor;
  // `dist` (inside the project) comes back as `..` and passes.
  const rel = relative(out, cwd);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return {
      out,
      files: [],
      diagnostics: [
        diagnostic(
          'error',
          'build',
          out,
          '--out contains the project itself; the output directory is emptied first',
        ),
      ],
    };
  }
  const base = input.base ?? '/';
  if (base !== '/') {
    diagnostics.push(
      diagnostic(
        'warning',
        'build',
        '--base',
        'the rows fetch /api/* at the origin root — serve dist/api there or proxy it',
      ),
    );
  }
  // No `--target`: the bundle bakes in no session seam (`createGame`'s
  // `buildTarget` is `undefined`), so nothing in it can answer
  // `/api/session`/`/api/spin` on its own — said once, as `info` (this is
  // a normal, supported build — e.g. dist/ served in front of a running
  // dev host, or a static preview), never as an `error`.
  if (input.target === undefined) {
    diagnostics.push(
      diagnostic(
        'info',
        'build',
        '--target',
        'the default target has no session: serve /api/session and /api/spin from a host, or build with --target platform',
      ),
    );
  }

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
  // Vite's ids are posix and real-pathed; so is this prefix (`cwd` above).
  const src = normalizePath(join(cwd, 'src')) + '/';
  let built = false;
  try {
    await viteBuild({
      root: cwd,
      base,
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
      // `src/` modules and the `virtual:e8-rows` map the page imports;
      // every other module — rows, engine packages, node_modules, the
      // project's own `plugins/`, vite's own `\0` helpers — is the `game`
      // chunk, a plain module the entry imports statically and the row map
      // imports dynamically, which never imports the entry back. The
      // helpers go with the rest on purpose: one that both chunks needed,
      // forced into the entry, would be `game → entry` again. Per-row
      // code-splitting is lost, and buys nothing: every row applies at
      // boot; only a seam's losing candidate is code nobody runs.
      build: {
        outDir: out,
        emptyOutDir: true,
        target: 'es2022',
        rollupOptions: {
          output: {
            manualChunks: (id, { getModuleInfo }) =>
              getModuleInfo(id)?.isEntry || id === ROWS_ID || id.startsWith(src)
                ? undefined
                : 'game',
          },
        },
      },
    });
    built = true;
  } catch (error) {
    failed('vite', error);
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  // A bundle that failed leaves what vite left — never a `dist/` that has
  // everything but the page and looks mostly built.
  if (!built) return result();

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

/**
 * The physical path of `path` — `realpathSync`, or, for a path that is not
 * on disk yet, its deepest EXISTING ancestor real-pathed with the rest
 * re-appended (a `dist/` still to be created under a symlinked project
 * names the project's physical directory). The path as given only when
 * nothing along it exists, or the real-path itself fails: `build()` never
 * throws, and the host says "not a project" about such a `cwd` anyway.
 */
function realpath(path: string): string {
  const rest: string[] = [];
  let dir = path;
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return path;
    rest.unshift(basename(dir));
    dir = parent;
  }
  try {
    return join(realpathSync(dir), ...rest);
  } catch {
    return path;
  }
}

/** Every file under `dir`, relative to it, posix-separated, sorted. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .map((rel) => rel.split(sep).join('/'))
    .sort();
}
