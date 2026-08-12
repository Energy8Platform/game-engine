/**
 * `artubePlugin` — one-command dev loop for an Artube game.
 *
 * The Artube target has always been two processes: a Vite dev server for the
 * frontend and `artube-server` for the game's own backend. Nothing enforced
 * the second one, so forgetting it produced a page that opened
 * `ws://localhost:5173/api/ws`, got a dead proxy, and reported
 * `ArtubeBackendError: ws error` — a message that names neither the address
 * nor the missing process. This plugin removes that failure mode by owning
 * the backend: it starts one, waits until it is actually serving, points the
 * dev server's `/api` proxy at it, and kills it when the dev server closes.
 *
 * The mechanics are lifted from `platform-core`'s `spinPlugin` (the same
 * repo already spawns `e8-server` this way), including the parts that exist
 * because they bit someone:
 *  - the port is *scanned*, not fixed, so two games can `npm run dev:artube`
 *    at once instead of the second one silently proxying into the first
 *    one's backend (a different game's math);
 *  - the readiness wait watches for the child dying, so a backend that
 *    cannot start fails in a second instead of after the full timeout;
 *  - the child is killed on dev-server close, so a stale backend does not
 *    outlive the terminal that started it.
 *
 * `apply: 'serve'` — it can never take part in `vite build`.
 *
 * NOT run in-process. The backend is a separate service with its own
 * lifecycle, its own structured logs and its own engine subprocess; hosting
 * it inside Vite would tangle the two and hide its logs.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { Plugin } from 'vite';

/** Public Artube sandbox GamesAPI — same value the CLI's `--sandbox` uses. */
export const SANDBOX_GAMES_API_URL = 'wss://gamesapi-sandbox.artube-888.live/v1/ws';

/**
 * The sandbox integration's `publicGameId`. Every sandbox tenant in the
 * public environment is created as `game1`, so this is the default that makes
 * a freshly scaffolded game playable with no configuration at all. It is only
 * ever used in sandbox mode — against a real GamesAPI the id is assigned by
 * the platform and must be given.
 */
export const SANDBOX_GAME_ID = 'game1';

/** Where the port scan starts. Historically the documented dev port. */
export const DEFAULT_ARTUBE_DEV_PORT = 8080;

/** How many ports we try from the base before giving up. */
const PORT_SCAN_RANGE = 32;

/** Attempts to survive the probe-then-bind race (same shape as `spinPlugin`). */
const START_ATTEMPTS = 3;

/** How long a backend gets to answer `/livez` before we call the start failed. */
const READY_TIMEOUT_MS = 45_000;

/** Lines of child output kept for the failure message. */
const OUTPUT_TAIL_LINES = 40;

export interface ArtubePluginOptions {
  /**
   * The game's `.spin` math — file or directory. Relative paths resolve
   * against the Vite root. Default `./src/game/script.spin`, which is where
   * `create-slot` puts it.
   */
  spinPath?: string;
  /**
   * The platform's `publicGameId` (env `GameId`). Required against a real
   * GamesAPI; in sandbox mode it defaults to {@link SANDBOX_GAME_ID}.
   */
  gameId?: string;
  /**
   * Point at the public sandbox. Defaults to `true` unless an explicit
   * `gamesApiUrl` (or env `GamesApiUrl`) is given.
   */
  sandbox?: boolean;
  /** Explicit GamesAPI URL. Setting it turns `sandbox` off by default. */
  gamesApiUrl?: string;
  /** GamesAPI key (env `GamesApiKey`). Optional in sandbox mode, required otherwise. */
  apiKey?: string;
  /**
   * First port to try for the backend (default `ARTUBE_PORT` →
   * {@link DEFAULT_ARTUBE_DEV_PORT}). If taken, the next free one is used —
   * the plugin owns the port, so nothing else needs to agree on it.
   */
  port?: number;
  /**
   * Escape hatch: don't spawn anything, proxy `/api` at a backend somebody
   * else is running (an IDE debug session, say). `true` uses `ARTUBE_BACKEND`
   * or `http://localhost:8080`; a string is used verbatim. Setting
   * `ARTUBE_BACKEND` alone also implies this.
   */
  external?: boolean | string;
  /** Starting virtual balance for demo sessions (env `DEMO_BALANCE`). */
  demoBalance?: number;
  /** Explicit path to the `artube-server` CLI entry (tests / odd layouts). */
  cliPath?: string;
}

