# @energy8engine/kernel

The plugin kernel for Energy8 games — points, contributions, schemas, resolution. It defines what
a plugin is, resolves a project's plugins into a plan, and activates their contributions lazily.
It has **zero dependencies** and knows nothing about renderers, slots, spins or the DOM: pure
functions over plain data, safe to run in the game, in the build, and in the IDE alike.

## Table of Contents

- [The model](#the-model)
- [Two rules](#two-rules)
- [Using it](#using-it)
- [Effective schema](#effective-schema)
- [Launch matching](#launch-matching)
- [Hooks](#hooks)
- [The never-throws contract](#the-never-throws-contract)
- [Public API](#public-api)
- [Tests](#tests)
- [License](#license)

## The model

A plugin **declares** rather than does. Its manifest is free of side effects, so the IDE, the
build and the agent can read the full composition of a game without starting it.

```ts
import { definePlugin } from '@energy8engine/kernel';

export default definePlugin({
  id: '@e8/reel-system',
  version: '1.0.0',
  engine: '^0.1.0',

  // A new extension point. The kernel owns no list of points — plugins open them.
  //
  // Field names to avoid: `enabled` collides with ContributionSettings.enabled, the structural
  // on/off switch project.json already puts on every contribution at this same key — the two would
  // do opposite, and opposingly silent, things (see "The enabled collision" below).
  points: {
    'reel.feature': {
      phase: 'runtime',
      arity: 'many',
      schema: { autoTrigger: { kind: 'boolean', default: true } },
      doc: 'A behaviour layered onto the reels.',
    },
  },

  // Contributions plug into a point — this plugin's own, or another's.
  contributes: {
    'reel.feature': [
      {
        id: 'expandingWild',
        schema: { holdSpins: { kind: 'number', default: 1, min: 1, max: 10 } },
        doc: 'A wild expands to fill its reel.',
        create: () => import('./features/expandingWild'),
      },
    ],
  },
});
```

Anyone can now add a fourteenth reel feature from their own plugin, without touching the engine.

## Two rules

1. **Schema is mandatory.** It is what lets the IDE render a settings form and what the agent
   reads as documentation. A contribution without one is not registered with any fields.
2. **What the IDE must configure lives in a contribution; what it merely needs to know about
   lives in a declared hook.** Hooks are opaque, so the list a bus accepts is closed and using
   one a plugin did not declare is refused.

## Using it

```ts
import { resolvePlan, activatePoint, toSnapshot, KERNEL_VERSION, hasErrors } from '@energy8engine/kernel';

const { plan, diagnostics } = resolvePlan({
  project,                       // parsed project.json: { plugins: { "@e8/reel-system": { version: "^1.0.0" } } }
  manifests,                     // the installed plugins' manifests, e.g. [reelSystemManifest]
  launch: { url: location.href, buildTarget: import.meta.env.BUILD_TARGET },
  kernelVersion: KERNEL_VERSION,
});

// Nothing threw. Errors arrived as data.
if (hasErrors(diagnostics)) showErrorScreen(diagnostics);

const { instances } = await activatePoint(plan, 'reel.feature');

// What the IDE and the agent read: the same plan, as plain JSON.
sendToIde(toSnapshot(plan));
```

`activatePoint` returns every *active* contribution to a point — the right shape for
`arity: 'many'`. For an `arity: 'one'` point (a shell, a session provider — exactly one candidate
should win), its sibling `activateOne` returns that single instance instead:

```ts
import { activateOne } from '@energy8engine/kernel';

const { instance, diagnostics } = await activateOne(plan, 'game.shell');
if (instance) mountShell(instance.value);
```

## Effective schema

A contribution's settings form is the **point's schema plus its own**, computed by `mergeSchemas`
inside `resolvePlan`. A contribution may add fields; it may not redefine one the point owns,
because the IDE would then render a control whose meaning changed depending on which contribution
is selected — that collision is reported as a `schema/field-conflict` diagnostic, not thrown.

**The `enabled` collision.** Do not name a schema field `enabled`. `ContributionSettings.enabled` is
the *structural* switch project.json already puts on every contribution (`{ "enabled": false }`,
sitting next to `settings`, not inside it) — a schema field of the same name lives one level deeper,
inside `settings`, and the two do opposite things without any error to say so: the structural flag
deactivates the whole contribution, while the schema field is just one more setting whose own default
is whatever the schema says. `checkManifestShape` reports a schema field named `enabled` as a
`manifest/enabled-collision` warning (not an error — the name is legal) precisely because the ambiguity
is real but not fatal; prefer a specific name instead (`autoTrigger`, `startsOn`, …).

## Launch matching

An `arity: 'one'` point picks its active contribution declaratively, via each candidate's
`activateWhen`, so the IDE can *show* when a session provider or boot overlay takes over instead
of reverse-engineering an opaque predicate:

```ts
import { matches, describeMatcher } from '@energy8engine/kernel';

const launch = { url: location.href, buildTarget: 'stake' };
matches({ buildTarget: 'stake' }, launch);              // true — every declared condition holds
describeMatcher({ buildTarget: 'stake' });               // 'when the build target is "stake"'
```

`match` is the escape hatch for rules `urlParam`/`buildTarget` cannot express. Because it is
caller-supplied code, `matches` takes an optional third argument — a diagnostics sink — so a
predicate that throws becomes a `match/predicate-threw` diagnostic instead of taking resolution
down with it:

```ts
import type { Diagnostic } from '@energy8engine/kernel';

const diagnostics: Diagnostic[] = [];
matches({ match: () => { throw new Error('unexpected shape'); } }, launch, diagnostics);
// matches() still returns `false` — and diagnostics[0] explains why (match/predicate-threw)
// instead of the throw taking resolution down with it
```

`resolvePlan` always passes this sink through, so a broken `match()` in a project's manifest
shows up as a normal diagnostic, not a stack trace.

## Hooks

A hook is a plugin's way to be notified without becoming IDE-configurable. Because hooks are
opaque (no schema, no form), the set a bus accepts is closed, and a plugin must declare the hooks
it uses in its manifest (`hooks: ['onSpinStart']`) before it may register a handler for one.

```ts
import { createHookBus, declaredFromPlan } from '@energy8engine/kernel';

// `plan.hooks` (hook id → the plugin ids that declared it) inverts into what createHookBus wants
// (plugin id → the hooks it declared) via declaredFromPlan.
const bus = createHookBus({
  ids: ['onSpinStart', 'onSpinEnd'],       // the closed list this bus accepts — supplied by the host
  declared: declaredFromPlan(plan.hooks),  // plugin id -> hooks it declared, derived from the plan
});

const refusal = bus.on('@e8/analytics', 'onSpinStart', (payload) => track('spin_start', payload));
if (refusal) console.warn(refusal.message); // e.g. hooks/undeclared, if the manifest never declared it

await bus.emit('onSpinStart', { betAmount: 1 });
```

## The never-throws contract

Every function here is total: malformed input becomes a `Diagnostic` (see `error`/`warning`/
`hasErrors`/`describeError`), never an exception or a rejected promise. A plugin manifest with a
typo, a settings object with the wrong shape, a factory that throws, a hook handler that throws —
each degrades to a diagnostic pointing at what and where, and everything *around* the failure
still runs. This is what lets a broken third-party contribution cost exactly itself, not the game.

The recursion this guarantee has to bound is capped rather than left to overflow the stack:
`MAX_SCHEMA_DEPTH` (32) for nested `object`/`list` schema fields, `MAX_HOOK_DEPTH` (16) for
synchronously re-entrant `emit()` calls. `isPlainObject`, `isUsableField` and `cloneValue` are the
shared guards that make the schema and manifest code paths safe against hostile shapes (`null`,
an array where an object was expected, a Proxy whose own `getPrototypeOf` trap throws); every
diagnostic message that has to describe an untrusted value — a caught exception, but just as often
a plain manifest field like a version or a hook id that turned out not to be a real string — goes
through the one total describer, `describeError`, rather than a bare `String()`. `String()` looks
total and is not: it throws for a null-prototype value and again for a value with a throwing
`Symbol.toStringTag` getter, so every one of those call sites is a real, if narrow, way for this
contract to be false. `describeError` is what actually is.

Two things are **deliberately** not covered, by design rather than by omission:

- **A factory that never settles stalls `activatePoint`.** Activation is sequential, on purpose —
  so that ordering guarantees hold (a shell activates before whatever depends on it existing) —
  and nothing here imposes a timeout no one asked for. A caller needing a time bound wraps the
  call in its own.
- **A purely asynchronous hook ping-pong is unbounded.** `MAX_HOOK_DEPTH` guards *synchronous*
  re-entrancy — the shape that actually overflows the JS call stack. Two hooks that `await` each
  other, each yielding to the event loop every round, never overflow the stack no matter how many
  rounds they run, so bounding them would refuse a harmless pattern to guard against a failure
  mode that cannot occur there.

## Public API

Everything below is exported from the package's single entry point, `@energy8engine/kernel`.

**Diagnostics** — `error`, `warning` build a `Diagnostic`; `hasErrors` checks a list for one;
`describeError` totally describes an unknown thrown/rejected value. Types: `Diagnostic`,
`Severity`.

**Schema** — `validate` checks a settings object against a `Schema` and fills in defaults;
`defaultOf` computes one field's default; `mergeSchemas` combines a point's schema with a
contribution's. `isPlainObject`, `isUsableField`, `cloneValue` are the shared hostile-input guards
described above; `MAX_SCHEMA_DEPTH` is the recursion cap they enforce. `STRING_KINDS` lists the
field kinds validated as a plain string (their domain meaning — is this a real asset path? — is
resolved by a higher layer, not the kernel). Types: `Schema`, `FieldSchema`, `FieldBase`,
`EnumOption`, `AssetKind`, `ValidateResult`, `MergeContext`, `MergeResult`.

**Manifest** — `definePlugin` is the identity helper that gives a manifest literal type inference;
`checkManifestShape` structurally validates one, collecting every problem rather than stopping at
the first. Types: `PluginManifest`, `PointDef`, `Contribution`, `PointId`, `Phase`, `Arity`,
`Factory`.

**Resolution** — `resolvePlan` turns a project's choices plus the installed manifests into a
`ResolvedPlan`; `orderPlugins` topologically sorts manifests by `dependsOn`; `parseVersion`,
`isValidRange`, `satisfies` implement the package's minimal semver subset; `matches`,
`isDefaultMatcher`, `describeMatcher` evaluate and describe a `Matcher`; `toSnapshot` turns a plan
into the plain-JSON `PlanSnapshot` the IDE and the agent read over RPC. Types: `ResolveInput`,
`ResolveOutput`, `ResolvedPlan`, `ResolvedPoint`, `ResolvedContribution`, `ResolvedPlugin`,
`ProjectDoc`, `PluginEntry`, `ContributionKey`, `ContributionSettings`, `LaunchContext`, `Matcher`,
`OrderResult`, `Version`, `PlanSnapshot`, `ContributionSnapshot`.

**Runtime** — `activatePoint` instantiates every active contribution to a point;
`activateOne` is its convenience form for an `arity: 'one'` point; `createHookBus` builds a closed
hook bus from a project's declared hooks; `declaredFromPlan` inverts `plan.hooks` into the shape
`createHookBus` wants. `MAX_HOOK_DEPTH` is the synchronous re-entrancy cap described above. Types:
`Activated`, `ActivateResult`, `HookBus`, `HookBusOptions`, `HookFn`.

Neither `activatePoint` nor `activateOne` filters by a point's `phase` — a `ResolvedPlan` mixes
`runtime`/`build`/`editor` points freely, and calling either for a point outside the caller's own
phase (a build-phase `build.target` from inside a browser bundle, say) will happily try to instantiate
it. Filtering `plan.points` down to the phase(s) that make sense for the current context, before
activating anything, is the caller's job.

**`KERNEL_VERSION`** — the kernel's own version. Plugin manifests declare the range they need via
`engine`, checked by `resolvePlan` with the same `satisfies` used for everything else.

## Tests

```bash
npm test --workspace @energy8engine/kernel
```

Run it from the repo root with that exact command — `npx vitest run <path>` reports false
failures under this workspace layout.

`tests/purity.test.ts` is a guard, not ordinary coverage: it fails if any source file under `src/`
imports something outside its own tree or touches a browser global, which is how this package
stays safe to import from the game, the build and the IDE alike.

## License

MIT
