import { Component, useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import type { ConnectionService } from '../plugins/connection';
import type { SlotMeta } from '../plugins/slots';
import {
  byOrder,
  useShell,
  type ActivityMeta,
  type SidebarMeta,
  type DocumentMeta,
  type PanelMeta,
  type StatusMeta,
} from '../plugins/shell';

/** What actually threw, reduced to the one thing worth showing a human. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The two things an activity button can open — anything else is a contribution the shell cannot draw. */
const ACTIVITY_OPENS: readonly string[] = ['sidebar', 'document'];

/**
 * Isolates one document from the rest of the shell — the same shape the
 * old `Layout.tsx`'s `ScreenBoundary` had, and for the same reason: a
 * document is a plugin's own code (or a file's own content, for Explorer's
 * instance tabs), this shell has no other trust relationship with it, and
 * one bad render must not take the tab strip, the sidebar or the panel down
 * with it.
 *
 * One instance per OPEN document, not one for the active one: `Shell`
 * below keeps every open document mounted and hides the inactive ones
 * (Ruling 13 — switching tabs used to unmount the editor and lose its
 * typed text), so each pane is keyed by its own `doc.key` and a crash in
 * one never touches a sibling's boundary. That per-document key is also
 * what keeps a crashed pane from poisoning the next one, the reason
 * `ScreenBoundary`'s own doc gave for keying on the active id. Keeping
 * every pane mounted is also what pays slice 6's third debt — the leave
 * guard never caught Back/Forward, because `hashchange` moved the address
 * before anyone could object: a hash change now hides a pane and unmounts
 * nothing, so there is nothing left to guard.
 */
class DocumentBoundary extends Component<
  { ctx: Context; docKey: string; children: ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: unknown) {
    return { message: errorMessage(error) };
  }
  componentDidCatch(error: unknown) {
    // Read leniently, exactly as `shell.tsx`'s own `report()` does and for
    // the same reason: a missing `connection` must not itself throw from
    // inside the one place left to catch it.
    const connection = this.props.ctx.reflect.get('connection', false) as
      ConnectionService | undefined;
    connection?.report(
      diagnostic(
        'error',
        this.props.docKey,
        'shell',
        `document crashed while rendering: ${errorMessage(error)}`,
      ),
    );
  }
  render() {
    if (this.state.message !== null) {
      return (
        <p className="e8-shell-doc-error" data-testid="doc-error">
          document crashed: {this.state.message}
        </p>
      );
    }
    return this.props.children;
  }
}

/** Splits `items` into those that pass `test` and those that do not, in order. */
function partition<T>(items: readonly T[], test: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) (test(item) ? yes : no).push(item);
  return [yes, no];
}

/** Narrower than this and a region is a sliver nobody can grab back. */
const SIZE_MIN = 100;

/** `localStorage` keys for the three draggable sizes (spec §3). */
const SIZE_KEYS = {
  sidebar: 'e8.sidebar-w',
  panel: 'e8.panel-h',
  sideRight: 'e8.side-right-w',
} as const;

/**
 * Failures are data: a private window or storage switched off throws on
 * both reads and writes. A read failure means the stylesheet's own token
 * stays in charge; a write failure means the drag still holds for this
 * tab and does not survive a reload. Same rule `StatusItems`' theme
 * already applies to its own key.
 */
