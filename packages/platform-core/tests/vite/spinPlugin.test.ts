// spinPlugin end-to-end: vite dev server + живой e8-server. Гейтится на
// наличие бинаря (его качает postinstall; локально — E8_SERVER_BINARY).
// Проверяет клиентский контракт глобалов: player-persist приезжает в
// data.persistent_state и растёт ЧЕРЕЗ раунды (meter.spin: +1 за спин).
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { spinPlugin } from '../../src/vite/spinPlugin';

function serverBinary(): string | null {
  const env = process.env.E8_SERVER_BINARY;
  if (env && existsSync(env)) return env;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const name = `e8-server-${process.platform}-${arch}${process.platform === 'win32' ? '.exe' : ''}`;
  const candidate = resolve(__dirname, '../../bin', name);
  return existsSync(candidate) ? candidate : null;
}

const bin = serverBinary();
const started: ViteDevServer[] = [];
let vite: ViteDevServer | null = null;

afterAll(async () => {
  await Promise.all(started.map((s) => s.close()));
});

/** держим TCP-порт занятым, как это делает чужой e8-server */
function occupy(port: number): Promise<() => Promise<void>> {
  return new Promise((res, rej) => {
    const s = createNetServer();
    s.once('error', rej);
    s.listen(port, '0.0.0.0', () =>
      res(() => new Promise<void>((done) => s.close(() => done()))),
    );
  });
}

async function play(port: number, body: unknown): Promise<any> {
  // e8-server стартует ~секунду — ретраим 500-ки, пока грузится
  const deadline = Date.now() + 15_000;
  for (;;) {
    const res = await fetch(`http://localhost:${port}/__lua-play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 200) return res.json();
    if (Date.now() > deadline) {
      throw new Error(`__lua-play ${res.status}: ${await res.text()}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe.skipIf(!bin)('spinPlugin + e8-server (globals → data.persistent_state)', () => {
  it('player-persist survives across rounds and reaches the client payload', async () => {
    vite = await createServer({
      configFile: false,
      root: __dirname,
      logLevel: 'silent',
      plugins: [
        spinPlugin({
          spinPath: resolve(__dirname, 'fixtures/meter.spin'),
          gameId: 'meter-game',
          port: 50171,
        }),
      ],
      server: { port: 0 },
    });
    started.push(vite);
    await vite.listen();
    const address = vite.httpServer!.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    // Раунд 1: метр = 1, и он в клиентском data.persistent_state
    const r1 = await play(port, { action: 'spin', bet: 1, roundId: 'meter-r1' });
    expect(r1.data.meter).toBe(1);
    expect(r1.data.persistent_state).toEqual({ meter: 1 });

    // Раунд 2 (НОВЫЙ roundId — межраундовый персист, не сессия)
    const r2 = await play(port, { action: 'spin', bet: 1, roundId: 'meter-r2' });
    expect(r2.data.meter).toBe(2);
    expect(r2.data.persistent_state).toEqual({ meter: 2 });
  }, 30_000);
});

describe.skipIf(!bin)('spinPlugin port autodiscovery', () => {
  it('falls forward to a free port when the base one is taken', async () => {
    // 50181 занят «чужим» процессом — плагин обязан уйти на следующий
    // свободный, а не молча ходить в чужой сервер (или не подняться вовсе)
    const release = await occupy(50181);
    try {
      const server = await createServer({
        configFile: false,
        root: __dirname,
        logLevel: 'silent',
        plugins: [
          spinPlugin({
            spinPath: resolve(__dirname, 'fixtures/meter.spin'),
            gameId: 'meter-game',
            port: 50181,
          }),
        ],
        server: { port: 0 },
      });
      started.push(server);
      await server.listen();
      const address = server.httpServer!.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      // раунд отыгрался ⇒ e8-server поднялся, несмотря на занятый 50181
      const r = await play(port, { action: 'spin', bet: 1, roundId: 'shift-r1' });
      expect(r.data.meter).toBeGreaterThan(0);
    } finally {
      await release();
    }
  }, 30_000);
});
