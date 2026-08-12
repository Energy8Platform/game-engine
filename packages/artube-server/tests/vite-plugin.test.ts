/**
 * `artubePlugin` — the one-command dev loop.
 *
 * The behaviour under test is the one the plugin exists for: `vite` alone
 * must end up with a *running* backend behind `/api`, and when it cannot, the
 * developer must get a message naming the cause instead of a browser saying
 * `ws error`. The spawn/readiness/kill path is exercised against a fake CLI
 * that binds the port it is handed — no GamesAPI, no engine binary, no
 * network — because what this plugin owns is the process lifecycle, not the
 * backend's own behaviour (which the rest of this suite covers).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  artubePlugin,
  artubeDevPlugin,
  buildChildArgs,
  buildChildEnv,
  describeStartFailure,
  resolveExternalTarget,
  resolveSpawnConfig,
  DEFAULT_ARTUBE_DEV_PORT,
  SANDBOX_GAMES_API_URL,
  SANDBOX_GAME_ID,
  type ResolvedSpawnConfig,
} from '../src/vite/index.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'artube-vite-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A game directory with a `.spin` file where the default option points. */
function gameRoot(): string {
  const root = tempDir();
  const spin = join(root, 'src', 'game');
  rmSync(spin, { recursive: true, force: true });
  writeFileSync(join(root, 'script.spin'), 'game "fake" {}\n');
  return root;
}

/**
 * A stand-in for the `artube-server` CLI: binds the `--port` it is given and
 * answers `/livez`, which is exactly the contract the plugin waits on.
 */
function fakeCli(body?: string): string {
  const dir = tempDir();
  const file = join(dir, 'fake-cli.mjs');
  writeFileSync(
    file,
    body ??
      `import { createServer } from 'node:http';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
console.log('fake artube-server starting on ' + port);
createServer((req, res) => {
  res.writeHead(req.url === '/livez' ? 200 : 404, { 'content-type': 'application/json' });
  res.end('{}');
}).listen(port);
`,
  );
  return file;
}

/** Hold a port so the scan has to move past it. */
function occupy(port: number): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, '0.0.0.0', () => {
      cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
      resolve();
    });
  });
}

type ConfigHook = (config: Record<string, unknown>, env: unknown) => Promise<any>;
const runConfig = (plugin: ReturnType<typeof artubeDevPlugin>, root: string) =>
  (plugin.config as unknown as ConfigHook)({ root }, { command: 'serve', mode: 'development' });

/** Minimal Vite dev-server shape: only `httpServer`'s close event is used. */
function fakeServer(): { httpServer: EventEmitter } {
  return { httpServer: new EventEmitter() };
}

const baseCfg: ResolvedSpawnConfig = {
  gameId: 'game1',
  sandbox: true,
  gamesApiUrl: SANDBOX_GAMES_API_URL,
  apiKey: '',
  spinPath: '/games/moon/src/game/script.spin',
  basePort: 8080,
};

describe('resolveExternalTarget — the escape hatch', () => {
  it('treats ARTUBE_BACKEND on its own as "use mine, do not spawn"', () => {
    expect(resolveExternalTarget({}, { ARTUBE_BACKEND: 'http://localhost:9000' })).toBe(
      'http://localhost:9000',
    );
  });

  it('spawns by default', () => {
    expect(resolveExternalTarget({}, {})).toBeNull();
  });

  it('takes an explicit URL, and lets external:false win over the env var', () => {
    expect(resolveExternalTarget({ external: 'http://127.0.0.1:1234' }, {})).toBe(
      'http://127.0.0.1:1234',
    );
    expect(resolveExternalTarget({ external: false }, { ARTUBE_BACKEND: 'http://x' })).toBeNull();
  });

  it('external:true without a URL falls back to the documented dev address', () => {
    expect(resolveExternalTarget({ external: true }, {})).toBe(
      `http://localhost:${DEFAULT_ARTUBE_DEV_PORT}`,
    );
  });
});

describe('resolveSpawnConfig — defaults a scaffolded game can rely on', () => {
  it('defaults to the public sandbox, its GameId, and the create-slot spin path', () => {
    const cfg = resolveSpawnConfig({}, {}, '/games/moon');
    expect(cfg.sandbox).toBe(true);
    expect(cfg.gamesApiUrl).toBe(SANDBOX_GAMES_API_URL);
    expect(cfg.gameId).toBe(SANDBOX_GAME_ID);
    expect(cfg.apiKey).toBe('');
    expect(cfg.spinPath).toBe('/games/moon/src/game/script.spin');
    expect(cfg.basePort).toBe(DEFAULT_ARTUBE_DEV_PORT);
  });

  it('an explicit GamesApiUrl turns sandbox off — and then the key is not optional', () => {
    expect(() => resolveSpawnConfig({ gamesApiUrl: 'wss://real', gameId: 'g' }, {})).toThrow(
      /GamesApiKey/,
    );
    const cfg = resolveSpawnConfig({ gamesApiUrl: 'wss://real', gameId: 'g', apiKey: 'k' }, {});
    expect(cfg.sandbox).toBe(false);
    expect(cfg.gamesApiUrl).toBe('wss://real');
  });

  it('names GameId when there is no sandbox default to fall back on', () => {
    expect(() =>
      resolveSpawnConfig({}, { GamesApiUrl: 'wss://real', GamesApiKey: 'k' }),
    ).toThrow(/GameId/);
  });

  it("reads the platform's own env var names", () => {
    const cfg = resolveSpawnConfig(
      {},
      { GameId: 'g7', GamesApiUrl: 'wss://real', GamesApiKey: 'k', ARTUBE_PORT: '9100' },
      '/games/moon',
    );
    expect(cfg.gameId).toBe('g7');
    expect(cfg.basePort).toBe(9100);
  });

  it('keeps an absolute spin path as given', () => {
    expect(resolveSpawnConfig({ spinPath: '/abs/x.spin' }, {}, '/games/moon').spinPath).toBe(
      '/abs/x.spin',
    );
  });
});

