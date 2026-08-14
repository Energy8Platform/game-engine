/**
 * Цикл переподключения: сколько раз клиент готов звать платформу и с какими
 * паузами.
 *
 * Тот же дефект, что и `GoAway` как терминальный, вторым маршрутом. Пять
 * попыток по `1000 * 2 ** n` — это 31 секунда, после которой цикл выходил,
 * `reconnecting` становился false, и не оставалось ни одного сокета, чей
 * `close` мог бы позвать `scheduleReconnect()` ещё раз: под жив, `/livez`
 * зелёный, платформы нет никогда. А сама дока (`goaway.md`) объявляет окна в
 * 300 000 мс (обновление сервера) и 1 800 000 мс (техобслуживание) — то есть
 * плановое окно, о котором нас предупредили заранее, переживало весь наш
 * бюджет попыток целиком.
 *
 * Тесты гоняют цикл на фальшивом таймере и с подменённым `openSocket`: 30
 * минут аварии должны стоить миллисекунды, а расписание пауз — быть
 * наблюдаемым точно, а не «примерно за какое-то время».
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  GamesApiClient, reconnectBackoffMs, MAX_BACKOFF_DELAY_MS, MAX_RECONNECT_DELAY_MS,
  type GamesApiClientOptions, type ReconnectAttempt,
} from '../src/games-api/client';

const HALF_HOUR_MS = 1_800_000;

/**
 * Клиент, у которого попытка коннекта всегда мгновенно падает.
 *
 * Настоящий сокет тут только помешал бы: авария — это как раз недоступная
 * платформа, а `openSocket` приватен лишь для внешнего мира (в рантайме это
 * обычный метод прототипа, и подмена на экземпляре его перекрывает).
 *
 * Цикл заводим напрямую: в бою его заводит `close`-хендлер внутри самого
 * `openSocket`, которого здесь нет. Что эта проводка на месте, проверяют тесты
 * на настоящих сокетах — `client-connect.test.ts` и `goaway.test.ts`.
 */
function failingClient(opts: Partial<GamesApiClientOptions> = {}) {
  const client = new GamesApiClient({
    url: 'ws://127.0.0.1:1/unreachable', apiKey: 'k', gameId: 'g',
    baseReconnectDelayMs: 1000, ...opts,
  });
  const attempts: number[] = [];
  const delays: number[] = [];
  let reachable = false;
  client.on('reconnecting', (a: ReconnectAttempt) => delays.push(a.delayMs));
  (client as any).openSocket = () => {
    attempts.push(Date.now());
    if (!reachable) return Promise.reject(new Error('games api is down'));
    // То, что делает настоящий `openSocket`, когда коннект состоялся.
    (client as any).socketOpenedAt = Date.now();
    (client as any).ready = true;
    (client as any).emit('connected');
    return Promise.resolve();
  };
  return {
    client, attempts, delays,
    start: () => void (client as any).scheduleReconnect(),
    /** Платформа вернулась (или снова пропала). */
    letIn: (v = true) => { reachable = v; },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('переподключение не сдаётся', () => {
  it('продолжает звать платформу далеко за прежним бюджетом в пять попыток', async () => {
    vi.useFakeTimers();
    // Без джиттера расписание точное: 1, 2, 4, 8, 16, 32, 60, 60, ... секунд.
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { client, attempts, start } = failingClient();
    start();

    // Ровно тот момент, где прежняя реализация замолкала навсегда.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(attempts).toHaveLength(5);
    expect(client.retrying).toBe(true);

    // Окно техобслуживания из доки целиком — и мы всё ещё здесь.
    await vi.advanceTimersByTimeAsync(HALF_HOUR_MS);
    expect(attempts.length).toBeGreaterThan(30);
    expect(client.retrying).toBe(true);
    expect(client.connected).toBe(false);

    client.close();
  });

  it('переподключается, когда платформа вернулась через час — а не остаётся глухим', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { client, attempts, start, letIn } = failingClient();
    let connected = false;
    client.on('connected', () => { connected = true; });
    start();

    await vi.advanceTimersByTimeAsync(3600_000);
    expect(connected).toBe(false);

    // Платформа поднялась. Клиента никто не трогал — он просто пробует дальше.
    letIn();
    const before = attempts.length;
    // Потолок паузы и есть цена возвращения: не больше минуты простоя после
    // того, как всё починилось.
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_DELAY_MS);
    expect(attempts.length).toBe(before + 1);
    expect(connected).toBe(true);
    expect(client.retrying).toBe(false);

    client.close();
  });
});

