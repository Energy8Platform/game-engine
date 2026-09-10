import { useEffect } from 'react';
import type { Context } from 'cordis';
import {
  AssetsScreen,
  CompositionScreen,
  Layout,
  PreviewWall,
  useGameComposition,
} from '@energy8engine/ide-client';

/**
 * `ctx.layout` mounts a registered screen as `<component ctx={ctx} />` —
 * `ctx` alone, nothing else (see `layout.tsx`'s `ScreenEntry`) — so the
 * GAME's resolved composition rows, which `App` used to read once for
 * itself and hand down, have to be fetched right here instead, one level
 * lower than before this screen became a registration. Handed to
 * `CompositionScreen` exactly as `App` used to hand them.
 */
function CompositionScreenEntry({ ctx }: { ctx: Context }) {
  const { rows } = useGameComposition(ctx);
  return <CompositionScreen ctx={ctx} rows={rows ?? undefined} />;
}

/**
 * The app shell. Registers its screens and draws `<Layout/>` — it does not
 * render a screen itself, and does not know how many are registered; a
 * third screen is another `ctx.layout.screen` call away, made by whichever
 * plugin owns it, not by another edit here. Before this, `App` rendered
 * `CompositionScreen` directly, which made it the one place a second screen
 * would have had to be wired in by hand.
 *
 * The PROJECT's own diagnostics (`CompositionScreenEntry`'s own
 * `useGameComposition` fetch) and the GAME's own (`ctx.gameDiagnostics`) do
 * NOT go to `CompositionScreen` at all. `App` used to hand them to
 * `DiagnosticsPanel` here too, via a `composition.card` registration —
 * reachable on the composition tab alone, and gone the moment a crash on
 * some OTHER screen took its own tab's card boundary down. That
 * registration is gone; `DiagnosticsPanel` is drawn by `Layout` itself now,
 * below whichever screen is current rather than pinned to one of them — see
 * `screens/Layout.tsx`'s own `DiagnosticsChrome`. `App` no longer feeds it
 * anything — it reads the same three services on its own.
 *
 * `PreviewWall` needs no wrapper the way `CompositionScreenEntry` does: it
 * fetches nothing of its own to inject as a second prop, so it takes `ctx`
 * alone — already the exact shape `ctx.layout.screen`'s component type
 * asks for — and is registered directly.
 *
 * Both entries below now carry an explicit `order`, not just the second
 * one: `layout.tsx`'s own comparator sorts a screen with NO `order` after
 * EVERY screen that has one, regardless of that one's number (see its
 * `ordered()`, and `layout.test.tsx`'s "a screen with no order sorts after
 * every screen that has one"). Leaving `composition` unordered while giving
 * `preview` any number at all would therefore have put `preview` FIRST —
 * the opposite of "after composition" — so composition's own `order: 0` is
 * part of making that true, not an unrelated tidy-up.
 */
export function App({ ctx }: { ctx: Context }) {
  useEffect(() => {
    return ctx.layout.screen(
      { id: 'composition', title: 'Состав', order: 0 },
      CompositionScreenEntry,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.layout.screen({ id: 'preview', title: 'Превью', order: 1 }, PreviewWall);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.layout.screen({ id: 'assets', title: 'Ассеты', order: 2 }, AssetsScreen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  return <Layout ctx={ctx} />;
}
