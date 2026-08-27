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

  // Fix round 1: a permanently-poisoned row (never releasing the claimed
  // id) was rejected — it would mean a developer who fixes a broken client
  // half never sees it load, short of a full page reload, even once the
  // host pushes a fresh snapshot. The id is released on failure instead.
  //
  // That release does let the first failure retrigger itself once, for
  // free: `ctx.connection.report()` notifies subscribers, including this
  // plugin's own sync loop, so the very first failure's notification causes
  // one immediate extra attempt. It does not cascade further — the second
  // consecutive failure produces a byte-identical `Diagnostic`, which
  // `report()`'s own identity dedupe recognises and swallows without
  // notifying, so the self-triggered retry is bounded at exactly one wasted
  // fetch. This test pins both halves of that behaviour: the bounded
  // self-retry (call #2, no snapshot needed), and the real fix — a later,
  // *explicit* snapshot still gets its own attempt instead of the row
  // being stuck.
  it('retries a failed import when a later snapshot repeats the same row', async () => {
    const importModule = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom')) // the push below
      .mockRejectedValueOnce(new Error('boom')) // the bounded self-retry from report()'s notify
      .mockResolvedValue({ apply() {} }); // the explicit second push, after the fix
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(2));
    expect(ctx.modules.loaded()).toEqual([]);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(ctx.modules.loaded()).toEqual(['a:probe1']));
    expect(importModule).toHaveBeenCalledTimes(3);
  });

  it('treats a client half with no apply export as loaded, not a failure', async () => {
    const importModule = vi.fn(async () => ({}));
    const { ctx, push } = await harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(ctx.modules.loaded()).toEqual(['a:probe1']));

    expect(ctx.connection.diagnostics).toHaveLength(0);
  });
});
