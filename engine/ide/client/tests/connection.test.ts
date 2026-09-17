import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage, Snapshot } from '@energy8engine/contracts';
import { createIdeClient, type WebSocketLike } from '../src/index';

/** The `workspace` plugin's boot GET must not reach the real `fetch` (jsdom has no host to answer, and the failure would land in `connection.diagnostics`); it never answers here. */
const fetchFn: typeof fetch = () => new Promise(() => {});

const SNAPSHOT: Snapshot = {
  rows: [
    {
      id: 'a:probe1',
      name: 'probe-plugin',
      disabled: false,
      state: 2,
      config: { speed: 8 },
      schema: null,
      hot: true,
      clientUrl: null,
      clientInject: [],
    },
  ],
  diagnostics: [],
};

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  listeners: Record<string, ((event: any) => void)[]> = {};
  // 0 = CONNECTING, matching a real WebSocket before its 'open' event fires.
  readyState = 0;
  addEventListener(type: string, listener: (event: any) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  receive(message: ServerMessage) {
    for (const listener of this.listeners.message ?? [])
      listener({ data: JSON.stringify(message) });
  }
  open() {
    this.readyState = 1; // OPEN
    for (const listener of this.listeners.open ?? []) listener({});
  }
}

describe('connection', () => {
  it('stores the snapshot the host pushes and notifies subscribers', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    const listener = vi.fn();
    ctx.connection.subscribe(listener);

    socket.open();
    socket.receive({ type: 'snapshot', snapshot: SNAPSHOT });

    expect(ctx.connection.snapshot).toEqual(SNAPSHOT);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('sends an update message shaped for the host', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    socket.open();
    ctx.connection.update('a:probe1', { speed: 3 });

    expect(JSON.parse(socket.sent[0])).toEqual({
      type: 'update',
      id: 'a:probe1',
      config: { speed: 3 },
    });
  });

  it('keeps diagnostics from the host without dropping the snapshot', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    socket.open();
    socket.receive({ type: 'snapshot', snapshot: SNAPSHOT });
    socket.receive({
      type: 'diagnostics',
      diagnostics: [{ severity: 'error', plugin: 'a:probe1', where: 'config', message: 'nope' }],
    });

    expect(ctx.connection.diagnostics).toHaveLength(1);
    expect(ctx.connection.snapshot).toEqual(SNAPSHOT);
  });

  // Fix round 1 (Task 10): a client-authored diagnostic (from `report()` —
  // a send failure, or since Task 10 a broken plugin client half) has
  // nothing to do with whatever the host just pushed, and must not vanish
  // the moment an unrelated host message arrives.
  it('keeps a client-authored diagnostic when an unrelated host message replaces the host ones', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    socket.open();

    const clientDiagnostic = {
      severity: 'error' as const,
      plugin: 'a:probe1',
      where: 'client',
      message: 'boom',
    };
    ctx.connection.report(clientDiagnostic);
    expect(ctx.connection.diagnostics).toEqual([clientDiagnostic]);

    socket.receive({
      type: 'diagnostics',
      diagnostics: [
        { severity: 'error', plugin: 'a:probe2', where: 'config', message: 'host says no' },
      ],
    });

    // Both present — host's alongside client's, not one replacing the other.
    expect(ctx.connection.diagnostics).toHaveLength(2);
    expect(ctx.connection.diagnostics.map((d) => d.plugin).sort()).toEqual([
      'a:probe1',
      'a:probe2',
    ]);

    // A second, unrelated host message replaces only the host's diagnostic.
    socket.receive({ type: 'diagnostics', diagnostics: [] });
    expect(ctx.connection.diagnostics).toEqual([clientDiagnostic]);
  });

  // Debt B1 (client half): `report()` hands back a retract bound to the
  // stored entry, so a speaker whose failure has passed (an editor whose
  // text was fixed, a save that later succeeded) can take its row back.
  it('report() returns a retract that removes the stored entry and notifies', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    const listener = vi.fn();
    ctx.connection.subscribe(listener);
    const d = { severity: 'error' as const, plugin: 'a:probe1', where: 'check', message: 'boom' };

    const off = ctx.connection.report(d);
    expect(ctx.connection.diagnostics).toEqual([d]);
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    expect(ctx.connection.diagnostics).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a second retract is a no-op: nothing removed, nobody notified, nothing thrown', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    const listener = vi.fn();
    ctx.connection.subscribe(listener);
    const d = { severity: 'error' as const, plugin: 'a:probe1', where: 'check', message: 'boom' };
    const other = { severity: 'error' as const, plugin: 'a:probe1', where: 'check', message: 'x' };

    const off = ctx.connection.report(d);
    ctx.connection.report(other);
    off();
    expect(ctx.connection.diagnostics).toEqual([other]);
    const notified = listener.mock.calls.length;

    expect(() => off()).not.toThrow();
    expect(ctx.connection.diagnostics).toEqual([other]);
    expect(listener).toHaveBeenCalledTimes(notified);
  });

  it('a host frame between report and retract neither removes the entry nor breaks the retract', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    socket.open();
    const d = { severity: 'error' as const, plugin: 'a:probe1', where: 'check', message: 'boom' };
    const hostD = {
      severity: 'error' as const,
      plugin: 'a:probe2',
      where: 'config',
      message: 'no',
    };

    const off = ctx.connection.report(d);
    socket.receive({ type: 'diagnostics', diagnostics: [hostD] });
    expect(ctx.connection.diagnostics).toEqual([hostD, d]);

    off();
    expect(ctx.connection.diagnostics).toEqual([hostD]);
  });

  it('two reports of equal diagnostics share one stored entry, so either retract removes it', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    const make = () => ({
      severity: 'error' as const,
      plugin: 'a:probe1',
      where: 'check',
      message: 'boom',
    });

    const offFirst = ctx.connection.report(make());
    const offSecond = ctx.connection.report(make());
    expect(ctx.connection.diagnostics).toHaveLength(1);

    offFirst();
    expect(ctx.connection.diagnostics).toEqual([]);

    // And the other way round, on a fresh pair: the second's retract works too.
    const offA = ctx.connection.report(make());
    const offB = ctx.connection.report(make());
    expect(ctx.connection.diagnostics).toHaveLength(1);
    offB();
    expect(ctx.connection.diagnostics).toEqual([]);
    offA();
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('does not send while the socket is not open, and records a diagnostic instead', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    const listener = vi.fn();
    ctx.connection.subscribe(listener);

    // Socket never opened — readyState stays CONNECTING(0), as it would be
    // for a real WebSocket before the host accepts the connection.
    ctx.connection.update('a:probe1', { speed: 3 });

    expect(socket.sent).toHaveLength(0);
    expect(ctx.connection.diagnostics).toHaveLength(1);
    expect(ctx.connection.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'a:probe1',
      where: 'connection',
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('collapses repeated not-connected failures into a single diagnostic and notifies once', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    const listener = vi.fn();
    ctx.connection.subscribe(listener);

    // Simulates a range input's onChange firing many times per second
    // (dragging a knob) while the socket is still closed.
    ctx.connection.update('a:probe1', { speed: 1 });
    ctx.connection.update('a:probe1', { speed: 2 });
    ctx.connection.update('a:probe1', { speed: 3 });

    expect(ctx.connection.diagnostics).toHaveLength(1);
    expect(ctx.connection.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'a:probe1',
      where: 'connection',
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps distinct rows' not-connected failures separate instead of collapsing them", async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    const listener = vi.fn();
    ctx.connection.subscribe(listener);

    // Two different rows fail against the same closed socket. Neither
    // failure has resolved, so both must still be visible afterwards —
    // row B failing must not silently erase row A's diagnostic.
    ctx.connection.update('a:probe1', { speed: 1 });
    ctx.connection.update('a:probe2', { speed: 1 });

    expect(ctx.connection.diagnostics).toHaveLength(2);
    expect(ctx.connection.diagnostics.map((d) => d.plugin).sort()).toEqual([
      'a:probe1',
      'a:probe2',
    ]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps a send-exception and a not-connected failure for the same row side by side', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });

    // Not connected first — this is the not-open branch.
    ctx.connection.update('a:probe1', { speed: 1 });
    // Then, once open, a value the transport can't serialise — the
    // try/catch-around-send branch. Both carry where: 'connection' for the
    // same row but are different failure reasons (different message), so
    // neither should erase the other.
    socket.open();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    ctx.connection.update('a:probe1', circular);

    expect(ctx.connection.diagnostics).toHaveLength(2);
    expect(
      ctx.connection.diagnostics.every((d) => d.plugin === 'a:probe1' && d.where === 'connection'),
    ).toBe(true);
    const messages = ctx.connection.diagnostics.map((d) => d.message);
    expect(new Set(messages).size).toBe(2);
  });

  it('turns a send failure into a diagnostic instead of throwing', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    socket.open();
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify throws synchronously on this

    expect(() => ctx.connection.update('a:probe1', circular)).not.toThrow();

    expect(socket.sent).toHaveLength(0);
    expect(ctx.connection.diagnostics).toHaveLength(1);
    expect(ctx.connection.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'a:probe1',
      where: 'connection',
    });
  });

  it('onFrame hears every well-formed frame, including types the service itself ignores', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    socket.open();
    const heard: string[] = [];
    const off = ctx.connection.onFrame((f) => heard.push(f.type));

    socket.receive({ type: 'scenes', scenes: [], diagnostics: [] });
    socket.receive('not json' as unknown as ServerMessage);
    socket.receive({ type: 'snapshot', snapshot: SNAPSHOT });

    expect(heard).toEqual(['scenes', 'snapshot']);

    off();
    socket.receive({ type: 'scenes', scenes: [], diagnostics: [] });
    expect(heard).toHaveLength(2);
  });

  it('ignores a well-formed but unrecognised frame instead of throwing', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, fetchFn });
    const listener = vi.fn();
    ctx.connection.subscribe(listener);
    socket.open();

    expect(() => socket.receive({ type: 'bogus' } as unknown as ServerMessage)).not.toThrow();

    expect(ctx.connection.snapshot).toBeNull();
    expect(ctx.connection.diagnostics).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
