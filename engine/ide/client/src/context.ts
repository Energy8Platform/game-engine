import { Context } from 'cordis';
import * as connection from './plugins/connection';
import type { ConnectionConfig } from './plugins/connection';
import * as slots from './plugins/slots';
import * as layout from './plugins/layout';
import * as modules from './plugins/modules';
import type { ModulesConfig } from './plugins/modules';
import * as gameComposition from './plugins/game-composition';
import type { GameCompositionConfig } from './plugins/game-composition';
import * as gameDiagnostics from './plugins/diagnostics';
import * as files from './plugins/files';
import type { FilesConfig } from './plugins/files';
import * as check from './plugins/check';
import type { CheckConfig } from './plugins/check';

/**
 * Boot the browser-side cordis application.
 *
 * Async, not the synchronous shape a naive reading of "boot a context and
 * register a plugin" might suggest: `ctx.plugin()` returns a Fiber that
 * cordis advances through its lifecycle asynchronously, so a bare
 * `void ctx.plugin(...)` gives no guarantee the fiber has reached ACTIVE —
 * and therefore that `ctx.connection` or `ctx.slots` exists — by the time
 * this function would otherwise return. Awaiting each fiber here means
 * every caller gets a `Context` with both services already provided.
 */
export async function createIdeClient(
  config: ConnectionConfig & ModulesConfig & GameCompositionConfig & FilesConfig & CheckConfig,
): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(connection, config);
  await ctx.plugin(slots);
  // Screens are the same kind of contribution cards already are (a
  // registry a plugin's client half adds to, `App` merely draws) — see
  // `layout.tsx`'s own doc — so it composes alongside `slots` here, before
  // the plugins that fetch or forward data rather than just hold state.
  await ctx.plugin(layout);
  await ctx.plugin(modules, config);
  await ctx.plugin(gameComposition, config);
  // `GameDiagnosticsConfig` is `ConnectionConfig` by another name (see its
  // own doc) — no new field for this signature to carry, just another
  // plugin reading the same `url`/`socketFactory` this function's caller
  // already supplies.
  await ctx.plugin(gameDiagnostics, config);
  // A plain fetch wrapper like `gameComposition`, not something anything
  // else here depends on — composed last for no reason but that this is
  // where it was added.
  await ctx.plugin(files, config);
  // Same kind of plain fetch wrapper as `files`, nothing here depends on
  // it either — the editor two tasks from now is the first consumer.
  await ctx.plugin(check, config);
  return ctx;
}
