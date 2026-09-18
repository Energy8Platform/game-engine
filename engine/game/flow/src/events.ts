/** A tiny synchronous pub/sub bus for flow `on`/`emit` nodes. */
export interface EventsService {
  emit(name: string, payload?: unknown): void;
  on(name: string, fn: (payload: unknown) => void): () => void;
}

export function createEvents(): EventsService {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  return {
    emit(name, payload) {
      const set = listeners.get(name);
      if (!set) return;
      // Copy before iterating: a listener may call its own `off()`
      // (returned by `on`) while `emit` is still running.
      for (const fn of [...set]) fn(payload);
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
