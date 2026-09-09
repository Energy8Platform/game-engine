import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import { createRegistry } from '@energy8engine/registry';
import type { ConnectionService } from './connection';

export interface ScreenMeta {
  /** Identity, and what goes in the address hash: `#/composition`. */
  id: string;
  /** What the navigation shows a human. */
  title: string;
  /** Ascending; ties break by registration order. */
  order?: number;
}

export interface ScreenEntry extends ScreenMeta {
  component: ComponentType<{ ctx: Context }>;
}

declare module 'cordis' {
  interface Context {
    layout: LayoutService;
  }
}

export interface LayoutService {
  /** Registers a screen. Returns a disposer, as `slots.register` does. */
  screen(meta: ScreenMeta, component: ComponentType<{ ctx: Context }>): () => void;
  /** Every screen, in `order` then registration order. */
  screens(): readonly ScreenEntry[];
  /** The screen the address currently names, or the first one. */
  current(): ScreenEntry | undefined;
  /** Navigates. Writes the address hash; the hash is the source of truth. */
  go(id: string): void;
  subscribe(listener: () => void): () => void;
}

export const name = 'layout';

/** `location.hash` minus its leading `#` or `#/` — `''` when nothing follows it. */
function hashId(): string {
  const hash = location.hash;
  if (hash.startsWith('#/')) return hash.slice(2);
  if (hash.startsWith('#')) return hash.slice(1);
  return hash;
}

export function apply(ctx: Context) {
  // Same collection `slots` builds on, for the same two guarantees this
  // file would otherwise have to hand-roll a fourth time: the collision
  // POLICY (last-wins — see `screen()`'s own comment for why that stays a
  // replace here too) and the disposer's IDENTITY GUARD (a disposer
  // removes the entry it added or nothing at all). What stays this file's
  // own job is exactly what it is in `slots`: wording the collision
  // diagnostic, delivering it leniently through `ctx.reflect`, and calling
  // `notify()` on every actual mutation.
  const entries = createRegistry<ScreenEntry>({ policy: 'last-wins' });
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  /**
   * `entries.keys()` is insertion-ordered (see `@energy8engine/registry`),
   * so this list starts in registration order before anything is sorted.
   * `Array#sort` has been stable since ES2019 — ties this comparator
   * calls equal (an equal `order`, or both missing one) keep that
   * registration order rather than being shuffled, which is what lets a
   * SINGLE comparator serve both "ties break by registration order" and
   * "no order sorts after every screen that has one" without this
   * function tracking indices itself.
   */
  function ordered(): ScreenEntry[] {
    const list: ScreenEntry[] = [];
    for (const id of entries.keys()) {
      const entry = entries.get(id);
      if (entry) list.push(entry);
    }
    return list.sort((a, b) => {
      if (a.order === undefined && b.order === undefined) return 0;
      if (a.order === undefined) return 1;
      if (b.order === undefined) return -1;
      return a.order - b.order;
    });
  }

  function report(where: string, message: string, fix: string) {
    // Read leniently — `layout` has no static dependency on `connection`
    // and must keep working (silently, as before `slots` gained this same
    // guard) if this is ever composed without it.
    const connection = ctx.reflect.get('connection', false) as ConnectionService | undefined;
    connection?.report(diagnostic('warning', where, 'layout', message, fix));
  }

  const service: LayoutService = {
    screen(meta, component) {
      const entry: ScreenEntry = { ...meta, component };
      // Checked before `add()`, not re-decided from its result — same
      // reasoning as `slots.register`: a collision is "something already
      // claims this id", which `add()` applies for itself (as a replace)
      // whether or not anyone asked first.
      if (entries.get(meta.id) !== undefined) {
        report(
          meta.id,
          `a second screen registered under the id "${meta.id}", replacing the first — a screen id must be unique`,
          'give one of them an id of its own',
        );
      }
      const off = entries.add(meta.id, entry);
      notify();
      return () => {
        // Checked before calling `off()`, not after — a stale disposer
        // (its registration already replaced by a later one under the
        // same id) must not notify either, since nothing changed for a
        // subscriber to re-render over. Same guard `slots.register` uses.
        const isCurrent = entries.get(meta.id) === entry;
        off();
        if (isCurrent) notify();
      };
    },
    screens() {
      return ordered();
    },
    current() {
      const list = ordered();
      if (list.length === 0) return undefined;
      const id = hashId();
      if (id === '') return list[0];
      const found = list.find((screen) => screen.id === id);
      if (found) return found;
      // The hash names something real to the browser (a non-empty
      // fragment) that just isn't a registered screen — a stale bookmark,
      // a screen removed since, a typo. Which one it is isn't something
      // this code knows, so the message says only what it does know: the
      // id, and what happens instead.
      report(
        id,
        `the address names screen "${id}", which is not registered — showing the first screen instead`,
        'pick a screen from the navigation',
      );
      return list[0];
    },
    go(id) {
      location.hash = `#/${id}`;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  // All this listener does is notify — it never reads or caches the hash
  // itself, since `current()` above already does that live, on every call.
  // `go()` does not wait for this to fire: a real `hashchange` is
  // asynchronous (a browser task, not a microtask — confirmed against
  // this project's own jsdom), so `go()` notifies directly instead and
  // this listener would be too late to tell go()'s OWN subscribers about
  // go()'s OWN navigation. What this catches is every OTHER way the hash
  // moves: the back and forward buttons, a typed address, a bookmark.
  const onHashChange = () => notify();
  ctx.effect(() => {
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, 'layout-hashchange');

  ctx.provide('layout', service);
}

/** Subscribe a component to the screen list and the current one. */
export function useLayout(ctx: Context): {
  screens: readonly ScreenEntry[];
  current: ScreenEntry | undefined;
} {
  const read = () => ({ screens: ctx.layout.screens(), current: ctx.layout.current() });
  // A fresh object per notification, matching `useGameComposition`: the
  // service mutates in place rather than handing out a new snapshot, so
  // reusing one `state` reference across renders would never look changed.
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return ctx.layout.subscribe(() => setState(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  return state;
}
