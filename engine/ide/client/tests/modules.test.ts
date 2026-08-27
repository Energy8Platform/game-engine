import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage, Snapshot } from '@energy8engine/contracts';
import { createIdeClient } from '../src/index';

function snapshotWith(clientUrl: string | null): Snapshot {
  return {
    rows: [
      { id: 'a:probe1', name: 'probe-plugin', disabled: false, state: 2, config: {}, schema: null, hot: true, clientUrl },
    ],
    diagnostics: [],
  };
}

// `createIdeClient` is async (Task 8, Ruling 2), so this harness must be too
// — every caller awaits the fiber reaching ACTIVE before touching
// `ctx.connection` or `ctx.modules`. `readyState: 1` (OPEN) is required by
// `WebSocketLike` (Task 8) even though these tests never exercise sending —
// shaped like the fake socket in tests/connection.test.ts, not the brief's
// (which omits it and fails to typecheck).
async function harness(importModule: (url: string) => Promise<unknown>) {
  const listeners: ((event: any) => void)[] = [];
  const socket = {
    readyState: 1,
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send() {},
    close() {},
  };
  const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, importModule });
  const push = (message: ServerMessage) => {
    for (const listener of listeners) listener({ data: JSON.stringify(message) });
  };
  return { ctx, push };
}

describe('modules', () => {
  it('imports a client half once the snapshot mentions it and applies it', async () => {
    const apply = vi.fn();
    const importModule = vi.fn(async () => ({ apply }));
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    expect(importModule).toHaveBeenCalledWith('/plugin-client/a:probe1');
    expect(ctx.modules.loaded()).toEqual(['a:probe1']);
  });

  it('does not import the same half twice across snapshots', async () => {
    const importModule = vi.fn(async () => ({ apply() {} }));
    const { push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(1));
  });

  it('skips rows with no client half', async () => {
    const importModule = vi.fn(async () => ({ apply() {} }));
    const { push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith(null) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(importModule).not.toHaveBeenCalled();
  });

  // Ruling (Task 10, pre-dispatch): the brief's own version of this test
  // polls `ctx.connection.diagnostics` and would pass even if the failure
  // were recorded by assigning the field directly — which notifies no one,
  // so nothing in the UI would re-render. Asserting a subscriber actually
  // fired is what tells the two implementations apart.
  it('survives a broken client half, reports it as a diagnostic, and notifies subscribers', async () => {
    const importModule = vi.fn(async () => {
      throw new Error('boom');
    });
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });

    // Subscribe only *after* the snapshot push, whose own notification would
    // otherwise fire the listener before the import has even rejected —
    // masking whether `report()` notifies on its own.
    const listener = vi.fn();
    ctx.connection.subscribe(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    expect(ctx.connection.diagnostics.length).toBeGreaterThan(0);
    expect(ctx.connection.diagnostics[0].message).toContain('boom');
  });

  // A broken client half fails the same way every time it's imported. Since
  // reporting the failure now goes through `connection.report()` — which
  // notifies subscribers, and this plugin's own sync loop is one of them —
  // un-claiming the id on failure (as the brief's code does) would let that
  // very notification re-trigger the same import, forever. Once an id is
  // claimed it stays claimed, success or failure.
  it('does not retry a failed import when a later snapshot repeats the same row', async () => {
    const importModule = vi.fn(async () => {
      throw new Error('boom');
    });
    const { push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(1));

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(importModule).toHaveBeenCalledTimes(1);
  });
});
