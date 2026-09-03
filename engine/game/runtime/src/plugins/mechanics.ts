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
  type FieldKind,
  type FieldType,
  type SpinMechanic,
  type SpinSchema,
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
  /**
   * Every stage currently bound to a mechanic that has actually
   * registered, keyed by stage — the exact shape `checkAgainstSchema`
   * takes as its second argument. A stage bound to an id nobody has
   * registered YET (see `bind`'s doc above) is omitted here, not reported
   * as `null`: that absence is not a failure at this point, and
   * `checkAgainstSchema` has no slot for "maybe".
   */
  bindings(): Record<string, SpinMechanic>;
}

declare module 'cordis' {
  interface Context {
    mechanics: MechanicsService;
  }
}

export const name = 'mechanics';

/**
 * No settings, and no config parameter to hold them. There was an empty
 * `MechanicsConfig` here, exported from the package index, with no
 * producer and no reader — the shared `diagnostics` array it used to carry
 * went with the bind-time complaint that was the only thing pushing onto
 * it (see `bind`). An empty interface is not a published shape, it is a
 * name; cordis passes a config argument this plugin simply ignores.
 */
export function apply(ctx: Context) {
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

    bindings() {
      const result: Record<string, SpinMechanic> = {};
      for (const [stage, mechanicId] of bindings) {
        const mechanic = mechanics.get(mechanicId);
        // A stage bound to an id nobody has registered yet is not this
        // method's to report — see `bind`'s doc — so it's left out rather
        // than filled in with a guess.
        if (mechanic) result[stage] = mechanic;
      }
      return result;
    },
  };

  ctx.provide('mechanics', service);
}

/**
 * Unwraps `optional`, whose presence or absence a `FieldKind` requirement
 * never distinguishes — a mechanic that needs a field either gets it or
 * doesn't, and a math author marking a field `T?` does not itself say
 * whether the mechanic tolerates it missing.
 */
function unwrapOptional(type: FieldType): FieldType {
  return type.kind === 'optional' ? unwrapOptional(type.of) : type;
}

/**
 * Does a schema field's declared `FieldType` satisfy a mechanic's
 * `FieldKind` requirement? Mirrors `matchesKind` above (which checks a
 * requirement against a measured VALUE) but against a declared TYPE
 * instead — the two are kept separate rather than unified behind one
 * function, since a value and a type are different things to pattern
 * match on, and forcing them through one signature would only make both
 * harder to read.
 *
 * `grid` requires two levels of list/array nesting (`[[int]]`, the shape
 * `spin-parser` derives for a `grid: [[int]]` field) — a plain `list`
 * doesn't qualify, and neither does a `list` of anything that isn't
 * itself a list/array.
 */
function matchesFieldKind(kind: FieldKind, type: FieldType): boolean {
  const declared = unwrapOptional(type);
  switch (kind) {
    case 'number':
      return declared.kind === 'int' || declared.kind === 'float';
    case 'list':
      return declared.kind === 'list' || declared.kind === 'array';
    case 'grid': {
      if (declared.kind !== 'list' && declared.kind !== 'array') return false;
      const inner = unwrapOptional(declared.of);
      return inner.kind === 'list' || inner.kind === 'array';
    }
  }
}

/** A short, human-readable name for a declared `FieldType`, for a mismatch diagnostic's message. */
function describeFieldType(type: FieldType): string {
  switch (type.kind) {
    case 'int':
      return 'an int';
    case 'float':
      return 'a float';
    case 'bool':
      return 'a bool';
    case 'str':
      return 'a str';
    case 'list':
      return `a list of ${describeFieldType(type.of)}`;
    case 'array':
      return `a ${type.length}-element array of ${describeFieldType(type.of)}`;
    case 'record':
      return `a record "${type.name}"`;
    case 'optional':
      return `optionally ${describeFieldType(type.of)}`;
  }
}

