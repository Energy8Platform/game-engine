import type { Context } from 'cordis';
import { CompositionScreen, useGameComposition } from '@energy8engine/ide-client';

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
 */
export function App({ ctx }: { ctx: Context }) {
  const { rows, diagnostics } = useGameComposition(ctx);
  return <CompositionScreen ctx={ctx} rows={rows ?? undefined} projectDiagnostics={diagnostics} />;
}
