import { Component } from 'react';
import type { ReactNode } from 'react';
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';
import type { ConnectionService } from '../plugins/connection';
import { useLayout } from '../plugins/layout';
import { useGameComposition } from '../plugins/game-composition';
import { useGameDiagnostics } from '../plugins/diagnostics';
import { useEditorDiagnostics } from './CompositionScreen';
import { DiagnosticsPanel } from './DiagnosticsPanel';

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
    // Read leniently, exactly as `layout.tsx`'s own `report()` does and for
    // the same reason: `layout` declares no dependency on `connection` and
    // is meant to work when composed without it. This read was direct,
    // which made a crashed screen throw INSIDE the error boundary when the
    // service was absent — the one path where "a failure is data" has to
    // hold hardest, since there is nothing left above it to catch. Not
    // reachable in the shipped app, where `createIdeClient` always
    // composes both; cheap enough to make consistent that reachability is
    // not the argument.
    const connection = this.props.ctx.reflect.get('connection', false) as
      ConnectionService | undefined;
    connection?.report(
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
 * Reads the game's composition and diagnostics, plus the editor's own, and
 * hands them to `DiagnosticsPanel` — this used to be `App.tsx`'s
 * `DiagnosticsPanelCard`, a `composition.card` registration reachable only
 * on the composition tab. It is a plain component now, not a slot entry:
 * §8 of the design spec wants ONE list visible to the game, the IDE and an
 * agent alike, and a card confined to one tab was never that. Reads all
 * three hooks reactively, the same as the card did — a wrapper that read
 * them once at registration and closed over the result would go stale the
 * moment any of the three updates after its first fetch/frame.
 *
 * Split from `DiagnosticsChrome` below for the reason
 * `CompositionScreen.tsx`'s own `EditorComposition` already gives for the
 * identical split: `useGameComposition`/`useGameDiagnostics`/
 * `useEditorDiagnostics` read `ctx.gameComposition`/`ctx.gameDiagnostics`/
 * `ctx.connection` directly, so this must only ever mount once
 * `DiagnosticsChrome` has confirmed all three exist — a hook call cannot
 * itself be made conditional.
 */
function DiagnosticsPanelEntry({ ctx }: { ctx: Context }) {
  const { diagnostics: project } = useGameComposition(ctx);
  const { groups: game, dropped } = useGameDiagnostics(ctx);
  const editor = useEditorDiagnostics(ctx);
  return (
    <DiagnosticsPanel project={project} game={game} droppedFromGame={dropped} editor={editor} />
  );
}

/**
 * The panel's guard: `layout` has no static dependency on `connection`,
 * `gameComposition` or `gameDiagnostics` and a few tests here compose it
 * alone (see the two "composed without ctx.connection" cases below) — a
 * `Context` that thin has none of the three, and `DiagnosticsPanelEntry`'s
 * hooks would throw reading straight off a service that was never
 * provided. Checked here, one component up, because the hooks themselves
 * cannot skip a call conditionally; a context missing any one of the
 * three renders nothing rather than mounting a component whose first hook
 * throws. Not reachable in the shipped app, where `createIdeClient`
 * always composes all three — same non-argument `ScreenBoundary`'s own
 * `componentDidCatch` already makes for the identical lenient read.
 */
function DiagnosticsChrome({ ctx }: { ctx: Context }) {
  const ready =
    ctx.reflect.get('connection', false) !== undefined &&
    ctx.reflect.get('gameComposition', false) !== undefined &&
    ctx.reflect.get('gameDiagnostics', false) !== undefined;
  if (!ready) return null;
  return <DiagnosticsPanelEntry ctx={ctx} />;
}

/**
 * The chrome around whichever screens the running IDE was given: a tab per
 * registered screen and the current one's body, always reading through
 * `useLayout` so a screen landing after mount (a plugin's client half,
 * loaded by its own dynamic import) shows up with no reload. Nothing here
 * ever throws: zero screens is `layout-empty` saying so, and one bad
 * screen is `ScreenBoundary` saying so — never a blank pane either way.
 *
 * A tab carries two identities and a test should pick deliberately: `title`
 * is the WORDING a human reads (`role="tab"`'s accessible name), and it can
 * be translated out from under a test that pins it; `data-testid={`tab-
 * ${id}`}` is the screen's own id, the same stable thing the address hash
 * already commits to. Most tests should address a tab by id — a test that
 * exists to prove wording is a separate, deliberate exception.
 *
 * The body is a plain `<div>`, not a `<main>`. A screen owns its own main
 * landmark — `CompositionScreen` and `PreviewWall` both open with one, and
 * a plugin's screen is free to — so a `<main>` here nested a landmark
 * inside a landmark on every screen the IDE ships. The chrome is the tab
 * bar; the content area is whatever the current screen decided to be.
 *
 * `DiagnosticsChrome` is a sibling of `e8-layout-body`, not a child of
 * `ScreenBoundary` and not keyed by `current.id` the way the boundary is.
 * Both matter: a sibling means a crashed screen — caught by
 * `ScreenBoundary` right above — never unmounts the panel alongside it,
 * which is exactly when the panel is most worth having on screen; no key
 * means navigating away from one screen to another never remounts it
 * either, so whatever it was showing survives the trip. Task 7's own debt:
 * the panel used to be a `composition.card`, reachable on the composition
 * tab alone and gone the moment the tab it lived on unmounted.
 */
export function Layout({ ctx }: { ctx: Context }) {
  const { screens, current } = useLayout(ctx);

  return (
    <div className="e8-layout">
      <nav className="e8-layout-tabs">
        <span className="e8-layout-brand">e8 ide</span>
        <div className="e8-layout-pills" role="tablist">
          {screens.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === current?.id}
              className="e8-layout-tab"
              data-testid={`tab-${entry.id}`}
              onClick={() => ctx.layout.go(entry.id)}
            >
              {entry.title}
            </button>
          ))}
        </div>
      </nav>
      <div className="e8-layout-body">
        {current ? (
          <ScreenBoundary key={current.id} ctx={ctx} screenId={current.id}>
            <current.component ctx={ctx} />
          </ScreenBoundary>
        ) : (
          <p className="e8-empty" data-testid="layout-empty">
            No screens are registered yet.
          </p>
        )}
      </div>
      <DiagnosticsChrome ctx={ctx} />
    </div>
  );
}
