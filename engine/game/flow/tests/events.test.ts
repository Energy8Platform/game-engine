import { describe, expect, it } from 'vitest';
import { createEvents } from '../src/events';

describe('createEvents', () => {
  it('on hears emit with the payload', () => {
    const events = createEvents();
    const seen: unknown[] = [];
    events.on('spin', (payload) => seen.push(payload));
    events.emit('spin', { ok: true });
    expect(seen).toEqual([{ ok: true }]);
  });

  it('off stops it', () => {
    const events = createEvents();
    const seen: unknown[] = [];
    const off = events.on('spin', (payload) => seen.push(payload));
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
    events.on('x', (payload) => seen.push(payload));
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
    events.on('x', () => seen.push('b'));
    events.emit('x');
    expect(seen).toEqual(['a', 'b']);
    // second emit: 'a' unsubscribed itself, only 'b' should fire again
    events.emit('x');
    expect(seen).toEqual(['a', 'b', 'b']);
  });
});
