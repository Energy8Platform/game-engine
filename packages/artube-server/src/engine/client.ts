import type { ChildProcess } from 'node:child_process';
import { createGrpcClient } from './proto.js';
import { spawnEngine, spawnFailureOf } from './spawn.js';

export interface GameInfo {
  game_id: string;
  script_sha256: string;
  vars_layout_hash: string;
  entry_actions: string[];
  loaded_versions: string[];
}

export interface RoundResponse {
  win: number;
  total_win: number;
  data_json: string;
  vars_json: string;
  globals_json: string;
  next_actions: string[];
  round_complete: boolean;
  spins_remaining: number;
  spins_played: number;
  script_sha256: string;
  error: string;
  bet: number;
}

export interface StartRoundArgs {
  gameId: string;
  playerId: string;
  roundId: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  action: string;
  bet: number;
  paramsJson?: string;
  requestId: string;
}

export interface RoundStateResponse {
  found: boolean;
  game_id: string;
  script_sha256: string;
  total_win: number;
  spins_played: number;
  spins_remaining: number;
  next_actions: string[];
  round_complete: boolean;
  vars_json: string;
  error: string;
  bet: number;
}

export class EngineClient {
  constructor(
    private readonly grpc: any,
    private readonly child: ChildProcess | null,
  ) {}

  private call<T>(method: string, req: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      this.grpc[method](req, (err: Error | null, res: T) => (err ? reject(err) : resolve(res)));
    });
  }

  async listGames(): Promise<GameInfo[]> {
    const res = await this.call<{ games: GameInfo[] }>('ListGames', {});
    return res.games;
  }

  async getConfig(gameId: string): Promise<Record<string, unknown>> {
    const res = await this.call<{ config_json: string; error: string }>('GetConfig', {
      game_id: gameId,
    });
    if (res.error) throw new Error(`engine GetConfig: ${res.error}`);
    return JSON.parse(res.config_json) as Record<string, unknown>;
  }

  /**
   * Начать раунд. Ставку всегда передаём как 1.0: `win` и `total_win` тогда
   * приходят чистыми множителями — ровно тем, что Artube ждёт в
   * `win_multiplier`. Деньги считает Games API, не мы.
   */
  startRound(a: StartRoundArgs): Promise<RoundResponse> {
    return this.call<RoundResponse>('StartRound', {
      game_id: a.gameId,
      player_id: a.playerId,
      round_id: a.roundId,
      server_seed: a.serverSeed,
      client_seed: a.clientSeed,
      nonce: a.nonce,
      action: a.action,
      bet: a.bet,
      params_json: a.paramsJson ?? '',
      request_id: a.requestId,
      recording: true,
    });
  }

  step(roundId: string, action: string, paramsJson: string, requestId: string): Promise<RoundResponse> {
    return this.call<RoundResponse>('Step', {
      round_id: roundId,
      action,
      params_json: paramsJson,
      request_id: requestId,
    });
  }

  /** Жив ли раунд в кэше движка. `found: false` — нужен холодный подъём. */
  getRound(roundId: string): Promise<RoundStateResponse> {
    return this.call<RoundStateResponse>('GetRound', { round_id: roundId });
  }

  close(): void {
    this.child?.kill();
  }
}

/** Поднять движок и дождаться, пока он загрузит игры. */
export async function startEngine(opts: {
  gamesDir: string;
  binPath?: string;
  port?: number;
}): Promise<EngineClient> {
  const { port, child } = await spawnEngine(opts);
  const grpc = createGrpcClient(port);
  const client = new EngineClient(grpc, child);
  for (let i = 0; i < 100; i++) {
    // A failed spawn (e.g. ENOENT on a bad binPath) or a binary that exits
    // immediately (e.g. bad CLI args) never becomes reachable over gRPC —
    // waiting out the full 20s timeout below would still be "correct" but
    // is a needlessly slow, uninformative way to report it. Fail fast with
    // the concrete reason instead.
    const spawnErr = spawnFailureOf(child);
    if (spawnErr) {
      throw new Error(`[artube] e8-server failed to start (${child.spawnfile}): ${spawnErr.message}`);
    }
    if (child.exitCode !== null) {
      throw new Error(
        `[artube] e8-server exited early (${child.spawnfile}), code ${child.exitCode}`,
      );
    }
    try {
      await client.listGames();
      return client;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  child.kill();
  throw new Error('[artube] e8-server не поднялся за 20 секунд');
}
