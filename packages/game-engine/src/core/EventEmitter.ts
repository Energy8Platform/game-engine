/**
 * Minimal typed event emitter.
 * Used internally by GameApplication, SceneManager, AudioManager, etc.
 *
 * Supports `void` event types — events that carry no data can be emitted
 * without arguments: `emitter.emit('eventName')`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class EventEmitter<TEvents extends {}> {
  private listeners = new Map<keyof TEvents, Set<(data: any) => void>>();

  on<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return this;
  }

  once<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): this {
    const wrapper = (data: TEvents[K]) => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }

  off<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  emit<K extends keyof TEvents>(
    ...args: TEvents[K] extends void ? [event: K] : [event: K, data: TEvents[K]]
  ): void {
    const [event, data] = args as [K, TEvents[K]];
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  removeAllListeners(event?: keyof TEvents): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}
