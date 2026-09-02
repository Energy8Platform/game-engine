/**
 * Runtime half of `@energy8engine/game-runtime` — the `mechanics1` row in
 * `e8-base`. Not the whole package: `./index.ts`'s `createGame` is the
 * host-side orchestrator Task 9 is retiring; this file is only the ONE
 * piece of `createGame`'s current body that is genuinely its own
 * standalone capability — the per-stage mechanic registry
 * (`./plugins/mechanics.ts`) plus registering the two mechanics this
 * package always ships.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this
 * is a real TypeScript module served through `dev-game`'s own vite
 * instance, not a hand-written, import-free twin — `@energy8engine/
 * mechanic-classic`/`mechanic-cascade` and `@energy8engine/contracts` all
 * resolve through it.
 *
 * Reuses `./plugins/mechanics.ts` directly (a plain function call, not
 * `ctx.plugin()` — same trick `dev-game.ts` uses for `session-dev`, see
 * its module doc: a plain call lets `mechanics.apply()`'s own
 * `ctx.provide('mechanics', ...)` land on THIS scope, which this file can
 * then read straight back) rather than re-deriving the registry's logic a
 * second time. That file's own `MechanicsConfig` wants a shared
 * `diagnostics` array (the pre-row-model convention); this row still
 * hands it a throwaway one and converts anything pushed onto it into a
 * thrown `Error`, so a bad `config.stages` entry becomes a row
 * `Diagnostic` through the loader's own catch, same contract every other
 * row in this bundle follows.
 */
import type { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import { mechanic as classicMechanic } from '@energy8engine/mechanic-classic';
import { mechanic as cascadeMechanic } from '@energy8engine/mechanic-cascade';
import * as mechanicsPlugin from './plugins/mechanics';

export const name = 'mechanics';

export interface MechanicsRowConfig {
  /** stage id → mechanic id, applied to the two mechanics this row always registers (`classic`, `cascade`). */
  stages?: Record<string, string>;
}

export function apply(ctx: Context, config: MechanicsRowConfig = {}): void {
  const diagnostics: Diagnostic[] = [];
  mechanicsPlugin.apply(ctx, { diagnostics });

  ctx.mechanics.register(classicMechanic);
  ctx.mechanics.register(cascadeMechanic);
  for (const [stage, mechanicId] of Object.entries(config.stages ?? {})) {
    ctx.mechanics.bind(stage, mechanicId);
  }

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map((d) => d.message).join('; '));
  }
}
