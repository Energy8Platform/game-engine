/**
 * Runtime half of `@energy8engine/game-runtime` — the `mechanics1` row in
 * `e8-base`. Not the whole package: `./index.ts`'s `createGame` is the
 * host-side orchestrator Task 9 is retiring; this file is only the ONE
 * piece of `createGame`'s current body that is genuinely its own
 * standalone capability — the per-stage mechanic registry
 * (`engine/game/runtime/src/plugins/mechanics.ts`) plus registering the
 * two mechanics this package always ships (`classic`, `cascade`).
 *
 * See `@energy8engine/boot`'s `src/runtime.js` module doc for why this
 * file's bare imports (`@energy8engine/contracts`,
 * `@energy8engine/mechanic-classic`, `@energy8engine/mechanic-cascade`) do
 * not actually resolve yet over `GET /plugin-runtime/:id`.
 *
 * `config.stages` — stage id to mechanic id — is exactly what `main.ts`
 * passes today as `createGame({ stages: { base_game: mechanicSelect.value } })`.
 * That value has a clean home here: a plain string keyed by a plain
 * string, no function, no DOM handle. See `e8.patch.yml`'s `mechanics1`
 * row.
 */
import { checkShape, diagnostic } from '@energy8engine/contracts';
import { mechanic as classicMechanic } from '@energy8engine/mechanic-classic';
import { mechanic as cascadeMechanic } from '@energy8engine/mechanic-cascade';

export const name = 'mechanics';

/** `config` is `{ stages: Record<string, string> }` — stage id → mechanic id. */
export function apply(ctx, config) {
  const mechanics = new Map();
  const bindings = new Map();

  const service = {
    register(mechanic) {
      const dispose = ctx.effect(() => {
        mechanics.set(mechanic.id, mechanic);
        return () => {
          if (mechanics.get(mechanic.id) === mechanic) {
            mechanics.delete(mechanic.id);
          }
        };
      }, `mechanic:${mechanic.id}`);
      return () => dispose();
    },

    bind(stage, mechanicId) {
      if (!mechanics.has(mechanicId)) {
        throw new Error(
          `stage "${stage}" is bound to mechanic "${mechanicId}", but no mechanic with that id is registered`,
        );
      }
      ctx.effect(() => {
        bindings.set(stage, mechanicId);
        return () => {
          if (bindings.get(stage) === mechanicId) {
            bindings.delete(stage);
          }
        };
      }, `mechanic-binding:${stage}`);
    },

    forStage(stage) {
      const mechanicId = bindings.get(stage);
      if (!mechanicId) return null;
      return mechanics.get(mechanicId) ?? null;
    },

    check(stage, sample) {
      const mechanic = service.forStage(stage);
      if (!mechanic) {
        return [
          diagnostic(
            'error',
            stage,
            stage,
            `cannot check stage "${stage}": no registered mechanic is bound to it`,
            `bind "${stage}" to a registered mechanic before checking its data`,
          ),
        ];
      }
      return checkShape(mechanic.requires, sample, mechanic.id, stage);
    },
  };

  ctx.provide('mechanics', service);

  // Both mechanics this package ships are always registered; which stage
  // uses which is a config choice (`config.stages`), not a code choice —
  // same rule `createGame` followed before this row existed.
  service.register(classicMechanic);
  service.register(cascadeMechanic);
  for (const [stage, mechanicId] of Object.entries(config?.stages ?? {})) {
    service.bind(stage, mechanicId);
  }
}
