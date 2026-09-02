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
   * same stage replaces the earlier one.
   *
   * Binding to an id nobody has registered **yet** is not a failure, and
   * is not reported as one: registration order across a composition is
   * not knowable from inside this call. A third-party row that registers
   * its mechanic from a `ctx.inject(['mechanics'], …)` callback lands
   * AFTER the row that binds the stage to it, and the binding resolves
   * the moment it does — `forStage` returns `null` until then and the
   * real mechanic afterwards. Reporting that as an error at bind time
   * (which this used to do) made a working third-party mechanic read as
   * broken, and painted a failure screen over a game that was fine.
   *
   * The complaint belongs where the answer is unambiguous: `check`, which
   * runs against real stage data before anything is presented and knows
   * by then whether the binding ever resolved.
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

/**
 * No settings. The shared `diagnostics` array this used to carry is gone
 * with the bind-time complaint that was the only thing pushing onto it —
 * see `bind`'s doc comment. Kept as a named type because it is part of
 * this plugin's published shape.
 */
export interface MechanicsConfig {}

declare module 'cordis' {
  interface Context {
    mechanics: MechanicsService;
  }
}

export const name = 'mechanics';

export function apply(ctx: Context, _config: MechanicsConfig = {}) {
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
      // No check that `mechanicId` is registered — see this method's doc
      // on the interface above for why that check was a guess about
      // composition order rather than a fact about the binding.
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
        // Two different situations, and a person debugging needs them
        // apart: nothing was ever bound to this stage, or something was
        // bound to an id that never registered (a typo in a patch row,
        // most likely). This is where "never registered" becomes a fact
        // rather than a guess — the composition is long since applied and
        // real stage data is being presented right now.
        const boundTo = bindings.get(stage);
        return [
          boundTo === undefined
            ? diagnostic(
                'error',
                stage,
                stage,
                `cannot check stage "${stage}": nothing is bound to it`,
                `bind "${stage}" to a registered mechanic before checking its data`,
              )
            : diagnostic(
                'error',
                boundTo,
                stage,
                `stage "${stage}" is bound to mechanic "${boundTo}", but no mechanic with that id ever registered`,
                `register a mechanic with id "${boundTo}", or bind "${stage}" to one that is registered`,
              ),
        ];
      }
      return checkShape(mechanic.requires, sample, mechanic.id, stage);
    },
  };

  ctx.provide('mechanics', service);
}