// ── configuration resolution (pure, unit-tested) ─────────────────────────

export interface ResolvedSpawnConfig {
  gameId: string;
  sandbox: boolean;
  gamesApiUrl: string;
  apiKey: string;
  spinPath: string;
  basePort: number;
  demoBalance?: number;
}

type Env = Record<string, string | undefined>;

/**
 * The externally-run-backend target, or `null` when we should spawn our own.
 * `ARTUBE_BACKEND` on its own counts: it is the variable the previous
 * two-terminal template documented, and someone who sets it means "use mine".
 */
export function resolveExternalTarget(
  opts: Pick<ArtubePluginOptions, 'external'> = {},
  env: Env = process.env,
): string | null {
  if (typeof opts.external === 'string') return opts.external;
  if (opts.external === true) return env.ARTUBE_BACKEND ?? `http://localhost:${DEFAULT_ARTUBE_DEV_PORT}`;
  if (opts.external === false) return null;
  return env.ARTUBE_BACKEND ?? null;
}

/**
 * Everything the child needs, with the defaults a scaffolded game relies on.
 * Throws — naming the variable — rather than starting a backend that will
 * fail later in a way the developer has to reverse-engineer.
 */
export function resolveSpawnConfig(
  opts: ArtubePluginOptions = {},
  env: Env = process.env,
  root = process.cwd(),
): ResolvedSpawnConfig {
  const explicitUrl = opts.gamesApiUrl ?? env.GamesApiUrl;
  const sandbox = opts.sandbox ?? !explicitUrl;

  const gameId = opts.gameId ?? env.GameId ?? (sandbox ? SANDBOX_GAME_ID : '');
  if (!gameId) {
    throw new Error(
      '[artube] no GameId. The platform assigns it (publicGameId) — pass ' +
        'artubePlugin({ gameId: "…" }) or set GameId in the environment. ' +
        'Only sandbox mode has a default.',
    );
  }

  const gamesApiUrl = sandbox ? (explicitUrl ?? SANDBOX_GAMES_API_URL) : explicitUrl!;
  if (!gamesApiUrl) {
    throw new Error(
      '[artube] no GamesApiUrl. Pass artubePlugin({ gamesApiUrl: "wss://…" }), ' +
        'set GamesApiUrl in the environment, or use sandbox: true.',
    );
  }

  const apiKey = opts.apiKey ?? env.GamesApiKey ?? '';
  if (!sandbox && !apiKey) {
    throw new Error(
      '[artube] no GamesApiKey. A real GamesAPI authenticates the backend — pass ' +
        'artubePlugin({ apiKey }) or set GamesApiKey. (Sandbox mode does not need one.)',
    );
  }

  const rawSpin = opts.spinPath ?? env.SPIN_PATH ?? './src/game/script.spin';
  const spinPath = isAbsolute(rawSpin) ? rawSpin : resolvePath(root, rawSpin);

  const basePort = opts.port ?? (env.ARTUBE_PORT ? Number(env.ARTUBE_PORT) : DEFAULT_ARTUBE_DEV_PORT);
  if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) {
    throw new Error(`[artube] port must be an integer 1..65535, got ${JSON.stringify(basePort)}`);
  }

  return {
    gameId,
    sandbox,
    gamesApiUrl,
    apiKey,
    spinPath,
    basePort,
    demoBalance: opts.demoBalance ?? (env.DEMO_BALANCE ? Number(env.DEMO_BALANCE) : undefined),
  };
}

/**
 * Argv for the CLI. `--sandbox` is a flag rather than a URL because the CLI
 * uses it to *relax* the `GamesApiUrl`/`GamesApiKey` requirements too.
 */
export function buildChildArgs(cfg: ResolvedSpawnConfig, port: number): string[] {
  const args = ['--spin', cfg.spinPath, '--port', String(port)];
  if (cfg.sandbox && cfg.gamesApiUrl === SANDBOX_GAMES_API_URL) args.push('--sandbox');
  return args;
}

