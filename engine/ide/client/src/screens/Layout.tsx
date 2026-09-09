import { Component } from 'react';
import type { ReactNode } from 'react';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import { useLayout } from '../plugins/layout';

/** What actually threw, reduced to the one thing worth showing a human. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Isolates the CURRENT screen from the rest of the IDE — the same shape as
 * `CompositionScreen.tsx`'s `CardBoundary`, and for the same reason: a
 * screen is a plugin's own code, this shell has no other trust
 * relationship with it, and one bad render must not take the tab bar (or
 * whatever screen you navigate to next) down with it.
 *
 * Two things differ from `CardBoundary`, both because a screen fills the
 * whole content area instead of sharing it with siblings:
 *
 *  - it is mounted with `key={current.id}` (see `Layout` below), where a
 *    card never needed one — a card's own key never changes under it, but
 *    a screen's identity changes every time navigation does. Without the
 *    key, navigating away from a crashed screen re-renders this SAME
 *    instance with new children; a class component whose `render()` is
 *    already committed to returning the fallback does not get a second
 *    look at those children, so the next screen would render as broken
 *    too and the IDE would stay stuck exactly as if there were no
 *    boundary at all.
 *  - failure renders a message instead of `null` — a card's failure is one
 *    row among several still-visible siblings, but the CURRENT screen has
 *    no siblings in the content area; `null` here would just be a blank
 *    pane, the exact "painted nothing" this module's empty state (below)
 *    exists to rule out too.
 *
 * `where: 'layout'` (not a card-style `'layout.screen'`) matches every
 * OTHER diagnostic `layout.tsx` itself already reports (a collision, a
 * stale hash) — both there and here `plugin` is the screen id and `where`
 * names the plugin, because unlike `slots`, which serves many differently
 * named extension points that `where` has to tell apart, a screen is the
 * only thing `layout` ever registers.
 */
class ScreenBoundary extends Component<
  { ctx: Context; screenId: string; children: ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: unknown) {
    return { message: errorMessage(error) };
  }
  componentDidCatch(error: unknown) {
    this.props.ctx.connection.report(
      diagnostic(
        'error',
        this.props.screenId,
        'layout',
        `screen crashed while rendering: ${errorMessage(error)}`,
      ),
    );
  }
  render() {
    if (this.state.message !== null) {
      return (
        <p className="e8-layout-screen-error" data-testid="screen-error">
          screen crashed: {this.state.message}
        </p>
      );
    }
    return this.props.children;
  }
}

/**
 * The chrome around whichever screens the running IDE was given: a tab per
 * registered screen (`role="tab"`, so `title` is what a human — and a
 * test — reads) and the current one's body, always reading through
 * `useLayout` so a screen landing after mount (a plugin's client half,
 * loaded by its own dynamic import) shows up with no reload. Nothing here
 * ever throws: zero screens is `layout-empty` saying so, and one bad
 * screen is `ScreenBoundary` saying so — never a blank pane either way.
 */
export function Layout({ ctx }: { ctx: Context }) {
  const { screens, current } = useLayout(ctx);

  return (
    <div className="e8-layout">
      <nav className="e8-layout-tabs" role="tablist">
        {screens.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === current?.id}
            className="e8-layout-tab"
            onClick={() => ctx.layout.go(entry.id)}
          >
            {entry.title}
          </button>
        ))}
      </nav>
      <main className="e8-layout-body">
        {current ? (
          <ScreenBoundary key={current.id} ctx={ctx} screenId={current.id}>
            <current.component ctx={ctx} />
          </ScreenBoundary>
        ) : (
          <p className="e8-empty" data-testid="layout-empty">
            No screens are registered yet.
          </p>
        )}
      </main>
    </div>
  );
}
