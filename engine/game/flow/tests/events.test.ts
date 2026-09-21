import { describe, expect, it } from 'vitest';
import { createEvents } from '../src/events';

describe('createEvents', () => {
  it('on hears emit with the payload', () => {
    const events = createEvents();
    const seen: unknown[] = [];
    events.on('spin', (payload) => {
      seen.push(payload);
    });
    events.emit('spin', { ok: true });
    expect(seen).toEqual([{ ok: true }]);
  });

  it('off stops it', () => {
    const events = createEvents();
    const seen: unknown[] = [];
    const off = events.on('spin', (payload) => {
      seen.push(payload);
    });
    off();
    events.emit('spin', 1);
    expect(seen).toEqual([]);
  });

  it('emit with no listener is fine', () => {
    const events = createEvents();
    expect(() => events.emit('nothing')).not.toThrow();
  });

  it('emit with no payload is fine', () => {
    const events = createEvents();
    const seen: unknown[] = [];
    events.on('x', (payload) => {
      seen.push(payload);
    });
    events.emit('x');
    expect(seen).toEqual([undefined]);
  });

  it('a listener may unsubscribe itself during emit without breaking sibling listeners', () => {
    const events = createEvents();
    const seen: string[] = [];
    const off = events.on('x', () => {
      seen.push('a');
      off();
    });
    events.on('x', () => {
      seen.push('b');
    });
    events.emit('x');
    expect(seen).toEqual(['a', 'b']);
    // second emit: 'a' unsubscribed itself, only 'b' should fire again
    events.emit('x');
    expect(seen).toEqual(['a', 'b', 'b']);
  });

  it('emit returns a promise that settles after every listener promise — a rejection included', async () => {
    const bus = createEvents();
    const order: string[] = [];
    bus.on(
      'x',
      () =>
        new Promise<void>((r) =>
          setTimeout(() => {
            order.push('a');
            r();
          }, 10),
        ),
    );
    bus.on('x', () => {
      order.push('sync');
    });
    bus.on('x', () => Promise.reject(new Error('nope')));
    await bus.emit('x');
    expect(order).toEqual(['sync', 'a']);
  });

  it('emit with no listener resolves at once', async () => {
    await expect(createEvents().emit('none')).resolves.toBeUndefined();
  });
});
