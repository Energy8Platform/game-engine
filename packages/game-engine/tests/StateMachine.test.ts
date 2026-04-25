import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateMachine } from '../src/state/StateMachine';

interface TestContext {
  count: number;
  lastState: string;
}

describe('StateMachine', () => {
  let fsm: StateMachine<TestContext>;
  let ctx: TestContext;

  beforeEach(() => {
    ctx = { count: 0, lastState: '' };
    fsm = new StateMachine<TestContext>(ctx);
  });

  describe('addState / hasState', () => {
    it('registers a state', () => {
      fsm.addState('idle', {});
      expect(fsm.hasState('idle')).toBe(true);
      expect(fsm.hasState('unknown')).toBe(false);
    });

    it('returns this for chaining', () => {
      const result = fsm.addState('a', {}).addState('b', {});
      expect(result).toBe(fsm);
    });
  });

  describe('start', () => {
    it('enters the initial state', async () => {
      const enter = vi.fn();
      fsm.addState('idle', { enter });
      await fsm.start('idle');
      expect(fsm.current).toBe('idle');
      expect(enter).toHaveBeenCalledWith(ctx, undefined);
    });

    it('passes data to enter', async () => {
      const enter = vi.fn();
      fsm.addState('idle', { enter });
      await fsm.start('idle', { foo: 'bar' });
      expect(enter).toHaveBeenCalledWith(ctx, { foo: 'bar' });
    });

    it('throws if already started', async () => {
      fsm.addState('idle', {});
      await fsm.start('idle');
      await expect(fsm.start('idle')).rejects.toThrow('Already started');
    });

    it('throws for unregistered state', async () => {
      await expect(fsm.start('nope')).rejects.toThrow('not registered');
    });

    it('emits transition event', async () => {
      const handler = vi.fn();
      fsm.addState('idle', {});
      fsm.on('transition', handler);
      await fsm.start('idle');
      expect(handler).toHaveBeenCalledWith({ from: null, to: 'idle' });
    });
  });

  describe('transition', () => {
    beforeEach(() => {
      fsm.addState('idle', {
        exit: (c) => { c.lastState = 'idle'; },
      });
      fsm.addState('running', {
        enter: (c) => { c.count++; },
      });
      fsm.addState('done', {});
    });

    it('transitions between states', async () => {
      await fsm.start('idle');
      const result = await fsm.transition('running');
      expect(result).toBe(true);
      expect(fsm.current).toBe('running');
      expect(ctx.count).toBe(1);
      expect(ctx.lastState).toBe('idle');
    });

    it('calls exit on previous and enter on next', async () => {
      const exitFn = vi.fn();
      const enterFn = vi.fn();
      fsm.addState('a', { exit: exitFn });
      fsm.addState('b', { enter: enterFn });
      await fsm.start('a');
      await fsm.transition('b');
      expect(exitFn).toHaveBeenCalledOnce();
      expect(enterFn).toHaveBeenCalledOnce();
    });

    it('throws for unregistered target state', async () => {
      await fsm.start('idle');
      await expect(fsm.transition('nope')).rejects.toThrow('not registered');
    });

    it('emits transition event', async () => {
      const handler = vi.fn();
      fsm.on('transition', handler);
      await fsm.start('idle');
      await fsm.transition('running');
      expect(handler).toHaveBeenCalledWith({ from: 'idle', to: 'running' });
    });
  });

  describe('guards', () => {
    beforeEach(async () => {
      fsm.addState('idle', {});
      fsm.addState('running', {});
    });

    it('blocks transition when guard returns false', async () => {
      fsm.addGuard('idle', 'running', () => false);
      await fsm.start('idle');
      const result = await fsm.transition('running');
      expect(result).toBe(false);
      expect(fsm.current).toBe('idle');
    });

    it('allows transition when guard returns true', async () => {
      fsm.addGuard('idle', 'running', () => true);
      await fsm.start('idle');
      const result = await fsm.transition('running');
      expect(result).toBe(true);
      expect(fsm.current).toBe('running');
    });

    it('canTransition checks guard', async () => {
      fsm.addGuard('idle', 'running', (c) => c.count > 0);
      await fsm.start('idle');
      expect(fsm.canTransition('running')).toBe(false);
      ctx.count = 5;
      expect(fsm.canTransition('running')).toBe(true);
    });

    it('canTransition returns true with no guard', async () => {
      await fsm.start('idle');
      expect(fsm.canTransition('running')).toBe(true);
    });

    it('canTransition returns false when not started', () => {
      expect(fsm.canTransition('running')).toBe(false);
    });
  });

  describe('update', () => {
    it('calls current state update with dt', async () => {
      const update = vi.fn();
      fsm.addState('idle', { update });
      await fsm.start('idle');
      fsm.update(16.67);
      expect(update).toHaveBeenCalledWith(ctx, 16.67);
    });

    it('does nothing when not started', () => {
      const update = vi.fn();
      fsm.addState('idle', { update });
      fsm.update(16.67);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('exits current state and clears current', async () => {
      const exit = vi.fn();
      fsm.addState('idle', { exit });
      await fsm.start('idle');
      await fsm.reset();
      expect(fsm.current).toBeNull();
      expect(exit).toHaveBeenCalledOnce();
    });

    it('handles reset when not started', async () => {
      await fsm.reset();
      expect(fsm.current).toBeNull();
    });
  });

  describe('destroy', () => {
    it('clears all states and guards', async () => {
      fsm.addState('idle', {});
      fsm.addState('running', {});
      fsm.addGuard('idle', 'running', () => true);
      await fsm.start('idle');
      await fsm.destroy();
      expect(fsm.current).toBeNull();
      expect(fsm.hasState('idle')).toBe(false);
    });
  });

  describe('context', () => {
    it('exposes context', () => {
      expect(fsm.context).toBe(ctx);
    });

    it('context is mutable', () => {
      fsm.context.count = 42;
      expect(ctx.count).toBe(42);
    });
  });

  describe('error handling', () => {
    it('emits error event when enter throws', async () => {
      const errHandler = vi.fn();
      fsm.on('error', errHandler);
      fsm.addState('idle', {});
      fsm.addState('bad', {
        enter: () => { throw new Error('boom'); },
      });
      await fsm.start('idle');
      await expect(fsm.transition('bad')).rejects.toThrow('boom');
      expect(errHandler).toHaveBeenCalled();
      // Should not be stuck in transitioning
      expect(fsm.isTransitioning).toBe(false);
    });
  });

  describe('nested transitions', () => {
    it('allows transition from within an enter hook', async () => {
      fsm.addState('a', {
        enter: async () => {
          await fsm.transition('b');
        },
      });
      fsm.addState('b', {});

      await fsm.start('a');
      expect(fsm.current).toBe('b');
    });

    it('supports chained transitions A → B → C via enter hooks', async () => {
      const events: string[] = [];
      fsm.on('transition', ({ from, to }) => {
        events.push(`${from}->${to}`);
      });

      fsm.addState('a', {
        enter: async () => {
          await fsm.transition('b');
        },
      });
      fsm.addState('b', {
        enter: async () => {
          await fsm.transition('c');
        },
      });
      fsm.addState('c', {});

      await fsm.start('a');
      expect(fsm.current).toBe('c');
      // Inner transitions emit first (depth-first)
      expect(events).toEqual([
        'b->c',
        'a->b',
        'null->a',
      ]);
    });

    it('runs exit hooks correctly during nested transitions', async () => {
      const order: string[] = [];
      fsm.addState('a', {
        enter: async () => {
          await fsm.transition('b');
        },
        exit: () => { order.push('exit-a'); },
      });
      fsm.addState('b', {
        enter: () => { order.push('enter-b'); },
      });

      await fsm.start('a');
      expect(order).toEqual(['exit-a', 'enter-b']);
      expect(fsm.current).toBe('b');
    });

    it('isTransitioning is false after nested transitions complete', async () => {
      fsm.addState('a', {
        enter: async () => {
          await fsm.transition('b');
        },
      });
      fsm.addState('b', {});

      await fsm.start('a');
      expect(fsm.isTransitioning).toBe(false);
    });

    it('throws on max transition depth (infinite loop protection)', async () => {
      fsm.addState('ping', {
        enter: async () => {
          await fsm.transition('pong');
        },
      });
      fsm.addState('pong', {
        enter: async () => {
          await fsm.transition('ping');
        },
      });

      fsm.on('error', () => {}); // Prevent unhandled error
      await expect(fsm.start('ping')).rejects.toThrow(
        'Max transition depth exceeded',
      );
    });

    it('guards still work during nested transitions', async () => {
      fsm.addState('a', {
        enter: async () => {
          const result = await fsm.transition('b');
          expect(result).toBe(false);
        },
      });
      fsm.addState('b', {});
      fsm.addGuard('a', 'b', () => false);

      await fsm.start('a');
      expect(fsm.current).toBe('a');
    });
  });
});
