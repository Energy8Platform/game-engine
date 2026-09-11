/**
 * A thin gRPC client + process manager for e8-server — enough to spawn a
 * server against a `--games-dir`, wait for it to come up, play spins, and
 * tear it down cleanly. Library, not a Vite plugin: no dev-server routing,
 * no session/round bookkeeping beyond what a single play() call needs.
 *
 * Protocol reference: packages/platform-core/src/vite/spinPlugin.ts (a
 * worked example of the same path inside a Vite plugin) — read, not copied;
 * this file re-derives its own binary lookup and free-port selection for a
 * standalone library that doesn't live inside platform-core.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants as fsConstants, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { E8Handle, SpinRequest, SpinResult, StartE8ServerOptions } from './types';

// e8-server's gRPC contract. Source of truth: casino_platform/e8/crates/
// e8-server/proto/engine.proto (a sibling repo, not vendored here) — this is
// a synced copy, same convention spinPlugin.ts uses. We only call the RPCs a
// single play() needs: ListGames (readiness probe) and StartRound (play).
const ENGINE_PROTO = `
syntax = "proto3";
package e8;
service Engine {
  rpc ListGames(ListGamesRequest) returns (ListGamesResponse);
  rpc GetConfig(ConfigRequest) returns (ConfigResponse);
  rpc StartRound(StartRoundRequest) returns (RoundResponse);
  rpc Step(RoundStepRequest) returns (RoundResponse);
  rpc GetRound(GetRoundRequest) returns (RoundStateResponse);
  rpc Health(HealthRequest) returns (HealthResponse);
}
message ListGamesRequest {}
message GameInfo {
  string game_id = 1;
  string script_sha256 = 2;
  string vars_layout_hash = 3;
  repeated string entry_actions = 4;
  repeated string loaded_versions = 5;
}
message ListGamesResponse { repeated GameInfo games = 1; }
message ConfigRequest { string game_id = 1; }
message ConfigResponse { string config_json = 1; string error = 2; }
message StartRoundRequest {
  string game_id = 1;
  string player_id = 2;
  string round_id = 3;
  string server_seed = 4;
  string client_seed = 5;
  int64 nonce = 6;
  string action = 7;
  double bet = 8;
  string params_json = 9;
  string request_id = 10;
  bool recording = 11;
}
message RoundStepRequest {
  string round_id = 1;
  string action = 2;
  string params_json = 3;
  string request_id = 4;
}
message RoundResponse {
  double win = 1;
  double total_win = 2;
  string data_json = 3;
  string vars_json = 4;
  string globals_json = 5;
  repeated string next_actions = 6;
  bool round_complete = 7;
  int64 spins_remaining = 8;
  uint32 spins_played = 9;
  string script_sha256 = 10;
  string error = 11;
  double bet = 12;
}
message GetRoundRequest { string round_id = 1; }
message RoundStateResponse {
  bool found = 1;
  string game_id = 2;
  string script_sha256 = 3;
  double total_win = 4;
  uint32 spins_played = 5;
  int64 spins_remaining = 6;
  repeated string next_actions = 7;
  bool round_complete = 8;
  string vars_json = 9;
  string error = 10;
  double bet = 11;
}
message HealthRequest {}
message HealthResponse { bool ok = 1; uint32 games_loaded = 2; string sessions_backend = 3; }
`;

function isExecutable(p: string): boolean {
  try {
    accessSync(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Binary lookup order (mirrors NativeSimulationRunner / spinPlugin's
 * intent, re-derived here since session-dev doesn't live inside
 * platform-core): explicit `binPath` → env `E8_SERVER_BINARY` →
 * `<platform-core package root>/bin/e8-server-<platform>-<arch>` (fetched
 * by platform-core's own postinstall) → bare `e8-server` on PATH.
 */
function resolveServerBinary(explicit?: string): string {
  if (explicit) return explicit;
  const envBin = process.env.E8_SERVER_BINARY;
  if (envBin && isExecutable(envBin)) return envBin;

  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const name = `e8-server-${platform}-${arch}${ext}`;

  try {
    // Locate platform-core via its main entry (its package.json doesn't
    // export "./package.json", so require.resolve of the bare specifier is
    // the reliable path) and derive its package root from there.
    const req = createRequire(import.meta.url);
    const entry = req.resolve('@energy8platform/platform-core');
    const pkgRoot = join(dirname(entry), '..');
    const candidate = join(pkgRoot, 'bin', name);
    if (isExecutable(candidate)) return candidate;
  } catch {
    // platform-core isn't resolvable from here — fall through to PATH
  }
  return `e8-server${ext}`;
}

