import { describe, expect, it, vi } from 'vitest';
import { createCanvasRpc } from '../src/shell/canvas-rpc';

/** A fake `Window`: captures the `message` listener and lets tests deliver frames to it. */
function fakeWindow() {
  let listener: ((e: unknown) => void) | undefined;
  return {
    addEventListener: vi.fn((type: string, fn: (e: unknown) => void) => {
      if (type === 'message') listener = fn;
    }),
    removeEventListener: vi.fn((type: string, fn: (e: unknown) => void) => {
      if (type === 'message' && listener === fn) listener = undefined;
    }),
    deliver(frame: unknown, origin = '*', source: unknown = undefined) {
      listener?.({ data: frame, origin, source });
    },
    get hasListener() {
      return listener !== undefined;
    },
  };
}

function fakeTarget() {
  return { contentWindow: { postMessage: vi.fn() } };
}

describe('canvas-rpc', () => {
  it('call posts a req with an incrementing id and resolves on the matching res', async () => {
    const win = fakeWindow();
    const target = fakeTarget();
    const rpc = createCanvasRpc(win);
    rpc.attach(target, '*');

    const p1 = rpc.call('foo', { a: 1 });
    expect(target.contentWindow.postMessage).toHaveBeenCalledWith(
      { type: 'e8:ide:req', id: 1, method: 'foo', params: { a: 1 } },
      '*',
    );
    win.deliver({ type: 'e8:ide:res', id: 1, ok: true, result: 'yay' }, '*', target.contentWindow);
    await expect(p1).resolves.toBe('yay');

    const p2 = rpc.call('bar');
    expect(target.contentWindow.postMessage).toHaveBeenCalledWith(
      { type: 'e8:ide:req', id: 2, method: 'bar', params: undefined },
      '*',
    );
    win.deliver({ type: 'e8:ide:res', id: 2, ok: true, result: 42 }, '*', target.contentWindow);
    await expect(p2).resolves.toBe(42);
  });

  it('ok:false rejects with the error text', async () => {
    const win = fakeWindow();
    const target = fakeTarget();
    const rpc = createCanvasRpc(win);
    rpc.attach(target, '*');

    const p = rpc.call('boom');
    win.deliver(
      { type: 'e8:ide:res', id: 1, ok: false, error: 'nope' },
      '*',
      target.contentWindow,
    );
    await expect(p).rejects.toThrow('nope');
  });

  it('an event reaches on handlers and the disposer stops it', () => {
    const win = fakeWindow();
    const target = fakeTarget();
    const rpc = createCanvasRpc(win);
    rpc.attach(target, '*');

    const handler = vi.fn();
    const off = rpc.on('ping', handler);
    win.deliver({ type: 'e8:ide:evt', event: 'ping', payload: { n: 1 } }, '*', target.contentWindow);
    expect(handler).toHaveBeenCalledWith({ n: 1 });

    off();
    win.deliver({ type: 'e8:ide:evt', event: 'ping', payload: { n: 2 } }, '*', target.contentWindow);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('frames from another source are ignored', async () => {
    const win = fakeWindow();
    const target = fakeTarget();
    const rpc = createCanvasRpc(win);
    rpc.attach(target, '*');

    const handler = vi.fn();
    rpc.on('ping', handler);
    win.deliver({ type: 'e8:ide:evt', event: 'ping', payload: {} }, '*', { not: 'the source' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('frames from another origin are ignored when origin is not "*"', () => {
    const win = fakeWindow();
    const target = fakeTarget();
    const rpc = createCanvasRpc(win);
    rpc.attach(target, 'https://good.example');

    const handler = vi.fn();
    rpc.on('ping', handler);
    win.deliver(
      { type: 'e8:ide:evt', event: 'ping', payload: {} },
      'https://evil.example',
      target.contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();

    win.deliver(
      { type: 'e8:ide:evt', event: 'ping', payload: { ok: true } },
      'https://good.example',
      target.contentWindow,
    );
    expect(handler).toHaveBeenCalledWith({ ok: true });
  });

  it('call rejects after 5s with a clear message', async () => {
    vi.useFakeTimers();
    try {
      const win = fakeWindow();
      const target = fakeTarget();
      const rpc = createCanvasRpc(win);
      rpc.attach(target, '*');

      const p = rpc.call('slow');
      const assertion = expect(p).rejects.toThrow('canvas did not answer "slow"');
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('a frame delivered before attach is ignored (no target to spoof yet)', () => {
    const win = fakeWindow();
    const target = fakeTarget();
    const rpc = createCanvasRpc(win);
    // deliberately not calling rpc.attach(...)

    const handler = vi.fn();
    rpc.on('ping', handler);
    win.deliver({ type: 'e8:ide:evt', event: 'ping', payload: {} }, '*', target.contentWindow);
    expect(handler).not.toHaveBeenCalled();
  });

  it('attach a second time rejects pending calls against the old target', async () => {
    const win = fakeWindow();
    const oldTarget = fakeTarget();
    const newTarget = fakeTarget();
    const rpc = createCanvasRpc(win);
    rpc.attach(oldTarget, '*');

    const p = rpc.call('stale');
    rpc.attach(newTarget, '*');

    await expect(p).rejects.toThrow('canvas was replaced');
  });

  it('dispose removes the listener and rejects every pending call', async () => {
    const win = fakeWindow();
    const target = fakeTarget();
    const rpc = createCanvasRpc(win);
    rpc.attach(target, '*');
    expect(win.hasListener).toBe(true);

    const p = rpc.call('pending');
    rpc.dispose();
    expect(win.hasListener).toBe(false);
    await expect(p).rejects.toThrow();

    // no longer delivers after dispose
    const handler = vi.fn();
    rpc.on('ping', handler);
    win.deliver({ type: 'e8:ide:evt', event: 'ping', payload: {} }, '*', target.contentWindow);
    expect(handler).not.toHaveBeenCalled();
  });
});
