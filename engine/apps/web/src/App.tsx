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
 * Two halves reach the screen from two different places, which is the
 * point of it taking them as separate props: the EDITOR's own plugin
 * graph off `ctx` (live, over the `/ide` socket), and the GAME's resolved
 * composition off `ctx.gameComposition` (fetched once from
 * `/api/composition` — see `game-composition.tsx`).
 *
 * `diagnostics` from that same fetch are the PROJECT's — the host's own
 * complaints about resolving those rows. They go in under the name that
 * says so. They are not a running game's diagnostics; nothing forwards
 * those here (see `GameCompositionProps.projectDiagnostics`).
 *
 * A THIRD source joins on screen via the slot registration below rather
 * than a third prop here: `ctx.gameDiagnostics` (task 7) — what a live,
 * running game itself has reported over the `/ide` socket, forwarded by
 * `ide-bridge` and relayed by the host. `DiagnosticsPanel` is where that
 * and the project's own diagnostics finally sit on one screen, each row
 * marked which side it came from.
 */
export function App({ ctx }: { ctx: Context }) {
  const { rows, diagnostics } = useGameComposition(ctx);

  useEffect(() => {
    return ctx.slots.register({ name: 'composition.card', key: 'diagnostics' }, () => (
      <DiagnosticsPanelCard ctx={ctx} />
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  return <CompositionScreen ctx={ctx} rows={rows ?? undefined} projectDiagnostics={diagnostics} />;
}
