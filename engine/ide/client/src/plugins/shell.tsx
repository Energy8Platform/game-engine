import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import type { ConnectionService } from './connection';
import type { SlotMeta } from './slots';

export type ActivityOpens = 'sidebar' | 'document';

export interface ActivityMeta {
  key: string;
  title: string;
  icon: string;
  order?: number;
  opens: ActivityOpens;
}
export interface SidebarMeta {
  key: string;
  title: string;
}
export interface DocumentMeta {
  key: string;
  title: string;
  closable?: boolean;
}
export interface PanelMeta {
  key: string;
  title: string;
}
export interface StatusMeta {
  key: string;
  side: 'left' | 'right';
  order?: number;
}

/** An open tab. Contributed documents and Explorer-opened ones both become this. */
export interface OpenDocument {
  key: string;
  title: string;
  component: ComponentType<{ ctx: Context }>;
  closable: boolean;
  dirty: boolean;
}

declare module 'cordis' {
  interface Context {
    shell: ShellService;
  }
}

export interface ShellService {
  /** Slot names, so nobody spells them by hand. */
  readonly slots: {
    activity: 'shell.activity';
    sidebar: 'shell.sidebar';
    document: 'shell.document';
    panel: 'shell.panel';
    status: 'shell.status';
  };

  /** Opens an instance tab — a file from Explorer. Same key twice activates. */
  open(doc: Omit<OpenDocument, 'dirty'>): void;
  /** Opens a CONTRIBUTED document by its slot key. Same key twice activates. */
  openContributed(key: string): void;
  /** Refuses when the tab is dirty and no guard has let it through. */
  close(key: string): boolean;
  activate(key: string): void;
  markDirty(key: string, dirty: boolean): void;

  documents(): readonly OpenDocument[];
  active(): OpenDocument | undefined;

  sidebar(): string | undefined; // active sidebar key, or collapsed
  showSidebar(key: string | undefined): void;
  panelCollapsed(): boolean;
  togglePanel(): void;

  /** A dirty-tab guard: return false to keep the tab. Same shape as layout.guard(). */
  guard(fn: (key: string) => boolean): () => void;

  /** Called by the app once every registration effect has run. Until then the
   *  hash is not checked, so a deep link to a contributed document does not
   *  produce a false "not registered" diagnostic — slice 6's recorded debt. */
  ready(): void;

  subscribe(listener: () => void): () => void;
}

export const name = 'shell';
// A hard dependency, unlike `connection` (read leniently through
// `ctx.reflect.get`, below): `openContributed`/`ready` call `ctx.slots.list`
// directly, and cordis refuses a bare property read for a service the
// plugin never declared, even one that is in fact provided by a sibling —
// see `modules.ts`'s own `inject` for the same rule already in this codebase.
export const inject = ['slots'];

const SLOT_NAMES: ShellService['slots'] = {
  activity: 'shell.activity',
  sidebar: 'shell.sidebar',
  document: 'shell.document',
  panel: 'shell.panel',
  status: 'shell.status',
};

const HASH_PREFIX = '#/doc/';

/** The document key the address currently names, or '' when it names none. */
function docKeyFromHash(): string {
  const hash = location.hash;
  return hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : '';
}

