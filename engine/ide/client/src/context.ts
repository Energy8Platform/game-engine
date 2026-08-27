import { Context } from 'cordis';
import * as connection from './plugins/connection';
import type { ConnectionConfig } from './plugins/connection';
import * as slots from './plugins/slots';

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
export async function createIdeClient(config: ConnectionConfig): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(connection, config);
  await ctx.plugin(slots);
  return ctx;
}
