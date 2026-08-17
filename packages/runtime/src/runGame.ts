import {
  activateOne,
  createHookBus,
  declaredFromPlan,
  describeError,
  hasErrors,
  KERNEL_VERSION,
  resolvePlan,
  type Diagnostic,
  type HookBus,
  type PluginManifest,
  type ProjectDoc,
  type ResolvedPlan,
} from '@energy8engine/kernel';
import { HOOK_IDS, POINT_SESSION_PROVIDER } from './points';
import type { DevBridgeCtor, InstalledSession, SessionProvider, StakeBridgeCtor } from './session/types';

export interface RunGameInput {
  project: ProjectDoc;
  manifests: readonly PluginManifest[];
  /** The launch URL. Injected so this package needs no DOM in tests. */
  url: string;
  buildTarget?: string;
  /**
   * The SDK handshake. Defaults to platform-core's `createPlatformSession`, reached dynamically
   * because platform-core is an optional peer.
   */
  createSession?: (cfg: Record<string, unknown>) => Promise<unknown>;
  loadDevBridge?: () => Promise<DevBridgeCtor>;
  loadStakeBridge?: () => Promise<StakeBridgeCtor>;
}

export interface RunGameResult {
  plan: ResolvedPlan;
  diagnostics: Diagnostic[];
  /** The handshake result, or null when resolution failed, installation did, or the handshake itself did. */
  session: unknown | null;
  hooks: HookBus;
  dispose: () => Promise<void>;
}

async function defaultCreateSession(cfg: Record<string, unknown>): Promise<unknown> {
  // Dynamic on purpose: platform-core is an OPTIONAL peer. A static specifier would be resolved by
  // every bundler, so a game that never uses the default handshake would still have to install it.
  const mod = await import('@energy8platform/platform-core');
  return (mod as unknown as { createPlatformSession: (c: Record<string, unknown>) => Promise<unknown> })
    .createPlatformSession(cfg);
}

/** A `ResolvedPlan` shape for the catastrophic path where resolution never produced a real one. */
const EMPTY_PLAN: ResolvedPlan = { plugins: [], points: {}, contributions: [], order: [], hooks: {} };

/**
 * Compose a game from its project's plugins.
 *
 * The order is the whole design: resolve the plan as data, refuse to go further if it carries
 * errors, install exactly one session backend on the SDK channel, and only then run a single
 * handshake against whatever installed itself. `createSlotGame` did the same work with the
 * backends named in `if` branches; here they are contributions chosen by a matcher.
 *
 * Never rejects, on any input. A malformed project, a plugin that fails to load, a backend whose
 * installation throws, the SDK handshake itself throwing or rejecting, or the kernel throwing
 * outright on hostile manifest data (e.g. a throwing property getter) — each becomes a diagnostic
 * on the returned value, never a rejection. `runGame` is the only containment boundary this system
 * has: nothing upstream isolates a plugin's own code, so every call this function makes into the
 * plan, the winning provider, and the handshake is guarded.
 */
export async function runGame(rawInput: RunGameInput): Promise<RunGameResult> {
  // `rawInput` itself — not just its `project` field — is untrusted: a caller can pass `null` or
  // `undefined` despite the type, the same way `resolvePlan` treats its own `input` parameter as
  // untrusted (`input?.field` throughout resolve.ts).
  const input: RunGameInput = rawInput ?? ({} as RunGameInput);

  try {
    const { plan, diagnostics } = resolvePlan({
      project: input.project,
      manifests: input.manifests ?? [],
      launch: { url: input.url, buildTarget: input.buildTarget },
      kernelVersion: KERNEL_VERSION,
      hookIds: HOOK_IDS,
    });

    const all: Diagnostic[] = [...diagnostics];
    const hooks = createHookBus({ ids: HOOK_IDS, declared: declaredFromPlan(plan.hooks) });
    let installed: InstalledSession | null = null;

    const dispose = async (): Promise<void> => {
      await installed?.dispose?.();
      installed = null;
      await hooks.emit('dispose');
    };

    // A plan carrying errors is not a plan to run. Stopping here is what turns a white screen into
    // a list somebody can act on.
    if (hasErrors(all)) return { plan, diagnostics: all, session: null, hooks, dispose };

    const activation = await activateOne<SessionProvider>(plan, POINT_SESSION_PROVIDER);
    all.push(...activation.diagnostics);
    const winner = activation.instance;
    if (!winner) return { plan, diagnostics: all, session: null, hooks, dispose };

    // LOAD-BEARING, not defensive garnish: `provider()` (session/types.ts) hands the kernel a
    // trivial `() => install` passthrough, so `activateOne` above only ever calls THAT — it cannot
    // fail, and the kernel's own factory-failure isolation never engages for a session provider.
    // `winner.value` (the `install` function itself, e.g. session-stake's) is invoked directly, for
    // the first time, right here — this try/catch is the only thing standing between a throwing
    // provider body and a rejected `runGame` call. `describeError`, not `err instanceof Error ? ... :
    // String(err)`: a provider that throws a null-prototype value (or anything with a throwing
    // `Symbol.toPrimitive`/`toString`) would make `String(err)` itself throw, turning this catch —
    // the only containment this path has — into a second rejection source.
    try {
      installed = await winner.value({
        url: input.url,
        buildTarget: input.buildTarget,
        settings: plan.contributions.find((c) => c.key === winner.key)?.settings ?? {},
        plan,
        loadDevBridge: input.loadDevBridge,
        loadStakeBridge: input.loadStakeBridge,
      });
    } catch (err) {
      all.push({
        severity: 'error',
        code: 'activate/factory-failed',
        message: `Session provider "${winner.contributionId}" failed to install: ${describeError(err)}`,
        pluginId: winner.pluginId,
        pointId: POINT_SESSION_PROVIDER,
        contributionId: winner.contributionId,
      });
      return { plan, diagnostics: all, session: null, hooks, dispose };
    }

    // Equally load-bearing, and equally uncontained upstream: this is the actual SDK handshake — a
    // network call in production — and nothing between here and the player's screen catches a
    // throw from it otherwise. A `createSession` that throws synchronously, rejects, or (being an
    // untyped-at-runtime optional field) simply isn't callable must all still produce a diagnostic,
    // not a rejected `runGame`.
    try {
      const createSession = input.createSession ?? defaultCreateSession;
      const session = await createSession({});
      await hooks.emit('bootstrap', { session });
      return { plan, diagnostics: all, session, hooks, dispose };
    } catch (err) {
      all.push({
        severity: 'error',
        code: 'runtime/handshake-failed',
        message: `The SDK handshake failed: ${describeError(err)}`,
        pointId: POINT_SESSION_PROVIDER,
      });
      return { plan, diagnostics: all, session: null, hooks, dispose };
    }
  } catch (err) {
    // Defense in depth. `resolvePlan` is documented to never throw, but that promise does not hold
    // for every input: a manifest with a throwing property getter (e.g. `get id() { throw }`)
    // reaches `checkManifestShape` unguarded and throws out of the kernel — a known kernel gap,
    // deliberately NOT fixed here (this task does not touch packages/kernel). `runGame` is this
    // system's only containment boundary, so it must absorb that throw too, along with anything
    // else in this body that turns out not to be as total as documented.
    return {
      plan: EMPTY_PLAN,
      diagnostics: [
        {
          severity: 'error',
          code: 'runtime/internal-error',
          message: `runGame failed unexpectedly: ${describeError(err)}`,
        },
      ],
      session: null,
      hooks: createHookBus({ ids: HOOK_IDS, declared: {} }),
      dispose: async () => {},
    };
  }
}
