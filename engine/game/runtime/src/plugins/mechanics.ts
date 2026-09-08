/**
 * The per-stage mechanic registry.
 *
 * A mechanic is registered under an id, and a stage is bound to exactly one
 * mechanic id at a time (`bind` overwrites, it never accumulates).
 * The stored type is `AnySpinMechanic` — `SpinMechanic<{ kind: string }>`,
 * the widest form — because a registry holds mechanics it did not write and
 * cannot name their step types. A mechanic authored as `SpinMechanic` (the
 * six built-in kinds, e.g. `classic`) or as `SpinMechanic<MyStep>` (a
 * plugin's, e.g. `reel-step`) widens into it on the way in, with no cast at
 * this seam in either direction. See `AnySpinMechanic`'s own doc for why
 * that widest form is a storage type and never an authoring one.
 *
 * The registered object is a `SpinMechanic` (`{ id, requires, present }`) from
 * `@energy8engine/contracts` — the exact shape `mechanic-classic` and
 * `mechanic-cascade` already bundle and export as `mechanic`, built for
 * this registry on purpose (see the doc comment on each package's
 * `mechanic` export, and Task 4's brief). Storing that type directly, and
 * not some renamed local shape, is what lets Tasks 7 and 9 hand those
 * exports straight to `register()` with no adapter in between.
 *
 * The rule that shapes every method here: failures are data. A stage bound
 * to an unregistered mechanic, data checked against a mechanic whose
 * requirements it doesn't meet, or two rows claiming one mechanic id, each
 * produces a `Diagnostic` — never an exception, and never a silent guess
 * about which mechanic was meant.
 */
import type { Context } from 'cordis';
import {
  type AnySpinMechanic,
  checkShape,
  diagnostic,
  type Diagnostic,
  type FieldKind,
  type FieldType,
  type PresentationStep,
  type SchemaGap,
  type SpinSchema,
} from '@energy8engine/contracts';

export interface MechanicsService {
  /**
   * Registers a mechanic under its id, IF no mechanic holds that id
   * already. Returns a disposer that unregisters it again.
   *
   * **An id already taken is a collision, and the incumbent keeps it.**
   * This used to be `mechanics.set(mechanic.id, mechanic)` — last writer
   * wins, no complaint — which meant any plugin could shadow the built-in
   * `classic` or `cascade` just by reusing its id, and the game would
   * present with something other than what the composition reads like,
   * with nothing on screen to say so. The asymmetry that made this worth
   * finding: `@energy8engine/play-loop`'s step registry took real care to
   * stop a plugin shadowing a built-in STEP, while the mechanic id right
   * next to it could be taken in silence.
   *
   * First wins — the same rule, chosen for the same three reasons, as
   * `BoardStepRegistry.register` (see its doc in
   * `@energy8engine/play-loop`, which states them in full): it matches
   * the precedence `executePlan` already applies, it matches
   * `spin-parser`'s `NamedCollection`, and last-wins would make the
   * winner depend on a composition order the project author does not
   * directly control.
   *
   * A row that WANTS to replace a mechanic disposes the incumbent's
   * registration first, or registers under an id of its own and binds the
   * stage to that.
   *
   * The refused registration's disposer is a no-op: it never held the id,
   * so it has nothing to give back — and were it to delete the entry it
   * would take the WINNER out with it.
   */
  register(mechanic: AnySpinMechanic): () => void;
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
  forStage(stage: string): AnySpinMechanic | null;
  /**
   * Checks `sample` against the shape the stage's bound mechanic declares
   * it needs. A thin wrapper over `checkShape` from the contracts package —
   * this registry does not implement a second shape checker.
   */
  check(stage: string, sample: Record<string, unknown>): Diagnostic[];
  /**
   * Checks `data` against the stage's bound mechanic and, only if it
   * passes, asks that mechanic for a presentation plan. Returns both —
   * never throws, whatever the mechanic does.
   *
   * **Why the engine owns this call.** `mechanic.present(data)` was the
   * last third-party call in the system outside "failures are data": its
   * only call site was a game's own page, unguarded, so a plugin mechanic
   * whose `present` threw produced a JS exception instead of a
   * `Diagnostic` — and, on a page whose entry is a module-top-level
   * `await`, a blank screen. `requires` cannot close that: it says a
   * field is a list, never what the list contains, and nothing at all
   * about the code that reads it.
   *
   * **Why the two steps are one call and not two.** Every game that
   * presents a stage has to `check` first and stop if it fails. That was
   * a habit each page re-invented, in the right order by luck rather than
   * by construction — and a page that got it wrong handed unchecked data
   * to a mechanic that had declared it could not read it. Here the order
   * is the method.
   *
   * A failure of any kind — nothing bound to the stage, data the mechanic
   * cannot read, a `present` that threw, a `present` that returned
   * something that is not a plan — yields an empty `plan` alongside the
   * diagnostics. Empty rather than partial: half a presentation of a spin
   * is not a spin presented worse, it is a board left in a state no
   * mechanic claims.
   *
   * `plan` is deliberately `PresentationStep[]` — the wide type — because
   * that is what `executePlan` takes, and what a plugin mechanic's own
   * step widens into. Each element is validated by `executePlan` itself,
   * step by step; this method only guarantees that what comes back is a
   * plan-shaped ARRAY, which is the one thing `executePlan` reads before
   * any of its own guards run.
   */
  present(
    stage: string,
    data: Record<string, unknown>,
  ): { plan: PresentationStep[]; diagnostics: Diagnostic[] };
  /**
   * Every stage currently bound to a mechanic that has actually
   * registered, keyed by stage — the exact shape `checkAgainstSchema`
   * takes as its second argument. A stage bound to an id nobody has
   * registered YET (see `bind`'s doc above) is omitted here, not reported
   * as `null`: that absence is not a failure at this point, and
   * `checkAgainstSchema` has no slot for "maybe".
   */
  bindings(): Record<string, AnySpinMechanic>;
  /**
   * Every collision `register` has refused, in the order they happened.
   * Cumulative and idempotent — reading it does not clear it.
   *
   * Separate from `register`'s return value because that return value is
   * a disposer and every caller in the repo passes it straight to
   * `ctx.effect`. `createGame` merges this into the game's diagnostics
   * once the composition has finished applying — the same array the
   * failure screen and the IDE's panel already read, and the moment when
   * every row that was going to register has.
   */
  collisions(): Diagnostic[];
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
  const mechanics = new Map<string, AnySpinMechanic>();
  const bindings = new Map<string, string>();
  const collisions: Diagnostic[] = [];

