import { Context } from 'cordis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ideBridge from '../src/index';

/**
 * `ide-bridge`'s `game-status` frames (slice 39) — what the project page's
 * own `#status` text used to say, now derived from the flow interpreter and
 * sent down the same `/ide` socket the trace already rides. `editor.html`
 * never composes `ide-bridge` at all, so there is no editor-page guard to
 * test here, unlike the browser-vs-host split `index.test.ts` covers.
 *
 * Same fakes as `index.test.ts`'s own `fakeMechanics`/`fakeOpenableSocket` —
 * copied rather than imported (they are test-only, one file each), per the
 * brief.
 */

/** The minimal `ctx.mechanics` slice `apply` reads before it does anything else — without it, `apply` is the host-side no-op and never opens a socket. */
function fakeMechanics() {
  const bound = new Map<string, string>();
  const bind = vi.fn((stage: string, mechanicId: string) => {
    bound.set(stage, mechanicId);
  });
  const forStage = vi.fn((stage: string) => {
    const id = bound.get(stage);
    return id === undefined ? null : { id };
  });
  const bindings = vi.fn(() => Object.fromEntries([...bound].map(([stage]) => [stage, {}])));
  return { bind, forStage, bindings };
}

/** Same shape as `index.test.ts`'s own `fakeOpenableSocket`. */
function fakeOpenableSocket() {
  const sent: string[] = [];
  const openListeners: ((event: { data: string }) => void)[] = [];
  const socket = {
    readyState: 0, // CONNECTING
    send(frame: string) {
      sent.push(frame);
    },
    sent,
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      if (type === 'open') openListeners.push(listener);
    },
    close() {},
    open() {
      socket.readyState = 1;
      for (const listener of openListeners) listener({ data: '' });
    },
  };
  return socket;
}

const statusFrames = (socket: { sent: string[] }) =>
  socket.sent.map((raw) => JSON.parse(raw)).filter((m) => m.type === 'game-status');
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A fake of the one slice of `FlowService` `watchStatus` reads: `ready` (a
 * promise this test settles by hand, via `resolveReady`/`rejectReady`),
 * `doc()` (a fixed node list — `id`/`kind` is all `watchStatus` looks at),
 * `busy()` (whatever `idle`/`working` last set — what the spinning state's
 * idle fallback polls), and `onTrace` (captures every subscriber so `fire`
 * can play a trace entry into all of them, the same shape `index.test.ts`'s
 * own `fakeTraceFlow` uses). A `replace` restarting the run numbering is
 * just a `fire` with a lower `run`.
 */
