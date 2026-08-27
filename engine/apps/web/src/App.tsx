import type { Context } from 'cordis';
import { CompositionScreen } from '@energy8engine/ide-client';

/**
 * The app shell. A single screen today (`CompositionScreen`, the only one
 * this plan builds) — kept as its own component, separate from the
 * bootstrap in `main.tsx`, so a later screen or a router has somewhere to
 * go without main.tsx growing UI concerns.
 */
export function App({ ctx }: { ctx: Context }) {
  return <CompositionScreen ctx={ctx} />;
}
