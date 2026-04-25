import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../src/core/EventEmitter';

interface TestEvents {
  greet: string;
  count: number;
  empty: undefined;
}

describe('EventEmitter', () => {
  it('emits events to registered listeners', () => {
    const ee = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    ee.on('greet', handler);
    ee.emit('greet', 'hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('supports multiple listeners', () => {
    const ee = new EventEmitter<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    ee.on('count', h1);
    ee.on('count', h2);
    ee.emit('count', 42);
    expect(h1).toHaveBeenCalledWith(42);
    expect(h2).toHaveBeenCalledWith(42);
  });

  it('once fires only once', () => {
    const ee = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    ee.once('greet', handler);
    ee.emit('greet', 'a');
    ee.emit('greet', 'b');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('a');
  });

  it('off removes a specific listener', () => {
    const ee = new EventEmitter<TestEvents>();
    const handler = vi.fn();
    ee.on('count', handler);
    ee.off('count', handler);
    ee.emit('count', 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('removeAllListeners for a specific event', () => {
    const ee = new EventEmitter<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    ee.on('greet', h1);
    ee.on('count', h2);
    ee.removeAllListeners('greet');
    ee.emit('greet', 'x');
    ee.emit('count', 1);
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith(1);
  });

  it('removeAllListeners without arg clears everything', () => {
    const ee = new EventEmitter<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    ee.on('greet', h1);
    ee.on('count', h2);
    ee.removeAllListeners();
    ee.emit('greet', 'x');
    ee.emit('count', 1);
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('on returns this for chaining', () => {
    const ee = new EventEmitter<TestEvents>();
    const result = ee.on('greet', () => {});
    expect(result).toBe(ee);
  });

  it('emitting unknown event does nothing', () => {
    const ee = new EventEmitter<TestEvents>();
    expect(() => ee.emit('greet', 'x')).not.toThrow();
  });
});
