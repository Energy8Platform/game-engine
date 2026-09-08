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
      { reportGameDiagnostics(diagnostics: unknown[]): void } | undefined;
    expect(ideRpc).toBeDefined();

    ideRpc!.reportGameDiagnostics([
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
      reportGameDiagnostics(diagnostics: unknown[]): void;
    };
    ideRpc.reportGameDiagnostics([
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
   * The host is a source, so it must keep a source's whole list.
   *
   * It did not: it shipped the array it was handed with `dropped` defaulting
   * to `0`, and a reader replaces a source's whole list on receipt. Two
   * consecutive `/api/spin` failures therefore left only the second, under a
   * panel asserting nothing had been forgotten — the one direction
   * `GameDiagnosticsMessage.dropped`'s own doc forbids.
   */
  it('keeps its own whole list, so a second failure does not erase the first', async () => {
    const ideRpc = host.ctx.reflect.get('ideRpc', false) as {
      reportGameDiagnostics(diagnostics: unknown[]): void;
    };
    ideRpc.reportGameDiagnostics([
      { severity: 'error', plugin: 'session', where: 'play', message: 'first bad spin' },
    ]);
    await inbox.waitFor((m) => m.type === 'game-diagnostics');
    ideRpc.reportGameDiagnostics([
      { severity: 'error', plugin: 'session', where: 'play', message: 'second bad spin' },
    ]);

    const message = await inbox.waitFor(
      (m) =>
        m.type === 'game-diagnostics' && m.diagnostics.some((d) => d.message === 'second bad spin'),
    );
    expect(message).toMatchObject({
      diagnostics: [{ message: 'first bad spin' }, { message: 'second bad spin' }],
    });
  });

  it('says honestly how many of its own it has forgotten', async () => {
    // The bound is `@energy8engine/diagnostics`'s `DEFAULT_LIMIT` (500), so
    // this reports past it rather than reaching for a smaller one — the
    // point is that the count is the host's OWN list's, not a number a
    // caller supplied and not a hardcoded zero.
    const ideRpc = host.ctx.reflect.get('ideRpc', false) as {
      reportGameDiagnostics(diagnostics: unknown[]): void;
    };
    ideRpc.reportGameDiagnostics(
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
