/**
 * The game runtime: a cordis application, exactly like the IDE host and the
 * IDE client. It currently hosts one plugin — the per-stage mechanic
 * registry — which is the knob the IDE composition screen turns to decide
 * which mechanic renders which stage's spin data.
 */
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import * as mechanics from './plugins/mechanics';

export type { Mechanic, MechanicsService, MechanicsConfig } from './plugins/mechanics';

/** Placeholder for future boot config (e.g. a composition source) — kept empty rather than invented ahead of need. */
export type GameConfig = Record<string, never>;

export interface GameApp {
  ctx: Context;
  /** Boot-time and runtime failures (e.g. a stage bound to an unregistered mechanic) that don't stop the game from running. */
  diagnostics: Diagnostic[];
  stop(): Promise<void>;
}

/**
 * Boots the game: a fresh cordis `Context` with the mechanic registry
 * installed. Async, not synchronous, for the same reason
 * `createIdeClient` is: `ctx.plugin()` returns a Fiber that cordis advances
 * asynchronously, so an un-awaited `ctx.plugin()` gives no guarantee
 * `ctx.mechanics` exists yet. Awaiting it here means every caller gets a
 * `GameApp` whose `ctx.mechanics` is already there.
 */
export async function createGame(config: GameConfig): Promise<GameApp> {
  const ctx = new Context();
  const diagnostics: Diagnostic[] = [];

  try {
    await ctx.plugin(mechanics, { diagnostics });

    return {
      ctx,
      diagnostics,
      stop: async () => {
        await ctx.fiber.dispose();
      },
    };
  } catch (error) {
    // A later boot step throwing must not leak whatever already got
    // registered on `ctx` — nothing external holds a reference to it yet.
    await ctx.fiber.dispose();
    throw error;
  }
}
