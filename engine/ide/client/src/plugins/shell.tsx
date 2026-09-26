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
  order?: number;
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
    sideRight: 'shell.sideRight';
  };

  /** Opens an instance tab — a file from Explorer. Same key twice activates. */
  open(doc: Omit<OpenDocument, 'dirty'>): void;
  /**
   * Opens a CONTRIBUTED document by its slot key. Same key twice activates.
   * `replace` says the shell chose this document, the person did not — the
   * fresh-load default — so the address is overwritten rather than pushed
   * and Back never lands on the empty address a default was painted over.
   */
  openContributed(key: string, opts?: { replace?: boolean }): void;
  /**
   * Opens a project file as an instance tab, keyed `f:<path>`, choosing
   * editor or viewer the way the Explorer does — through the one chooser
   * installed with `registerPathOpener`. This is how a plugin's own sidebar
   * view opens `game/script.spin` without importing anything, and how the
   * address resolves a `f:` key on a cold load. With no chooser installed it
   * is a diagnostic, not a throw.
   */
  openPath(path: string): void;
  /** Installs the chooser `openPath` delegates to. Returns a disposer. */
  registerPathOpener(open: (path: string) => void): () => void;
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
   * The `shell.panel` key whose tab is selected — the entries a plugin
   * contributes are TABS now (Task 4), not one stacked column, so exactly
   * one is showing at a time. `undefined` only when nothing is registered
   * at all; the moment one entry exists, `panel()` falls back to it
   * (`byOrder`'s first) rather than leaving every tab unselected.
   */
  panel(): string | undefined;
  /**
   * Selects a `shell.panel` tab by key and expands the panel if it was
   * collapsed — the one call a status-bar item or any other plugin needs
   * to jump a person to a specific tab (`ctx.shell.showPanel('diagnostics')`),
   * without importing React: a project plugin's client half is plain JS,
   * `React` reached only off `globalThis.__E8_IDE__` for the ones that
   * draw their own component, so the panel's own API has to work without
   * it too. Persisted the same way a click on the tab itself is.
   */
  showPanel(key: string): void;
  /**
   * Sets (or clears) the small count a panel tab shows beside its title —
   * `ctx.shell.setPanelBadge('diagnostics', errors + warnings)`. Imperative
   * for the same reason `showPanel` is: nothing here is a React component,
   * so there is no prop to pass it through. `0` clears the badge rather
   * than drawing an empty pill — a tab reading "Diagnostics 0" is not
   * informative, it is a row that used to say `nothing to report` doing so
   * twice.
   */
  setPanelBadge(key: string, value: number | string | undefined): void;
  /** The badge currently set for `key`, or `undefined` — nothing to show. */
  panelBadge(key: string): number | string | undefined;

  /** The `shell.sideRight` key currently shown, or `undefined` — collapsed. */
  sideRight(): string | undefined;
  /** Shows the right sidebar's `shell.sideRight` contribution registered under `key`. */
  showSideRight(key: string): void;
  /** Collapses the right sidebar. */
  hideSideRight(): void;

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
  sideRight: 'shell.sideRight',
};

const HASH_PREFIX = '#/doc/';
/** What a file's document key starts with; the rest is the project path. */
export const FILE_KEY_PREFIX = 'f:';

/** The document key the address currently names, or '' when it names none. */
function docKeyFromHash(): string {
  const hash = location.hash;
  return hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : '';
}

/** `localStorage` key for the panel's selected tab (Task 4). */
const PANEL_TAB_KEY = 'e8.panel-tab';

/**
 * Failures are data: a private window or storage switched off throws on
 * both reads and writes. A read failure means nothing was ever stored, so
 * the panel falls back to its first tab the same as a fresh install; a
 * write failure means the choice holds for this tab only and does not
 * survive a reload. Same rule `Shell.tsx`'s own `readSize`/`writeSize`
 * already apply to the sizes it drags.
 */
function readStored(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // See `readStored`.
  }
}

