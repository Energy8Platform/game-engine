/** Конфиг сервиса. Имена переменных окружения задаёт платформа. */

export interface ArtubeServerConfig {
  gameId: string;
  gamesApiUrl: string;
  apiKey: string;
  /** Путь к .spin-файлу игры или к каталогу с ними. */
  spinPath: string;
  port?: number;
  /** Стартовый виртуальный баланс демо-сессии. */
  startingDemoBalance?: number;
}

export interface LoadConfigOptions {
  /**
   * Set when the caller (the CLI's `--sandbox` flag) is about to overwrite
   * `gamesApiUrl` with the public sandbox address itself. Requiring
   * `GamesApiUrl` in that case would force a developer to set a variable
   * the flag is about to discard. `GameId` still comes from `required()`
   * unconditionally — it must match the `publicGameId` created in the
   * Sandbox UI, and defaulting it would just move the failure later.
   * `GamesApiKey` is also relaxed: the sandbox only checks the key when the
   * integration under test defines a non-empty one.
   */
  sandbox?: boolean;
}

export function loadConfigFromEnv(
  env = process.env,
  opts: LoadConfigOptions = {},
): ArtubeServerConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`missing required env var: ${name}`);
    return value;
  };
  return {
    gameId: required('GameId'),
    gamesApiUrl: opts.sandbox ? (env.GamesApiUrl ?? '') : required('GamesApiUrl'),
    apiKey: opts.sandbox ? (env.GamesApiKey ?? '') : required('GamesApiKey'),
    spinPath: env.SPIN_PATH ?? './game.spin',
    port: env.PORT ? Number(env.PORT) : 80,
    startingDemoBalance: env.DEMO_BALANCE ? Number(env.DEMO_BALANCE) : 1000,
  };
}
