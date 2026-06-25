import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Container } from 'pixi.js';
import { createOverlayController } from '@/host/overlayController';

function setup() {
  const parent = new Container();
  const ctl = createOverlayController({ parent, size: () => ({ width: 800, height: 600 }) });
  return { parent, ctl };
}

describe('OverlayController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves on autoClose and tears down the layer', async () => {
    const { parent, ctl } = setup();
    let built = false;
    const p = ctl.overlay.show({ build: () => { built = true; }, autoCloseMs: 100, closeOn: false });
    expect(built).toBe(true);
    expect(parent.children.length).toBe(1);
    vi.advanceTimersByTime(100);
    await p;
    expect(parent.children.length).toBe(0);
  });

  it('resolves on manual close()', async () => {
    const { ctl } = setup();
    const p = ctl.overlay.show({ build: () => {}, closeOn: false });
    ctl.overlay.close();
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects a concurrent show()', async () => {
    const { ctl } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p1 = ctl.overlay.show({ build: () => {}, closeOn: false });
    await expect(ctl.overlay.show({ build: () => {} })).rejects.toThrow(/already open/i);
    expect(warn).toHaveBeenCalled();
    ctl.overlay.close();
    await p1;
    warn.mockRestore();
  });
});
