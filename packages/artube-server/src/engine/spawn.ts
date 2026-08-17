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

/**
 * Порт gRPC движка по умолчанию.
 *
 * Намеренно НИЖЕ эфемерного диапазона любой ОС (Linux 32768+, macOS и Windows
 * 49152+). Прежнее значение, 50251, лежало внутри него, и это не косметика:
 * эфемерные порты ядро выдаёт КАЖДОМУ `listen(0)`, а `::` и `0.0.0.0` на одном
 * порту сосуществуют без всякого EADDRINUSE. То есть фейковый Games API теста
 * (`new WebSocketServer({ port: 0 })`, а это всегда `::`) мог получить ровно
 * тот порт, на котором уже слушает движок соседнего теста, — и `ws://127.0.0.1`
 * уходил В ДВИЖОК, потому что при выборе слушателя точное совпадение семейства
 * адресов (IPv4) выигрывает у `::`. Тест видел от «своего» Games API
 * `Parse Error: Expected HTTP/` или молчаливое закрытие — про поведение,
 * которое он проверял, это не говорило ничего.
 */
export const DEFAULT_ENGINE_PORT = 20251;

/**
 * Ширина окна, внутри которого ищется свободный порт, и разброс стартовой
 * точки поиска.
 *
 * Разброс нужен ровно против того, чем этот файл жил раньше: когда все
 * процессы начинают скан с одного и того же порта, они и претендуют на один и
 * тот же — гонка «проверил → занял» из редкой становится нормой. Со случайной
 * стартовой точкой параллельные процессы расходятся по окну сами, а цикл
 * повторов остаётся страховкой, а не основным механизмом.
 */
const PORT_WINDOW = 64;
const PORT_FANOUT = 32;

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

/**
 * Свободен ли порт для ДВИЖКА.
 *
 * Проба идёт по тому же адресу, который занимает сам `e8-server` — `0.0.0.0`,
 * а не `127.0.0.1`. Разница не теоретическая: на BSD/macOS bind на
 * `127.0.0.1:P` проходит, пока другой процесс держит `0.0.0.0:P` (SO_REUSEADDR
 * разрешает занять более узкий адрес), поэтому проба по локалхосту объявляла
 * свободным порт, на котором уже слушал движок. Весь пакет тестов начинал скан
 * с одного порта, и на замерах ~88% попыток спавна (≈300 из ≈340 за прогон)
 * умирали на гонке за bind: цикл повторов это прятал, но каждая такая смерть
 * была ещё и монеткой против окна `SPAWN_CHECK_MS`.
 *
 * Проба по IPv4-wildcard ровно так же строга, как bind ребёнка: «свободен»
 * теперь значит свободен — в том числе и для узла, который держит `::`
 * (bind `0.0.0.0` поверх `::` тоже даёт EADDRINUSE).
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

/** Первый свободный порт, начиная с `start`. Скан вверх, без обёртки. */
export async function findFreePort(start: number, range = PORT_WINDOW): Promise<number> {
  for (let p = start; p < start + range; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`[artube] нет свободного порта в диапазоне ${start}..${start + range - 1}`);
}

export interface SpawnedEngine {
  port: number;
  child: ChildProcess;
}

/**
 * Records a *post-start-window* failure for a given child — one that shows
 * up after `spawnEngine` has already judged it alive (e.g. it dies while
 * loading games, before it's reachable over gRPC). Read back by
 * `startEngine`'s readiness loop via `spawnFailureOf`. See the
 * `child.on('error', ...)` note in `spawnEngine` for why this exists.
 */
const spawnFailures = new WeakMap<ChildProcess, Error>();

export function spawnFailureOf(child: ChildProcess): Error | undefined {
  return spawnFailures.get(child);
}

/**
 * How long to give a freshly spawned child to prove it survived its own
 * bind attempt before `spawnEngine` calls it started. A real `e8-server`
 * that loses the port race (`EADDRINUSE`) exits within tens of ms of being
 * spawned — this window is generous margin over that, without meaningfully
 * slowing down the common (no collision) case.
 */
const SPAWN_CHECK_MS = 400;

/**
 * One initial attempt + this many retries on the next port, bounding the
 * search so a run of colliding processes can't retry forever.
 *
 * Used to be 24, sized for a collision storm that was itself a bug: the
 * loopback probe could not see an engine already listening on `0.0.0.0`, so
 * every process started from the same port and nearly every spawn lost the
 * race (see `isPortFree`). With an honest probe and a randomised starting
 * point, losing the race needs two processes to probe the *same* port in the
 * same instant — and losing it eight times in a row is no longer a case worth
 * waiting 10 seconds for; it's a case worth reporting.
 */
const MAX_SPAWN_ATTEMPTS = 8;

/**
 * Race the child's own 'error'/'exit' events against a short timer. Resolves
 * with the failure if the child dies within `windowMs`, or `undefined` if it
 * is still alive when the window elapses — the most a bare child process can
 * promise; confirming it's actually *ready* (gRPC reachable) is
 * `startEngine`'s job, not this one.
 */