/**
 * §7.1's pre-flight: checks every BOUND mechanic's `requires` against the
 * math's own declared `SpinSchema`, before any spin has run — as opposed
 * to `checkShape`/`MechanicsService.check` above, which check a mechanic's
 * `requires` against a SAMPLE of real spin data, necessarily after one.
 * Both are correct and both stay: this one catches a mismatch the moment
 * a project composes an incompatible mechanic onto a stage; that one
 * catches whatever this one structurally cannot (see `FieldKind`'s doc in
 * `@energy8engine/contracts` — a `list` field only proves "is an array",
 * so a game that never actually produces the field on some codepaths
 * still needs a real sample to catch).
 *
 * `schema: null` — a project whose `.spin` failed to parse, or has none —
 * performs NO check and reports NOTHING. The project's own diagnostic
 * (from `@energy8engine/spin-parser`, surfaced by the IDE host's
 * `ctx.spinSchema`) already says the `.spin` is broken; inventing a
 * second complaint here, about a mechanic that cannot be judged without
 * the very schema that failed to parse, would report the same root cause
 * twice.
 *
 * **The flat-dialect caveat, inherited, not introduced here.** Under
 * SpinML's flat `data = <Record>` dialect (five of the eight real `.spin`
 * files in this repo — see `SpinSchema.stages`'s own doc comment) every
 * stage's entry in `schema.stages` is the exact same `RecordShape` — the
 * source file itself declares only one record for every stage, so this
 * function is handed the same shape for all of them and has no way to
 * recover which stage a field is "really" on. What that means in
 * practice: a field present ANYWHERE in the flat record reads as present
 * on every stage, so a diagnostic can go silent that a tagged-enum `.spin`
 * (where each stage has its own declared shape) would have caught. This
 * function does not paper over that — it stays literally true either way
 * ("the schema for stage X does/doesn't have field Y"), it just cannot
 * promise the field is EXCLUSIVE to the stage a message names. What it
 * must not do, and does not do, is phrase a message as though the field
 * were confirmed specific to that one stage — see the messages below,
 * which say only that the named stage's schema does or doesn't carry the
 * field, never that it carries it uniquely.
 */
export function checkAgainstSchema(
  schema: SpinSchema | null,
  bindings: Record<string, SpinMechanic>,
): Diagnostic[] {
  if (schema === null) return [];

  const diagnostics: Diagnostic[] = [];
  const stageNames = Object.keys(schema.stages);

  for (const [stage, mechanic] of Object.entries(bindings)) {
    const stageShape = schema.stages[stage];
    if (!stageShape) {
      diagnostics.push(
        diagnostic(
          'error',
          mechanic.id,
          stage,
          `mechanic "${mechanic.id}" is bound to stage "${stage}", but the math's schema does not declare that stage — it declares: ${
            stageNames.length > 0 ? stageNames.join(', ') : '(none)'
          }`,
          `bind "${stage}" to a mechanic meant for a declared stage, or add "${stage}" to the math`,
        ),
      );
      continue;
    }

    for (const [field, kind] of Object.entries(mechanic.requires.fields)) {
      const fieldType = stageShape[field];
      if (!fieldType) {
        diagnostics.push(
          diagnostic(
            'error',
            mechanic.id,
            stage,
            `mechanic "${mechanic.id}" on stage "${stage}" expects field "${field}" (${kind}), but the math's schema does not declare it`,
            `add "${field}" to the "${stage}" stage's data in .spin, or bind "${stage}" to a mechanic that does not need it`,
          ),
        );
        continue;
      }
      if (!matchesFieldKind(kind, fieldType)) {
        diagnostics.push(
          diagnostic(
            'error',
            mechanic.id,
            stage,
            `mechanic "${mechanic.id}" on stage "${stage}" expects field "${field}" to be a ${kind}, but the math's schema types it as ${describeFieldType(fieldType)}`,
            `fix the type of "${field}" in .spin, or bind "${stage}" to a different mechanic`,
          ),
        );
      }
    }
  }

  return diagnostics;
}