/** Env for the child: the platform's own variable names, nothing else invented. */
export function buildChildEnv(
  cfg: ResolvedSpawnConfig,
  parent: Env = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) if (v !== undefined) env[k] = v;
  env.GameId = cfg.gameId;
  env.GamesApiUrl = cfg.gamesApiUrl;
  env.GamesApiKey = cfg.apiKey;
  if (cfg.demoBalance !== undefined) env.DEMO_BALANCE = String(cfg.demoBalance);
  return env;
}

/**
 * The message a developer reads when the backend did not come up. It has to
 * name the cause, because the alternative — the failure this plugin exists to
 * remove — is a browser saying `ws error` and nothing else.
 */
export function describeStartFailure(opts: {
  reason: string;
  cfg: ResolvedSpawnConfig;
  port: number;
  output: string[];
}): string {
  const tail = opts.output.slice(-OUTPUT_TAIL_LINES).join('\n');
  return [
    `[artube] the game backend did not start: ${opts.reason}`,
    `  spin:      ${opts.cfg.spinPath}`,
    `  GameId:    ${opts.cfg.gameId}`,
    `  GamesAPI:  ${opts.cfg.gamesApiUrl}${opts.cfg.sandbox ? ' (sandbox)' : ''}`,
    `  port:      ${opts.port}`,
    '  Check, in this order: the .spin file exists and loads; an `e8-server` binary is',
    '  installed (@energy8platform/platform-core postinstall, or E8_SERVER_BINARY); the',
    '  GamesAPI URL is reachable and the GameId/GamesApiKey belong to it.',
    '  To use a backend you run yourself instead: ARTUBE_BACKEND=http://localhost:8080.',
    tail ? `--- last output from artube-server ---\n${tail}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ── process plumbing ─────────────────────────────────────────────────────

/**
 * Locate the built CLI. Resolved from this module's own URL rather than
 * `require.resolve`: the package is ESM-only and its `exports` map has no
 * `require` condition, so `require.resolve` throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` here.
 *
 * `dist/src/vite/devPlugin.js` → `../../bin/artube-server.js` is the built
 * layout; the second candidate covers running straight from `src/` inside the
 * monorepo.
 */
export function resolveCliEntry(explicit?: string): string {
  if (explicit) return explicit;
  const candidates = ['../../bin/artube-server.js', '../../../dist/bin/artube-server.js'].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  );
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(
    '[artube] cannot find the artube-server CLI. Build the package ' +
      '(`npm run build --workspace @energy8platform/artube-server`) or pass ' +
      `artubePlugin({ cliPath: "…" }). Looked at:\n  ${candidates.join('\n  ')}`,
  );
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const probe = createServer();
    probe.once('error', () => res(false));
    probe.once('listening', () => probe.close(() => res(true)));
    probe.listen(port, '0.0.0.0');
  });
}

async function findFreePort(start: number, range = PORT_SCAN_RANGE): Promise<number> {
  for (let p = start; p < start + range; p++) if (await isPortFree(p)) return p;
  throw new Error(`[artube] no free port in ${start}..${start + range - 1}`);
}

