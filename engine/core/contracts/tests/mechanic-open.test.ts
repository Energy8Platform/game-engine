/**
 * `SpinMechanic` is open to a plugin's own step kind, and still closed to a
 * typo. Both halves matter and they pull against each other, so they are
 * pinned together, here, in one file.
 *
 * **These are COMPILE-TIME assertions.** `@ts-expect-error` fails the build
 * when the line under it compiles cleanly, so `npm run typecheck` is what
 * actually runs them — vitest does not typecheck, and the runtime `expect`s
 * at the bottom exist so this file is a legitimate test rather than a lie
 * about what it checks. If you are reading this because a "unused
 * '@ts-expect-error' directive" error pointed you here, the property that
 * error names has been LOST, not merely annotated wrongly.
 *
 * The history the two halves come from: task 7 opened `PresentationStep`
 * and `executePlan` to any kind but left `SpinMechanic.present` returning
 * the closed `PresentationPlan`, so the one interface a mechanic actually
 * implements could not emit the step the rest of the machinery had just
 * been opened for. A plugin had to cast. Widening `present` to the flat
 * `PresentationStep[]` would have fixed that and silently cost the other
 * half: an index-signature member absorbs an object literal the moment any
 * member fits, so `{ kind: 'spinTo', boardTYPO }` would have type-checked.
 * The type parameter is what lets both hold — a plugin names its OWN step
 * type, so its step matches precisely and nothing else gets a free pass.
 *
 * **Where the typo check actually lives, measured rather than assumed.**
 * TypeScript performs no excess-property check on an object literal
 * returned from a function whose return type it knows only from CONTEXT.
 * The four cases, each run:
 *
 *   - `const a: () => Ret = () => [{ …, TYPO: 1 }]`      — no check
 *   - `const c: { m(): Ret } = { m() { return […] } }`   — no check
 *   - `function b(): Ret { return [{ …, TYPO: 1 }] }`    — **TS2353**
 *   - `const d = (): Ret => [{ …, TYPO: 1 }]`            — **TS2353**
 *
 * So the line is not arrow-versus-function and not "returns are exempt": a
 * function that carries its OWN return annotation is checked, and one that
 * only inherits a contextual type is not. `present: (data) => plan(data)`
 * is the first kind of position; `export function plan(…): ReelStepPlan`
 * is the second, which is why `reel-step`'s steps are checked where it
 * writes them.
 *
 * That was true before this change too — `mechanic-classic`'s protection
 * has always come from the `const steps: PresentationPlan = [...]` inside
 * its own `plan()`, never from the `present` signature. The cases below are
 * therefore written the way a mechanic is actually written: a standalone
 * annotated function building into an annotated local.
 */
import { describe, expect, it } from 'vitest';
import type { AnySpinMechanic, SpinMechanic } from '../src/mechanic';
import type {
  KnownPresentationStep,
  PresentationPlan,
  PresentationStep,
} from '../src/presentation';

/**
 * A plugin's step, declared the way `StepHandler`'s doc prescribes: a plain
 * interface, no `extends UnknownPresentationStep`.
 */
interface ReelStepStep {
  kind: 'reelStep';
  shifts: number[];
  settled: number[][];
}

/** What a plugin's `present` returns: the six, plus this plugin's own one. */
type ReelStepPlan = (KnownPresentationStep | ReelStepStep)[];

const requires = { fields: {} };

/** Open: a plugin's own kind sits alongside the built-in ones, no cast anywhere. */
function pluginPlan(): ReelStepPlan {
  const steps: ReelStepPlan = [{ kind: 'spinTo', board: [[1]] }];
  steps.push({ kind: 'reelStep', shifts: [1], settled: [[1]] });
  return steps;
}

/** Closed: a mistyped BUILT-IN step is still an error, opened vocabulary or not. */
function mistypedBuiltIn(): ReelStepPlan {
  // @ts-expect-error `boardTYPO` is not `SpinToStep.board`, and the plugin's own member must not absorb it
  const steps: ReelStepPlan = [{ kind: 'spinTo', boardTYPO: [[1]] }];
  return steps;
}

