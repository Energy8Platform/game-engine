/**
 * The per-stage mechanic registry.
 *
 * A mechanic is registered under an id, and a stage is bound to exactly one
 * mechanic id at a time (`bind` overwrites, it never accumulates). The
 * registered object is a `SpinMechanic` (`{ id, requires, present }`) from
 * `@energy8engine/contracts` — the exact shape `mechanic-classic` and
 * `mechanic-cascade` already bundle and export as `mechanic`, built for
 * this registry on purpose (see the doc comment on each package's
 * `mechanic` export, and Task 4's brief). Storing that type directly, and
 * not some renamed local shape, is what lets Tasks 7 and 9 hand those
 * exports straight to `register()` with no adapter in between.
 *
 * The rule that shapes every method here: failures are data. A stage bound
 * to an unregistered mechanic, or data checked against a mechanic whose
 * requirements it doesn't meet, produces a `Diagnostic` — never an
 * exception, and never a silent fallback to "whichever mechanic happens to
 * be registered first."
 */
import type { Context } from 'cordis';
import {
  checkShape,
  diagnostic,
  type Diagnostic,
  type SpinMechanic,
} from '@energy8engine/contracts';

export interface MechanicsService {
  /** Registers a mechanic under its id. Returns a disposer that unregisters it again. */
  register(mechanic: SpinMechanic): () => void;
  /**
   * Binds `stage` to the mechanic named `mechanicId`. A later call for the
   * same stage replaces the earlier one. Binding to an id nobody has
   * registered (yet, or ever) is not an error thrown here — it is recorded
   * as a `Diagnostic` on the game, and `forStage` simply keeps returning
   * `null` for that stage until a matching mechanic registers.
   */
  bind(stage: string, mechanicId: string): void;
  /** The mechanic currently bound to `stage`, or `null` if none is (or its registration is gone). */
  forStage(stage: string): SpinMechanic | null;
  /**
   * Checks `sample` against the shape the stage's bound mechanic declares
   * it needs. A thin wrapper over `checkShape` from the contracts package —
   * this registry does not implement a second shape checker.
   */
  check(stage: string, sample: Record<string, unknown>): Diagnostic[];
}

export interface MechanicsConfig {
  /** Shared with the owning `GameApp`; diagnostics pushed here surface as `game.diagnostics`. */
  diagnostics: Diagnostic[];
}

declare module 'cordis' {
  interface Context {
    mechanics: MechanicsService;
  }
}

export const name = 'mechanics';

export function apply(ctx: Context, config: MechanicsConfig) {
  const mechanics = new Map<string, SpinMechanic>();
  const bindings = new Map<string, string>();

  const service: MechanicsService = {
    register(mechanic) {
      const dispose = ctx.effect(() => {
        mechanics.set(mechanic.id, mechanic);
        return () => {
          // Only remove the entry if it's still *this* registration — an
          // earlier registration's disposer must not delete a later one
          // that re-registered the same id in the meantime.
          if (mechanics.get(mechanic.id) === mechanic) {
            mechanics.delete(mechanic.id);
          }
        };
      }, `mechanic:${mechanic.id}`);
      return () => {
        dispose();
      };
    },

    bind(stage, mechanicId) {
      if (!mechanics.has(mechanicId)) {
        config.diagnostics.push(
          diagnostic(
            'error',
            mechanicId,
            stage,
            `stage "${stage}" is bound to mechanic "${mechanicId}", but no mechanic with that id is registered`,
            `register a mechanic with id "${mechanicId}", or bind "${stage}" to one that is already registered`,
          ),
        );
      }
      ctx.effect(() => {
        bindings.set(stage, mechanicId);
        return () => {
          // Same identity-guard shape as `register`'s, but currently
          // unreachable: `bind` returns void, exposes no disposer, and the
          // only thing that ever tears this effect down is the whole
          // context disposing in `stop()` — after which nothing reads
          // `bindings` again. Kept for parity, not because a test needs it.
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
}
