import { describe, it, expect, vi } from 'vitest';
import { createPauseController } from '@/host/pauseController';

describe('PauseController', () => {
  it('calls onHidden/onVisible on visibility changes and unsubscribes on destroy', () => {
    let hidden = false;
    let cb: () => void = () => {};
    const onHidden = vi.fn();
    const onVisible = vi.fn();
    const unsub = vi.fn();
    const ctl = createPauseController({
      isHidden: () => hidden,
      onHidden, onVisible,
      subscribe: (fn) => { cb = fn; return unsub; },
    });
    hidden = true; cb();
    expect(onHidden).toHaveBeenCalledTimes(1);
    hidden = false; cb();
    expect(onVisible).toHaveBeenCalledTimes(1);
    // no double-fire when state doesn't change
    cb();
    expect(onVisible).toHaveBeenCalledTimes(1);
    ctl.destroy();
    expect(unsub).toHaveBeenCalled();
  });
});