/** Closed: a stray field on the plugin's OWN step too — the cost `extends UnknownPresentationStep` would have hidden. */
function strayFieldOnOwnStep(): ReelStepPlan {
  const steps: ReelStepPlan = [];
  // @ts-expect-error `shiftsTYPO` is excess on this plugin's own declared step
  steps.push({ kind: 'reelStep', shifts: [1], settled: [[1]], shiftsTYPO: [9] });
  return steps;
}

/** And `PresentationPlan` itself is unchanged: still exactly the six. */
function closedPlan(): PresentationPlan {
  const steps: PresentationPlan = [];
  // @ts-expect-error a plan built from the six known kinds cannot carry a plugin's
  steps.push({ kind: 'reelStep', shifts: [1], settled: [[1]] });
  return steps;
}

/** A plugin's mechanic types against its own step, with no cast at `present`. */
const plugin: SpinMechanic<ReelStepStep> = {
  id: 'reel-step',
  requires,
  present: pluginPlan,
};

/** With no type parameter the contract is exactly what it always was. */
const closedByDefault: SpinMechanic = {
  id: 'classic',
  requires,
  present: closedPlan,
};

/** Both forms are what a registry stores — no cast at the registration seam either. */
const stored: AnySpinMechanic[] = [plugin, closedByDefault];

/** And what a registry hands back is what `executePlan` takes, unchanged. */
const forExecute: PresentationStep[] = stored[0].present({});

/**
 * Why `AnySpinMechanic`'s `{ kind: string }` is a STORAGE type and never an
 * authoring one — the three facts its doc comment states, checked here so
 * the doc cannot drift from the compiler.
 *
 * The premise this replaces was backwards: it claimed `{ kind: string }`
 * carries an implicit index signature and would absorb a typo'd literal
 * "exactly the way `UnknownPresentationStep` does". It does the reverse. A
 * maintainer reasoning from the old sentence would have concluded the
 * widest storage type was dangerous for the wrong reason, and might have
 * "fixed" it by widening `TStep`'s constraint to `UnknownPresentationStep`
 * — which is the one change that WOULD lose the guarantee.
 */
type WidestStep = KnownPresentationStep | { kind: string };

/** 1. It REJECTS a typo'd built-in — the index signature is what absorbs, and it has none. */
// @ts-expect-error `boardTYPO` is excess against both members
const notAbsorbed: WidestStep[] = [{ kind: 'spinTo', boardTYPO: 1 }];

/** 2. It rejects a plugin's OWN fields too — too strict to author against, which is why `TStep` exists. */
// @ts-expect-error `shifts` does not exist in type '{ kind: string; }'
const tooStrictToAuthorAgainst: WidestStep[] = [{ kind: 'reelStep', shifts: [1] }];

/** 3. And an existing value widens into it with no excess-property check at all. */
const alreadyTyped: ReelStepStep = { kind: 'reelStep', shifts: [1], settled: [[1]] };
const widensCleanly: WidestStep = alreadyTyped;

describe('SpinMechanic — open to a plugin, closed to a typo', () => {
  it('a plugin mechanic emits its own step kind alongside the built-in ones', () => {
    expect(plugin.present({}).map((step) => step.kind)).toEqual(['spinTo', 'reelStep']);
    expect(forExecute).toHaveLength(2);
  });

  it('a mechanic that declares no extra kind is still assignable and still runs', () => {
    // `closedPlan`'s one push is the suppressed line — at RUNTIME it still
    // happens (a `@ts-expect-error` silences the compiler, not the code),
    // so this asserts what actually comes back rather than pretending the
    // type error removed it.
    expect(closedByDefault.present({}).map((step) => step.kind)).toEqual(['reelStep']);
  });

  it('the typo cases still produce the plan they were trying to produce', () => {
    // The compile-time half is the point; these run the same functions so a
    // reader can see the suppressed lines are real code, not dead branches.
    expect(mistypedBuiltIn()).toHaveLength(1);
    expect(strayFieldOnOwnStep()).toHaveLength(1);
    expect(stored).toHaveLength(2);
    expect(notAbsorbed).toHaveLength(1);
    expect(tooStrictToAuthorAgainst).toHaveLength(1);
    expect(widensCleanly).toBe(alreadyTyped);
  });
});
