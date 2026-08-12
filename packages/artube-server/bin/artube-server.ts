#!/usr/bin/env node
/**
 * CLI игрового бэкенда.
 *
 * В продакшне достаточно переменных окружения; `--sandbox` направляет сервис
 * на публичную песочницу Artube, где стоит тот же GamesAPI, что на dev и prod.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createArtubeServer } from '../src/http/server.js';
import { loadConfigFromEnv, type ArtubeServerConfig } from '../src/config.js';

export const SANDBOX_URL = 'wss://gamesapi-sandbox.artube-888.live/v1/ws';

export function parseArgs(argv: string[], env = process.env): ArtubeServerConfig {
  // Scanned up front, not discovered mid-loop: `loadConfigFromEnv` needs to
  // know *before* it validates env vars whether `--sandbox` is about to
  // overwrite `gamesApiUrl` itself, so it can stop demanding `GamesApiUrl`
  // (and relax `GamesApiKey`) for a flag whose whole point is frictionless
  // local runs.
  const sandbox = argv.includes('--sandbox');
  const config = loadConfigFromEnv(env, { sandbox });
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sandbox') config.gamesApiUrl = SANDBOX_URL;
    if (argv[i] === '--spin') {
      const value = argv[++i];
      if (!value) {
        throw new Error('--spin requires a path argument, e.g. --spin ./game.spin');
      }
      config.spinPath = value;
    }
    if (argv[i] === '--port') {
      const raw = argv[++i];
      const value = Number(raw);
      if (raw === undefined || !Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error(
          `--port requires an integer between 0 and 65535, got ${JSON.stringify(raw)}`,
        );
      }
      config.port = value;
    }
  }
  return config;
}

/**
 * `npm install` links `bin` commands (and `npx`) as a POSIX symlink named
 * after the `bin` key, with NO extension — e.g.
 * `node_modules/.bin/artube-server -> ../@energy8platform/artube-server/
 * dist/bin/artube-server.js`. `process.argv[1]` in that case is the
 * extensionless symlink path, not the `.js` file it points to, so a suffix
 * check (`.endsWith('artube-server.js')`) never matches and the CLI silently
 * does nothing. Comparing the *resolved* (symlink-followed) invocation path
 * against this module's own URL works for the symlink case, a direct
 * `node dist/bin/artube-server.js` call, and — since `import.meta.url` here
 * is whichever file Node actually loaded — a dev-mode `node bin/artube-server.ts`
 * run under a TS loader, all without any extension-guessing.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const config = parseArgs(process.argv.slice(2));
  const server = createArtubeServer(config);
  await server.listen();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}
