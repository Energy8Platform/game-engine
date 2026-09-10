import { Component, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type ResolvedRow } from '@energy8engine/contracts';
import { SchemaForm } from '../schema-form/SchemaForm';
import { useSlot } from '../plugins/slots';
import { Preview } from './PreviewWall';

/**
 * The EDITOR's own diagnostics — its plugin graph, namespace 1 of
 * `Diagnostic.plugin` resolved against the EDITOR's rows. Exported because
 * `Layout.tsx`'s `DiagnosticsPanelEntry` reads it reactively and hands the
 * array straight to `DiagnosticsPanel`'s `editor` prop, which renders
 * these as rows now, the same as `project`'s and `game`'s — see
 * `EditorComposition`'s own comment, below, for why this screen no longer
 * renders a copy of its own. That reader used to be `App.tsx`'s
 * `DiagnosticsPanelCard`, a card confined to the composition tab; it
 * moved into the chrome so the one list outlives whichever screen you
 * are on, and this comment named the deleted card for a slice after.
 *
 * `ctx.connection.diagnostics` is a getter that concatenates two backing
 * arrays into a *fresh* array on every read (see connection.ts). That's
 * fine for plain reads, but `useSyncExternalStore`'s `getSnapshot` must
 * return a referentially stable value when nothing actually changed — it
 * re-invokes `getSnapshot` on every render (and once more right after
 * commit, to catch tearing) and treats any `Object.is` difference as a new
 * value, which a fresh array every time would turn into an infinite
 * render loop. The two backing arrays don't get recreated unless their
 * contents change, so an elementwise reference comparison against the
 * previous snapshot is enough to tell "really changed" from "read again".
 */
export function useEditorDiagnostics(ctx: Context): Diagnostic[] {
  const cache = useRef<Diagnostic[]>(ctx.connection.diagnostics);
  return useSyncExternalStore(ctx.connection.subscribe, () => {
    const next = ctx.connection.diagnostics;
    const same =
      next.length === cache.current.length && next.every((d, i) => d === cache.current[i]);
    if (!same) cache.current = next;
    return cache.current;
  });
}

const STATE_LABEL: Record<number, string> = {
  0: 'ждёт',
  1: 'грузится',
  2: 'активен',
  3: 'сбой',
  4: 'выгружен',
  5: 'выгружается',
};

/**
 * Isolates one `composition.card` slot entry from the rest of the screen.
 * A card is contributed by a plugin the IDE has no other trust relationship
 * with, and a `Snapshot`-driven re-render can hand it props it doesn't
 * expect — nothing here should let a bad card take the row list, the
 * diagnostics panel, or a *different* card down with it. `useSlot` already
 * re-renders this boundary's siblings independently (each `card.key` gets
 * its own subtree), so containment only needs to happen per-card, not
 * screen-wide.
 *
 * Survivable is not the same as legible: swallowing the error and rendering
 * nothing would hide a broken card from the very screen whose job is to
 * surface plugin failures. `componentDidCatch` reports it through the same
 * `ctx.connection.report` path every other diagnostic on this screen uses,
 * named by the card's slot key, so a crashed card shows up next to a
 * cannot-resolve-package failure instead of just quietly vanishing.
 *
 * This only catches errors thrown while React is rendering the card's
 * subtree (the React error-boundary contract) — an error thrown later, from
 * an event handler inside the card or from async work it kicked off, does
 * not reach `getDerivedStateFromError`/`componentDidCatch` and will not be
 * caught or reported here.
 */
