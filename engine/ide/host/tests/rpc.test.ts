import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import Server from '@cordisjs/plugin-server';
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
let workspace: string;
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
  workspace = mkdtempSync(join(tmpdir(), 'ide-host-rpc-'));
  writeFileSync(join(workspace, 'e8.yml'), readFileSync(TEMPLATE_FILE, 'utf8'));
  mkdirSync(join(workspace, 'node_modules'));
  symlinkSync(PROBE_PLUGIN_DIR, join(workspace, 'node_modules', 'probe-plugin'), 'dir');
  (globalThis as any).__probeApplied = [];

  host = await createIdeHost({ root: workspace, port: 0 });
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
  it('pushes the workspace, then a snapshot, as soon as the browser connects', async () => {
    // Workspace FIRST (spec §9): the client learns which project the rows
    // belong to before it sees any rows.
    const first = await inbox.waitFor(() => true);
    expect(first.type).toBe('workspace');
    expect(first.type === 'workspace' && first.workspace.active).toBe(basename(workspace));
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

/**
 * A game's own diagnostics (`ide-bridge`'s `game-diagnostics` frame,
 * Task 5) riding the SAME `/ide` socket the composition already does.
 * Today's guard accepts only `update` — these tests widen that without
 * losing the "malformed frames are ignored" reasoning already sitting on
 * it, and prove a game diagnostic is RELAYED (to every OTHER socket, never
 * echoed to the sender) rather than fed through `ctx.composition.update()`
 * or re-labelled as a project `{type:'diagnostics'}`.
 *
 * `twoClients`/`connect` from the plan's own brief don't exist as named
 * helpers anywhere in this file or package — this suite already has a
 * working connect-and-buffer pattern (`createInbox`, above), built for a
 * single socket that consumes each message once. These tests need to
 * inspect a socket's WHOLE received history after the fact (e.g. "no
 * `game-diagnostics` frame is in here at all"), which a consume-once queue
 * cannot answer, so `collectMessages` below is a plain accumulator instead
 * — same connection mechanics, a shape suited to what these four tests
 * actually assert.
 */
/**
 * The game's own socket (Task 4): `dev-game` attaches this same handler to
 * the preview server with `accept: ['game-diagnostics']`. Unrestricted,
 * any page served from the game's origin could send `update` and rewrite
 * `e8.yml` — the reach spec §6's own-origin rule exists to deny. A second
 * server stands in for the preview here, attached the way `dev-game`
 * attaches it.
 */
describe('ide rpc — a send-restricted attachment', () => {
  async function restrictedSocket(): Promise<{
    socket: WebSocket;
    inbox: ReturnType<typeof createInbox>;
  }> {
    const fiber = host.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    host.ctx.ideRpc.attach(fiber.ctx.server, { accept: ['game-diagnostics'] });
    const gameSocket = new WebSocket(`ws://127.0.0.1:${fiber.ctx.server.port}/ide`);
    const gameInbox = createInbox(gameSocket);
    await new Promise((resolve) => gameSocket.once('open', resolve));
    return { socket: gameSocket, inbox: gameInbox };
  }

  it('drops an update from the game socket silently; the same update over the root still applies', async () => {
    const first = await inbox.waitFor((m) => m.type === 'snapshot');
    const id =
      first.type === 'snapshot'
        ? first.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id
        : '';
    const before = readFileSync(join(workspace, 'e8.yml'), 'utf8');
    const game = await restrictedSocket();
    // Receiving is intact: the greeting still arrives (ide-bridge's hot rebind needs `snapshot`).
    expect((await game.inbox.waitFor((m) => m.type === 'snapshot')).type).toBe('snapshot');

    const rootFrames: ServerMessage[] = [];
    socket.on('message', (data) => rootFrames.push(JSON.parse(String(data)) as ServerMessage));
    game.socket.send(JSON.stringify({ type: 'update', id, config: { speed: 5 } }));
    // Same socket, so the frames are handled in order: once this relay has
    // reached the editor, the `update` before it has already been dropped.
    game.socket.send(
      JSON.stringify({
        type: 'game-diagnostics',
        diagnostics: [{ severity: 'error', plugin: 'session', where: 'x', message: 'marker' }],
        dropped: 0,
      }),
    );
    await inbox.waitFor((m) => m.type === 'game-diagnostics');
    await new Promise((resolve) => setImmediate(resolve));

    expect(readFileSync(join(workspace, 'e8.yml'), 'utf8')).toBe(before);
    expect(rootFrames.map((m) => m.type)).not.toContain('diagnostics');
    expect(
      rootFrames.some(
        (m) =>
          m.type === 'snapshot' &&
          JSON.stringify(m.snapshot.rows.find((r) => r.id === id)?.config) ===
            JSON.stringify({ speed: 5 }),
      ),
    ).toBe(false);
    // And the game socket itself was told nothing — no acknowledgement of any kind.
    expect(game.socket.readyState).toBe(WebSocket.OPEN);

    // The root's own socket is unrestricted: the editor still edits.
    socket.send(JSON.stringify({ type: 'update', id, config: { speed: 5 } }));
    await inbox.waitFor(
      (m) =>
        m.type === 'snapshot' &&
        JSON.stringify(m.snapshot.rows.find((r) => r.id === id)?.config) ===
          JSON.stringify({ speed: 5 }),
    );
    game.socket.close();
  });
});

describe('ide rpc — a game reports its own diagnostics', () => {
  function collectMessages(ws: WebSocket): ServerMessage[] {
    const received: ServerMessage[] = [];
    ws.on('message', (data) => received.push(JSON.parse(String(data)) as ServerMessage));
    return received;
  }

  async function connectClient(): Promise<{ ws: WebSocket; received: ServerMessage[] }> {
    const ws = new WebSocket(`${host.url.replace('http', 'ws')}/ide`);
    const received = collectMessages(ws);
    await new Promise((resolve) => ws.once('open', resolve));
    return { ws, received };
  }

  const frame = {
    type: 'game-diagnostics',
    diagnostics: [
      { severity: 'error', plugin: 'reels', where: 'runtime', message: 'reels blew up' },
    ],
  };

  let game: { ws: WebSocket; received: ServerMessage[] };
  let editor: { ws: WebSocket; received: ServerMessage[] };

  beforeEach(async () => {
    // `socket`/`inbox` from the outer `beforeEach` are left alone — this
    // describe block owns its own pair of clients so "the game" and "the
    // editor" are unambiguously two different sockets.
    game = await connectClient();
    editor = await connectClient();
  });

  afterEach(() => {
    game.ws.close();
    editor.ws.close();
  });

  it('passes a game diagnostic on to the other clients', async () => {
    game.ws.send(JSON.stringify(frame));
    await expect.poll(() => editor.received).toContainEqual(expect.objectContaining(frame));
  });

  it('does not echo it back to the game that sent it', async () => {
    // A negative can't be proven by racing against a DIFFERENT connection
    // (waiting for `editor` to receive something, then immediately
    // checking `game`) — cross-connection delivery order is not
    // guaranteed, only PER-connection order is; measured directly, that
    // race let a mutant that echoes to every client (sender included)
    // slip through, because `game`'s own echo had not always finished
    // arriving on ITS socket by the time `editor`'s had arrived on a
    // different one.
    //
    // So this waits for a reply on GAME'S OWN connection instead: an
    // `update` sent right after the diagnostics frame is handled strictly
    // after it by the same single-threaded server on the same socket (the
    // `game-diagnostics` branch has no `await` before it finishes queueing
    // whatever it queues), and TCP preserves per-connection order. By the
    // time `game.ws` receives the `update`'s own reply, any echo the
    // diagnostics frame might have produced on this SAME socket has
    // necessarily already arrived, if it was ever going to.
    await expect.poll(() => game.received.some((m) => m.type === 'snapshot')).toBe(true);
    const snapshot = game.received.find((m) => m.type === 'snapshot')!;
    const id =
      snapshot.type === 'snapshot'
        ? snapshot.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id
        : '';

    game.ws.send(JSON.stringify(frame));
    game.ws.send(JSON.stringify({ type: 'update', id, config: { speed: 6 } }));

    await expect
      .poll(() =>
        game.received.some(
          (m) =>
            m.type === 'snapshot' &&
            JSON.stringify(m.snapshot.rows.find((r) => r.id === id)?.config) ===
              JSON.stringify({ speed: 6 }),
        ),
      )
      .toBe(true);
    expect(game.received.filter((m) => m.type === 'game-diagnostics')).toEqual([]);
  });

  it('still ignores a malformed frame', async () => {
    // The existing guard's reason is in a comment above it — null, an array
    // and a primitive all survive JSON.parse and would throw on `.type`
    // outside the catch. Do not lose that while widening the accepted set.
    for (const bad of ['null', '[]', '42', '{"type":"nope"}']) game.ws.send(bad);
    game.ws.send(JSON.stringify(frame)); // a good one after, to prove liveness
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toHaveLength(1);
  });

  it('a game diagnostic does not become a project diagnostic', async () => {
    game.ws.send(JSON.stringify(frame));
    // `.length > 0` alone is armed by the UNRELATED connect-time snapshot
    // `editor` already got when it connected (pushed on no fixed schedule
    // relative to when this test's `beforeEach` returns), which would let
    // the assertion below run before the relay's own result has arrived —
    // proving nothing either way. Waiting for the specific, correctly-typed
    // frame ties the wait to the event this test is actually about, the
    // same way the "passes it on" test above does.
    await expect.poll(() => editor.received).toContainEqual(expect.objectContaining(frame));
    expect(editor.received.filter((m) => m.type === 'diagnostics')).toEqual([]);
  });

  /**
   * The reconnect gap the coordinator found on a live host: a client that
   * connects (or reconnects) AFTER a game already reported trouble used to
   * see only a `Snapshot`, and never learned about the failure at all. The
   * four tests above all wait on a socket that was ALREADY listening when
   * the report happened — none of them could have caught this. These two
   * connect their observer AFTER the report instead, matching how the
   * coordinator reproduced it: "a client that connects after the report,
   * not one that was already listening."
   */
  describe('a client that connects after the fact', () => {
    it('still receives the last game-diagnostics frame, not only a snapshot', async () => {
      game.ws.send(JSON.stringify(frame));
      // Confirmed landed on the already-listening `editor` first, so the
      // host has provably recorded it before `late` connects — not a race
      // against the write.
      await expect.poll(() => editor.received).toContainEqual(expect.objectContaining(frame));

      const late = await connectClient(); // simulates a reloaded IDE tab
      await expect.poll(() => late.received.some((m) => m.type === 'game-diagnostics')).toBe(true);
      expect(late.received.filter((m) => m.type === 'game-diagnostics')).toEqual([
        expect.objectContaining(frame),
      ]);

      late.ws.close();
    });

    // Decision 2 (see `lastGameDiagnostics`'s own doc in rpc.ts): the
    // retained frame survives the reporting socket's own disconnect — a
    // game going quiet BECAUSE it crashed is exactly the case this exists
    // for, and clearing on close would erase the failure at the moment it
    // matters most.
    it('keeps the last frame even after the game that reported it has disconnected', async () => {
      game.ws.send(JSON.stringify(frame));
      await expect.poll(() => editor.received).toContainEqual(expect.objectContaining(frame));

      game.ws.close();
      await new Promise((resolve) => game.ws.once('close', resolve));

      const late = await connectClient();
      await expect.poll(() => late.received.some((m) => m.type === 'game-diagnostics')).toBe(true);
      expect(late.received.filter((m) => m.type === 'game-diagnostics')).toEqual([
        expect.objectContaining(frame),
      ]);

      late.ws.close();
    });
  });
});

/**
 * The addition beyond the brief (see task-4-6-report.md): `session-dev`'s
 * host-side `/api/spin` failures (`dev-game.ts`'s route, a DIFFERENT OS
 * process from the browser) must also reach the IDE as `game-diagnostics`
 * — not only when a game's own `ide-bridge` happens to relay them. `rpc.ts`
 * is where the host learns to speak this message type at all, so it is
 * also where it exposes a way for the HOST ITSELF (not a game's socket) to
 * originate one. This is a narrow, direct test of that service; the
 * end-to-end proof (a real `/api/spin` failure reaching a real `/ide`
 * socket) lives in `dev-game.test.ts`, next to the route it is about.
 */
describe('ide rpc — the host can originate its own game-diagnostics', () => {
  it('broadcasts to a connected client, with no sender of its own to exclude', async () => {
    const ideRpc = host.ctx.reflect.get('ideRpc', false) as
      { reportGameDiagnostics(speaker: string, diagnostics: unknown[]): void } | undefined;
    expect(ideRpc).toBeDefined();

    ideRpc!.reportGameDiagnostics('session', [
      { severity: 'error', plugin: 'session', where: 'e8-server', message: 'did not start' },
    ]);

    // `socket`/`inbox` are the outer `beforeEach`'s own connected client,
    // reused here on purpose: this broadcast has no "sender" socket to
    // exclude (unlike the relay tests above, where the game IS one of the
    // connected clients), so the one client already connected must still
    // receive it.
    const message = await inbox.waitFor((m) => m.type === 'game-diagnostics');
    expect(message).toMatchObject({
      type: 'game-diagnostics',
      diagnostics: [{ severity: 'error', plugin: 'session' }],
      // Its own list's count, not a number the caller supplied: nothing has
      // been forgotten yet, so it is honestly 0. See I2's test below.
      dropped: 0,
    });
  });
});

/**
 * Two speakers, one message type, and a reader that replaces on receipt.
 *
 * The host became a second speaker (the describe block above) after the
 * whole-list-not-a-delta decision was already made, and the two collided:
 * a host frame carries only its own `/api/spin` failure, so it replaced
 * everything a game had reported — terminally, since nothing makes the game
 * speak again afterwards. The fix is that whole-list is per SOURCE. These
 * tests hold the host's half of it: the stamp it puts on each frame, and
 * the retention that keeps one per source rather than one in total.
 */
describe('ide rpc — the two speakers do not overwrite each other', () => {
  function collect(ws: WebSocket): ServerMessage[] {
    const received: ServerMessage[] = [];
    ws.on('message', (data) => received.push(JSON.parse(String(data)) as ServerMessage));
    return received;
  }

  async function connectClient(): Promise<{ ws: WebSocket; received: ServerMessage[] }> {
    const ws = new WebSocket(`${host.url.replace('http', 'ws')}/ide`);
    const received = collect(ws);
    await new Promise((resolve) => ws.once('open', resolve));
    return { ws, received };
  }

  const gameFrame = {
    type: 'game-diagnostics',
    diagnostics: [
      { severity: 'error', plugin: 'reels', where: 'runtime', message: 'the game said this' },
    ],
    dropped: 0,
  };

  function hostRpc() {
    const ideRpc = host.ctx.reflect.get('ideRpc', false) as {
      reportGameDiagnostics(speaker: string, diagnostics: unknown[]): void;
    };
    ideRpc.reportGameDiagnostics('session', [
      { severity: 'error', plugin: 'session', where: 'play', message: 'the host said this' },
    ]);
  }

  it("stamps a relayed frame as the game's, so a reader can tell the speakers apart", async () => {
    const game = await connectClient();
    const editor = await connectClient();
    game.ws.send(JSON.stringify(gameFrame));
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ source: 'game' }));
    game.ws.close();
    editor.ws.close();
  });

  it("stamps its own broadcast as the host's", async () => {
    hostRpc();
    const message = await inbox.waitFor((m) => m.type === 'game-diagnostics');
    expect(message).toMatchObject({ source: 'host' });
  });

  it('retains one frame PER SOURCE, so a late client is told both', async () => {
    const game = await connectClient();
    const editor = await connectClient();

    // The game speaks first…
    game.ws.send(JSON.stringify(gameFrame));
    // …confirmed landed on the already-listening editor, so the host has
    // provably recorded it before the host's own broadcast can race it.
    // Anchored on an ORDERED signal on one connection rather than on a
    // second connection's timing — the same correction the echo test above
    // needed.
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ source: 'game' }));

    // …and then the host does.
    hostRpc();
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ source: 'host' }));

    // A tab opening now — the moment a person actually looks — must be told
    // BOTH, in `GAME_DIAGNOSTIC_SOURCES` order: the game's own account, then the host's.
    const late = await connectClient();
    await expect
      .poll(() => late.received.filter((m) => m.type === 'game-diagnostics').length)
      .toBe(2);
    const frames = late.received.filter((m) => m.type === 'game-diagnostics');
    expect(frames).toEqual([
      expect.objectContaining({ source: 'game' }),
      expect.objectContaining({ source: 'host' }),
    ]);
    expect(frames[0]).toMatchObject({ diagnostics: [{ message: 'the game said this' }] });
    expect(frames[1]).toMatchObject({ diagnostics: [{ message: 'the host said this' }] });

    late.ws.close();
    game.ws.close();
    editor.ws.close();
  });

  /**
   * The host is a source, so it must keep a source's whole list — but a
   * list with SPEAKERS (debt slice B1): the host's rows come from several
   * places (`session`'s restart, `spin`'s route, `dev-game`'s boot), and
   * only the place that said something can take it back. So a call
   * replaces that one speaker's group, an empty list deletes it, and every
   * other speaker's rows stay exactly where they were. Before this, the
   * list only accumulated: "failed to restart" outlived the fix that cured
   * it, because nothing could retract a row.
   */
  it('a call replaces its own speaker, leaves the others, and an empty list retracts', async () => {
    const ideRpc = host.ctx.reflect.get('ideRpc', false) as {
      reportGameDiagnostics(speaker: string, diagnostics: unknown[]): void;
    };
    const row = (message: string) => ({
      severity: 'error',
      plugin: 'session',
      where: 'x',
      message,
    });
    const messagesOf = (m: ServerMessage) =>
      m.type === 'game-diagnostics' ? m.diagnostics.map((d) => d.message) : [];

    ideRpc.reportGameDiagnostics('session', [row('a')]);
    await inbox.waitFor((m) => m.type === 'game-diagnostics');
    ideRpc.reportGameDiagnostics('spin', [row('b')]);
    expect(messagesOf(await inbox.waitFor((m) => m.type === 'game-diagnostics'))).toEqual([
      'a',
      'b',
    ]);

    // The empty list is the retract: `session`'s row goes, `spin`'s stays.
    ideRpc.reportGameDiagnostics('session', []);
    expect(messagesOf(await inbox.waitFor((m) => m.type === 'game-diagnostics'))).toEqual(['b']);

    // A speaker that was deleted is new again — it lands AFTER `spin`.
    ideRpc.reportGameDiagnostics('session', [row('c')]);
    expect(messagesOf(await inbox.waitFor((m) => m.type === 'game-diagnostics'))).toEqual([
      'b',
      'c',
    ]);
    // …and a second report from the same speaker replaces, never appends.
    ideRpc.reportGameDiagnostics('session', [row('d')]);
    expect(messagesOf(await inbox.waitFor((m) => m.type === 'game-diagnostics'))).toEqual([
      'b',
      'd',
    ]);

    // A tab opening now is told exactly the current list, once.
    const late = await connectClient();
    await expect
      .poll(() => late.received.filter((m) => m.type === 'game-diagnostics').length)
      .toBe(1);
    expect(late.received.filter((m) => m.type === 'game-diagnostics').map(messagesOf)).toEqual([
      ['b', 'd'],
    ]);
    late.ws.close();
  });

  it('retracting every speaker leaves a late client told nothing, not an empty report', async () => {
    const ideRpc = host.ctx.reflect.get('ideRpc', false) as {
      reportGameDiagnostics(speaker: string, diagnostics: unknown[]): void;
    };
    ideRpc.reportGameDiagnostics('spin', [
      { severity: 'error', plugin: 'session', where: 'play', message: 'bad spin' },
    ]);
    await inbox.waitFor((m) => m.type === 'game-diagnostics');
    ideRpc.reportGameDiagnostics('spin', []);
    // The connected client IS told (an empty host frame clears its list)…
    expect(await inbox.waitFor((m) => m.type === 'game-diagnostics')).toMatchObject({
      source: 'host',
      diagnostics: [],
      dropped: 0,
    });
    // …a late one hears nothing at all — "nothing reported" is not "an
    // empty report" (see the greeting's own comment in rpc.ts).
    const late = await connectClient();
    await expect.poll(() => late.received.some((m) => m.type === 'snapshot')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(late.received.filter((m) => m.type === 'game-diagnostics')).toEqual([]);
    late.ws.close();
  });

  it('says honestly how many of its own it has forgotten', async () => {
    // The bound is `@energy8engine/diagnostics`'s `DEFAULT_LIMIT` (500), so
    // this reports past it rather than reaching for a smaller one — the
    // point is that the count is the host's OWN list's, not a number a
    // caller supplied and not a hardcoded zero.
    const ideRpc = host.ctx.reflect.get('ideRpc', false) as {
      reportGameDiagnostics(speaker: string, diagnostics: unknown[]): void;
    };
    ideRpc.reportGameDiagnostics(
      'session',
      Array.from({ length: 502 }, (_unused, i) => ({
        severity: 'error',
        plugin: 'session',
        where: 'play',
        message: `bad spin ${i}`,
      })),
    );

    const message = await inbox.waitFor((m) => m.type === 'game-diagnostics');
    expect(message).toMatchObject({ dropped: 2 });
    expect((message as { diagnostics: unknown[] }).diagnostics).toHaveLength(500);

    // Each speaker's group has the bound of its own; the frame's `dropped`
    // is the sum over speakers, so it stays the count of what the whole
    // list forgot.
    ideRpc.reportGameDiagnostics(
      'spin',
      Array.from({ length: 501 }, (_unused, i) => ({
        severity: 'error',
        plugin: 'session',
        where: 'play',
        message: `bad spin again ${i}`,
      })),
    );
    const both = await inbox.waitFor((m) => m.type === 'game-diagnostics');
    expect(both).toMatchObject({ dropped: 3 });
    expect((both as { diagnostics: unknown[] }).diagnostics).toHaveLength(1000);
  });

  /**
   * Retention survives a source going away — the same call already made for
   * the single retained frame, applied to both sources so the rule does not
   * depend on which speaker happens to fall silent. A game going quiet
   * BECAUSE it crashed is exactly the case this exists for.
   */
  it("keeps a disconnected game's frame alongside the host's", async () => {
    const game = await connectClient();
    const editor = await connectClient();
    game.ws.send(JSON.stringify(gameFrame));
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ source: 'game' }));
    hostRpc();
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ source: 'host' }));

    game.ws.close();
    await new Promise((resolve) => game.ws.once('close', resolve));

    const late = await connectClient();
    await expect
      .poll(() => late.received.filter((m) => m.type === 'game-diagnostics').length)
      .toBe(2);

    late.ws.close();
    editor.ws.close();
  });
});

