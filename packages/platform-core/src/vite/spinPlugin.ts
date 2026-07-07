/**
 * spinPlugin — dev-путь фронта поверх e8-server (SpinML, домен-API раундов).
 *
 * Замена luaPlugin для spin-рантайма: тот же роут POST /__lua-play и тот же
 * ответ — DevBridge не меняется. Плагин ТОНКИЙ: машину раунда (сессии /
 * очереди / unlimited / globals / идемпотентность) ведёт сам e8-server
 * (--sessions memory), плагин лишь переводит протокол и держит history для
 * HUD. Горячая перезагрузка .spin — у сервера (--watch): правка файла =
 * новая версия, открытые раунды доигрываются старой.
 *
 * Источник истины протокола: casino-platform/e8/crates/e8-server/proto/
 * engine.proto (репо движка); ниже — синхронизированная копия.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants as fsConstants, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Поиск бинаря e8-server в порядке их NativeSimulationRunner:
 * явный binPath → env E8_SERVER_BINARY →
 * node_modules/@energy8platform/platform-core/bin/e8-server-<platform>-<arch>
 * (его качает install-e8.mjs postinstall'ом) → голый "e8-server" из PATH.
 */
function resolveServerBinary(explicit?: string): string {
  const ok = (p: string) => {
    try {
      accessSync(p, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (explicit) return explicit;
  const env = process.env.E8_SERVER_BINARY;
  if (env && ok(env)) return env;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const name = `e8-server-${platform}-${arch}${ext}`;
  // бинарь этого пакета (его качает scripts/install-e8.mjs); раскладки
  // src/vite/*.ts и dist/vite.esm.js отличаются уровнем — пробуем оба
  try {
    const here = fileURLToPath(import.meta.url);
    for (const up of ['..', '../..']) {
      const candidate = join(here, '..', up, 'bin', name);
      if (ok(candidate)) return candidate;
    }
  } catch {
    // import.meta недоступен — падаем на PATH
  }
  return `e8-server${ext}`;
}

export interface SpinPluginOptions {
  /** путь к бинарю e8-server (default: E8_SERVER_BINARY → platform-core/bin → PATH) */
  binPath?: string;
  /** .spin-файл игры или каталог */
  spinPath?: string;
  gamesDir?: string;
  /** id игры из декларации game "..." (default: первая загруженная) */
  gameId?: string;
  /** порт gRPC (default 50151) */
  port?: number;
  /** server_seed дев-сессий (детерминированный replay) */
  serverSeed?: string;
  /** подключиться к уже запущенному серверу, не спавнить */
  external?: boolean;
}

// Копия контракта — источник истины crates/e8-server/proto/engine.proto.
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

export function spinPlugin(opts: SpinPluginOptions = {}): Plugin {
  const port = opts.port ?? 50151;
  const serverSeed = opts.serverSeed ?? 'e8-dev-seed';
  let child: ChildProcess | null = null;
  let client: any = null;
  let gameId = opts.gameId ?? '';
  let entryActions: string[] = [];

  let roundCounter = 0;
  let reqCounter = 0;
  // презентационное состояние протокола (history / bet раунда)
  const rounds = new Map<string, { bet: number; history: unknown[] }>();
  let activeRoundId: string | null = null;

  function grpc() {
    // createRequire: vite.config грузится и как ESM, и как CJS-бандл
    const req = createRequire(import.meta.url);
    const grpcJs = req('@grpc/grpc-js');
    const loader = req('@grpc/proto-loader');
    const dir = mkdtempSync(join(tmpdir(), 'e8proto-'));
    writeFileSync(join(dir, 'engine.proto'), ENGINE_PROTO);
    const def = loader.loadSync(join(dir, 'engine.proto'), {
      keepCase: true,
      longs: Number,
      defaults: true,
    });
    const pkg = grpcJs.loadPackageDefinition(def) as any;
    return new pkg.e8.Engine(`127.0.0.1:${port}`, grpcJs.credentials.createInsecure());
  }

  function call<T>(method: string, req: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      client[method](req, (err: Error | null, resp: T) =>
        err ? reject(err) : resolve(resp),
      );
    });
  }

  function toLegacy(r: any, roundId: string) {
    const meta = rounds.get(roundId)!;
    const data = r.data_json ? JSON.parse(r.data_json) : null;
    meta.history.push({
      spinIndex: r.spins_played - 1,
      win: r.win * meta.bet,
      data,
    });
    const hadSession = r.spins_played > 1 || !r.round_complete;
    if (r.round_complete) {
      rounds.delete(roundId);
      if (activeRoundId === roundId) activeRoundId = null;
    }
    return {
      totalWin: r.round_complete && r.spins_played > 1 ? r.total_win : r.win,
      data,
      nextActions: r.next_actions,
      session: hadSession
        ? {
            spinsRemaining: r.spins_remaining,
            spinsPlayed: r.spins_played,
            totalWin: r.total_win * meta.bet,
            betAmount: meta.bet,
            completed: r.round_complete,
            maxWinReached: false,
            history: meta.history,
          }
        : null,
      variables: r.vars_json ? JSON.parse(r.vars_json) : {},
      globals: r.globals_json ? JSON.parse(r.globals_json) : {},
      creditDeferred: !r.round_complete,
      roundId,
    };
  }

  async function play(body: any): Promise<unknown> {
    const action: string = body.action ?? 'spin';
    const params = body.params ? JSON.stringify(body.params) : '';
    const rid: string | null = body.roundId ?? activeRoundId;
    reqCounter += 1;

    // шаг открытого раунда, если действие принадлежит его активной сессии.
    // Маршрутизируем ПО СЕРВЕРУ (GetRound), а не по локальной карте: клиент
    // (DevBridge) - владелец roundId и может пережить перезапуск плагина.
    if (rid) {
      const st: any = await call('GetRound', { round_id: rid });
      if (st.found && !st.round_complete && st.next_actions.includes(action)) {
        if (!rounds.has(rid)) rounds.set(rid, { bet: st.bet || 1.0, history: [] });
        const r: any = await call('Step', {
          round_id: rid,
          action,
          params_json: params,
          request_id: `dev-${reqCounter}`,
        });
        if (r.error) throw new Error(r.error);
        return toLegacy(r, rid);
      }
    }

    // entry: новый раунд. roundId КЛИЕНТА уважается (их DevBridge генерит
    // uuid на entry и шлёт его же в session-шаги) — id-пространства совпадают.
    roundCounter += 1;
    const roundId: string = body.roundId ?? `r${roundCounter.toString(16).padStart(8, '0')}`;
    const bet: number = body.bet ?? 1.0;
    rounds.set(roundId, { bet, history: [] });
    const r: any = await call('StartRound', {
      game_id: gameId,
      player_id: 'dev-player',
      round_id: roundId,
      server_seed: serverSeed,
      client_seed: 'dev',
      nonce: roundCounter,
      action,
      bet,
      params_json: params,
      request_id: `dev-${reqCounter}`,
      recording: true,
    });
    if (r.error) throw new Error(r.error);
    if (!r.round_complete) activeRoundId = roundId;
    return toLegacy(r, roundId);
  }

  return {
    name: 'e8:spin',
    apply: 'serve',
    // pre: наша мидлвара /__lua-play регистрируется раньше luaPlugin из
    // defineGameConfig — .spin-игры перехватывают роут без правок конфига
    // движка (их LuaEngine на .spin-тексте тихо не поднимется).
    enforce: 'pre',

    async configureServer(server) {
      if (!opts.external) {
        const args = ['--port', String(port), '--sessions', 'memory', '--watch'];
        if (opts.gamesDir) args.push('--games-dir', opts.gamesDir);
        else if (opts.spinPath) {
          const dir = opts.spinPath.replace(/\/[^/]+$/, '') || '.';
          args.push('--games-dir', dir);
        }
        child = spawn(resolveServerBinary(opts.binPath), args, { stdio: 'inherit' });
        server.httpServer?.on('close', () => child?.kill());
      }
      client = grpc();

      for (let i = 0; i < 100; i++) {
        try {
          const games: any = await call('ListGames', {});
          if (!gameId) gameId = games.games[0]?.game_id ?? '';
          const info = games.games.find((g: any) => g.game_id === gameId);
          entryActions = info?.entry_actions ?? [];
          console.log(
            `[e8] connected: game=${gameId} script=${info?.script_sha256?.slice(0, 12)} entry=[${entryActions}]`,
          );
          break;
        } catch {
          await new Promise((res) => setTimeout(res, 300));
        }
      }

      server.middlewares.use('/__lua-play', (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }
        let body = '';
        req.on('data', (c: string) => (body += c));
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            res.statusCode = 200;
            res.end(JSON.stringify(await play(JSON.parse(body))));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });

      server.middlewares.use('/config', async (_req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          const c: any = await call('GetConfig', { game_id: gameId });
          res.statusCode = 200;
          res.end(c.config_json || JSON.stringify({ error: c.error }));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    },
  };
}