function fakeStatusFlow(
  nodes: { id: string; kind: string }[] = [
    { id: 's', kind: 'spin' },
    { id: 'p', kind: 'present' },
  ],
) {
  let resolveReady!: () => void;
  let rejectReady!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let busy = false;
  const listeners = new Set<
    (e: { run: number; node: string; out: string | null; at: number }) => void
  >();
  return {
    ready,
    resolveReady: () => resolveReady(),
    rejectReady: (reason: unknown) => rejectReady(reason),
    busy: () => busy,
    working: () => {
      busy = true;
    },
    idle: () => {
      busy = false;
    },
    doc: () => ({ nodes }),
    onTrace(fn: (e: { run: number; node: string; out: string | null; at: number }) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    fire(e: { run: number; node: string; out: string | null; at: number }) {
      listeners.forEach((fn) => fn(e));
    },
  };
}

let ctx: Context | undefined;
afterEach(async () => {
  await ctx?.fiber.dispose();
  ctx = undefined;
});

describe('ide-bridge — game-status', () => {
  it('sends `loading` on open, then `ready` once the flow settles', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    expect(statusFrames(socket)).toEqual([{ type: 'game-status', state: 'loading' }]);

    flow.resolveReady();
    await nextTick();
    expect(statusFrames(socket)).toEqual([
      { type: 'game-status', state: 'loading' },
      { type: 'game-status', state: 'ready' },
    ]);
  });

  it('a `spin` node entered moves to `spinning`; a `present` node left by `next` moves back to `ready`', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow.resolveReady();
    await nextTick();

    flow.fire({ run: 1, node: 's', out: null, at: 1 });
    flow.fire({ run: 1, node: 'p', out: 'next', at: 2 });
    expect(statusFrames(socket)).toEqual([
      { type: 'game-status', state: 'loading' },
      { type: 'game-status', state: 'ready' },
      { type: 'game-status', state: 'spinning' },
      { type: 'game-status', state: 'ready' },
    ]);
  });

  it('a `spin` or `present` node left by `failed` reports which, and a later spin re-enters `spinning`', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow.resolveReady();
    await nextTick();

    flow.fire({ run: 1, node: 's', out: 'failed', at: 1 });
    expect(statusFrames(socket).at(-1)).toEqual({
      type: 'game-status',
      state: 'failed',
      message: 'spin failed',
    });

    flow.fire({ run: 1, node: 'p', out: 'failed', at: 2 });
    expect(statusFrames(socket).at(-1)).toEqual({
      type: 'game-status',
      state: 'failed',
      message: 'presentation failed',
    });

    flow.fire({ run: 1, node: 's', out: null, at: 3 });
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'spinning' });
  });

  it('a trace for a node of another kind, or one absent from the doc, sends nothing', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow([
      { id: 's', kind: 'spin' },
      { id: 'p', kind: 'present' },
      { id: 'm', kind: 'merge' },
    ]);
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow.resolveReady();
    await nextTick();
    const before = statusFrames(socket).length;

    flow.fire({ run: 1, node: 'm', out: null, at: 1 }); // a real node, but not `spin`/`present`
    flow.fire({ run: 1, node: 'ghost', out: null, at: 2 }); // not in the doc at all
    expect(statusFrames(socket)).toHaveLength(before);
  });

  it('the same state reported twice sends one frame', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow.resolveReady();
    await nextTick();
    const before = statusFrames(socket).length;

    flow.fire({ run: 1, node: 's', out: null, at: 1 });
    flow.fire({ run: 2, node: 's', out: null, at: 2 }); // still `spinning` — no second frame
    expect(statusFrames(socket)).toHaveLength(before + 1);
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'spinning' });
  });

  it('with no flow row, reports `ready` with a message explaining why', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    // No `ctx.provide('flow', …)` at all.
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    expect(statusFrames(socket)).toEqual([
      { type: 'game-status', state: 'ready', message: 'no flow row' },
    ]);
  });

  it('a status set before the socket opens is not lost — the last one goes out on open', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket(); // never opened yet

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    flow.resolveReady();
    await nextTick();
    // Nothing sent yet — the socket is still closed.
    expect(statusFrames(socket)).toEqual([]);

    socket.open();
    // Only the LAST status — `ready` — goes out, not the `loading` it passed through.
    expect(statusFrames(socket)).toEqual([{ type: 'game-status', state: 'ready' }]);
  });

  it("a re-provided flow is the one watched: its trace moves the status, the first one's does not", async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow1 = fakeStatusFlow();
    const disposeFlow1 = ctx.provide('flow' as never, flow1 as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow1.resolveReady();
    await nextTick();
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'ready' });

    await disposeFlow1();
    const flow2 = fakeStatusFlow();
    ctx.provide('flow' as never, flow2 as never);
    // cordis runs a sibling `ctx.inject(['flow'])` asynchronously — see
    // `index.test.ts`'s own "re-arms the subscription" test for the same wait.
    await nextTick();
    await nextTick();

    // The new flow boots: `loading` until its own `ready` settles.
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'loading' });
    flow1.fire({ run: 1, node: 's', out: null, at: 1 });
    expect(
      statusFrames(socket).at(-1),
      "the disposed flow's trace must not move the status",
    ).toEqual({ type: 'game-status', state: 'loading' });

    flow2.fire({ run: 1, node: 's', out: null, at: 2 });
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'spinning' });
  });

  // --- The final review's I3: every way a spin can end without `present`
  // leaving by a port, and a flow that never starts or goes away.

  it('a lower run number means a `replace` restarted the flow mid-spin — the old run is gone, so `ready` goes out first', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow([
      { id: 's', kind: 'spin' },
      { id: 'p', kind: 'present' },
      { id: 'boot', kind: 'boot' },
    ]);
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow.resolveReady();
    await nextTick();

    flow.fire({ run: 2, node: 's', out: null, at: 1 });
    flow.fire({ run: 2, node: 's', out: 'next', at: 2 }); // same run: still spinning
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'spinning' });

    // The edit's `replace` stopped run 2; the new document's boot is run 1.
    flow.fire({ run: 1, node: 'boot', out: null, at: 3 });
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'ready' });

    // …and an entry that restarts numbering straight into a spin reads
    // `ready` first, then the new spin.
    flow.fire({ run: 3, node: 's', out: null, at: 4 });
    flow.fire({ run: 1, node: 's', out: null, at: 5 });
    expect(statusFrames(socket).slice(-3)).toEqual([
      { type: 'game-status', state: 'spinning' },
      { type: 'game-status', state: 'ready' },
      { type: 'game-status', state: 'spinning' },
    ]);
  });

  it('a spin that ends with no port — a node threw or timed out, or `stop()` aborted it — falls back to `ready` once the flow is idle', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow.resolveReady();
    await nextTick();

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      // Nothing polls until something is spinning.
      expect(vi.getTimerCount()).toBe(0);
      flow.working();
      flow.fire({ run: 2, node: 's', out: null, at: 1 });
      expect(vi.getTimerCount()).toBe(1);

      // Still busy (the spin is in flight): still spinning.
      vi.advanceTimersByTime(1000);
      expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'spinning' });

      // The node threw — `fail()` reports, nothing leaves, no trace entry —
      // and the run's last branch is gone.
      flow.idle();
      vi.advanceTimersByTime(250);
      expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'ready' });
      // …and the poll is over with the spinning state.
      expect(vi.getTimerCount()).toBe(0);

      // A spin that DOES leave by a port stops the poll just the same.
      flow.working();
      flow.fire({ run: 3, node: 's', out: null, at: 2 });
      expect(vi.getTimerCount()).toBe(1);
      flow.fire({ run: 3, node: 'p', out: 'failed', at: 3 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the flow disposed with nothing in its place reads `ready — no flow row`, and its trace moves nothing any more', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow();
    const disposeFlow = ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow.resolveReady();
    await nextTick();
    flow.fire({ run: 2, node: 's', out: null, at: 1 });
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'spinning' });

    await disposeFlow();
    await nextTick();
    await nextTick();
    expect(statusFrames(socket).at(-1)).toEqual({
      type: 'game-status',
      state: 'ready',
      message: 'no flow row',
    });

    const before = statusFrames(socket).length;
    flow.fire({ run: 3, node: 's', out: null, at: 2 });
    expect(statusFrames(socket), 'the old watch is unsubscribed').toHaveLength(before);
  });

  it('a flow that arrives after apply is watched: `loading` until it settles, then `ready` — not the `no flow row` it replaced', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    expect(statusFrames(socket).at(-1)).toEqual({
      type: 'game-status',
      state: 'ready',
      message: 'no flow row',
    });

    const flow = fakeStatusFlow();
    ctx.provide('flow' as never, flow as never);
    await nextTick();
    await nextTick();
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'loading' });

    flow.resolveReady();
    await nextTick();
    expect(statusFrames(socket).at(-1)).toEqual({ type: 'game-status', state: 'ready' });
  });

  it("`flow.ready` rejecting — the boot GET failed — reads `failed` with the error's message", async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow.rejectReady(new Error('could not read the flow document: the host answered 500'));
    await nextTick();
    expect(statusFrames(socket).at(-1)).toEqual({
      type: 'game-status',
      state: 'failed',
      message: 'could not read the flow document: the host answered 500',
    });
  });

  it('…and with no message to give, says `the flow did not start`', async () => {
    ctx = new Context();
    const { bind, forStage, bindings } = fakeMechanics();
    ctx.provide('mechanics' as never, { bind, forStage, bindings } as never);
    const flow = fakeStatusFlow();
    ctx.provide('flow' as never, flow as never);
    const socket = fakeOpenableSocket();

    ideBridge.apply(ctx, { bridgeUrl: 'ws://x/ide', socketFactory: () => socket as never });
    socket.open();
    flow.rejectReady('nope');
    await nextTick();
    expect(statusFrames(socket).at(-1)).toEqual({
      type: 'game-status',
      state: 'failed',
      message: 'the flow did not start',
    });
  });
});