function waitForEarlyDeath(
  child: ChildProcess,
  windowMs: number,
): Promise<NodeJS.ErrnoException | Error | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (err?: NodeJS.ErrnoException | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      resolve(err);
    };
    const onError = (err: NodeJS.ErrnoException) => finish(err);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`e8-server exited early (code ${code}, signal ${signal})`));
    const timer = setTimeout(() => finish(undefined), windowMs);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

/**
 * Убить движок вместе с процессом, который его завёл.
 *
 * Ребёнок не входит в жизненный цикл ноды сам по себе: процесс, который не
 * дошёл до `EngineClient.close()` — упавший хук в тесте, необработанное
 * исключение, `process.exit()` — оставляет `e8-server` жить, и его
 * переподчиняет init. Это не косметика:
 *
 *  - брошенный движок бессрочно держит порт из окна поиска, то есть портит не
 *    только свой прогон, но и все последующие (в этом репозитории нашлись
 *    трёхдневные сироты на 50251..50256);
 *  - он отвечает на gRPC тем же каталогом игр, что и живой, — значит
 *    подключиться к сироте с прошлого прогона и получить его кэш раундов
 *    ничему не противоречит. Именно так «пять зелёных прогонов» превращаются в
 *    красный на шестом.
 *
 * `process.on('exit')` покрывает нормальный выход, `process.exit()` и
 * необработанное исключение. Штатное завершение ПО СИГНАЛУ он не покрывает:
 * нода на SIGTERM/SIGINT без своего обработчика 'exit'-хуки не запускает.
 * Ставить их здесь нельзя — библиотека, перехватывающая Ctrl-C у хоста, лечит
 * не то; в продакшне оба сигнала уже ловит `bin/artube-server.ts` и звёт
 * `server.close()`. То, что остаётся (сирота после сигнала воркеру тестов),
 * теперь безвредно: честная проба порт сироты ВИДИТ и берёт другой, а окно
 * портов не пересекается с динамическим диапазоном — перехватить чужое
 * соединение сирота не может.
 */
const liveChildren = new Set<ChildProcess>();
let reaperInstalled = false;

function reapWithParent(child: ChildProcess): void {
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
  if (reaperInstalled) return;
  reaperInstalled = true;
  // Один слушатель на процесс, а не на ребёнка: девять живых движков в одном
  // файле тестов (http.test.ts) иначе дали бы MaxListenersExceededWarning —
  // предупреждение об утечке в коде, который её как раз и закрывает.
  process.on('exit', () => {
    for (const c of liveChildren) {
      if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    }
  });
}

/**
 * Spawn `e8-server`, tolerating the inherent probe-then-bind race: another
 * process can grab the port `findFreePort` just declared free before this
 * child gets to bind it. Same shape as `spinPlugin`'s `startServer()` (see
 * `packages/platform-core/src/vite/spinPlugin.ts`) — probe, spawn, watch for
 * an early death, and on failure retry from the next port, bounded by
 * `MAX_SPAWN_ATTEMPTS`.
 *
 * A missing binary (`ENOENT`) is not a port problem — retrying more ports
 * would just repeat the same `ENOENT` up to `MAX_SPAWN_ATTEMPTS` times for
 * no benefit — so that case fails fast on the first attempt instead.
 */
export async function spawnEngine(opts: {
  gamesDir: string;
  binPath?: string;
  port?: number;
  sessionTtlSec?: number;
}): Promise<SpawnedEngine> {
  const bin = resolveEngineBinary(opts.binPath);
  const basePort = opts.port ?? DEFAULT_ENGINE_PORT;
  // Явный порт значит «начни ровно здесь» (так `startEngine` уводит поиск с
  // порта, который только что не удался). Порт по умолчанию значит
  // «где-нибудь в окне» — см. PORT_FANOUT.
  let from =
    opts.port === undefined ? basePort + Math.floor(Math.random() * PORT_FANOUT) : basePort;
  let lastFailure: Error | undefined;

  for (let attempt = 1; attempt <= MAX_SPAWN_ATTEMPTS; attempt++) {
    const port = await findFreePort(from);
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
    // `ChildProcess` is an `EventEmitter`; an unlistened 'error' event (e.g.
    // ENOENT when `bin` doesn't exist) throws synchronously and takes down
    // the whole host process. Keep a permanent listener attached for the
    // child's whole lifetime — including failures after our own detection
    // window below — so it always becomes data: `startEngine`'s readiness
    // loop reads it back via `spawnFailureOf` and rejects with a clear
    // message naming the binary that failed, rather than crashing.
    child.on('error', (err) => spawnFailures.set(child, err));
    reapWithParent(child);

    const early = await waitForEarlyDeath(child, SPAWN_CHECK_MS);
    if (!early) return { port, child }; // survived the window — looks started

    if ((early as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`[artube] e8-server failed to start (${bin}): ${early.message}`);
    }

    // Anything else — a bind failure from the port being taken between
    // probe and spawn, a bad-args exit, ... — is treated as the port race
    // this function exists to survive, and retried from the next port.
    lastFailure = early;
    from = port + 1;
  }

  throw new Error(
    `[artube] e8-server не смог стартовать за ${MAX_SPAWN_ATTEMPTS} попыток начиная с порта ${basePort}` +
      (lastFailure ? `: ${lastFailure.message}` : ''),
  );
}
