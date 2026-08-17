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
    // Канал grpc-js переживает смерть ребёнка и продолжает переподключаться к
    // мёртвому порту с собственным бэкоффом. Внутри процесса-воркера это
    // живой сокет и таймеры после `afterAll` — ровно та утечка за пределы
    // теста, из-за которой соседи начинают зависеть от того, кто закрылся
    // раньше.
    this.grpc?.close?.();
  }
}

/** Сколько всего ждём готовности движка, включая повторные попытки. */
const READY_TIMEOUT_MS = 20_000;
/** Пауза между опросами `ListGames`, пока движок грузит игры. */
const READY_POLL_MS = 100;
/**
 * Сколько РАЗНЫХ портов пробуем, если ребёнок умирает уже после того, как
 * `spawnEngine` счёл его живым.
 *
 * Это не то же самое, что `MAX_SPAWN_ATTEMPTS`: там повтор идёт по смерти
 * внутри окна `SPAWN_CHECK_MS`, здесь — по смерти ПОСЛЕ него. Ребёнок
 * печатает список игр раньше, чем занимает порт, поэтому на загруженной машине
 * проигравший гонку за bind вполне успевает пережить окно, и раньше это была
 * не повторная попытка, а `exited early` в лицо тесту.
 */
const MAX_PORT_RETRIES = 4;

/** Готов ли движок, или ребёнок умер, или вышло время. */
type Readiness = 'ready' | 'died' | 'timeout';

/**
 * Поднять движок и дождаться, пока он загрузит игры.
 *
 * Готовность и смерть ребёнка — одна и та же гонка, и решается она в одном
 * месте: пока движок не отвечает на `ListGames`, он либо ещё грузится, либо уже
 * не поднимется. Смерть — это почти всегда проигранная гонка за порт (её
 * оставляет открытой любой probe-then-bind), поэтому она ведёт к следующему
 * порту, а не к ошибке.
 */
export async function startEngine(opts: {
  gamesDir: string;
  binPath?: string;
  port?: number;
}): Promise<EngineClient> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let from = opts.port;
  let lastDeath = '';

  for (let attempt = 0; attempt <= MAX_PORT_RETRIES; attempt++) {
    // ENOENT и прочие «бинарь вообще не запустился» отсекает сам spawnEngine —
    // до всякого gRPC и с названием бинаря в сообщении.
    const { port, child } = await spawnEngine({ ...opts, port: from });
    const grpc = createGrpcClient(port);
    const client = new EngineClient(grpc, child);
    const outcome = await waitUntilReady(client, child, deadline);
    if (outcome === 'ready') return client;

    // Больше не наш: канал закрываем сами, иначе grpc-js продолжит стучаться в
    // мёртвый порт до конца процесса.
    client.close();
    if (outcome === 'timeout') {
      throw new Error(
        `[artube] e8-server не поднялся за ${READY_TIMEOUT_MS / 1000} секунд` +
          (lastDeath ? ` (последняя смерть: ${lastDeath})` : ''),
      );
    }
    lastDeath = deathReason(child);
    // Порт, на котором он только что умер, пробовать снова смысла нет.
    from = port + 1;
  }

  throw new Error(
    `[artube] e8-server умирал на ${MAX_PORT_RETRIES + 1} портах подряд: ${lastDeath}`,
  );
}

function deathReason(child: ChildProcess): string {
  const spawnErr = spawnFailureOf(child);
  if (spawnErr) return `${child.spawnfile}: ${spawnErr.message}`;
  return `${child.spawnfile} exited with code ${child.exitCode}, signal ${child.signalCode}`;
}

/**
 * Ждать, пока движок ответит на `ListGames`, — и следить за ребёнком.
 *
 * Успешный `ListGames` сам по себе НЕ доказывает, что ответил наш движок:
 * ребёнок мог проиграть гонку за bind и умереть, а на том же порту слушает
 * победитель — с чужим каталогом игр. Поэтому живость ребёнка проверяется и
 * после удачного ответа: «ответил кто-то» и «ответил наш» — разные вещи, и
 * молчаливая подмена каталога игр была бы худшим из возможных исходов.
 */
async function waitUntilReady(
  client: EngineClient,
  child: ChildProcess,
  deadline: number,
): Promise<Readiness> {
  while (Date.now() < deadline) {
    if (spawnFailureOf(child) || child.exitCode !== null || child.signalCode !== null) {
      return 'died';
    }
    try {
      await client.listGames();
      return child.exitCode === null && child.signalCode === null ? 'ready' : 'died';
    } catch {
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
  }
  return 'timeout';
}
