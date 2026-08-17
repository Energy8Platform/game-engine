/**
 * Контракт gRPC движка SpinML.
 *
 * Источник истины — `crates/e8-server/proto/engine.proto` в репозитории
 * движка; здесь синхронизированная копия, как и в `platform-core/src/vite/
 * spinPlugin.ts`. Держим её в строке, чтобы не тащить .proto через сборку.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ENGINE_PROTO = `
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

/**
 * Путь к .proto на диске, один на процесс.
 *
 * `loadSync` умеет только файл, а не строку, поэтому копию приходится
 * выкладывать во временный каталог. Раньше — на КАЖДЫЙ вызов: к моменту, когда
 * этот файл читали, в `/var/folders` лежало 5660 каталогов `artube-proto-*`.
 * Сам по себе мусор безвреден, но пакет тестов создаёт клиента десятки раз за
 * прогон, и это лишняя работа файловой системы там, где параллельные процессы
 * и без неё дерутся за диск.
 */
let protoPath: string | null = null;

function ensureProtoFile(): string {
  if (protoPath) return protoPath;
  const dir = mkdtempSync(join(tmpdir(), 'artube-proto-'));
  protoPath = join(dir, 'engine.proto');
  writeFileSync(protoPath, ENGINE_PROTO);
  return protoPath;
}

/** Собрать gRPC-клиент к уже запущенному серверу на 127.0.0.1:port. */
export function createGrpcClient(port: number): any {
  const req = createRequire(import.meta.url);
  const grpcJs = req('@grpc/grpc-js');
  const loader = req('@grpc/proto-loader');
  const def = loader.loadSync(ensureProtoFile(), {
    keepCase: true,
    longs: Number,
    defaults: true,
  });
  const pkg = grpcJs.loadPackageDefinition(def);
  return new pkg.e8.Engine(`127.0.0.1:${port}`, grpcJs.credentials.createInsecure());
}
