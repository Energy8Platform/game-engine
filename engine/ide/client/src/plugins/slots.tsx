import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { Context } from 'cordis';

export interface SlotMeta {
  /** Named extension point, e.g. "composition.card". */
  name: string;
  /** Identity within the slot; registering the same key twice replaces it. */
  key: string;
}

export interface SlotEntry extends SlotMeta {
  component: ComponentType<any>;
}

declare module 'cordis' {
  interface Context {
    slots: SlotsService;
  }
}

export interface SlotsService {
  register(meta: SlotMeta, component: ComponentType<any>): () => void;
  list(name: string): SlotEntry[];
  subscribe(listener: () => void): () => void;
}

export const name = 'slots';

export function apply(ctx: Context) {
  const entries = new Map<string, SlotEntry>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const service: SlotsService = {
    register(meta, component) {
      const id = `${meta.name}::${meta.key}`;
      const entry: SlotEntry = { ...meta, component };
      entries.set(id, entry);
      notify();
      return () => {
        // Compare by reference, not just by id: a later registration under
        // the same key replaces the map entry but keeps the same id, and
        // this closure must not evict that replacement out from under its
        // owner. The same check makes calling this disposer twice a no-op
        // for free — the second call finds the id already gone (or holding
        // someone else's entry) and does nothing.
        if (entries.get(id) !== entry) return;
        entries.delete(id);
        notify();
      };
    },
    list(slotName) {
      return [...entries.values()].filter((entry) => entry.name === slotName);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  ctx.provide('slots', service);
}

/** Subscribe a component to one slot. */
export function useSlot(ctx: Context, slotName: string): SlotEntry[] {
  const [entries, setEntries] = useState<SlotEntry[]>(() => ctx.slots.list(slotName));
  useEffect(() => {
    setEntries(ctx.slots.list(slotName));
    return ctx.slots.subscribe(() => setEntries(ctx.slots.list(slotName)));
  }, [ctx, slotName]);
  return entries;
}