/**
 * Registration order is what `ctx.slots.list()` already returns; `order`
 * breaks ties on top of it. `Array.prototype.sort` is stable, so entries
 * that never set `order` keep the registration order they came in. Shared
 * by every slot that carries an `order` (activity, status, and — Task 4 —
 * panel); moved here from `Shell.tsx` so `panel()` below can sort the same
 * way the strip draws.
 */
export function byOrder<T extends { order?: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
}

export function apply(ctx: Context) {
  // Insertion-ordered, the same guarantee `documents()` promises: a `Map`
  // keeps that natively, so nothing here needs the registry package's own
  // ordering trick `slots` leans on.
  const documents = new Map<string, OpenDocument>();
  const listeners = new Set<() => void>();
  let sidebarKey: string | undefined;
  let sideRightKey: string | undefined;
  let panelCollapsed = false;
  // The selected `shell.panel` tab, read once at apply time — a fresh
  // load's `localStorage`, or `undefined` on a private window/first run,
  // in which case `panel()` falls back to the first entry itself.
  let panelKey: string | undefined = readStored(PANEL_TAB_KEY);
  const panelBadges = new Map<string, number | string>();
  let ready = false;
  let pending: string | undefined;
  // The last key the address named that was an open document — where a
  // stale link falls back to, so a typo does not lose a person's place.
  let lastActive: string | undefined;
  let pathOpener: ((path: string) => void) | undefined;
  // Keys open through a `shell.document` CONTRIBUTION (not `open()`'s
  // instance tabs): the ones a plugin's unload can pull the component out
  // from under — see `onSlotsChange`.
  const contributed = new Set<string>();
  // The retract of each "withdrawn" warning still standing, by key — run
  // when the same key is contributed again (its plugin came back: a
  // project switch reloads every client half), see `onSlotsChange`.
  const withdrawn = new Map<string, () => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function report(where: string, message: string, fix: string): () => void {
    // Read leniently — `shell` has no static dependency on `connection`
    // and must keep working (silently) if this is ever composed without
    // it, the same rule `slots` already applies to its own reports.
    const connection = ctx.reflect.get('connection', false) as ConnectionService | undefined;
    return connection?.report(diagnostic('warning', where, 'shell', message, fix)) ?? (() => {});
  }

  /**
   * Points the address at `key` — `''` for none. `replace` means this is
   * the shell's own choice, not a place a person navigated to: the
   * fresh-load default, the fallback from a stale link, the neighbour
   * picked after a close. Those overwrite the current history entry
   * instead of adding one, so Back lands where the person actually was and
   * never on an address that answers to nothing (the two empty panes the
   * final review reproduced). Both forms fire `hashchange`. `'#'` rather
   * than `''` for the empty case: `location.replace('')` resolves to the
   * page itself, which is a reload.
   */
  function go(key: string, replace: boolean) {
    const hash = key === '' ? '' : `${HASH_PREFIX}${key}`;
    if (replace) location.replace(hash === '' ? '#' : hash);
    else location.hash = hash;
    if (documents.has(key)) lastActive = key;
  }

  /** Adds the tab if its key is new, then activates it either way. */
  function openInternal(doc: Omit<OpenDocument, 'dirty'>, replace = false) {
    if (!documents.has(doc.key)) {
      documents.set(doc.key, { ...doc, dirty: false });
    }
    go(doc.key, replace);
    notify();
  }

  // `DocumentMeta` alone has no `name` — a contributor supplies it inline
  // at the call site (`register({ name: 'shell.document', ... })`), not as
  // part of the meta TYPE — so reading it back through `list<M>`'s
  // `M extends SlotMeta` constraint needs the two intersected.
  function contributedDocuments(): (SlotMeta & DocumentMeta & { component: ComponentType<any> })[] {
    return ctx.slots.list<SlotMeta & DocumentMeta>(SLOT_NAMES.document);
  }

  function findContributed(
    key: string,
  ): (DocumentMeta & { component: ComponentType<any> }) | undefined {
    return contributedDocuments().find((entry) => entry.key === key);
  }

  function openFoundContributed(
    found: DocumentMeta & { component: ComponentType<any> },
    replace = false,
  ) {
    contributed.add(found.key);
    openInternal(
      {
        key: found.key,
        title: found.title ?? found.key,
        component: found.component,
        closable: found.closable ?? false,
      },
      replace,
    );
  }

  /** `modules`, if this was composed with it; the hand-built harnesses are not. */
  function modules(): ModulesService | undefined {
    return ctx.reflect.get('modules', false) as ModulesService | undefined;
  }

  /**
   * The address names something real to the browser that answers to no
   * registered document — a stale bookmark, a removed contribution, a
   * typo. Says so once and falls back to the document that WAS active, so
   * a mistyped address does not lose a person's place; only when none is
   * open does it fall back to the first contributed document, the way the
   * old layout fell back to its first screen. "First" is the bar's order,
   * not registration order: the document whose `shell.activity` (same
   * key) has the lowest `order`, documents without one last, ties by
   * registration — a plugin's document registered before the app's core
   * screens must not become the fallback by arriving early. The fallback
   * REPLACES the stale address: pushing it left Back stuck on the same
   * stale entry, re-reporting and growing the history on every press.
   */
  function giveUp(key: string) {
    pending = undefined;
    const previous = lastActive !== undefined && documents.has(lastActive) ? lastActive : undefined;
    const activities = ctx.slots.list<SlotMeta & ActivityMeta>(SLOT_NAMES.activity);
    const rank = (key: string) =>
      activities.find((entry) => entry.key === key)?.order ?? Number.MAX_SAFE_INTEGER;
    // A stable sort, so ties keep registration order on their own.
    const contributed = [...contributedDocuments()].sort((a, b) => rank(a.key) - rank(b.key));
    const fallback = previous ?? contributed[0]?.key;
    report(
      key,
      `the address names document "${key}", which is not registered — ${
        fallback === undefined ? 'nothing else is open' : `showing "${fallback}" instead`
      }`,
      'open a document from the sidebar',
    );
    if (previous !== undefined) {
      go(previous, true);
      notify();
    } else if (contributed.length > 0) {
      openFoundContributed(contributed[0], true);
    } else {
      notify();
    }
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
    // A file key is never a plugin's contribution, so there is nothing to
    // wait for: the chooser opens it (F5 on a file tab, the most common
    // gesture there is — Ruling 18), or, with no chooser, it is given up
    // on like any other key nobody answers to.
    if (key.startsWith(FILE_KEY_PREFIX)) {
      if (pathOpener) {
        pathOpener(key.slice(FILE_KEY_PREFIX.length));
        return;
      }
      giveUp(key);
      return;
    }
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

  /**
   * A `shell.document` landed or left. Landed: if it is the one the
   * address is waiting for, open it. Left while open (its plugin was
   * unloaded): the tab used to stay, non-closable, painting a component
   * that no longer exists — force-closed instead, and said once. A
   * contribution registered again later opens fresh on the next click,
   * and its return takes the warning back: the plugin is here again, so
   * "was unloaded" is no longer the case.
   */
  function onSlotsChange() {
    for (const key of contributed) {
      if (findContributed(key) !== undefined) continue;
      remove(key);
      withdrawn.set(
        key,
        report(
          key,
          'document withdrawn by its plugin',
          'the plugin that contributed it was unloaded',
        ),
      );
    }
    for (const [key, retract] of withdrawn) {
      if (findContributed(key) === undefined) continue;
      retract();
      withdrawn.delete(key);
    }
    if (pending === undefined) return;
    const found = findContributed(pending);
    if (found) {
      pending = undefined;
      openFoundContributed(found);
    }
  }

  /** Takes the tab out, the neighbour taking over if it was the active one. */
  function remove(key: string) {
    const keys = [...documents.keys()];
    const index = keys.indexOf(key);
    const wasActive = docKeyFromHash() === key;
    documents.delete(key);
    contributed.delete(key);

    if (wasActive) {
      const remaining = [...documents.keys()];
      // The neighbour is the shell's pick, so it overwrites the closed
      // tab's entry: Back goes to where the person was before it, not
      // onto the tab they just closed.
      go(remaining.length > 0 ? remaining[Math.min(index, remaining.length - 1)] : '', true);
    }
    notify();
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

    openContributed(key, opts) {
      const replace = opts?.replace ?? false;
      if (documents.has(key)) {
        openInternal({ ...documents.get(key)! }, replace);
        return;
      }
      const found = findContributed(key);
      if (!found) {
        report(
          key,
          `no document is registered for "${key}"`,
          'register it on the shell.document slot',
        );
        return;
      }
      openFoundContributed(found, replace);
    },

    openPath(path) {
      if (!pathOpener) {
        report(
          path,
          `"${path}" cannot be opened: nothing has registered a file opener on the shell`,
          'register one with ctx.shell.registerPathOpener',
        );
        return;
      }
      pathOpener(path);
    },

    registerPathOpener(open) {
      pathOpener = open;
      return () => {
        if (pathOpener === open) pathOpener = undefined;
      };
    },

    close(key, opts) {
      const doc = documents.get(key);
      if (!doc) return false;
      if (!doc.closable) return false;
      if (doc.dirty && !opts?.force) return false;
      remove(key);
      return true;
    },

    activate(key) {
      go(key, false);
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

    panel() {
      const entries = byOrder(ctx.slots.list<SlotMeta & PanelMeta>(SLOT_NAMES.panel));
      return entries.some((e) => e.key === panelKey) ? panelKey : entries[0]?.key;
    },

    showPanel(key) {
      panelKey = key;
      panelCollapsed = false;
      writeStored(PANEL_TAB_KEY, key);
      notify();
    },

    setPanelBadge(key, value) {
      const next = value === 0 ? undefined : value;
      if (panelBadges.get(key) === next) return;
      if (next === undefined) panelBadges.delete(key);
      else panelBadges.set(key, next);
      notify();
    },

    panelBadge(key) {
      return panelBadges.get(key);
    },

    sideRight() {
      return sideRightKey;
    },

    showSideRight(key) {
      sideRightKey = key;
      notify();
    },

    hideSideRight() {
      sideRightKey = undefined;
      notify();
    },

    ready() {
      // Idempotent: the app calls this once every registration effect has
      // run, but a second call must not re-report the same deep link.
      if (ready) return;
      ready = true;
      // Subscribed here, not at apply time: `modules` composes after this
      // plugin, and until `ready()` there is nothing pending to hear about.
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
    // Back onto an open tab is the one way the address reaches a document
    // without going through `go()`.
    const key = docKeyFromHash();
    if (documents.has(key)) lastActive = key;
    notify();
    if (ready) resolveHash();
  };
  ctx.effect(() => {
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, 'shell-hashchange');
  // From apply time, not `ready()`: a contribution can be withdrawn from
  // under an open tab before the app ever says it is ready, and `slots`
  // is a hard dependency that is already there.
  ctx.effect(() => ctx.slots.subscribe(onSlotsChange), 'shell-slots');

  ctx.provide('shell', service);
}

/** Subscribe a component to the open documents and the active one. */
export function useShell(ctx: Context): {
  documents: readonly OpenDocument[];
  active: OpenDocument | undefined;
  pending: string | undefined;
  sidebar: string | undefined;
  panelCollapsed: boolean;
  /** The selected `shell.panel` tab — see `ShellService.panel`'s own doc. */
  panel: string | undefined;
  sideRight: string | undefined;
} {
  const read = () => ({
    documents: ctx.shell.documents(),
    active: ctx.shell.active(),
    pending: ctx.shell.pending(),
    sidebar: ctx.shell.sidebar(),
    panelCollapsed: ctx.shell.panelCollapsed(),
    panel: ctx.shell.panel(),
    sideRight: ctx.shell.sideRight(),
  });
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    const refresh = () => setState(read());
    // Two sources, not one: `panel()` (like `documents()`) reads
    // `ctx.slots` as well as `ctx.shell`'s own state, so a `shell.panel`
    // entry registering or withdrawing — a plugin's client half landing,
    // Task 4's own reason for this second subscription — must refresh this
    // hook too, not only the `ctx.shell.subscribe` notifications `Shell.tsx`
    // already relied on.
    const offShell = ctx.shell.subscribe(refresh);
    const offSlots = ctx.slots.subscribe(refresh);
    return () => {
      offShell();
      offSlots();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  return state;
}
