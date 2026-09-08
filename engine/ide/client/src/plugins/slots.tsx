import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import type { ConnectionService } from './connection';

export interface SlotMeta {
  /** Named extension point, e.g. "composition.card". */
  name: string;
  /**
   * Identity within the slot; registering the same key twice replaces it
   * — deliberately still a replace, not a refusal (see `apply`'s own
   * comment on `register` for why this differs from the
   * first-wins-and-refuses rule `BoardStepRegistry`/`MechanicsService`
   * apply to their own name collisions). The replacement is reported as a
   * diagnostic when it happens, so it stops being silent either way.
   */
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
      // A second registration under a key already taken used to replace
      // the first with nothing anywhere saying so — the same
      // last-writer-wins defect this branch has already found (and fixed)
      // twice elsewhere: `NamedCollection` in spin-parser, and
      // `BoardStepRegistry`/`MechanicsService` in play-loop/game-runtime.
      // The POLICY stays a replace here, deliberately, not a refusal:
      // unlike those two, this collection is rendered as a LIST (`useSlot`
      // returns every entry for a name; nothing looks up "the one card at
      // key K" the way `mechanics.bind` looks up "the one mechanic named
      // K"), and the existing "stale disposer" test below relies on a
      // later registration under the same key winning over an earlier
      // one. What was actually wrong was the SILENCE, not the policy: a
      // developer whose card mysteriously stopped appearing now has
      // somewhere to look for why. Read leniently — `slots` has no static
      // dependency on `connection` and must keep working (silently, as
      // before) if this is ever composed without it.
      if (entries.has(id)) {
        const connection = ctx.reflect.get('connection', false) as ConnectionService | undefined;
        connection?.report(
          diagnostic(
            'warning',
            meta.key,
            meta.name,
            `a second contribution to "${meta.name}" registered under the key "${meta.key}", replacing the first — a slot key must be unique within its slot`,
            'give one of them a key of its own',
          ),
        );
      }
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
