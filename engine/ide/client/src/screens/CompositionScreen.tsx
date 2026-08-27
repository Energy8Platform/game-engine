import { Component, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import { SchemaForm } from '../schema-form/SchemaForm';
import { useSlot } from '../plugins/slots';

/**
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
function useDiagnostics(ctx: Context): Diagnostic[] {
  const cache = useRef<Diagnostic[]>(ctx.connection.diagnostics);
  return useSyncExternalStore(ctx.connection.subscribe, () => {
    const next = ctx.connection.diagnostics;
    const same = next.length === cache.current.length && next.every((d, i) => d === cache.current[i]);
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
 */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function CompositionScreen({ ctx }: { ctx: Context }) {
  const snapshot = useSyncExternalStore(ctx.connection.subscribe, () => ctx.connection.snapshot);
  const diagnostics = useDiagnostics(ctx);
  const cards = useSlot(ctx, 'composition.card');

  const rows = snapshot?.rows ?? [];

  return (
    <main className="e8-composition">
      <h1>Состав</h1>

      {diagnostics.length > 0 && (
        <ul className="e8-diagnostics">
          {diagnostics.map((d, index) => (
            <li key={index} data-severity={d.severity}>
              <strong className="e8-severity">{d.severity}</strong> {d.plugin} · {d.where}: {d.message}
              {d.fix ? ` — ${d.fix}` : ''}
            </li>
          ))}
        </ul>
      )}

      {snapshot === null ? (
        <p className="e8-empty">подключение…</p>
      ) : rows.length === 0 ? (
        <p className="e8-empty">состав пуст</p>
      ) : (
        rows.map((row) => (
          <section className="e8-row" key={row.id}>
            <header>
              <strong>{row.name}</strong>
              <span className="e8-state">{row.state === null ? '—' : (STATE_LABEL[row.state] ?? row.state)}</span>
              {row.hot ? <span className="e8-badge">горячий</span> : null}
            </header>
            <SchemaForm
              schema={row.schema}
              value={(row.config ?? {}) as Record<string, unknown>}
              onChange={(next) => ctx.connection.update(row.id, next)}
            />
          </section>
        ))
      )}

      {cards.map((card) => (
        <CardBoundary key={card.key}>
          <card.component />
        </CardBoundary>
      ))}
    </main>
  );
}