describe('the child process contract', () => {
  it("passes --sandbox only for the sandbox URL — the flag also relaxes the CLI's env checks", () => {
    expect(buildChildArgs(baseCfg, 8081)).toEqual([
      '--spin',
      baseCfg.spinPath,
      '--port',
      '8081',
      '--sandbox',
    ]);
    expect(buildChildArgs({ ...baseCfg, sandbox: false, gamesApiUrl: 'wss://real' }, 8081)).not.toContain(
      '--sandbox',
    );
  });

  it("hands the platform's variables over under the platform's names", () => {
    const env = buildChildEnv({ ...baseCfg, apiKey: 'k', demoBalance: 5000 }, { PATH: '/bin' });
    expect(env.GameId).toBe('game1');
    expect(env.GamesApiUrl).toBe(SANDBOX_GAMES_API_URL);
    expect(env.GamesApiKey).toBe('k');
    expect(env.DEMO_BALANCE).toBe('5000');
    expect(env.PATH).toBe('/bin');
  });
});

describe('describeStartFailure — the message that replaces "ws error"', () => {
  it('names the cause, the inputs, and the escape hatch', () => {
    const text = describeStartFailure({
      reason: 'artube-server exited (code 1, signal null)',
      cfg: baseCfg,
      port: 8080,
      output: ['Error: engine GetConfig: unknown game "game1"'],
    });
    expect(text).toContain('code 1');
    expect(text).toContain(baseCfg.spinPath);
    expect(text).toContain('game1');
    expect(text).toContain(SANDBOX_GAMES_API_URL);
    expect(text).toContain('e8-server');
    expect(text).toContain('ARTUBE_BACKEND');
    // The backend's own last words — the part that actually identifies the fault.
    expect(text).toContain('unknown game "game1"');
  });
});

describe('artubePlugin — the two halves', () => {
  /**
   * One call site, two plugin objects, each with an unconditional `apply`.
   * That is the whole guarantee: neither half can run in the other's mode,
   * and you can read that off the object instead of tracing a `command`
   * branch inside a hook.
   */
  it('returns a serve half and a build half, and nothing that applies to both', () => {
    const plugins = artubePlugin();
    expect(plugins.map((p) => [p.name, p.apply])).toEqual([
      ['artube:backend', 'serve'],
      ['artube:server-artifact', 'build'],
    ]);
  });
});

describe('artubeDevPlugin', () => {
  it('external mode proxies /api without starting anything', async () => {
    const config = await runConfig(
      artubeDevPlugin({ external: 'http://127.0.0.1:9999' }),
      gameRoot(),
    );
    expect(config.server.proxy['/api']).toEqual({
      target: 'http://127.0.0.1:9999',
      ws: true,
      changeOrigin: true,
    });
  });

  it('starts a backend and proxies /api at the port it actually bound', async () => {
    const plugin = artubeDevPlugin({ cliPath: fakeCli(), spinPath: './script.spin', port: 8140 });
    const server = fakeServer();
    cleanups.push(() => server.httpServer.emit('close'));

    const config = await runConfig(plugin, gameRoot());
    (plugin.configureServer as any)(server);

    expect(config.server.proxy['/api'].target).toBe('http://127.0.0.1:8140');
    expect(config.server.proxy['/api'].ws).toBe(true);
    // Proof it is really up: the plugin only returns once /livez answers.
    expect((await fetch('http://127.0.0.1:8140/livez')).ok).toBe(true);
  });

  it('scans past a taken port, so two games can run at once', async () => {
    await occupy(8150);
    const plugin = artubeDevPlugin({ cliPath: fakeCli(), spinPath: './script.spin', port: 8150 });
    const server = fakeServer();
    cleanups.push(() => server.httpServer.emit('close'));

    const config = await runConfig(plugin, gameRoot());
    (plugin.configureServer as any)(server);
    expect(config.server.proxy['/api'].target).toBe('http://127.0.0.1:8151');
  });

  it('kills the backend when the dev server closes', async () => {
    const plugin = artubeDevPlugin({ cliPath: fakeCli(), spinPath: './script.spin', port: 8160 });
    const server = fakeServer();
    await runConfig(plugin, gameRoot());
    (plugin.configureServer as any)(server);

    server.httpServer.emit('close');
    // The port comes back once the child is gone — which is what stops the
    // next run from proxying into a stale backend.
    await expect
      .poll(async () => (await fetch('http://127.0.0.1:8160/livez').then(() => true, () => false)), {
        timeout: 5000,
      })
      .toBe(false);
  });

  it("fails with the backend's own output when it dies during startup", async () => {
    const dying = fakeCli(
      `console.error('Error: engine GetConfig: unknown game "game1"');\nprocess.exit(1);\n`,
    );
    const plugin = artubeDevPlugin({ cliPath: dying, spinPath: './script.spin', port: 8170 });
    await expect(runConfig(plugin, gameRoot())).rejects.toThrow(/unknown game "game1"/);
  });

  it('names a missing .spin instead of starting a backend that cannot serve', async () => {
    const plugin = artubeDevPlugin({ cliPath: fakeCli(), spinPath: './nope.spin' });
    await expect(runConfig(plugin, gameRoot())).rejects.toThrow(/spin math not found[\s\S]*nope\.spin/);
  });
});