/**
 * Task 5: a third axis, one level finer than `source` and living only
 * inside it. The describe block above proved the two SOURCES keep each
 * other's frame; these tests prove the same property one level down, where
 * `source` alone runs out: the preview wall (a later task) opens several
 * tiles against this one host at once, each its own socket, each its own
 * `GameDiagnosticsMessage.game` — and a single shared `'game'` slot (what
 * `lastGameDiagnostics` used before this) let the second tile's whole-list
 * frame silently erase the first's. Reproduced directly against pre-Task-5
 * code before writing the fix: two sockets reporting as `a` and `b` left a
 * later client told only about `b` — see task-5-context.md.
 *
 * `twoClients`/`connect`/`settle`/`retainedMessages`/`framesFor` from the
 * plan's own brief are illustrative, not literal, matching the precedent
 * the describe block above already set (see its own comment): this suite's
 * connect-and-buffer pattern is reused rather than invented helpers
 * matching the brief verbatim.
 */
describe('ide rpc — several games do not overwrite each other', () => {
  function collect(ws: WebSocket): ServerMessage[] {
    const received: ServerMessage[] = [];
    ws.on('message', (data) => received.push(JSON.parse(String(data)) as ServerMessage));
    return received;
  }

  async function connectClient(): Promise<{ ws: WebSocket; received: ServerMessage[] }> {
    const ws = new WebSocket(`${host.url.replace('http', 'ws')}/ide`);
    const received = collect(ws);
    await new Promise((resolve) => ws.once('open', resolve));
    return { ws, received };
  }

  function gameFrame(game: string, message: string) {
    return JSON.stringify({
      type: 'game-diagnostics',
      game,
      diagnostics: [{ severity: 'error', plugin: 'reels', where: 'runtime', message }],
      dropped: 0,
    });
  }

  it('retains one frame per game, not one for the whole game source', async () => {
    // The host half of the defect Task 4's own bridge test recorded: two
    // DIFFERENT games reporting must not leave only the second one's
    // message behind. Read back through a late connection — the same
    // "ask the host what it retained by seeing what it replays" idiom
    // every other retention test in this file already uses; there is no
    // other seam to ask.
    const a = await connectClient();
    const b = await connectClient();
    const editor = await connectClient();

    a.ws.send(gameFrame('a', 'A said this'));
    // Confirmed landed on an independently-listening third socket before
    // `b` speaks, so the host has provably recorded `a`'s frame first —
    // not a race against `b`'s write landing first purely by luck.
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ game: 'a' }));
    b.ws.send(gameFrame('b', 'B said this'));
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ game: 'b' }));

    const late = await connectClient();
    await expect
      .poll(() => late.received.filter((m) => m.type === 'game-diagnostics').length)
      .toBe(2);
    const messages = late.received
      .filter((m) => m.type === 'game-diagnostics')
      .flatMap((m) => (m.type === 'game-diagnostics' ? m.diagnostics.map((d) => d.message) : []));
    expect(messages.sort()).toEqual(['A said this', 'B said this']);

    late.ws.close();
    a.ws.close();
    b.ws.close();
    editor.ws.close();
  });

  it('a late-connecting client is told about every game that has spoken', async () => {
    // The existing "retains one frame PER SOURCE" test is the model; this
    // is the same promise one level finer — every GAME, not just every
    // source.
    const a = await connectClient();
    const b = await connectClient();
    const editor = await connectClient();

    a.ws.send(gameFrame('a', 'A said this'));
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ game: 'a' }));
    b.ws.send(gameFrame('b', 'B said this'));
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ game: 'b' }));

    const late = await connectClient();
    await expect
      .poll(() => late.received.filter((m) => m.type === 'game-diagnostics').length)
      .toBe(2);
    const frames = late.received.filter(
      (m): m is Extract<ServerMessage, { type: 'game-diagnostics' }> =>
        m.type === 'game-diagnostics',
    );
    expect(frames.map((f) => f.game).sort()).toEqual(['a', 'b']);

    late.ws.close();
    a.ws.close();
    b.ws.close();
    editor.ws.close();
  });

  it('a host frame is still retained once, under no game', async () => {
    // The host is one speaker, not one of several games — adding a
    // per-game key must not accidentally give it a game identity it does
    // not have (see `lastGameDiagnostics`'s own doc, decision 1).
    const ideRpc = host.ctx.reflect.get('ideRpc', false) as {
      reportGameDiagnostics(speaker: string, diagnostics: unknown[]): void;
    };
    ideRpc.reportGameDiagnostics('session', [
      { severity: 'error', plugin: 'session', where: 'play', message: 'spin failed' },
    ]);

    const late = await connectClient();
    await expect
      .poll(() => late.received.filter((m) => m.type === 'game-diagnostics').length)
      .toBe(1);
    const frames = late.received.filter(
      (m): m is Extract<ServerMessage, { type: 'game-diagnostics' }> =>
        m.type === 'game-diagnostics',
    );
    const hostFrames = frames.filter((f) => f.source === 'host');
    expect(hostFrames).toHaveLength(1);
    expect(hostFrames[0].game).toBeUndefined();

    late.ws.close();
  });

  it('a game that disconnects stops being retained, so a closed tile does not haunt the panel', async () => {
    // Otherwise the wall accumulates the ghosts of every tile ever opened —
    // see `lastGameDiagnostics`'s own doc, decision 3, for why this is the
    // property that now bounds the map, replacing the old "there are only
    // two slots" argument.
    const a = await connectClient();
    const editor = await connectClient();
    a.ws.send(gameFrame('a', 'A said this'));
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ game: 'a' }));

    a.ws.close();
    await new Promise((resolve) => a.ws.once('close', resolve));

    const late = await connectClient();
    await expect.poll(() => late.received.some((m) => m.type === 'snapshot')).toBe(true);
    const snapshot = late.received.find((m) => m.type === 'snapshot')!;
    const id =
      snapshot.type === 'snapshot'
        ? snapshot.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id
        : '';

    // A negative (no retained frame for the now-closed game `a`) is not
    // provable by "wait a bit and see" — see the echo test above, in the
    // describe block above this one, for why that shape of proof is a
    // race rather than evidence. Instead: make `late` provoke a reply on
    // ITS OWN connection, after it has already read its snapshot.
    // Everything the host had already queued for `late` — including any
    // retained `game-diagnostics` frame — is necessarily delivered before
    // that reply, because it is the same single-threaded server writing to
    // the same ordered connection.
    late.ws.send(JSON.stringify({ type: 'update', id, config: { speed: 8 } }));
    await expect
      .poll(() =>
        late.received.some(
          (m) =>
            m.type === 'snapshot' &&
            JSON.stringify(m.snapshot.rows.find((r) => r.id === id)?.config) ===
              JSON.stringify({ speed: 8 }),
        ),
      )
      .toBe(true);

    const frames = late.received.filter(
      (m): m is Extract<ServerMessage, { type: 'game-diagnostics' }> =>
        m.type === 'game-diagnostics',
    );
    expect(frames.filter((f) => f.game === 'a')).toEqual([]);

    late.ws.close();
    editor.ws.close();
  });

  it("relays a game's frame to other clients with its game label intact, not only to a late-connecting one", async () => {
    // The retained-and-replayed path above is one of two ways a client
    // learns which game a frame is about; the LIVE relay (`rpc.ts`'s
    // `for (const other of clients)` loop) is the other, and an
    // already-connected editor watching a wall needs the label on THIS
    // path too, not only on reconnect.
    const a = await connectClient();
    const editor = await connectClient();

    a.ws.send(gameFrame('a', 'A said this'));

    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ source: 'game', game: 'a' }));

    a.ws.close();
    editor.ws.close();
  });

  it('a fresher reconnect for the same game survives a stale socket closing after it', async () => {
    // A tile that reloads (or a page that reconnects before the old socket
    // has noticed it is gone) is one socket handing a game's identity to
    // another, live, and the OLD socket's own `close` must not be allowed
    // to erase what the NEW one has since reported. A naive ownership
    // record — one entry per SOCKET, "the last id I sent" — gets this
    // wrong: it still remembers `stale` as `shared`'s claimant even after
    // `fresh` has taken it over, so `stale`'s `close` deletes `fresh`'s
    // still-live entry. Every other test in this describe block passes
    // under that naive shape too, because none of them has two sockets
    // contest the SAME game id — this is the one that does.
    const stale = await connectClient();
    const observer = await connectClient();

    stale.ws.send(gameFrame('shared', 'A said this'));
    await expect
      .poll(() => observer.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ game: 'shared' }));

    const fresh = await connectClient();
    fresh.ws.send(gameFrame('shared', 'B said this'));
    // Two relayed `shared` frames now (A's, then B's) — confirmed on the
    // already-listening `observer`, so the host has provably recorded B's
    // claim before `stale` closes below.
    await expect
      .poll(
        () =>
          observer.received.filter((m) => m.type === 'game-diagnostics' && m.game === 'shared')
            .length,
      )
      .toBe(2);

    stale.ws.close();
    await new Promise((resolve) => stale.ws.once('close', resolve));

    const late = await connectClient();
    await expect.poll(() => late.received.some((m) => m.type === 'snapshot')).toBe(true);
    const snapshot = late.received.find((m) => m.type === 'snapshot')!;
    const id =
      snapshot.type === 'snapshot'
        ? snapshot.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id
        : '';

    // Same "provoke a reply on late's OWN connection" technique as the
    // ghost test above — the exact count below (not just "at least one")
    // is only trustworthy once everything the host queued for `late` has
    // necessarily already arrived.
    late.ws.send(JSON.stringify({ type: 'update', id, config: { speed: 9 } }));
    await expect
      .poll(() =>
        late.received.some(
          (m) =>
            m.type === 'snapshot' &&
            JSON.stringify(m.snapshot.rows.find((r) => r.id === id)?.config) ===
              JSON.stringify({ speed: 9 }),
        ),
      )
      .toBe(true);

    const sharedFrames = late.received.filter(
      (m): m is Extract<ServerMessage, { type: 'game-diagnostics' }> =>
        m.type === 'game-diagnostics' && m.game === 'shared',
    );
    expect(sharedFrames).toHaveLength(1);
    expect(sharedFrames[0].diagnostics.map((d) => d.message)).toEqual(['B said this']);

    late.ws.close();
    fresh.ws.close();
    observer.ws.close();
  });

  it('tells the clients still connected that a named game has gone', async () => {
    // Releasing the retained entry (the ghost test above) only fixes what
    // a LATER client is told. A client that was already watching holds its
    // own copy of that tile's list, and nothing else on this wire would
    // ever contradict it — so it would keep showing rows under a tile name
    // that stopped running, for the life of the page.
    const a = await connectClient();
    const editor = await connectClient();
    a.ws.send(gameFrame('a', 'A said this'));
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics'))
      .toContainEqual(expect.objectContaining({ game: 'a' }));

    a.ws.close();
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-gone'))
      .toContainEqual({ type: 'game-gone', game: 'a' });

    editor.ws.close();
  });

  it('says nothing when a socket that never named a game closes', async () => {
    // The anonymous bucket is never released, on either side — see
    // `lastGameDiagnostics`'s own doc, decision 3: the one project `e8 dev`
    // serves crashing is exactly the case retention exists for. So there
    // is nothing to announce, and announcing it would tell every reader to
    // forget the crash that just happened.
    const anonymous = await connectClient();
    const editor = await connectClient();
    anonymous.ws.send(
      JSON.stringify({
        type: 'game-diagnostics',
        diagnostics: [
          { severity: 'error', plugin: 'reels', where: 'runtime', message: 'it broke' },
        ],
        dropped: 0,
      }),
    );
    await expect
      .poll(() => editor.received.filter((m) => m.type === 'game-diagnostics').length)
      .toBeGreaterThan(0);

    anonymous.ws.close();
    await new Promise((resolve) => anonymous.ws.once('close', resolve));

    // A negative needs a provoked reply on the editor's OWN connection to
    // be evidence rather than a race — the same technique the ghost test
    // above uses, and for the same reason.
    const snapshot = editor.received.find((m) => m.type === 'snapshot')!;
    const id =
      snapshot.type === 'snapshot'
        ? snapshot.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id
        : '';
    editor.ws.send(JSON.stringify({ type: 'update', id, config: { speed: 7 } }));
    await expect
      .poll(() =>
        editor.received.some(
          (m) =>
            m.type === 'snapshot' &&
            JSON.stringify(m.snapshot.rows.find((r) => r.id === id)?.config) ===
              JSON.stringify({ speed: 7 }),
        ),
      )
      .toBe(true);

    expect(editor.received.filter((m) => m.type === 'game-gone')).toEqual([]);

    editor.ws.close();
  });
});

