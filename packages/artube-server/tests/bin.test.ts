/**
 * Регрессия на баг из ревью: `npm install` кладёт bin-команды как POSIX
 * symlink БЕЗ расширения, названный по ключу `bin` в package.json (см.
 * `node_modules/.bin/platform-core-simulate -> ../@energy8platform/
 * platform-core/bin/simulate.ts` в этом же монорепо). Старая проверка
 * `process.argv[1]?.endsWith('artube-server.js' | '.ts')` не совпадала с
 * таким путём — бинарь тихо завершался с кодом 0, ничего не выведя и не
 * запустив сервер. Этот тест воспроизводит именно установочную форму
 * (собранный `dist/bin/artube-server.js`, вызванный через extensionless
 * symlink) и требует, чтобы процесс реально дошёл до `server.listen()`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(pkgRoot, 'tests', 'fixtures');
const builtEntry = join(pkgRoot, 'dist', 'bin', 'artube-server.js');

describe('bin/artube-server, вызванный так, как это делает npm', () => {
  let api: FakeGamesApi;

  beforeAll(async () => {
    execSync('npm run build', { cwd: pkgRoot, stdio: 'pipe' });
    expect(existsSync(builtEntry)).toBe(true);
    api = await startFakeGamesApi();
  }, 60_000);

  afterAll(async () => {
    await api?.close();
  });

  it('symlink без расширения на dist/bin/artube-server.js реально стартует сервер, а не выходит молча', async () => {
    const linkDir = mkdtempSync(join(tmpdir(), 'artube-bin-'));
    const link = join(linkDir, 'artube-server'); // без .js/.ts — точь-в-точь node_modules/.bin/*
    symlinkSync(builtEntry, link);

    const child = spawn(process.execPath, [link], {
      env: {
        ...process.env,
        GameId: 'feature-game',
        GamesApiUrl: api.url,
        GamesApiKey: 'k',
        SPIN_PATH: fixtures,
        PORT: '0',
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `бинарь не дошёл до старта за 20с (тихий no-op?); stdout=${stdout} stderr=${stderr}`,
            ),
          );
        }, 20_000);
        const onData = (): void => {
          if (stdout.includes('"message":"artube-server listening"')) {
            clearTimeout(timer);
            child.stdout.off('data', onData);
            resolve();
          }
        };
        child.stdout.on('data', onData);
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(
            new Error(
              `процесс завершился раньше времени с кодом ${code} — воспроизводит баг ` +
                `«symlink без расширения — тихий exit 0»; stdout=${stdout} stderr=${stderr}`,
            ),
          );
        });
      });
    } finally {
      // Дождаться, пока CLI действительно выйдет, а не просто послать сигнал.
      // Выключение у него асинхронное (`server.close()` гасит движок), и если
      // воркер уходит первым, каналы stdio закрываются у CLI под руками — он
      // умирает на полпути, а ВНУК (`e8-server`) остаётся жить и держит порт из
      // окна поиска до перезагрузки машины. Именно такие сироты и нашлись
      // здесь трёхдневными.
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 5000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(linkDir, { recursive: true, force: true });
    }
  }, 40_000);
});
