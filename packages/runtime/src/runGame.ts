import {
  activateOne,
  createHookBus,
  declaredFromPlan,
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
  /** The handshake result, or null when resolution failed or installation did. */
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

/**
 * Compose a game from its project's plugins.
 *
 * The order is the whole design: resolve the plan as data, refuse to go further if it carries
 * errors, install exactly one session backend on the SDK channel, and only then run a single
 * handshake against whatever installed itself. `createSlotGame` did the same work with the
 * backends named in `if` branches; here they are contributions chosen by a matcher.
 *
 * Never rejects. A malformed project, a plugin that fails to load, a backend whose installation
 * throws — each becomes a diagnostic on the returned value.
 */
export async function runGame(rawInput: RunGameInput): Promise<RunGameResult> {
  // `rawInput` itself — not just its `project` field — is untrusted: a caller can pass `null` or
  // `undefined` despite the type, the same way `resolvePlan` treats its own `input` parameter as
  // untrusted (`input?.field` throughout resolve.ts). Without this guard, `rawInput.project` below
  // would throw synchronously, and — being inside an async function — that throw would turn into a
  // REJECTED promise, breaking the "never rejects, on any input" contract before resolution even
  // gets a chance to turn the problem into a diagnostic.
  const input: RunGameInput = rawInput ?? ({} as RunGameInput);

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
  // provider body and a rejected `runGame` call.
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
      message: `Session provider "${winner.contributionId}" failed to install: ${
        err instanceof Error ? err.message : String(err)
      }`,
      pluginId: winner.pluginId,
      pointId: POINT_SESSION_PROVIDER,
      contributionId: winner.contributionId,
    });
    return { plan, diagnostics: all, session: null, hooks, dispose };
  }

  const createSession = input.createSession ?? defaultCreateSession;
  const session = await createSession({});
  await hooks.emit('bootstrap', { session });

  return { plan, diagnostics: all, session, hooks, dispose };
}