describe('ide rpc — the root /ide refuses a cross-origin upgrade (spec §6.2)', () => {
  /** Resolves with what the handshake did: `greeted` (the workspace frame arrived) or `refused` (an error, no open). */
  const handshake = (origin: string) =>
    new Promise<string>((resolve) => {
      const s = new WebSocket(`${host.url.replace('http', 'ws')}/ide`, { headers: { origin } });
      s.once('message', () => {
        s.close();
        resolve('greeted');
      });
      s.once('error', () => resolve('refused'));
    });

  it('an unknown Origin never completes the handshake; the IDE’s own does', async () => {
    // The ws handler returns without `accept()`; plugin-server then destroys
    // the socket, and the client sees the handshake fail (measured: `ws`
    // emits `error` "socket hang up", never `open`).
    expect(await handshake('http://evil.example')).toBe('refused');
    expect(await handshake('http://127.0.0.1:5680')).toBe('greeted');
    expect(await handshake(host.url)).toBe('greeted');
  });
});

describe('ide rpc — on a root with no project open', () => {
  let bare: IdeHost;
  let bareSocket: WebSocket;
  let bareInbox: ReturnType<typeof createInbox>;
  beforeEach(async () => {
    // A folder with nothing in it: a workspace of zero projects, none open.
    bare = await createIdeHost({
      root: mkdtempSync(join(tmpdir(), 'ide-host-rpc-bare-')),
      port: 0,
    });
    bareSocket = new WebSocket(`${bare.url.replace('http', 'ws')}/ide`);
    bareInbox = createInbox(bareSocket);
    await new Promise((resolve) => bareSocket.once('open', resolve));
  });
  afterEach(async () => {
    bareSocket.close();
    await bare.stop();
  });

  it('greets a client with the workspace, then an EMPTY snapshot — not silence', async () => {
    const first = await bareInbox.waitFor(() => true);
    // `templates` is whatever this repo's engine/templates holds — not this test's subject.
    expect(first).toMatchObject({
      type: 'workspace',
      workspace: { projects: [], active: null, previewUrl: null, diagnostics: [] },
    });
    const second = await bareInbox.waitFor(() => true);
    expect(second).toEqual({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
  });

  it('answers an update with a diagnostic when there is no project to update', async () => {
    bareSocket.send(JSON.stringify({ type: 'update', id: 'probe1', config: { speed: 5 } }));
    const message = await bareInbox.waitFor((m) => m.type === 'diagnostics');
    expect(message).toMatchObject({
      diagnostics: [
        { severity: 'error', plugin: 'ide-rpc', where: 'probe1', message: 'no project is open' },
      ],
    });
    expect(bareSocket.readyState).toBe(bareSocket.OPEN);
  });
});

describe('ide rpc — on a folder of projects', () => {
  let h: IdeHost;
  let root: string;
  const clients: WebSocket[] = [];
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'ide-host-rpc-switch-'));
    for (const id of ['one', 'two']) {
      mkdirSync(join(root, id, 'node_modules'), { recursive: true });
      writeFileSync(join(root, id, 'e8.yml'), readFileSync(TEMPLATE_FILE, 'utf8'));
      symlinkSync(PROBE_PLUGIN_DIR, join(root, id, 'node_modules', 'probe-plugin'), 'dir');
    }
    (globalThis as any).__probeApplied = [];
    h = await createIdeHost({ root, port: 0 });
  });
  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await h.stop();
  });
  async function client() {
    const s = new WebSocket(`${h.url.replace('http', 'ws')}/ide`);
    clients.push(s);
    const box = createInbox(s);
    await new Promise((resolve) => s.once('open', resolve));
    return box;
  }

  it('greets the FIRST client with the projects as they are, not with an empty list', async () => {
    // Nothing has been opened, so `workspace/changed` has never fired: the
    // greeting has to READ the workspace, not replay a broadcast.
    const first = await (await client()).waitFor(() => true);
    expect(first.type).toBe('workspace');
    expect(first.type === 'workspace' && first.workspace.projects.map((p) => p.id)).toEqual([
      'one',
      'two',
    ]);
    expect(first.type === 'workspace' && first.workspace.active).toBeNull();
  });

  it('a connected client is told the new workspace and the new (or empty) snapshot without reconnecting', async () => {
    const box = await client();
    await box.waitFor((m) => m.type === 'snapshot' && m.snapshot.rows.length === 0);

    await h.ctx.workspace.open('one');
    await box.waitFor((m) => m.type === 'workspace' && m.workspace.active === 'one');
    await box.waitFor(
      (m) => m.type === 'snapshot' && m.snapshot.rows.some((r) => r.name === 'probe-plugin'),
    );

    await h.ctx.workspace.close();
    await box.waitFor((m) => m.type === 'workspace' && m.workspace.active === null);
    await box.waitFor((m) => m.type === 'snapshot' && m.snapshot.rows.length === 0);
  });

  /** Every `game-diagnostics`/`game-gone` frame a FRESH client is greeted with, once its snapshot has arrived. */
  async function lateGreeting(): Promise<ServerMessage[]> {
    const s = new WebSocket(`${h.url.replace('http', 'ws')}/ide`);
    clients.push(s);
    const frames: ServerMessage[] = [];
    s.on('message', (data) => frames.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((resolve) => s.once('open', resolve));
    await expect.poll(() => frames.some((m) => m.type === 'snapshot')).toBe(true);
    // Retained frames are sent right after the snapshot, but may land in a
    // later chunk than it did; let the socket settle.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return frames.filter((m) => m.type === 'game-diagnostics' || m.type === 'game-gone');
  }

  it("what a scope's own boot reports survives that open — a late client is still told", async () => {
    // `one` has a game/spec.json its scope cannot read. The diagnostic is
    // reported DURING the boot, before `workspace/changed` says `one` is
    // active — so a reset keyed on "active changed" would wipe it on the
    // spot. The reset is keyed on a project LEAVING instead (H1) — and
    // `two` leaving is announced on its own `active: null` frame BEFORE
    // `one` boots, so a switch does not wipe the newcomer's report either.
    mkdirSync(join(root, 'one', 'game'));
    writeFileSync(join(root, 'one', 'game', 'spec.json'), '{');
    await h.ctx.workspace.open('two');
    await h.ctx.workspace.open('one');
    expect(await lateGreeting()).toEqual([
      expect.objectContaining({
        source: 'host',
        diagnostics: [expect.objectContaining({ plugin: 'dev-game', where: 'game/spec.json' })],
      }),
    ]);
  });

  it("the host's own diagnostics about a project go when that project does", async () => {
    mkdirSync(join(root, 'one', 'game'));
    writeFileSync(join(root, 'one', 'game', 'spec.json'), '{');
    const box = await client();
    await box.waitFor((m) => m.type === 'snapshot');

    await h.ctx.workspace.open('one');
    const about = await box.waitFor((m) => m.type === 'game-diagnostics' && m.source === 'host');
    expect(about).toMatchObject({ diagnostics: [{ where: 'game/spec.json' }] });

    await h.ctx.workspace.open('two');
    // The connected panel is told to drop the rows: an empty host frame
    // replaces its host list whole. It arrives on the `active: null` frame
    // between the two projects — with `one`'s open, the inbox holds no
    // earlier host frame this could be mistaken for (the test above).
    const cleared = await box.waitFor((m) => m.type === 'game-diagnostics' && m.source === 'host');
    expect(cleared).toMatchObject({ diagnostics: [], dropped: 0 });
    // A fresh client is told nothing about `one` at all.
    expect(await lateGreeting()).toEqual([]);
  });

  it("a game's own reports go with its project too, in the shapes the panel clears on", async () => {
    await h.ctx.workspace.open('one');
    const box = await client();
    await box.waitFor((m) => m.type === 'snapshot');
    // `one`'s game speaks twice over the root: once as a named tile, once anonymously.
    const game = new WebSocket(`${h.url.replace('http', 'ws')}/ide`);
    clients.push(game);
    await new Promise((resolve) => game.once('open', resolve));
    const report = (extra: object) =>
      game.send(
        JSON.stringify({
          type: 'game-diagnostics',
          diagnostics: [{ severity: 'error', plugin: 'x', where: 'y', message: 'z' }],
          dropped: 0,
          ...extra,
        }),
      );
    report({ game: 'tile' });
    report({});
    await box.waitFor((m) => m.type === 'game-diagnostics' && m.game === 'tile');
    await box.waitFor((m) => m.type === 'game-diagnostics' && m.game === undefined);
    expect(await lateGreeting()).toHaveLength(2);

    await h.ctx.workspace.open('two');
    // The named tile's group is deleted (`game-gone`); the anonymous
    // game's list is replaced whole (an empty `source: 'game'` frame).
    await box.waitFor((m) => m.type === 'game-gone' && m.game === 'tile');
    const anonymous = await box.waitFor(
      (m) => m.type === 'game-diagnostics' && m.source === 'game',
    );
    expect(anonymous).toMatchObject({ diagnostics: [], dropped: 0 });
    expect(anonymous).not.toHaveProperty('game');
    expect(await lateGreeting()).toEqual([]);
  });
});

