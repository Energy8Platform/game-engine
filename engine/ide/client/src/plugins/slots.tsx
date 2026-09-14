import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import { createRegistry } from '@energy8engine/registry';
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
  /**
   * Generic over the meta shape, not just `SlotMeta`: a caller registering
   * to `shell.activity` (say) passes an `ActivityMeta` — `title`/`icon`/
   * `order`/`opens` alongside `name`/`key` — and `{ ...meta, component }`
   * below already carries those through to `list()` at runtime. Before this
   * became generic, only the TYPE refused them; nothing in the collection
   * ever dropped them. `SlotMeta` stays the default, so every existing
   * caller (`composition.card`, `sidebar.item`, …) is untouched.
   *
   * `component` is optional: a `shell.activity` entry is drawn from its
   * `icon` and never rendered, so an activity needs no body of its own.
   */
  register<M extends SlotMeta>(meta: M, component?: ComponentType<any>): () => void;
  list<M extends SlotMeta = SlotMeta>(name: string): (M & { component: ComponentType<any> })[];
  subscribe(listener: () => void): () => void;
}

export const name = 'slots';

/** The body of an entry that has none — a `shell.activity` button, drawn from its meta alone. */
const Nothing = () => null;

export function apply(ctx: Context) {
  // Same replace-and-report guarantee as before, now from
  // `@energy8engine/registry` instead of a hand-rolled `Map` — see
  // `registries-context.md`. What stays here is what the generic
  // collection cannot know on its own: building the COMPOSITE key
  // (`name::key` — `key` alone is only unique WITHIN a slot, so the
  // generic collection, which only ever sees a flat `(key, value)`, must
  // be handed the combined string), rendering this package's own
  // collision diagnostic, delivering it leniently through `ctx.reflect`,
  // and calling `notify()` on every actual mutation. See `register`'s own
  // comment below for why the POLICY itself stays a replace.
  const entries = createRegistry<SlotEntry>({ policy: 'last-wins' });
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const service: SlotsService = {
    register<M extends SlotMeta>(meta: M, component: ComponentType<any> = Nothing) {
      const id = `${meta.name}::${meta.key}`;
      // Stored as `SlotEntry` — the registry only ever needs `name`/`key`/
      // `component` for itself (collision id, `list()`'s name filter);
      // the caller's extra fields ride along in the object regardless and
      // come back out through `list<M>`'s cast below.
      const entry = { ...meta, component } as SlotEntry;
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
      //
      // Checked before `add()`, not re-decided from its result: a
      // collision is exactly "something is already registered under this
      // id", which `add()` applies for itself (as a replace, under this
      // collection's last-wins policy) whether or not anyone asked first.
      if (entries.get(id) !== undefined) {
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
      const off = entries.add(id, entry);
      notify();
      return () => {
        // Checked BEFORE calling `off()`, not after: the registry's own
        // disposer already no-ops on a stale call (compares the slot it
        // added by reference, not by id — see `@energy8engine/registry`),
        // but it has no way to tell its caller whether it actually removed
        // anything. A stale disposer here must not notify either, for the
        // same reason it must not remove: nothing changed for a subscriber
        // to re-render over.
        const isCurrent = entries.get(id) === entry;
        off();
        if (isCurrent) notify();
      };
    },
    list<M extends SlotMeta = SlotMeta>(slotName: string) {
      // `entries.keys()` is insertion-ordered (see
      // `@energy8engine/registry`), and this is the one adopter of the
      // three that actually depends on that: `useSlot` renders every
      // result of this call as a list, in this order.
      const result: (M & { component: ComponentType<any> })[] = [];
      for (const id of entries.keys()) {
        const entry = entries.get(id);
        if (entry && entry.name === slotName)
          result.push(entry as M & { component: ComponentType<any> });
      }
      return result;
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
