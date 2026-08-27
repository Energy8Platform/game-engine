import { Context } from 'cordis';
import * as connection from './plugins/connection';
import type { ConnectionConfig } from './plugins/connection';

/**
 * Boot the browser-side cordis application.
 *
 * Async, not the synchronous shape a naive reading of "boot a context and
 * register a plugin" might suggest: `ctx.plugin()` returns a Fiber that
 * cordis advances through its lifecycle asynchronously, so a bare
 * `void ctx.plugin(...)` gives no guarantee the fiber has reached ACTIVE —
 * and therefore that `ctx.connection` exists — by the time this function
 * would otherwise return. Awaiting the fiber here means every caller gets a
 * `Context` with `ctx.connection` already provided.
 */
export async function createIdeClient(config: ConnectionConfig): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(connection, config);
  return ctx;
}
