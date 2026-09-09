import { useEffect } from 'react';
import type { Context } from 'cordis';
import {
  CompositionScreen,
  DiagnosticsPanel,
  Layout,
  useEditorDiagnostics,
  useGameComposition,
  useGameDiagnostics,
} from '@energy8engine/ide-client';

/**
 * The `composition.card` contribution that puts `DiagnosticsPanel` on
 * screen — an ordinary slot card, the same mechanism a plugin's own client
 * half would use (`ctx.slots.register` + `useSlot`, already rendered by
 * `CompositionScreen`'s `EditorComposition`), not a new branch added to
 * that screen's own JSX. Registered with no props (a `composition.card`
 * entry is rendered as `<card.component />`, see `CompositionScreen.tsx`),
 * so it reads everything it needs itself, reactively, via the same hooks
 * `App` below already uses — reading `ctx.gameComposition`/
 * `ctx.gameDiagnostics` once at registration time and closing over the
 * result would go stale the moment either service updates after the
 * initial fetch/frame.
 */
function DiagnosticsPanelCard({ ctx }: { ctx: Context }) {
  const { diagnostics: project } = useGameComposition(ctx);
  const { groups: game, dropped } = useGameDiagnostics(ctx);
  // The third namespace — the EDITOR's own plugin graph. Rendered as rows
  // now, the same as `project`'s and `game`'s: `CompositionScreen` no
  // longer keeps a separate copy of its own.
  const editor = useEditorDiagnostics(ctx);
  return (
    <DiagnosticsPanel project={project} game={game} droppedFromGame={dropped} editor={editor} />
  );
}

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
 * The app shell. Registers the composition screen and draws `<Layout/>` —
 * it does not render a screen itself, and does not know how many are
 * registered; a second screen is another `ctx.layout.screen` call away,
 * made by whichever plugin owns it, not by another edit here. Before this,
 * `App` rendered `CompositionScreen` directly, which made it the one place
 * a second screen would have had to be wired in by hand.
 *
 * The PROJECT's own diagnostics (`CompositionScreenEntry`'s own
 * `useGameComposition` fetch) and the GAME's own (`ctx.gameDiagnostics`)
 * do NOT go to `CompositionScreen` at all — they reach the screen only via
 * the slot registration below. `DiagnosticsPanel` is the one place they
 * sit together, each row marked which side it came from (see
 * `CompositionScreen.tsx`'s own comment on `GameComposition` for why a
 * second, standalone copy of the project half used to live there and does
 * not anymore).
 */
export function App({ ctx }: { ctx: Context }) {
  useEffect(() => {
    return ctx.slots.register({ name: 'composition.card', key: 'diagnostics' }, () => (
      <DiagnosticsPanelCard ctx={ctx} />
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    return ctx.layout.screen({ id: 'composition', title: 'Состав' }, CompositionScreenEntry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  return <Layout ctx={ctx} />;
}
