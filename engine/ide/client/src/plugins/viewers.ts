import type { ComponentType } from 'react';
import type { Context } from 'cordis';
import { diagnostic, type FileEntry } from '@energy8engine/contracts';
import { createRegistry } from '@energy8engine/registry';
import type { ConnectionService } from './connection';

/** What a viewer component receives — the same shape `EditorDocument`/`ViewerDocument` already take. */
export interface ViewerProps {
  ctx: Context;
  path: string;
  entry?: FileEntry;
}

/**
 * One way to look at a file, tried in registration order (last wins) by
 * `openPath` before it falls back to the editor or the plain
 * `ViewerDocument`. `match` sees the tree's own `entry` when the caller
 * has one — same lenient shape `Explorer`'s `openPath` already threads
 * through.
 */
export interface ViewerDef {
  id: string;
  match(path: string, entry?: FileEntry): boolean;
  component: ComponentType<ViewerProps>;
  /** The opened tab's own sidebars — see `OpenDocument`'s. */
  sidebar?: string;
  sideRight?: string;
}

declare module 'cordis' {
  interface Context {
    viewers: ViewersService;
  }
}

export interface ViewersService {
  /** Same id again replaces, with a warning diagnostic; the return retracts this registration. */
  register(def: ViewerDef): () => void;
  /** The LAST registered viewer whose `match` says yes, or none. */
  pick(path: string, entry?: FileEntry): ViewerDef | undefined;
  list(): readonly ViewerDef[];
  subscribe(listener: () => void): () => void;
}

export const name = 'viewers';

export function apply(ctx: Context) {
  const entries = createRegistry<ViewerDef>({ policy: 'last-wins' });
  // Same trick `languages.ts` uses: retract the old slot before re-adding,
  // so a same-id re-registration lands at the END of the list rather than
  // keeping its original `Map` position.
  const offs = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // Read leniently, as `slots`/`languages` do: no static dependency on
  // `connection`.
  const connection = () => ctx.reflect.get('connection', false) as ConnectionService | undefined;

  const service: ViewersService = {
    register(def) {
      if (entries.get(def.id) !== undefined)
        connection()?.report(
          diagnostic(
            'warning',
            'viewers',
            def.id,
            `a second viewer registered as "${def.id}", replacing the first`,
            'give it an id of its own',
          ),
        );
      offs.get(def.id)?.();
      const off = entries.add(def.id, def);
      offs.set(def.id, off);
      notify();
      return () => {
        const isCurrent = entries.get(def.id) === def;
        off();
        if (isCurrent) notify();
      };
    },
    pick(path, entry) {
      const defs = service.list();
      for (let i = defs.length - 1; i >= 0; i--) {
        if (defs[i].match(path, entry)) return defs[i];
      }
      return undefined;
    },
    list() {
      const result: ViewerDef[] = [];
      for (const id of entries.keys()) {
        const def = entries.get(id);
        if (def) result.push(def);
      }
      return result;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  ctx.provide('viewers', service);
}
