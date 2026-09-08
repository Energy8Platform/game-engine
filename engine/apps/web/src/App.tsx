import { useEffect } from 'react';
import type { Context } from 'cordis';
import {
  CompositionScreen,
  DiagnosticsPanel,
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
  const { diagnostics: game, dropped } = useGameDiagnostics(ctx);
  return <DiagnosticsPanel project={project} game={game} droppedFromGame={dropped} />;
}

/**
 * The app shell. A single screen today (`CompositionScreen`, the only one
 * this plan builds) — kept as its own component, separate from the
 * bootstrap in `main.tsx`, so a later screen or a router has somewhere to
 * go without main.tsx growing UI concerns.
 *
 * Two halves reach `CompositionScreen` from two different places, which is
 * the point of it taking them as separate props: the EDITOR's own plugin
 * graph off `ctx` (live, over the `/ide` socket), and the GAME's resolved
 * composition rows off `ctx.gameComposition` (fetched once from
 * `/api/composition` — see `game-composition.tsx`).
 *
 * The PROJECT's own diagnostics from that same fetch, and the GAME's own
 * (task 7's `ctx.gameDiagnostics`), do NOT go to `CompositionScreen` at
 * all — they reach the screen only via the slot registration below.
 * `DiagnosticsPanel` is the one place they sit together, each row marked
 * which side it came from (see `CompositionScreen.tsx`'s own comment on
 * `GameComposition` for why a second, standalone copy of the project half
 * used to live there and does not anymore).
 */
export function App({ ctx }: { ctx: Context }) {
  const { rows } = useGameComposition(ctx);

  useEffect(() => {
    return ctx.slots.register({ name: 'composition.card', key: 'diagnostics' }, () => (
      <DiagnosticsPanelCard ctx={ctx} />
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  return <CompositionScreen ctx={ctx} rows={rows ?? undefined} />;
}