/**
 * An OS-assigned free TCP port: bind 0, read back what the kernel gave us,
 * release it. There is an unavoidable race between releasing this probe and
 * e8-server binding the same port a moment later; accepted here — this is a
 * dev/test spike, not a production port allocator.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

function grpcClient(port: number) {
  // createRequire: this file is ESM; @grpc/grpc-js and @grpc/proto-loader are CJS.
  const req = createRequire(import.meta.url);
  const grpcJs = req('@grpc/grpc-js');
  const loader = req('@grpc/proto-loader');
  const dir = mkdtempSync(join(tmpdir(), 'e8proto-'));
  try {
    writeFileSync(join(dir, 'engine.proto'), ENGINE_PROTO);
    const def = loader.loadSync(join(dir, 'engine.proto'), {
      keepCase: true,
      longs: Number,
      defaults: true,
    });
    const pkg = grpcJs.loadPackageDefinition(def) as any;
    return new pkg.e8.Engine(`127.0.0.1:${port}`, grpcJs.credentials.createInsecure());
  } finally {
    // The dir only exists to hand loadSync a path to read — nothing keeps
    // reading from it once loadPackageDefinition has parsed the result
    // into memory, so it's removed right here rather than tied to this
    // handle's later stop(): every startE8Server() call used to leave a
    // /tmp/e8proto-* directory behind forever, whether or not stop() was
    // ever reached.
    rmSync(dir, { recursive: true, force: true });
  }
}

function call<T>(client: any, method: string, req: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](req, (err: Error | null, resp: T) => (err ? reject(err) : resolve(resp)));
  });
}

export async function startE8Server(opts: StartE8ServerOptions): Promise<E8Handle> {
  const port = opts.port === 0 ? await freePort() : opts.port;
  const bin = resolveServerBinary(opts.binPath);
  const serverSeed = opts.serverSeed ?? 'session-dev-seed';
  const readyTimeoutMs = opts.readyTimeoutMs ?? 15_000;

  const args = ['--port', String(port), '--games-dir', opts.gamesDir, '--sessions', 'memory'];

  let child: ChildProcess;
  try {
    // stdio piped (not 'inherit'): a library shouldn't spam the caller's
    // stdout on the happy path — output is only surfaced if startup fails.
    child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e: any) {
    throw new Error(`[session-dev] failed to spawn e8-server (${bin}): ${e.message}`);
  }

  let exited = false;
  let exitInfo = '';
  const output: string[] = [];
  child.stdout?.on('data', (c) => output.push(String(c)));
  child.stderr?.on('data', (c) => output.push(String(c)));
  // `'close'`, not `'exit'` — Node fires `'exit'` the moment the OS reaps
  // the process, which can be BEFORE the `'data'` events above have
  // delivered everything already written to stdout/stderr; `'close'` is
  // guaranteed to fire only after every stdio stream has ended. A compiler
  // that prints its error and exits immediately (a syntax error in a
  // freshly-saved `.spin`, the exact case `restart()` exists for) races
  // this: on `'exit'`, the readiness loop below could observe `exited`
  // before `output` has the message, so the same failure was captured on
  // one run and silently empty on the next. `'close'` closes that race.
  child.once('close', (code, signal) => {
    exited = true;
    exitInfo = `exit code=${code} signal=${signal}`;
  });
  child.once('error', (e) => {
    exited = true;
    exitInfo = `spawn error: ${e.message}`;
  });

  const client = grpcClient(port);

  const deadline = Date.now() + readyTimeoutMs;
  let ready = false;
  while (Date.now() < deadline) {
    if (exited) break;
    try {
      await call(client, 'ListGames', {});
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  if (!ready) {
    if (!exited) child.kill('SIGKILL');
    throw new Error(
      `[session-dev] e8-server did not become ready on 127.0.0.1:${port} within ${readyTimeoutMs}ms ` +
        `(bin="${bin}" games-dir="${opts.gamesDir}")` +
        (exited ? ` — process exited: ${exitInfo}` : '') +
        (output.length ? `\n--- e8-server output ---\n${output.join('')}` : ''),
    );
  }

  let roundCounter = 0;
  let stopped = false;

  async function play(reqBody: SpinRequest): Promise<SpinResult> {
    if (stopped) throw new Error('[session-dev] play() called after stop()');
    roundCounter += 1;
    const roundId = `session-dev-${roundCounter}`;
    const r: any = await call(client, 'StartRound', {
      game_id: reqBody.gameId,
      player_id: 'session-dev',
      round_id: roundId,
      server_seed: serverSeed,
      client_seed: 'session-dev',
      nonce: roundCounter,
      action: reqBody.action,
      bet: reqBody.betLevel,
      params_json: reqBody.params ? JSON.stringify(reqBody.params) : '',
      request_id: `session-dev-req-${roundCounter}`,
      recording: true,
    });
    if (r.error) throw new Error(`[session-dev] e8-server: ${r.error}`);

    const data = r.data_json ? JSON.parse(r.data_json) : {};
    return {
      win: r.win,
      totalWin: r.total_win,
      bet: r.bet,
      stage: data.stage,
      data,
      vars: r.vars_json ? JSON.parse(r.vars_json) : {},
      nextActions: r.next_actions ?? [],
      roundComplete: r.round_complete,
      spinsRemaining: r.spins_remaining,
      spinsPlayed: r.spins_played,
      scriptSha256: r.script_sha256,
      roundId,
    };
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    // No counterpart before this fix: the gRPC client was never close()d,
    // leaking its channel/connection for the life of the process.
    client.close();
    if (exited) return;
    await new Promise<void>((resolve) => {
      // Neither cleared nor unref'd before this fix: a clean exit (the
      // common case — the process usually does exit well within 2s of
      // SIGTERM) still held the event loop open for the full 2s, because
      // nothing ever cancelled the fallback SIGKILL timer once `exit`
      // actually fired. `unref()` on top means even an UNcleared timer
      // (e.g. a future bug re-introducing this) can't keep the process
      // alive on its own.
      const killTimer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, 2000);
      killTimer.unref();
      child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  // Non-null: we only get here after the readiness poll observed a live
  // `ListGames` response from this exact child, so it necessarily has a pid
  // (Node only leaves `pid` undefined when the process never spawned at
  // all — the `exited`/'error' branch above, which returns before this
  // point).
  return { port, pid: child.pid!, play, stop };
}

export type { E8Handle, SpinRequest, SpinResult, StartE8ServerOptions } from './types';
