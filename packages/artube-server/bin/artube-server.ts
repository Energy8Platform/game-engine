#!/usr/bin/env node
/**
 * CLI игрового бэкенда.
 *
 * В продакшне достаточно переменных окружения; `--sandbox` направляет сервис
 * на публичную песочницу Artube, где стоит тот же GamesAPI, что на dev и prod.
 */

import { createArtubeServer } from '../src/http/server.js';
import { loadConfigFromEnv, type ArtubeServerConfig } from '../src/config.js';

export const SANDBOX_URL = 'wss://gamesapi-sandbox.artube-888.live/v1/ws';

export function parseArgs(argv: string[], env = process.env): ArtubeServerConfig {
  const config = loadConfigFromEnv(env);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sandbox') config.gamesApiUrl = SANDBOX_URL;
    if (argv[i] === '--spin') config.spinPath = argv[++i];
    if (argv[i] === '--port') config.port = Number(argv[++i]);
  }
  return config;
}

// Запуск только когда файл вызван как бинарь, а не импортирован тестом.
if (process.argv[1]?.endsWith('artube-server.js') || process.argv[1]?.endsWith('artube-server.ts')) {
  const config = parseArgs(process.argv.slice(2));
  const server = createArtubeServer(config);
  await server.listen();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}