  const service: MechanicsService = {
    register(mechanic) {
      if (mechanics.has(mechanic.id)) {
        collisions.push(
          diagnostic(
            'error',
            mechanic.id,
            'mechanics.register',
            `two mechanics claim id "${mechanic.id}": the one already registered keeps it, this one is ignored`,
            `give one of them an id of its own and bind the stage to that, or unregister the first before registering the second — a mechanic id names exactly one mechanic`,
          ),
        );
        // No `ctx.effect` and no eviction — see `register`'s doc.
        return () => {};
      }
      const dispose = ctx.effect(() => {
        mechanics.set(mechanic.id, mechanic);
        return () => {
          // Only remove the entry if it's still *this* registration. A
          // stale disposer — one whose registration was already disposed,
          // and whose id another row then took — must not evict the
          // replacement.
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

    present(stage, data) {
      // The check comes first and its failure is terminal — see this
      // method's doc on the interface above. `check` already reports both
      // "nothing is bound" and "bound to an id nobody registered", so
      // there is no second lookup to make here when it comes back empty:
      // a clean check means `forStage` has a mechanic.
      const problems = service.check(stage, data);
      if (problems.length > 0) return { plan: [], diagnostics: problems };

      const mechanic = service.forStage(stage)!;
      let plan: unknown;
      try {
        plan = mechanic.present(data);
      } catch (error) {
        return {
          plan: [],
          diagnostics: [
            diagnostic(
              'error',
              mechanic.id,
              stage,
              `mechanic "${mechanic.id}" threw while presenting stage "${stage}": ${
                error instanceof Error ? error.message : String(error)
              }`,
              `fix "${mechanic.id}"'s present(), or bind "${stage}" to a mechanic that can read this data`,
            ),
          ],
        };
      }

      // `executePlan` reads `plan.length` before any of its own guards
      // run, so a non-array reaches it as a TypeError — or, for a plain
      // object, as a plan that silently runs no steps at all. Neither is
      // a failure it can report, so it is reported here.
      if (!Array.isArray(plan)) {
        return {
          plan: [],
          diagnostics: [
            diagnostic(
              'error',
              mechanic.id,
              stage,
              `mechanic "${mechanic.id}" did not return a plan for stage "${stage}": present() gave ${
                plan === null ? 'null' : typeof plan
              }, not an array of steps`,
              `have "${mechanic.id}"'s present() return an array of presentation steps`,
            ),
          ],
        };
      }

      // Each STEP is validated by `executePlan`, step by step, and
      // deliberately not again here: it reports a malformed step against
      // its position in the plan (`plan[3]`), which is the address a
      // person debugging one actually needs.
      return { plan: plan as PresentationStep[], diagnostics: [] };
    },

    bindings() {
      const result: Record<string, AnySpinMechanic> = {};
      for (const [stage, mechanicId] of bindings) {
        const mechanic = mechanics.get(mechanicId);
        // A stage bound to an id nobody has registered yet is not this
        // method's to report — see `bind`'s doc — so it's left out rather
        // than filled in with a guess.
        if (mechanic) result[stage] = mechanic;
      }
      return result;
    },

    collisions() {
      return [...collisions];
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
 * `grid` requires two levels of list/array nesting with a numeric leaf
 * (`[[int]]` or `[[float]]`, the shape `spin-parser` derives for a
 * `grid: [[int]]` field) — a plain `list` doesn't qualify, neither does a
 * `list` of anything that isn't itself a list/array, and neither does a
 * correctly-nested `list` whose innermost element isn't `int`/`float`
 * (`grid: [[str]]`, say). That last leg mirrors `isGrid` above, the
 * VALUE-level equivalent of this check: `isGrid` requires every leaf cell
 * to satisfy `isFiniteNumber`, so a schema that let a non-numeric leaf
 * through here would pass the pre-flight check in this file and then
 * permanently fail `checkShape`'s post-spin one on the very first sample —
 * a gap between the two checks with no game that could ever close it.
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
      if (inner.kind !== 'list' && inner.kind !== 'array') return false;
      const leaf = unwrapOptional(inner.of);
      return leaf.kind === 'int' || leaf.kind === 'float';
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
 * **They are NOT symmetric in consequence, and reading "both are correct
 * and both stay" as parity is the mistake to avoid.** This one runs
 * inside `createGame`, and its findings land in the `diagnostics` array
 * `createGame` checks for `severity: 'error'` — so a finding here PAINTS
 * THE FAILURE SCREEN OVER THE MOUNT and the game does not start. The
 * post-spin one runs from `MechanicsService.present`, and its findings go
 * back to whoever called it; in this repo that is `first-slot`'s page,
 * which writes them into a `<pre>` it happens to have. A different game
 * with no log element shows nothing at all for the same mistake.
 *
 * So: same mistake, two checks, and one of them stops the game while the
 * other may be invisible. That asymmetry is a property of WHERE each
 * check's output goes, not of what either check knows, and neither is
 * wrong — but a maintainer weakening or strengthening one of them should
 * know which one they are holding.
 *
 * **This means the same mistake can legitimately reach the SAME failure
 * screen twice** — once from this function on page load (the schema says
 * the field isn't there), and again from `checkShape`/`check` above once
 * the developer clicks Spin (the actual sample doesn't have it either).
 * That is deliberate, not a bug in either check: they answer different
 * questions at different moments, and collapsing them would trade a real
 * guarantee for a tidier screen. The two messages below that this can
 * duplicate (missing field, wrong kind) say so in their own text — see
 * the `— checked …` clause each carries — so a person reading only the
 * screen, not this comment, has the same explanation `checkAgainstSchema`
 * gives a person reading the source. The third case (an unknown stage)
 * has no post-spin counterpart — `checkShape` never learns a stage name,
 * only `MechanicsService.check` does, and that reports a DIFFERENT
 * failure ("nothing is bound") — so its message carries no such clause.
 *
 * `schema: null` — a project whose `.spin` failed to parse, or has none —
 * performs NO check and reports NOTHING. The project's own diagnostic
 * (from `@energy8engine/spin-parser`, surfaced by the IDE host's
 * `ctx.spinSchema`) already says the `.spin` is broken; inventing a
 * second complaint here, about a mechanic that cannot be judged without
 * the very schema that failed to parse, would report the same root cause
 * twice.
 *
 * **What a half-read schema costs this check, and why it goes quiet
 * rather than loud.** A `SpinSchema` is the shape a math file DECLARES;
 * what arrives here is the shape a parser managed to READ. Before
 * `SchemaGap` existed those were indistinguishable, so a missing brace or
 * an unreadable field type landing on a field a bound mechanic requires
 * produced the message "the math's schema does not declare it" about a
 * file that declares it perfectly well — measured against `first-slot`'s
 * own `.spin` with `lines: [LineWin]` cut to `lines:`. At `error`
 * severity, that false sentence painted the failure screen over a game
 * that would have played.
 *
 * So every finding below is first asked whether the schema's own `gaps`
 * cover the thing it is about, and dropped if they do. Dropped, not
 * downgraded: the parser has ALREADY reported the loss, in the words of
 * whoever actually saw it, and the IDE host forwards that report as a
 * warning. A second complaint from here would say the same thing worse —
 * the same reasoning `schema: null` above is decided by, applied to the
 * case where only part of the file was lost.
 *
 * The suppression is deliberately asymmetric, and only one of the three
 * findings needs it twice over:
 *
 *  - a stage the map does not have, and a field the stage's shape does
 *    not have, are both ABSENCES, and an absence is exactly what a
 *    dropped declaration produces. Both are suppressed by a covering gap.
 *  - a field present but of the WRONG KIND keeps full force always. The
 *    parser never turns a declaration into a differently-typed one: an
 *    unreadable type is dropped whole (`parseFieldType` returns null and
 *    the field never enters the shape), so no gap can be the cause of a
 *    mismatch, and staying silent about one would only hide a real error.
 *    This is the finding the rejected cheap fix — downgrade everything
 *    whenever any parser warning exists — got wrong.
 *
 * A cheaper alternative was prototyped and rejected on that evidence.
 * Do not reintroduce it.
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
  bindings: Record<string, AnySpinMechanic>,
): Diagnostic[] {
  if (schema === null) return [];

  const diagnostics: Diagnostic[] = [];
  const stageNames = Object.keys(schema.stages);

  for (const [stage, mechanic] of Object.entries(bindings)) {
    const stageShape = schema.stages[stage];
    if (!stageShape) {
      // The stage may be absent because the file does not declare it, or
      // because this reading lost the declaration. Only the second is a
      // thing to stay quiet about, and `gaps` is the only thing that can
      // tell them apart.
      if (coveredByGap(schema.gaps, stage, null)) continue;
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
        if (coveredByGap(schema.gaps, stage, field)) continue;
        diagnostics.push(
          diagnostic(
            'error',
            mechanic.id,
            stage,
            `mechanic "${mechanic.id}" on stage "${stage}" expects field "${field}" (${kind}), but the math's schema does not declare it — checked here against the declared schema, before any spin; the same requirement is checked again against real data once one runs`,
            `add "${field}" to the "${stage}" stage's data in .spin, or bind "${stage}" to a mechanic that does not need it`,
          ),
        );
        continue;
      }
      // No gap check here, and that is the point — see this function's doc.
      // A dropped declaration produces an ABSENT field, never a
      // wrong-typed one, so a mismatch is always a real error about a
      // field this reading did read.
      if (!matchesFieldKind(kind, fieldType)) {
        diagnostics.push(
          diagnostic(
            'error',
            mechanic.id,
            stage,
            `mechanic "${mechanic.id}" on stage "${stage}" expects field "${field}" to be a ${kind}, but the math's schema types it as ${describeFieldType(fieldType)} — checked here against the declared schema, before any spin; the same requirement is checked again against real data once one runs`,
            `fix the type of "${field}" in .spin, or bind "${stage}" to a different mechanic`,
          ),
        );
      }
    }
  }

  return diagnostics;
}

/**
 * Does the schema's record of its own partiality cover an absence at
 * `stage` (and, when named, `field`)?
 *
 * `null` in a gap is the WIDER claim, never the vaguer one — `name: null`
 * means the reading could not say which stages the file has at all, and
 * `field: null` means it could not say which field of that stage it lost
 * — so either matches everything at its level. See `SchemaGap`.
 *
 * `field: null` as an ARGUMENT asks the stage-level question ("could this
 * whole stage have been lost?"), which only a stage-level gap can answer.
 */
function coveredByGap(gaps: SchemaGap[], stage: string, field: string | null): boolean {
  return gaps.some(
    (gap) =>
      gap.in === 'stages' &&
      (gap.name === null || gap.name === stage) &&
      (gap.field === null || gap.field === field),
  );
}
