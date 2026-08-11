import { describe, it, expect } from 'vitest';
import { loadConfigFromEnv } from '../src/config';
import { parseArgs, SANDBOX_URL } from '../bin/artube-server';

describe('конфиг из окружения', () => {
  const env = {
    GameId: 'my-game',
    GamesApiUrl: 'wss://hub-dev.artube-888.live/v1/ws?game=my-game',
    GamesApiKey: 'secret',
  };

  it('читает переменные, которые выдаёт DevOps', () => {
    const config = loadConfigFromEnv(env);
    expect(config.gameId).toBe('my-game');
    expect(config.apiKey).toBe('secret');
    expect(config.port).toBe(80);
  });

  it('падает без обязательной переменной', () => {
    expect(() => loadConfigFromEnv({ ...env, GamesApiKey: undefined })).toThrow(/GamesApiKey/);
  });
});

describe('аргументы CLI', () => {
  it('--sandbox подменяет адрес платформы', () => {
    const args = parseArgs(['--sandbox', '--spin', './game.spin'], {
      GameId: 'g', GamesApiUrl: 'wss://prod/v1/ws', GamesApiKey: 'k',
    });
    expect(args.gamesApiUrl).toBe(SANDBOX_URL);
    expect(args.spinPath).toBe('./game.spin');
  });

  it('--port переопределяет порт', () => {
    const args = parseArgs(['--port', '8080'], {
      GameId: 'g', GamesApiUrl: 'wss://prod/v1/ws', GamesApiKey: 'k',
    });
    expect(args.port).toBe(8080);
  });
});
