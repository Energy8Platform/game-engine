/**
 * Поиск и запуск бинаря `e8-server`.
 *
 * Движок эфемерный: `--sessions memory` и короткий TTL. Раунды, которые он
 * держит, — временный кэш воспроизведения, а не состояние игры: настоящее
 * состояние живёт в `round_state` на стороне Artube.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';

export const DEFAULT_ENGINE_PORT = 50251;

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Порядок поиска тот же, что у `spinPlugin`: явный путь → `E8_SERVER_BINARY`
 * → бинарь, скачанный postinstall'ом platform-core → голое имя из PATH.
 *
 * `platform-core`'s `exports` map не публикует `./package.json`, поэтому
 * резолвим сам entry point пакета (его `.` экспорт), а не package.json —
 * иначе `require.resolve` бросает `ERR_PACKAGE_PATH_NOT_EXPORTED`. Entry
 * point лежит в `dist/index.cjs.js`, т.е. на два уровня выше пакетного
 * корня, откуда рядом — `bin/`.
 */
export function resolveEngineBinary(explicit?: string): string {
  if (explicit) return explicit;
  const fromEnv = process.env.E8_SERVER_BINARY;
  if (fromEnv && executable(fromEnv)) return fromEnv;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const name = `e8-server-${platform}-${arch}${ext}`;
  try {
    const req = createRequire(import.meta.url);
    const main = req.resolve('@energy8platform/platform-core');
    const candidate = join(main, '..', '..', 'bin', name);
    if (executable(candidate)) return candidate;
  } catch {
    // platform-core не установлен — падаем на PATH
  }
  try {
    const here = fileURLToPath(import.meta.url);
    for (const up of ['..', '../..', '../../..']) {
      const candidate = join(here, '..', up, 'bin', name);
      if (executable(candidate)) return candidate;
    }
  } catch {
    // import.meta недоступен
  }
  return `e8-server${ext}`;
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

export async function findFreePort(start: number, range = 20): Promise<number> {
  for (let p = start; p < start + range; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`[artube] нет свободного порта в диапазоне ${start}..${start + range - 1}`);
}

export interface SpawnedEngine {
  port: number;
  child: ChildProcess;
}

export async function spawnEngine(opts: {
  gamesDir: string;
  binPath?: string;
  port?: number;
  sessionTtlSec?: number;
}): Promise<SpawnedEngine> {
  const port = await findFreePort(opts.port ?? DEFAULT_ENGINE_PORT);
  const bin = resolveEngineBinary(opts.binPath);
  const child = spawn(
    bin,
    [
      '--port', String(port),
      '--sessions', 'memory',
      '--session-ttl', String(opts.sessionTtlSec ?? 300),
      '--games-dir', opts.gamesDir,
    ],
    { stdio: 'inherit' },
  );
  return { port, child };
}
