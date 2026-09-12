import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import type { ConnectionService } from './connection';
import type { ModulesService } from './modules';
import type { SlotMeta } from './slots';

export type ActivityOpens = 'sidebar' | 'document';

export interface ActivityMeta {
  key: string;
  title: string;
  icon: string;
  order?: number;
  /**
   * What the button opens: the `shell.sidebar` or `shell.document` entry
   * registered under this SAME `key`. Nothing else pairs the two — a
   * document is two registrations sharing one key.
   */
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
  /**
   * Refuses a dirty tab and returns `false` unless `force` says otherwise.
   * The one call site this ever mattered at was already behind
   * `if (doc.dirty)`, so a confirm flow is two calls, not a registered
   * guard: `if (!shell.close(k)) confirm(() => shell.close(k, { force: true }))`.
   */
  close(key: string, opts?: { force?: boolean }): boolean;
  activate(key: string): void;
  markDirty(key: string, dirty: boolean): void;

  documents(): readonly OpenDocument[];
  active(): OpenDocument | undefined;
  /**
   * The key the address names while no document answers to it yet — a
   * plugin's document whose client half is still loading. Cleared the
   * moment it lands, or reported once the loader has settled without it.
   */
  pending(): string | undefined;
  /** For `beforeunload`: a shell-level fact, not a per-tab guard question. */
  hasDirtyDocuments(): boolean;

  sidebar(): string | undefined; // active sidebar key, or collapsed
  showSidebar(key: string | undefined): void;
  panelCollapsed(): boolean;
  togglePanel(): void;

  /**
   * Called by the app once every registration effect has run. Until then
   * the hash is not checked, so a deep link to a contributed document does
   * not produce a false "not registered" diagnostic — slice 6's recorded
   * debt. From then on the address is resolved live: on every `hashchange`
   * (Back to a closed tab, a typed link), when a `shell.document` lands for
   * a key still pending, and when `modules` settles with the key still
   * unanswered — the one moment "not registered" stops being a guess.
   */
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
  // ordering trick `slots` leans on.
  const documents = new Map<string, OpenDocument>();
  const listeners = new Set<() => void>();
  let sidebarKey: string | undefined;
  let panelCollapsed = false;
  let ready = false;
  let pending: string | undefined;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function report(where: string, message: string, fix: string) {
    // Read leniently — `shell` has no static dependency on `connection`
    // and must keep working (silently) if this is ever composed without
    // it, the same rule `slots` already applies to its own reports.
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

  /** `modules`, if this was composed with it; the hand-built harnesses are not. */
  function modules(): ModulesService | undefined {
    return ctx.reflect.get('modules', false) as ModulesService | undefined;
  }

  /**
   * The address names something real to the browser that answers to no
   * registered document — a stale bookmark, a removed contribution, a
   * typo. Says so once and falls back to the first contributed document,
   * the way the old layout fell back to its first screen.
   */
  function giveUp(key: string) {
    pending = undefined;
    report(
      key,
      `the address names document "${key}", which is not registered — showing the first document instead`,
      'open a document from the sidebar',
    );
    const contributed = contributedDocuments();
    if (contributed.length > 0) openFoundContributed(contributed[0]);
    else notify();
  }

  /**
   * Makes the address true, or says why it cannot be. Run at `ready()` and
   * on every `hashchange` after it. A key nobody has registered is held as
   * `pending` while `modules` is still loading client halves — a plugin's
   * document on a cold F5 is exactly this — and given up on only once the
   * loader has settled, or at once when there is no loader to wait for.
   */
  function resolveHash() {
    const key = docKeyFromHash();
    pending = undefined;
    if (key === '' || documents.has(key)) return;
    const found = findContributed(key);
    if (found) {
      openFoundContributed(found);
      return;
    }
    const loader = modules();
    if (loader && !loader.settled()) {
      pending = key;
      notify();
      return;
    }
    giveUp(key);
  }

  /** A `shell.document` landed: if it is the one the address is waiting for, open it. */
  function onSlotsChange() {
    if (pending === undefined) return;
    const found = findContributed(pending);
    if (found) {
      pending = undefined;
      openFoundContributed(found);
    }
  }

  /** The loader settled: whatever is still pending is not coming. */
  function onModulesChange() {
    if (pending !== undefined && modules()?.settled()) giveUp(pending);
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

    close(key, opts) {
      const doc = documents.get(key);
      if (!doc) return false;
      if (!doc.closable) return false;
      if (doc.dirty && !opts?.force) return false;

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

    pending() {
      return pending;
    },

    hasDirtyDocuments() {
      for (const doc of documents.values()) {
        if (doc.dirty) return true;
      }
      return false;
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

    ready() {
      // Idempotent: the app calls this once every registration effect has
      // run, but a second call must not re-report the same deep link.
      if (ready) return;
      ready = true;
      // Subscribed here, not at apply time: `modules` composes after this
      // plugin, and until `ready()` there is nothing pending to hear about.
      ctx.effect(() => ctx.slots.subscribe(onSlotsChange), 'shell-pending-slots');
      const loader = modules();
      if (loader) ctx.effect(() => loader.subscribe(onModulesChange), 'shell-pending-modules');
      resolveHash();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  // Notifies — `active()` reads the hash live on every call — and, once the
  // app has said it is ready, resolves the address again: Back onto a tab
  // that was closed, or a link typed by hand, must open something or say
  // why, not leave the body empty.
  const onHashChange = () => {
    notify();
    if (ready) resolveHash();
  };
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
  pending: string | undefined;
  sidebar: string | undefined;
  panelCollapsed: boolean;
} {
  const read = () => ({
    documents: ctx.shell.documents(),
    active: ctx.shell.active(),
    pending: ctx.shell.pending(),
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