/**
 * A row's config rewritten through `PUT /api/composition/rows/:id`
 * (`runtime-assets.ts`) is announced to EVERY socket — the editor on the
 * root and the game on the preview alike: the editor redraws its rows, the
 * game's `ide-bridge` re-applies (or, on `reload: true`, waits to be
 * reloaded). One client set behind both attachments, so one loop.
 */
describe('ide rpc — broadcastGameComposition reaches the root and the preview', () => {
  it('sends the same frame to a root socket and a preview socket', async () => {
    const fiber = host.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    host.ctx.ideRpc.attach(fiber.ctx.server, { accept: ['game-diagnostics'] });
    const preview = new WebSocket(`ws://127.0.0.1:${fiber.ctx.server.port}/ide`);
    const previewInbox = createInbox(preview);
    await new Promise((resolve) => preview.once('open', resolve));

    const frame = {
      rows: [
        {
          id: 'reels1',
          name: '@energy8engine/reels',
          config: { config: { grid: { cols: 6, rows: 3 } } },
          from: 'patch',
          runtimeUrl: null,
          schema: null,
          hot: true,
        },
      ],
      reload: false,
      changed: ['reels1'],
    };
    host.ctx.ideRpc.broadcastGameComposition(frame);

    const expected = { type: 'game-composition', ...frame };
    expect(await inbox.waitFor((m) => m.type === 'game-composition')).toEqual(expected);
    expect(await previewInbox.waitFor((m) => m.type === 'game-composition')).toEqual(expected);
    preview.close();
  });
});