/** `/livez` answers only once the HTTP server is listening — i.e. fully booted. */
async function isServing(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/livez`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for `/livez`, but give up the moment the child dies — the failure
 * modes that matter here (missing engine binary, unreachable GamesAPI, a
 * `.spin` that will not load) all kill the process, and waiting out the full
 * timeout for them would just delay the message that explains them.
 */
async function waitUntilServing(
  port: number,
  isDead: () => boolean,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<'ready' | 'died' | 'timeout'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isDead()) return 'died';
    if (await isServing(port)) return 'ready';
    await new Promise((r) => setTimeout(r, 200));
  }
  return 'timeout';
}

// ── the plugin ───────────────────────────────────────────────────────────

export function artubePlugin(opts: ArtubePluginOptions = {}): Plugin {
  let child: ChildProcess | null = null;
  let target = '';

  const kill = (): void => {
    if (!child) return;
    const dying = child;
    child = null;
    dying.kill();
  };

  return {
    name: 'artube:backend',
    // Dev only, exactly like `spinPlugin` and `devBridgePlugin`: no production
    // bundle can be affected by anything in this file.
    apply: 'serve',
    enforce: 'pre',

    /**
     * The backend is started here, not in `configureServer`, because the
     * proxy target has to be a settled string by the time Vite builds its
     * config — and the port is only settled once a child has actually bound
     * it. Doing both here also means a broken backend aborts `vite` with the
     * reason, instead of Vite printing a happy URL for a game that cannot play.
     */
    async config(userConfig) {
      const root = resolvePath(userConfig.root ?? process.cwd());
      const external = resolveExternalTarget(opts);

      if (external) {
        target = external;
        console.log(`[artube] using the backend at ${target} (not starting one)`);
      } else {
        const cfg = resolveSpawnConfig(opts, process.env, root);
        if (!existsSync(cfg.spinPath)) {
          throw new Error(
            `[artube] spin math not found: ${cfg.spinPath}\n` +
              '  Pass artubePlugin({ spinPath: "…" }) with the path to the game\'s .spin file.',
          );
        }
        const port = await start(cfg, root);
        target = `http://127.0.0.1:${port}`;
      }

      return {
        server: {
          proxy: {
            // Production serves the game and its backend on ONE origin split
            // by path; the bridge derives its API base from the page origin.
            // Proxying /api keeps dev the same shape. `ws: true` matters —
            // the whole player protocol is the `/api/ws` socket.
            '/api': { target, ws: true, changeOrigin: true },
          },
        },
      };
    },

    configureServer(server) {
      // Vite's own close is the normal path; the process hooks cover the ones
      // that skip it (a `--strictPort` clash exiting before the server ever
      // listens, Ctrl-C, an unhandled throw) — a backend outliving its dev
      // server would hold its port and be proxied into by the next run.
      server.httpServer?.on('close', kill);
      process.once('exit', kill);
      for (const sig of ['SIGINT', 'SIGTERM'] as const) {
        process.once(sig, () => {
          kill();
          process.exit(0);
        });
      }
    },
  };

  async function start(cfg: ResolvedSpawnConfig, root: string): Promise<number> {
    const cli = resolveCliEntry(opts.cliPath);
    let from = cfg.basePort;
    let lastFailure = 'unknown';
    let output: string[] = [];

    for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
      const port = await findFreePort(from);
      if (port !== cfg.basePort) {
        console.log(`[artube] port ${cfg.basePort} is taken → backend on :${port}`);
      }
      console.log(
        `[artube] starting the game backend on :${port} (GameId=${cfg.gameId}, ` +
          `${cfg.sandbox ? 'sandbox' : cfg.gamesApiUrl})`,
      );

      output = [];
      let exited: string | null = null;
      // Piped rather than inherited so the failure message can quote the
      // reason; every line is echoed through, so the terminal still shows the
      // backend's own logs live, as a separate service should.
      const proc = spawn(process.execPath, [cli, ...buildChildArgs(cfg, port)], {
        cwd: root,
        env: buildChildEnv(cfg),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = proc;
      for (const stream of [proc.stdout, proc.stderr]) {
        stream?.setEncoding('utf8');
        stream?.on('data', (chunk: string) => {
          process.stderr.write(chunk);
          for (const line of chunk.split('\n')) if (line.trim()) output.push(line);
        });
      }
      proc.on('error', (err) => {
        exited = err.message;
        output.push(String(err.message));
      });
      proc.on('exit', (code, signal) => {
        exited ??= `artube-server exited (code ${code}, signal ${signal})`;
      });

      const outcome = await waitUntilServing(port, () => exited !== null);
      if (outcome === 'ready') {
        console.log(`[artube] backend ready on :${port} — /api is proxied to it`);
        return port;
      }

      kill();
      lastFailure = outcome === 'died' ? (exited ?? 'the process exited') : 'timed out waiting for /livez';
      // Only a lost port race is worth another port; a bad spin file or an
      // unreachable GamesAPI would fail identically on every one of them, and
      // retrying would only bury the reason under two more copies of it.
      if (!/EADDRINUSE|address already in use|listen tcp/i.test(output.join('\n'))) break;
      from = port + 1;
    }

    throw new Error(
      describeStartFailure({ reason: lastFailure, cfg, port: from, output }),
    );
  }
}
