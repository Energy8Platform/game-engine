import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage, Snapshot } from '@energy8engine/contracts';
import { createIdeClient, type WebSocketLike } from '../src/index';

const SNAPSHOT: Snapshot = {
  rows: [
    { id: 'a:probe1', name: 'probe-plugin', disabled: false, state: 2, config: { speed: 8 }, schema: null, hot: true, clientUrl: null },
  ],
  diagnostics: [],
};

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  listeners: Record<string, ((event: any) => void)[]> = {};
  addEventListener(type: string, listener: (event: any) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  receive(message: ServerMessage) {
    for (const listener of this.listeners.message ?? []) listener({ data: JSON.stringify(message) });
  }
  open() {
    for (const listener of this.listeners.open ?? []) listener({});
  }
}

describe('connection', () => {
  it('stores the snapshot the host pushes and notifies subscribers', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
    const listener = vi.fn();
    ctx.connection.subscribe(listener);

    socket.open();
    socket.receive({ type: 'snapshot', snapshot: SNAPSHOT });

    expect(ctx.connection.snapshot).toEqual(SNAPSHOT);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('sends an update message shaped for the host', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
    socket.open();
    ctx.connection.update('a:probe1', { speed: 3 });

    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'update', id: 'a:probe1', config: { speed: 3 } });
  });

  it('keeps diagnostics from the host without dropping the snapshot', async () => {
    const socket = new FakeSocket();
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
    socket.open();
    socket.receive({ type: 'snapshot', snapshot: SNAPSHOT });
    socket.receive({
      type: 'diagnostics',
      diagnostics: [{ severity: 'error', plugin: 'a:probe1', where: 'config', message: 'nope' }],
    });

    expect(ctx.connection.diagnostics).toHaveLength(1);
    expect(ctx.connection.snapshot).toEqual(SNAPSHOT);
  });
});