describe('ограничена пауза, а не число попыток', () => {
  it('пауза упирается в потолок вместо бесконечного удвоения', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { client, delays, start } = failingClient();
    start();
    await vi.advanceTimersByTimeAsync(HALF_HOUR_MS);

    expect(delays.slice(0, 7)).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 60_000]);
    expect(Math.max(...delays)).toBe(MAX_BACKOFF_DELAY_MS);
    // Хвост — ровно на потолке: удвоение остановилось, а не замедлилось.
    expect(delays.slice(-10).every((d) => d === MAX_BACKOFF_DELAY_MS)).toBe(true);

    client.close();
  });

  it('потолок бэкоффа взят из доки и не мешает платформе назначить своё окно', () => {
    // Самая короткая пауза, которую называет дока (`goaway.md`, перегрузка) —
    // темп, приемлемый для платформы в худший для неё момент.
    expect(MAX_BACKOFF_DELAY_MS).toBe(60_000);
    // И это НЕ тот потолок, что ограничивает `retry_after_ms`: получасовое
    // окно техобслуживания мы обязаны выждать целиком.
    expect(MAX_RECONNECT_DELAY_MS).toBe(HALF_HOUR_MS);
    expect(MAX_BACKOFF_DELAY_MS).toBeLessThan(MAX_RECONNECT_DELAY_MS);
  });

  it('экспонента растёт, упирается в потолок и не ломается на больших номерах', () => {
    const full = { jitter: () => 1 };
    expect(reconnectBackoffMs(0, { base: 1000, ...full })).toBe(1000);
    expect(reconnectBackoffMs(3, { base: 1000, ...full })).toBe(8000);
    expect(reconnectBackoffMs(6, { base: 1000, ...full })).toBe(MAX_BACKOFF_DELAY_MS);
    // `2 ** 1024` — уже Infinity; ни NaN, ни бесконечной паузы отсюда выйти
    // не должно.
    expect(reconnectBackoffMs(5000, { base: 1000, ...full })).toBe(MAX_BACKOFF_DELAY_MS);
  });

  it('джиттер разводит попытки, но не обнуляет паузу', () => {
    // Связь теряют не по одному: реплики сервиса рвутся в одну миллисекунду.
    for (const rand of [0, 0.25, 0.5, 0.75, 1]) {
      const d = reconnectBackoffMs(2, { base: 1000, jitter: () => rand });
      expect(d).toBeGreaterThanOrEqual(2000); // половина номинала — жёсткая
      expect(d).toBeLessThanOrEqual(4000);
    }
    const drawn = new Set(
      Array.from({ length: 50 }, () => reconnectBackoffMs(10, { base: 1000 })),
    );
    expect(drawn.size).toBeGreaterThan(1); // не все поды в одну секунду
    for (const d of drawn) {
      expect(d).toBeGreaterThanOrEqual(MAX_BACKOFF_DELAY_MS / 2);
      expect(d).toBeLessThanOrEqual(MAX_BACKOFF_DELAY_MS);
    }
  });

  it('мусорная стартовая пауза не превращает цикл в горячий', async () => {
    // Ноль — не «подключайся быстрее», а тысячи коннектов в секунду.
    expect(reconnectBackoffMs(0, { base: 0, jitter: () => 1 })).toBe(1000);
    expect(reconnectBackoffMs(0, { base: -5, jitter: () => 1 })).toBe(1000);
    expect(reconnectBackoffMs(0, { base: Number.NaN, jitter: () => 1 })).toBe(1000);

    vi.useFakeTimers();
    const { client, attempts, start } = failingClient({ baseReconnectDelayMs: 0 });
    start();
    await vi.advanceTimersByTimeAsync(HALF_HOUR_MS);
    // Мгновенно падающие попытки за полчаса: десятки, а не миллионы.
    expect(attempts.length).toBeLessThan(80);
    client.close();
  });

  it('коннект, не проживший минуты, не обнуляет бэкофф', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { client, attempts, delays, start, letIn } = failingClient();
    start();
    await vi.advanceTimersByTimeAsync(7_100);
    expect(attempts).toHaveLength(3);
    // Последняя пауза объявлена, но ещё не истекла — попытка №4 ждёт.
    expect(delays).toEqual([1000, 2000, 4000, 8000]);

    // Платформа пустила — четвёртая попытка удалась, цикл вышел.
    letIn();
    await vi.advanceTimersByTimeAsync(8_100);
    expect(client.retrying).toBe(false);

    // ...и уронила коннект через секунду. Его `close` заводит цикл заново.
    letIn(false);
    await vi.advanceTimersByTimeAsync(1_000);
    start();
    // Начинать со стартовой паузы значило бы вечно долбить платформу, которая
    // роняет коннект сразу за рукопожатием: связи нет, а мы стучим раз в
    // секунду и никогда не разводим попытки.
    expect(delays.at(-1)).toBe(16_000);

    // А коннект, проживший минуту, — это состоявшаяся связь, и следующий
    // обрыв уже новая авария: разводку начинаем сначала.
    letIn();
    await vi.advanceTimersByTimeAsync(16_100);
    expect(client.retrying).toBe(false);
    letIn(false);
    await vi.advanceTimersByTimeAsync(61_000);
    start();
    expect(delays.at(-1)).toBe(1000);

    client.close();
  });
});