describe('ide rpc — the game reports its transitions', () => {
  async function previewSocket(accept: Parameters<typeof host.ctx.ideRpc.attach>[1]) {
    const fiber = host.ctx.isolate('server').plugin(Server, { host: '127.0.0.1', port: 0 });
    await fiber;
    host.ctx.ideRpc.attach(fiber.ctx.server, accept);
    const ws = new WebSocket(`ws://127.0.0.1:${fiber.ctx.server.port}/ide`);
    await new Promise((resolve) => ws.once('open', resolve));
    return ws;
  }

  it('mirrors the last list a socket sent, a later socket replaces it, and it survives the game leaving', async () => {
    expect(host.ctx.ideRpc.transitions()).toEqual([]);
    const game = await previewSocket({ accept: ['game-diagnostics', 'game-transitions'] });
    game.send(JSON.stringify({ type: 'game-transitions', ids: ['cut', 'fade', 'wipe'] }));
    await expect.poll(() => host.ctx.ideRpc.transitions()).toEqual(['cut', 'fade', 'wipe']);
    // Not an array of strings: ignored, the last list stands.
    game.send(JSON.stringify({ type: 'game-transitions', ids: [1, 'x'] }));
    game.send(JSON.stringify({ type: 'game-transitions', ids: 'cut' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.ctx.ideRpc.transitions()).toEqual(['cut', 'fade', 'wipe']);

    const later = await previewSocket({ accept: ['game-diagnostics', 'game-transitions'] });
    later.send(JSON.stringify({ type: 'game-transitions', ids: ['cut'] }));
    await expect.poll(() => host.ctx.ideRpc.transitions()).toEqual(['cut']);
    game.close();
    later.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.ctx.ideRpc.transitions()).toEqual(['cut']); // last known
  });

  it('is dropped on a socket whose attachment does not accept it', async () => {
    const game = await previewSocket({ accept: ['game-diagnostics'] });
    game.send(JSON.stringify({ type: 'game-transitions', ids: ['cut'] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.ctx.ideRpc.transitions()).toEqual([]);
    game.close();
  });

  it('broadcastScenePreview reaches every socket', async () => {
    const preview = await previewSocket({ accept: ['game-diagnostics'] });
    const previewInbox = createInbox(preview);
    host.ctx.ideRpc.broadcastScenePreview({ scene: 'bonus' });
    const expected = { type: 'scene-preview', scene: 'bonus' };
    expect(await inbox.waitFor((m) => m.type === 'scene-preview')).toEqual(expected);
    expect(await previewInbox.waitFor((m) => m.type === 'scene-preview')).toEqual(expected);
    preview.close();
  });
});