function readSize(key: string): number | undefined {
  try {
    const value = Number(localStorage.getItem(key));
    return value >= SIZE_MIN ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeSize(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // See `readSize`.
  }
}

/**
 * One draggable edge. `size` is `undefined` until something was dragged or
 * stored — the stylesheet's token is the default, and nothing here
 * repeats its number. The handle captures the pointer on press, so a drag
 * that crosses the preview's `<iframe>` keeps reporting to the handle
 * instead of vanishing into it; under jsdom there is no capture, and the
 * `?.` is what lets the same code be tested there. The parent region's
 * own box is the starting size when nothing was stored yet.
 */
function useResize(key: string, axis: 'x' | 'y', direction: 1 | -1) {
  const [size, setSize] = useState(() => readSize(key));
  const drag = useRef<{ from: number; start: number; last: number } | null>(null);
  const at = (event: ReactPointerEvent<HTMLElement>) =>
    axis === 'x' ? event.clientX : event.clientY;
  const handlers = {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      const region = event.currentTarget.parentElement?.getBoundingClientRect();
      const start = size ?? (axis === 'x' ? (region?.width ?? 0) : (region?.height ?? 0));
      drag.current = { from: at(event), start, last: start };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (!drag.current) return;
      const next = Math.max(
        SIZE_MIN,
        drag.current.start + direction * (at(event) - drag.current.from),
      );
      drag.current.last = next;
      setSize(next);
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      if (!drag.current) return;
      writeSize(key, drag.current.last);
      drag.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
  };
  return { size, handlers };
}

/**
 * The activity icons this shell ships, by `ActivityMeta.icon` name — the
 * seven the shipped contributions use, drawn inline so no icon package is
 * pulled in for a handful of shapes. A name not listed here draws its first
 * letter, so a plugin with no icon of its own still gets a button a
 * person can tell apart. `default` is for a plugin that wants a generic
 * one rather than a letter.
 */
const ICON_PATHS: Record<string, string> = {
  workspace: 'M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z',
  files:
    'M9 3H5.5A1.5 1.5 0 0 0 4 4.5v13M8 7h7l4 4v9.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 8 20.5v-12A1.5 1.5 0 0 1 9.5 7M15 7v4h4',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
  puzzle: 'M4 7.5h4a2.5 2.5 0 1 1 5 0h4v4a2.5 2.5 0 1 1 0 5v4H4z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'git-branch':
    'M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 6c0 4-12 4-12 9',
  'symbol-misc': 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9',
  default:
    'M4 5a1 1 0 0 1 1-1h5v6H4V5zM14 4h5a1 1 0 0 1 1 1v5h-6V4zM4 14h6v6H5a1 1 0 0 1-1-1v-5zM14 14h6v5a1 1 0 0 1-1 1h-5v-6z',
};

function ActivityIcon({ name }: { name: string }) {
  const path = ICON_PATHS[name];
  if (path === undefined) {
    return <span className="e8-activity-letter">{name.slice(0, 1).toUpperCase()}</span>;
  }
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** One button on the activity bar. */
function ActivityButton({
  ctx,
  entry,
  active,
}: {
  ctx: Context;
  entry: ActivityMeta;
  active: boolean;
}) {
  return (
    <button
      type="button"
      className="e8-activity-button"
      data-testid={`activity-${entry.key}`}
      aria-label={entry.title}
      aria-pressed={active}
      onClick={() =>
        entry.opens === 'sidebar'
          ? ctx.shell.showSidebar(entry.key)
          : ctx.shell.openContributed(entry.key)
      }
    >
      <ActivityIcon name={entry.icon} />
    </button>
  );
}

/**
 * One tab on the document strip. The whole tab activates on click — a plain
 * `<button role="tab">`, the same element the old layout's tab was —
 * and close is a nested `<span role="button">`, not a nested `<button>`
 * (invalid HTML) and not a sibling of it either (a sibling would sit
 * outside the tab's own click target, and closing a tab you never
 * activated is not a shape anything here needs). `stopPropagation` keeps
 * closing from also activating the tab it just removed.
 */
function DocumentTab({
  ctx,
  doc,
  active,
  onCloseRefused,
}: {
  ctx: Context;
  doc: { key: string; title: string; closable: boolean; dirty: boolean };
  active: boolean;
  onCloseRefused: (key: string) => void;
}) {
  // The strip scrolls sideways once it is full, so the tab that just
  // became active is brought into view — a selected tab nobody can see
  // reads as no selection at all. jsdom has no `scrollIntoView`.
  const tab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) tab.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return (
    <button
      ref={tab}
      type="button"
      role="tab"
      aria-selected={active}
      className="e8-doc-tab"
      data-testid={`doc-${doc.key}`}
      onClick={() => ctx.shell.activate(doc.key)}
    >
      {doc.title}
      {doc.dirty ? ' ●' : ''}
      {doc.closable ? (
        <span
          role="button"
          className="e8-doc-tab-close"
          aria-label={`close ${doc.title}`}
          data-testid={`doc-close-${doc.key}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!ctx.shell.close(doc.key)) onCloseRefused(doc.key);
          }}
        >
          ×
        </span>
      ) : null}
    </button>
  );
}

/**
 * The five regions the design spec names: activity bar, sidebar, document
 * tabs + body, panel, status bar. Nothing here ever
 * throws: a crashed document is `DocumentBoundary` saying so, and zero
 * contributions anywhere is `shell-empty` saying so — never a blank page
 * either way, the same rule the old layout applied to one screen at a
 * time.
 *
 * `shell-empty` replaces the WHOLE shell, not just the document body: five
 * empty chrome regions around one explanation would still be "painting
 * something" for nothing registered anywhere, the exact failure this
 * exists to rule out. It only fires when every slot AND every already-open
 * document is empty — an open document with no activity button pointing at
 * it (opened via `ctx.shell.open`, e.g. from Explorer) is still something
 * to show, even though no slot named it.
 */
export function Shell({ ctx }: { ctx: Context }) {
  const { documents, active, pending, sidebar, panelCollapsed, panel, sideRight } = useShell(ctx);
  const [pendingClose, setPendingClose] = useState<string | undefined>(undefined);
  const sidebarSize = useResize(SIZE_KEYS.sidebar, 'x', 1);
  // Dragging the panel's top edge UP makes it taller, hence the sign.
  const panelSize = useResize(SIZE_KEYS.panel, 'y', -1);
  // Its handle sits on the right aside's LEFT edge, so dragging left (a
  // shrinking clientX) is what widens it — the mirror image of the left
  // sidebar's own handle and sign.
  const sideRightSize = useResize(SIZE_KEYS.sideRight, 'x', -1);

  // Every `shell.sidebar` / `shell.sideRight` key shown at least once stays
  // in this set for the life of the component, so the entry below is kept
  // mounted (hidden, not removed) after the pick moves on — the same rule
  // `documents` and the panel's own entries already keep (Ruling 13, Task
  // 4), now extended to the two sides. Updated while rendering rather than
  // in an effect: a set that already has the key is left alone, so this
  // never loops, and the entry appears in the very render that first shows
  // it instead of one frame late.
  const [shownSidebars, setShownSidebars] = useState<ReadonlySet<string>>(() => new Set());
  if (sidebar !== undefined && !shownSidebars.has(sidebar)) {
    setShownSidebars(new Set(shownSidebars).add(sidebar));
  }
  const [shownSideRight, setShownSideRight] = useState<ReadonlySet<string>>(() => new Set());
  if (sideRight !== undefined && !shownSideRight.has(sideRight)) {
    setShownSideRight(new Set(shownSideRight).add(sideRight));
  }

  // The five slot lists below are read straight off `ctx.slots` on every
  // render. `useShell` subscribes to `ctx.slots` too, but for its own
  // reads (`documents()`, `panel()`); this subscription is the one that
  // exists for the lists, so a contribution landing AFTER mount (a plugin's
  // client half, imported by `modules` once the snapshot names it) is drawn
  // without depending on what that hook happens to read.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => ctx.slots.subscribe(bump), [ctx]);

  // Reload and close are the one door no tab's own close button guards.
  // Registered ONCE, here, off a shell-level fact — not per editor, where
  // one dirty editor among several would have to know about the others.
  // `returnValue` beside `preventDefault`: Safari holds the page on the
  // one, the rest on the other.
  //
  // Cmd/Ctrl+S is swallowed here for EVERY tab: the editor's own listener
  // saves only when its tab is active, so on any other tab the keystroke
  // reached the browser and opened its save-page dialog, which an IDE
  // never wants.
  useEffect(() => {
    const hold = (event: BeforeUnloadEvent) => {
      if (!ctx.shell.hasDirtyDocuments()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const swallowSave = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's')
        event.preventDefault();
    };
    window.addEventListener('beforeunload', hold);
    window.addEventListener('keydown', swallowSave);
    return () => {
      window.removeEventListener('beforeunload', hold);
      window.removeEventListener('keydown', swallowSave);
    };
  }, [ctx]);

  // Spec §8: a contribution with an unknown `opens` is a diagnostic. It is
  // checked here, where the slot is first read, and the button is skipped
  // — clicking it used to report "no document is registered", a cause the
  // code did not know. Reported once per entry, from an effect rather than
  // mid-render: `report()` wakes the panel, and a state update from inside
  // another component's render is React's own warning.
  const [validActivities, badActivities] = partition(
    ctx.slots.list<SlotMeta & ActivityMeta>(ctx.shell.slots.activity),
    (entry) => ACTIVITY_OPENS.includes(entry.opens),
  );
  const reportedOpens = useRef(new Set<string>());
  useEffect(() => {
    for (const entry of badActivities) {
      const id = `${entry.key}::${String(entry.opens)}`;
      if (reportedOpens.current.has(id)) continue;
      reportedOpens.current.add(id);
      const connection = ctx.reflect.get('connection', false) as ConnectionService | undefined;
      connection?.report(
        diagnostic(
          'warning',
          entry.key,
          'shell',
          `the activity button "${entry.key}" opens "${String(entry.opens)}", which the shell does not know — the button is not drawn`,
          "set opens to 'sidebar' or 'document'",
        ),
      );
    }
  });
  const activities = byOrder(validActivities);
  const sidebarEntries = ctx.slots.list<SlotMeta & SidebarMeta>(ctx.shell.slots.sidebar);
  const sideRightEntries = ctx.slots.list<SlotMeta & SidebarMeta>(ctx.shell.slots.sideRight);
  const documentContribs = ctx.slots.list<SlotMeta & DocumentMeta>(ctx.shell.slots.document);
  const panelEntries = byOrder(ctx.slots.list<SlotMeta & PanelMeta>(ctx.shell.slots.panel));
  const statusEntries = byOrder(ctx.slots.list<SlotMeta & StatusMeta>(ctx.shell.slots.status));

  const nothingAtAll =
    activities.length === 0 &&
    sidebarEntries.length === 0 &&
    documentContribs.length === 0 &&
    documents.length === 0 &&
    panelEntries.length === 0 &&
    statusEntries.length === 0;

  if (nothingAtAll) {
    return (
      <p className="e8-shell-empty" data-testid="shell-empty">
        No contributions are registered on any shell slot yet.
      </p>
    );
  }

  const activeSidebarEntry =
    sidebar === undefined ? undefined : sidebarEntries.find((e) => e.key === sidebar);
  const pendingDoc =
    pendingClose === undefined ? undefined : documents.find((d) => d.key === pendingClose);

  // Only a dragged or stored size lands inline; otherwise the stylesheet's
  // own token stays in charge, so the defaults live in one place.
  const sizes = {
    '--e8-sidebar-w': sidebarSize.size === undefined ? undefined : `${sidebarSize.size}px`,
    '--e8-panel-h': panelSize.size === undefined ? undefined : `${panelSize.size}px`,
    '--e8-side-right-w': sideRightSize.size === undefined ? undefined : `${sideRightSize.size}px`,
  } as CSSProperties;

  return (
    <div
      // No sidebar chosen means its column is 0 wide (DESIGN.md §2), not
      // 260px of empty chrome. The right sidebar collapses the same way —
      // keyed on the same effective key `useShell` already resolved, not on
      // whether something is still registered for it (a plugin unloading
      // out from under a still-flagged key leaves the column open but
      // empty, same as an open document pane with a withdrawn component
      // would).
      className={[
        'e8-shell',
        sidebar === undefined ? 'e8-sidebar-collapsed' : '',
        sideRight === undefined ? 'e8-side-right-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="shell"
      style={sizes}
    >
      <nav className="e8-activity" data-testid="activity-bar">
        {activities.map((entry) => (
          <ActivityButton
            key={entry.key}
            ctx={ctx}
            entry={entry}
            // Highlighted only for the OVERRIDE, never for a tab's own
            // sidebar showing on its own account: `sidebar` (the effective
            // key) differs from `active?.sidebar` (what the tab itself
            // declares) exactly when an override picked it — see
            // `effectiveLeft` in `shell.tsx`, `override ?? active?.sidebar`.
            active={entry.opens === 'sidebar' && sidebar === entry.key && sidebar !== active?.sidebar}
          />
        ))}
      </nav>

      <aside className="e8-sidebar" data-testid="sidebar">
        <div
          className="e8-resize e8-resize-x"
          data-testid="resize-sidebar"
          {...sidebarSize.handlers}
        />
        {/* Every entry shown at least once stays mounted, hidden rather
            than unmounted, the same rule the document panes and the
            panel's own entries already keep — so a half-typed field
            survives the pick moving to a different sidebar and back. */}
        {sidebarEntries
          .filter((entry) => shownSidebars.has(entry.key))
          .map((entry) => (
            <div key={entry.key} data-testid={`sidebar-${entry.key}`} hidden={entry.key !== sidebar}>
              <entry.component ctx={ctx} />
            </div>
          ))}
        {sidebar !== undefined && activeSidebarEntry === undefined ? (
          <p className="e8-empty">{`nothing registered for the "${sidebar}" sidebar`}</p>
        ) : null}
      </aside>

      <div className="e8-editors">
        <div className="e8-editors-tabs" data-testid="doc-tabs" role="tablist">
          {documents.map((doc) => (
            <DocumentTab
              key={doc.key}
              ctx={ctx}
              doc={doc}
              active={doc.key === active?.key}
              onCloseRefused={setPendingClose}
            />
          ))}
        </div>
        <div className="e8-editors-body" data-testid="doc-body">
          {active === undefined && pending !== undefined ? (
            <p className="e8-empty" data-testid="doc-opening">
              {`opening "${pending}"…`}
            </p>
          ) : null}
          {active === undefined && pending === undefined ? (
            // The address names nothing and nothing is on its way: Back
            // onto the entry a page was first loaded at, or the last
            // closable tab closed with nothing contributed open. Every pane
            // below is hidden then, and the body used to be blank.
            <p className="e8-empty" data-testid="doc-none">
              no document is open — open a project from Projects, or a file from the Explorer
            </p>
          ) : null}
          {documents.map((doc) => (
            <div
              key={doc.key}
              className="e8-doc-pane"
              data-testid={`doc-pane-${doc.key}`}
              hidden={doc.key !== active?.key}
            >
              <DocumentBoundary ctx={ctx} docKey={doc.key}>
                <doc.component ctx={ctx} />
              </DocumentBoundary>
            </div>
          ))}
        </div>
        {pendingDoc ? (
          <div
            className="e8-shell-confirm"
            role="alertdialog"
            aria-label={`close ${pendingDoc.title} without saving`}
          >
            <p>{`Close "${pendingDoc.title}" without saving?`}</p>
            <button
              type="button"
              data-testid="confirm-yes"
              onClick={() => {
                ctx.shell.close(pendingDoc.key, { force: true });
                setPendingClose(undefined);
              }}
            >
              Yes
            </button>
            <button
              type="button"
              data-testid="confirm-no"
              onClick={() => setPendingClose(undefined)}
            >
              No
            </button>
          </div>
        ) : null}
      </div>

      <aside className="e8-side-right" data-testid="side-right">
        <div
          className="e8-resize e8-resize-x"
          data-testid="resize-side-right"
          {...sideRightSize.handlers}
        />
        {/* Same mount-once-hide-after rule as the left sidebar above. */}
        {sideRightEntries
          .filter((entry) => shownSideRight.has(entry.key))
          .map((entry) => (
            <div
              key={entry.key}
              data-testid={`side-right-${entry.key}`}
              hidden={entry.key !== sideRight}
            >
              <entry.component ctx={ctx} />
            </div>
          ))}
      </aside>

      <div
        className="e8-panel"
        data-testid="panel"
        data-collapsed={panelCollapsed ? '' : undefined}
      >
        <div className="e8-resize e8-resize-y" data-testid="resize-panel" {...panelSize.handlers} />
        <div className="e8-panel-header" role="tablist">
          {/* One tab per `shell.panel` entry (Task 4): the title, and a
              badge only `ctx.shell.setPanelBadge` puts there — the entry
              itself carries neither any more, so a plugin with several
              tabs reads the same as one with a single stacked pane used
              to. The toggle rides the strip's right edge either way. */}
          {panelEntries.map((entry) => {
            const badge = ctx.shell.panelBadge(entry.key);
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                className="e8-panel-tab"
                aria-selected={entry.key === panel}
                data-testid={`panel-tab-${entry.key}`}
                onClick={() => ctx.shell.showPanel(entry.key)}
              >
                {entry.title}
                {badge === undefined ? null : (
                  <span className="e8-badge" data-testid={`panel-badge-${entry.key}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            data-testid="panel-toggle"
            aria-pressed={panelCollapsed}
            onClick={() => ctx.shell.togglePanel()}
          >
            {panelCollapsed ? '▸' : '▾'}
          </button>
        </div>
        {/* Every entry stays mounted (Ruling 13's own rule, applied to the
            panel): collapsed or on another tab, it is `hidden`, never
            unmounted — a plugin's own state survives switching away from
            it or collapsing the panel, same as a document's pane. */}
        {panelEntries.map((entry) => (
          <div
            key={entry.key}
            className="e8-panel-entry"
            role="tabpanel"
            data-testid={`panel-${entry.key}`}
            hidden={panelCollapsed || entry.key !== panel}
          >
            <entry.component ctx={ctx} />
          </div>
        ))}
      </div>

      <div className="e8-status" data-testid="status-bar">
        <div data-side="left">
          {statusEntries
            .filter((entry) => entry.side === 'left')
            .map((entry) => (
              <span key={entry.key} data-testid={`status-${entry.key}`}>
                <entry.component ctx={ctx} />
              </span>
            ))}
        </div>
        <div data-side="right">
          {statusEntries
            .filter((entry) => entry.side === 'right')
            .map((entry) => (
              <span key={entry.key} data-testid={`status-${entry.key}`}>
                <entry.component ctx={ctx} />
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