export function apply(ctx: Context) {
  // Insertion-ordered, the same guarantee `documents()` promises: a `Map`
  // keeps that natively, so nothing here needs the registry package's own
  // ordering trick `slots`/`layout` lean on.
  const documents = new Map<string, OpenDocument>();
  const listeners = new Set<() => void>();
  const guards = new Set<(key: string) => boolean>();
  let sidebarKey: string | undefined;
  let panelCollapsed = false;
  let ready = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function report(where: string, message: string, fix: string) {
    // Read leniently — `shell` has no static dependency on `connection`
    // and must keep working (silently) if this is ever composed without
    // it, the same rule `layout`/`slots` already apply to their own
    // reports.
    const connection = ctx.reflect.get('connection', false) as ConnectionService | undefined;
    connection?.report(diagnostic('warning', where, 'shell', message, fix));
  }

  /** Adds the tab if its key is new, then activates it either way. */
  function openInternal(doc: Omit<OpenDocument, 'dirty'>) {
    if (!documents.has(doc.key)) {
      documents.set(doc.key, { ...doc, dirty: false });
    }
    location.hash = `${HASH_PREFIX}${doc.key}`;
    notify();
  }

  // `DocumentMeta` alone has no `name` — a contributor supplies it inline
  // at the call site (`register({ name: 'shell.document', ... })`), not as
  // part of the meta TYPE — so reading it back through `list<M>`'s
  // `M extends SlotMeta` constraint needs the two intersected.
  function contributedDocuments(): (SlotMeta & DocumentMeta & { component: ComponentType<any> })[] {
    return ctx.slots.list<SlotMeta & DocumentMeta>(SLOT_NAMES.document);
  }

  function findContributed(key: string): (DocumentMeta & { component: ComponentType<any> }) | undefined {
    return contributedDocuments().find((entry) => entry.key === key);
  }

  function openFoundContributed(found: DocumentMeta & { component: ComponentType<any> }) {
    openInternal({
      key: found.key,
      title: found.title ?? found.key,
      component: found.component,
      closable: found.closable ?? false,
    });
  }

  const service: ShellService = {
    slots: SLOT_NAMES,

    open(doc) {
      openInternal(doc);
    },

    openContributed(key) {
      if (documents.has(key)) {
        openInternal({ ...documents.get(key)! });
        return;
      }
      const found = findContributed(key);
      if (!found) {
        report(key, `no document is registered for "${key}"`, 'register it on the shell.document slot');
        return;
      }
      openFoundContributed(found);
    },

    close(key) {
      const doc = documents.get(key);
      if (!doc) return false;
      if (!doc.closable) return false;
      if (doc.dirty) {
        // Refused unless SOME guard says it may proceed — no guards at
        // all is the same as every guard refusing.
        if (guards.size === 0) return false;
        for (const guard of guards) {
          if (!guard(key)) return false;
        }
      }

      const keys = [...documents.keys()];
      const index = keys.indexOf(key);
      const wasActive = docKeyFromHash() === key;
      documents.delete(key);

      if (wasActive) {
        const remaining = [...documents.keys()];
        location.hash =
          remaining.length > 0 ? `${HASH_PREFIX}${remaining[Math.min(index, remaining.length - 1)]}` : '';
      }
      notify();
      return true;
    },

    activate(key) {
      location.hash = `${HASH_PREFIX}${key}`;
      notify();
    },

    markDirty(key, dirty) {
      const doc = documents.get(key);
      if (!doc) return;
      doc.dirty = dirty;
      notify();
    },

    documents() {
      return [...documents.values()];
    },

    active() {
      const key = docKeyFromHash();
      return key === '' ? undefined : documents.get(key);
    },

    sidebar() {
      return sidebarKey;
    },

    showSidebar(key) {
      sidebarKey = sidebarKey === key ? undefined : key;
      notify();
    },

    panelCollapsed() {
      return panelCollapsed;
    },

    togglePanel() {
      panelCollapsed = !panelCollapsed;
      notify();
    },

    guard(fn) {
      guards.add(fn);
      return () => {
        guards.delete(fn);
      };
    },

    ready() {
      // Idempotent: the app calls this once every registration effect has
      // run, but a second call must not re-report the same deep link.
      if (ready) return;
      ready = true;

      const key = docKeyFromHash();
      if (key === '' || documents.has(key)) return;

      const found = findContributed(key);
      if (found) {
        openFoundContributed(found);
        return;
      }

      // The hash names something real to the browser that answers to no
      // registered document — a stale bookmark, a removed contribution, a
      // typo. Falls back to the first contributed document, same as
      // `layout.current()` falls back to `screens()[0]`.
      report(
        key,
        `the address names document "${key}", which is not registered — showing the first document instead`,
        'open a document from the sidebar',
      );
      const contributed = contributedDocuments();
      if (contributed.length > 0) openFoundContributed(contributed[0]);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  // All this listener does is notify — `active()` reads the hash live on
  // every call, same division of labour as `layout`'s own `onHashChange`.
  const onHashChange = () => notify();
  ctx.effect(() => {
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, 'shell-hashchange');

  ctx.provide('shell', service);
}

/** Subscribe a component to the open documents and the active one. */
export function useShell(ctx: Context): {
  documents: readonly OpenDocument[];
  active: OpenDocument | undefined;
  sidebar: string | undefined;
  panelCollapsed: boolean;
} {
  const read = () => ({
    documents: ctx.shell.documents(),
    active: ctx.shell.active(),
    sidebar: ctx.shell.sidebar(),
    panelCollapsed: ctx.shell.panelCollapsed(),
  });
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return ctx.shell.subscribe(() => setState(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  return state;
}
