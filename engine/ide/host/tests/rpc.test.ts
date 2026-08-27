import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import { createIdeHost, type IdeHost } from '../src/index';

// Template fixture (checked in, read-only) copied into a fresh, disposable
// temp directory per test — not fixtures/workspace (its e8.yml must stay
// `[]`, per the composition tests it backs) and not fixtures/composition
// (Task 4's own read-only fixture). These tests send `update` frames over
// the socket, which mutate the composition file on disk via the same
// `@cordisjs/plugin-include` write path Task 5 documented in
// update.test.ts: an unowned, uncancellable `setTimeout(0)` write that
// nothing can await or safely race a cleanup against. So this file follows
// the same pattern update.test.ts settled on after three measured attempts
// (see that file's comment block): a fresh mkdtempSync directory per test,
// pointed at by `cwd`, and no attempt to delete it afterwards.
const TEMPLATE_FILE = join(__dirname, 'fixtures', 'update-workspace', 'e8.yml');

// Same resolution trick as update.test.ts: `readPackageJson()` walks up
// from `cwd` via `createRequire(cwd)`, which finds nothing above a bare OS
// temp directory. Resolve where `probe-plugin` actually lives once, then
// symlink it into each temp workspace's own node_modules.
const PROBE_PLUGIN_DIR = dirname(
  createRequire(join(__dirname, 'noop.js')).resolve('probe-plugin/package.json'),
);

let host: IdeHost;
let socket: WebSocket;

/**
 * Buffers every frame the socket receives so `waitFor` can scan past
 * messages that don't match what a given test cares about, instead of
 * grabbing "the next message" and assuming it's the relevant one. The rpc
 * plugin broadcasts a fresh snapshot both explicitly after a successful
 * `update` and reactively off `internal/status` / `loader/config-update`,
 * so more than one frame can legitimately follow a single client message,
 * in an order this test must not assume.
 */
function createInbox(socket: WebSocket) {
  const queue: ServerMessage[] = [];
  const waiters: Array<(message: ServerMessage) => void> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  return {
    async waitFor(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
      for (;;) {
        const message =
          queue.length > 0
            ? queue.shift()!
            : await new Promise<ServerMessage>((resolve) => waiters.push(resolve));
        if (predicate(message)) return message;
      }
    },
  };
}

let inbox: ReturnType<typeof createInbox>;

beforeEach(async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ide-host-rpc-'));
  writeFileSync(join(workspace, 'e8.yml'), readFileSync(TEMPLATE_FILE, 'utf8'));
  mkdirSync(join(workspace, 'node_modules'));
  symlinkSync(PROBE_PLUGIN_DIR, join(workspace, 'node_modules', 'probe-plugin'), 'dir');
  (globalThis as any).__probeApplied = [];

  host = await createIdeHost({ cwd: workspace, port: 0 });
  socket = new WebSocket(`${host.url.replace('http', 'ws')}/ide`);
  inbox = createInbox(socket);
  await new Promise((resolve) => socket.once('open', resolve));
});

afterEach(async () => {
  socket.close();
  await host.stop();
  // No rmSync of the temp workspace — see the comment on TEMPLATE_FILE.
});

describe('ide rpc', () => {
  it('pushes a snapshot as soon as the browser connects', async () => {
    const message = await inbox.waitFor(() => true);
    expect(message.type).toBe('snapshot');
    expect(
      message.type === 'snapshot' && message.snapshot.rows.some((r) => r.name === 'probe-plugin'),
    ).toBe(true);
  });

  it('pushes a fresh snapshot after an update arrives from the browser', async () => {
    const first = await inbox.waitFor((m) => m.type === 'snapshot');
    const id =
      first.type === 'snapshot'
        ? first.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id
        : '';

    socket.send(JSON.stringify({ type: 'update', id, config: { speed: 5 } }));

    const updated = await inbox.waitFor(
      (m) =>
        m.type === 'snapshot' &&
        m.snapshot.rows.find((r) => r.id === id)?.config !== undefined &&
        JSON.stringify(m.snapshot.rows.find((r) => r.id === id)?.config) ===
          JSON.stringify({ speed: 5 }),
    );
    expect(
      updated.type === 'snapshot' && updated.snapshot.rows.find((r) => r.id === id)!.config,
    ).toEqual({
      speed: 5,
    });
  });

  it('sends diagnostics when the update is rejected, and does not disconnect', async () => {
    const first = await inbox.waitFor((m) => m.type === 'snapshot');
    const id =
      first.type === 'snapshot'
        ? first.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id
        : '';

    socket.send(JSON.stringify({ type: 'update', id, config: { speed: 999 } }));

    const diagnosticsMessage = await inbox.waitFor((m) => m.type === 'diagnostics');
    expect(diagnosticsMessage.type).toBe('diagnostics');
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it('ignores malformed frames instead of crashing the connection', async () => {
    const first = await inbox.waitFor((m) => m.type === 'snapshot');
    const id =
      first.type === 'snapshot'
        ? first.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id
        : '';

    // `null` is valid JSON but not an object — `JSON.parse` succeeds, so a
    // handler that only guards the parse call (not the shape) would throw
    // on `.type` outside its own try/catch. Cover the whole family a real
    // browser bug could send: unparsable JSON, a bare primitive, an array,
    // and a well-formed object with an unknown `type`. None of these are
    // expected to produce a reply — if the connection survived them, the
    // update sent right after this loop still gets its normal broadcast.
    for (const frame of [
      'not json',
      'null',
      '42',
      '[]',
      JSON.stringify({ type: 'not-a-real-type' }),
    ]) {
      socket.send(frame);
    }

    socket.send(JSON.stringify({ type: 'update', id, config: { speed: 7 } }));

    const updated = await inbox.waitFor(
      (m) =>
        m.type === 'snapshot' &&
        JSON.stringify(m.snapshot.rows.find((r) => r.id === id)?.config) ===
          JSON.stringify({ speed: 7 }),
    );
    expect(
      updated.type === 'snapshot' && updated.snapshot.rows.find((r) => r.id === id)!.config,
    ).toEqual({
      speed: 7,
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });
});
