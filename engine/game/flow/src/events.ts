/** A tiny pub/sub bus for flow `on`/`emit` nodes: dispatch is synchronous, the promise is for whoever wants to wait. */
export interface EventsService {
  /**
   * Dispatches synchronously; the promise settles once every listener's
   * returned promise has (a rejection is the listener's, not the emitter's).
   */
  emit(name: string, payload?: unknown): Promise<void>;
  on(name: string, fn: (payload: unknown) => void | Promise<void>): () => void;
}

export function createEvents(): EventsService {
  const listeners = new Map<string, Set<(payload: unknown) => void | Promise<void>>>();

  return {
    emit(name, payload) {
      const set = listeners.get(name);
      if (!set) return Promise.resolve();
      const pending: Promise<unknown>[] = [];
      // Copy before iterating: a listener may call its own `off()`
      // (returned by `on`) while `emit` is still running.
      for (const fn of [...set]) {
        const r = fn(payload);
        if (r && typeof (r as Promise<unknown>).then === 'function')
          pending.push(r as Promise<unknown>);
      }
      return Promise.allSettled(pending).then(() => undefined);
    },
    on(name, fn) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(fn);
      return () => set.delete(fn);
    },
  };
}
