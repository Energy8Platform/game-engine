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

export function loadConfigFromEnv(env = process.env): ArtubeServerConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`missing required env var: ${name}`);
    return value;
  };
  return {
    gameId: required('GameId'),
    gamesApiUrl: required('GamesApiUrl'),
    apiKey: required('GamesApiKey'),
    spinPath: env.SPIN_PATH ?? './game.spin',
    port: env.PORT ? Number(env.PORT) : 80,
    startingDemoBalance: env.DEMO_BALANCE ? Number(env.DEMO_BALANCE) : 1000,
  };
}