class CardBoundary extends Component<
  { ctx: Context; cardKey: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.ctx.connection.report(
      diagnostic(
        'error',
        this.props.cardKey,
        'composition.card',
        `card crashed while rendering: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/**
 * The IDE's own plugin graph — `ctx.connection`'s snapshot/diagnostics,
 * unchanged from before Task 10. Split out of `CompositionScreen` so that
 * component can render this half only when it actually has a `ctx` (a
 * `useSyncExternalStore` call cannot be made conditional on `ctx` being
 * present, so it has to live behind a component that's ONLY mounted when
 * `ctx` exists, not behind an `if` inside one that always mounts).
 *
 * Used to also render `useEditorDiagnostics(ctx)` here as a standalone
 * list, resolving each entry's `plugin` id to the row's package name —
 * `GameComposition`'s own comment, below, records the same removal for
 * the PROJECT half. Removed once `DiagnosticsPanel`'s `editor` prop
 * existed: §8 of the design spec names the panel as THE list, and a
 * second, unattributed copy of the same diagnostics here — just resolved
 * by row name instead of raw id — was the "second place to look" that
 * rules out. The row-name resolution is a real capability the panel does
 * not (yet) replicate — named here rather than silently dropped, for
 * whoever next has reason to add it there instead.
 */
function EditorComposition({ ctx }: { ctx: Context }) {
  const snapshot = useSyncExternalStore(ctx.connection.subscribe, () => ctx.connection.snapshot);
  const cards = useSlot(ctx, 'composition.card');

  const rows = snapshot?.rows ?? [];

  return (
    <>
      <Preview ctx={ctx} />

      {snapshot === null ? (
        <p className="e8-empty">подключение…</p>
      ) : rows.length === 0 ? (
        <p className="e8-empty">состав пуст</p>
      ) : (
        rows.map((row) => (
          <section className="e8-row" key={row.id}>
            <header>
              <strong>{row.name}</strong>
              <span className="e8-state">
                {row.state === null ? '—' : (STATE_LABEL[row.state] ?? row.state)}
              </span>
              {row.hot ? <span className="e8-badge">горячий</span> : null}
            </header>
            <SchemaForm
              rowId={row.id}
              schema={row.schema}
              value={(row.config ?? {}) as Record<string, unknown>}
              onChange={(next) => ctx.connection.update(row.id, next)}
            />
          </section>
        ))
      )}

      {cards.map((card) => (
        <CardBoundary key={card.key} ctx={ctx} cardKey={card.key}>
          <card.component />
        </CardBoundary>
      ))}
    </>
  );
}

/** `bundle:e8-base` → `e8-base` (the bundle's own name); a patch layer's name is already the label to show. */
function layerLabel(from: string): string {
  return from.startsWith('bundle:') ? from.slice('bundle:'.length) : from;
}

interface GameCompositionProps {
  /** The GAME's resolved composition — one row per plugin, in layering order, each carrying which layer placed it. */
  rows: ResolvedRow[];
}

/**
 * The GAME's resolved composition — which layer placed each row.
 *
 * Used to also render the PROJECT's own diagnostics here as a standalone
 * list above the rows (`GET /api/composition`'s own `diagnostics` — a
 * malformed `e8.profile.yml`, a bundle not found, a row whose package
 * could not be resolved), resolving each one's `plugin` id to the row's
 * package name. Removed once `DiagnosticsPanel` (Task 8) existed: §8 of
 * the design spec names the panel as THE list ("список в панели
 * диагностик"), and this screen's own copy — standalone, not attached to
 * the row it was about — was pure duplication of what the panel already
 * shows, not a second legitimate view of it. The row-name resolution this
 * used to do is a real capability the panel does not (yet) replicate —
 * `DiagnosticsPanel` shows the raw `plugin` id — named here rather than
 * silently dropped, for whoever next has reason to add it there instead.
 */
function GameComposition({ rows }: GameCompositionProps) {
  return (
    <section className="e8-game-composition">
      {rows.map((row) => (
        <section className="e8-game-row" key={row.id} data-testid={`row-${row.id}`}>
          <header>
            <strong>{row.name}</strong>
            <span className="e8-layer">{layerLabel(row.from)}</span>
          </header>
        </section>
      ))}
    </section>
  );
}

export interface CompositionScreenProps {
  /** The IDE's own plugin graph — omit in a game-composition-only render (see `GameComposition`). */
  ctx?: Context;
  /** The GAME's resolved composition — omit when only the editor's own rows are being shown. */
  rows?: ResolvedRow[];
}

export function CompositionScreen({ ctx, rows }: CompositionScreenProps) {
  return (
    <main className="e8-composition">
      <h1>Состав</h1>
      {ctx ? <EditorComposition ctx={ctx} /> : null}
      {rows ? <GameComposition rows={rows} /> : null}
    </main>
  );
}