describe('цикл управляем', () => {
  it('close() выходит из цикла немедленно, не дожидаясь конца паузы', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { client, attempts, start } = failingClient();
    start();
    // Разгоняемся до потолка: цикл спит целую минуту.
    await vi.advanceTimersByTimeAsync(120_000);
    const before = attempts.length;
    expect(client.retrying).toBe(true);

    client.close();
    // Ни одного тика фальшивого времени — цикл обязан выйти сам.
    await vi.advanceTimersByTimeAsync(0);
    expect(client.retrying).toBe(false);

    await vi.advanceTimersByTimeAsync(HALF_HOUR_MS);
    expect(attempts).toHaveLength(before);
  });

  it('второй заход не разводит параллельные циклы', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { client, attempts, start } = failingClient();
    start();
    start();
    start();
    await vi.advanceTimersByTimeAsync(31_000);
    // Расписание одного цикла, а не трёх наложенных друг на друга.
    expect(attempts).toHaveLength(5);
    client.close();
  });

  it('переданный явно конечный бюджет заканчивается видимой остановкой', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { client, attempts, start } = failingClient({ maxReconnectAttempts: 3 });
    const abandoned: number[] = [];
    client.on('reconnectAbandoned', (n: number) => abandoned.push(n));
    start();
    await vi.advanceTimersByTimeAsync(HALF_HOUR_MS);

    expect(attempts).toHaveLength(3);
    // «Сдался» обязано быть отличимо от «ещё ищет» — иначе оператор смотрит на
    // ровно ту же картину, что и при баге.
    expect(abandoned).toEqual([3]);
    expect(client.retrying).toBe(false);
    expect(client.connected).toBe(false);
    client.close();
  });

  it('по умолчанию бюджета нет — конечным его делает только явная опция', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { client, start } = failingClient();
    const abandoned: number[] = [];
    client.on('reconnectAbandoned', (n: number) => abandoned.push(n));
    start();
    await vi.advanceTimersByTimeAsync(HALF_HOUR_MS * 8);
    expect(abandoned).toEqual([]);
    expect(client.retrying).toBe(true);
    client.close();
  });
});

describe('оператору видно, что под ещё ищет платформу', () => {
  it('каждая попытка объявлена, а частоту строк задаёт сам бэкофф', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const client = new GamesApiClient({
      url: 'ws://127.0.0.1:1/unreachable', apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 1000,
    });
    const seen: ReconnectAttempt[] = [];
    client.on('reconnecting', (a: ReconnectAttempt) => seen.push(a));
    (client as any).openSocket = () => Promise.reject(new Error('down'));
    void (client as any).scheduleReconnect();

    await vi.advanceTimersByTimeAsync(60_000);
    // Первая минута аварии — единицы строк, а не тысячи.
    expect(seen.length).toBeLessThanOrEqual(6);
    expect(seen[0]).toEqual({ attempt: 1, delayMs: 1000, planned: false });
    expect(seen.at(-1)!.attempt).toBe(seen.length);

    const afterFirstMinute = seen.length;
    await vi.advanceTimersByTimeAsync(HALF_HOUR_MS);
    // Дальше — не чаще одной строки в минуту на под.
    expect(seen.length - afterFirstMinute).toBeLessThanOrEqual(HALF_HOUR_MS / 60_000);
    expect(client.attempts).toBe(seen.length);

    client.close();
  });

  it('пауза по расписанию платформы помечена как плановая, а не как авария', async () => {
    vi.useFakeTimers();
    const client = new GamesApiClient({
      url: 'ws://127.0.0.1:1/unreachable', apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 1000,
    });
    const seen: ReconnectAttempt[] = [];
    client.on('reconnecting', (a: ReconnectAttempt) => seen.push(a));
    (client as any).openSocket = () => Promise.reject(new Error('down'));
    // Ровно то, что оставляет после себя `GoAway` перед закрытием коннекта.
    (client as any).goAwayDelayMs = 300_000;
    void (client as any).scheduleReconnect();

    await vi.advanceTimersByTimeAsync(300_000);
    expect(seen[0]).toEqual({ attempt: 1, delayMs: 300_000, planned: true });
    // И тратится она ровно один раз: дальше это обычный сбой связи.
    expect(seen[1].planned).toBe(false);
    expect(seen[1].delayMs).toBeLessThanOrEqual(MAX_BACKOFF_DELAY_MS);

    client.close();
  });
});
