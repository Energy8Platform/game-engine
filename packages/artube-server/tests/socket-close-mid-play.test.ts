/**
 * The player's socket dies between `play` and `result` — a refresh mid-spin, or the network going.
 *
 * Nothing on the server may treat that as a cancellation: the round is already the platform's
 * business. A one-shot round must still reach `PlayRound` (so the balance the reload reads from
 * SessionInfo already counts it), and a feature round must still be opened (so the reload gets it
 * back as `init.resume`, which the game drains). The platform's reply is held until the client is
 * gone, so the server provably learns about the close first.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakePlatform, type FakePlatform } from './helpers/fakePlatform';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let platform: FakePlatform | undefined;
let server: ArtubeServer | undefined;

afterEach(async () => {
  await server?.close();
  await platform?.close();
});

function connect(base: string, sessionId: string) {
  const socket = new WebSocket(`${base}/api/ws?sessionId=${sessionId}`);
  const messages: any[] = [];
  socket.on('message', (d) => messages.push(JSON.parse(d.toString())));
  const waitFor = (t: string, timeoutMs = 5000) =>
    new Promise<any>((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        const found = messages.find((m) => m.t === t);
        if (found) { clearInterval(tick); resolve(found); }
        else if (Date.now() - started > timeoutMs) {
          clearInterval(tick);
          reject(new Error(`no ${t}; got ${JSON.stringify(messages)}`));
        }
      }, 10);
    });
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  return { socket, messages, waitFor, closed };
}

const until = async (cond: () => boolean, timeoutMs = 5000) => {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('a client socket closed mid-play', () => {
  it('a one-shot round still settles, and the reload reads the settled balance', async () => {
    let client: ReturnType<typeof connect> | null = null;
    platform = await startFakePlatform({
      allowedBets: [1],
      intercept: (env, ctl) => {
        if (env.type !== 'PlayRoundRequest') return false;
        // The player is gone before the platform answers.
        client!.socket.terminate();
        void client!.closed.then(() =>
          setTimeout(() => {
            const p = env.payload;
            ctl.platform.balance += (p.win_multiplier - p.price_multiplier) * 1;
            ctl.reply('PlayRoundResponse', {
              round_id: 'round-1', balance: ctl.platform.balance,
              win: p.win_multiplier, is_platform_max_win_reached: false,
            });
          }, 100),
        );
        return true;
      },
    });
    server = createArtubeServer({
      gameId: 'one-shot-game', gamesApiUrl: platform.url, apiKey: 'k', spinPath: fixtures,
    });
    await server.listen(0, '127.0.0.1');
    const base = `ws://127.0.0.1:${server.port}`;

    client = connect(base, 'sess-refresh');
    await client.waitFor('init');
    client.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'one_shot', betIndex: 0 }));
    await client.closed;
    await until(() => platform!.balance === 99); // the platform took the bet: the round went through

    const back = connect(base, 'sess-refresh');
    const init = await back.waitFor('init');
    expect(init.balance).toBe(99);
    expect(init.resume).toBeNull();
    expect(platform.countOf('PlayRoundRequest')).toBe(1);
    back.socket.close();
  }, 40_000);

  it('a feature round is still opened, and the reload gets it back to drain', async () => {
    let client: ReturnType<typeof connect> | null = null;
    platform = await startFakePlatform({
      allowedBets: [0.5, 2],
      intercept: (env) => {
        if (env.type === 'OpenRoundRequest') client!.socket.terminate();
        return false; // the platform answers as usual; the client is already gone
      },
    });
    server = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: platform.url, apiKey: 'k', spinPath: fixtures,
    });
    await server.listen(0, '127.0.0.1');
    const base = `ws://127.0.0.1:${server.port}`;

    client = connect(base, 'sess-feature');
    await client.waitFor('init');
    client.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 1 }));
    await client.closed;
    await until(() => platform!.countOf('OpenRoundRequest') === 1);
    await new Promise((r) => setTimeout(r, 100)); // let the server finish the round's bookkeeping

    const back = connect(base, 'sess-feature');
    const init = await back.waitFor('init');
    expect(init.resume).toBeTruthy();
    expect(init.resume.action).toBe('spin');
    expect(init.resume.creditPending).toBe(true);
    expect(init.balance).toBe(100 - 2); // the bet left once, at OpenRound
    back.socket.close();
  }, 40_000);
});
