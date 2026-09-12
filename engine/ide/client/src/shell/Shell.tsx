import { Component, useEffect, useReducer, useState } from 'react';
import type { ReactNode } from 'react';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import type { ConnectionService } from '../plugins/connection';
import type { SlotMeta } from '../plugins/slots';
import {
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

/** Registration order is what `ctx.slots.list()` already returns; `order` breaks ties on top of it. `Array.prototype.sort` is stable, so entries that never set `order` keep the registration order they came in. */
function byOrder<T extends { order?: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
}

/**
 * Isolates one document from the rest of the shell — the same shape
 * as `Layout.tsx`'s own `ScreenBoundary`, and for the same reason: a
 * document is a plugin's own code (or a file's own content, for Explorer's
 * instance tabs), this shell has no other trust relationship with it, and
 * one bad render must not take the tab strip, the sidebar or the panel down
 * with it. Duplicated here rather than imported from `Layout.tsx` — the two
 * are meant to diverge exactly as far as their owners do, and `Layout.tsx`
 * is on its way out (Task 6); a shared import would tie this file's fate to
 * that deletion for no reason.
 *
 * One instance per OPEN document, not one for the active one: `Shell`
 * below keeps every open document mounted and hides the inactive ones
 * (Ruling 13 — switching tabs used to unmount the editor and lose its
 * typed text), so each pane is keyed by its own `doc.key` and a crash in
 * one never touches a sibling's boundary. That per-document key is also
 * what keeps a crashed pane from poisoning the next one, the reason
 * `ScreenBoundary`'s own doc gave for keying on the active id.
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
      {entry.icon}
    </button>
  );
}

/**
 * One tab on the document strip. The whole tab activates on click — a plain
 * `<button role="tab">`, the same element Layout.tsx's own tab already is —
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
  return (
    <button
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
 * either way, the same rule `Layout.tsx` already applies to one screen at a
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
  const { documents, active, sidebar, panelCollapsed } = useShell(ctx);
  const [pendingClose, setPendingClose] = useState<string | undefined>(undefined);

  // The five slot lists below are read straight off `ctx.slots` on every
  // render, and `useShell` only hears from `ctx.shell` — so a contribution
  // landing AFTER mount (a plugin's client half, imported by `modules` once
  // the snapshot names it) needs this to be drawn at all.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => ctx.slots.subscribe(bump), [ctx]);

  // Reload and close are the one door no tab's own close button guards.
  // Registered ONCE, here, off a shell-level fact — not per editor, where
  // one dirty editor among several would have to know about the others.
  useEffect(() => {
    const hold = (event: BeforeUnloadEvent) => {
      if (ctx.shell.hasDirtyDocuments()) event.preventDefault();
    };
    window.addEventListener('beforeunload', hold);
    return () => window.removeEventListener('beforeunload', hold);
  }, [ctx]);

  const activities = byOrder(ctx.slots.list<SlotMeta & ActivityMeta>(ctx.shell.slots.activity));
  const sidebarEntries = ctx.slots.list<SlotMeta & SidebarMeta>(ctx.shell.slots.sidebar);
  const documentContribs = ctx.slots.list<SlotMeta & DocumentMeta>(ctx.shell.slots.document);
  const panelEntries = ctx.slots.list<SlotMeta & PanelMeta>(ctx.shell.slots.panel);
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

  return (
    <div className="e8-shell">
      <nav className="e8-activity" data-testid="activity-bar">
        {activities.map((entry) => (
          <ActivityButton
            key={entry.key}
            ctx={ctx}
            entry={entry}
            active={entry.opens === 'sidebar' && sidebar === entry.key}
          />
        ))}
      </nav>

      <aside className="e8-sidebar" data-testid="sidebar">
        {sidebar === undefined ? null : activeSidebarEntry ? (
          <div data-testid={`sidebar-${sidebar}`}>
            <activeSidebarEntry.component ctx={ctx} />
          </div>
        ) : (
          <p className="e8-empty">{`nothing registered for the "${sidebar}" sidebar`}</p>
        )}
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

      <div className="e8-panel" data-testid="panel">
        <div className="e8-panel-header">
          <button
            type="button"
            data-testid="panel-toggle"
            aria-pressed={panelCollapsed}
            onClick={() => ctx.shell.togglePanel()}
          >
            {panelCollapsed ? '▸' : '▾'}
          </button>
        </div>
        {panelCollapsed
          ? null
          : panelEntries.map((entry) => (
              <div key={entry.key} className="e8-panel-entry" data-testid={`panel-${entry.key}`}>
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
