/**
 * The flow node-kind registry (`ctx.flowNodes`) and the sixteen built-in
 * kinds. Last-wins like the scene node-type registry, so a project plugin
 * (or a hot re-apply) can replace a built-in; subscribers hear every change.
 *
 * Built-ins reach the game's services LENIENTLY (`ctx.reflect.get(name,
 * false)`): a flow that names a service the composition does not provide
 * throws from `run`, and the interpreter turns that into a diagnostic on
 * the node rather than a crash of the page.
 */
import type { Context } from 'cordis';
import Schema from 'schemastery';
import {
  evaluate,
  resolveValue,
  type Diagnostic,
  type PlayRequest,
  type PresentationStep,
  type SessionService,
  type Severity,
  type SpinResult,
} from '@energy8engine/contracts';
import type { PlayService } from '@energy8engine/play-loop/runtime';
import type { SceneRef, ScenesService } from '@energy8engine/scenes';
import { createRegistry } from '@energy8engine/registry';
import type { EventsService } from './events';

declare global {
  namespace Schemastery {
    interface Meta {
      /** IDE hint: render this string field as a picker of the named thing's ids (`'scene'`). */
      pick?: string;
    }
  }
}

export interface RunCtx {
  /** One object per run, shared by every concurrent branch of it (last writer wins). */
  vars: Record<string, unknown>;
  /** The game's context. The flow bus is `ctx.get('events')` / `ctx.reflect.get('events', false)` — NOT `ctx.events`, which is cordis's own emitter. */
  ctx: Context;
  /** Aborted by `stop()`/`replace()`; a `run` that waits must give up on it. */
  signal: AbortSignal;
  /** A diagnostic on this node that does NOT end the branch (a bad `if` expression, say). */
  report(message: string, severity?: Severity): void;
  /** Whether any run of this document still has a live branch. */
  busy(): boolean;
  /** Resolves once no run has a live branch (at once when already idle). */
  idle(): Promise<void>;
}

export interface FlowNodeKind<P = Record<string, unknown>> {
  kind: string;
  schema: Schema<P>;
  /** Output port names in order; the first is what an edge with no `out` means. */
  outs: readonly string[];
  /** A trigger starts a run: the interpreter calls `arm` once per doc and never `run`. */
  trigger?: boolean;
  /** `false` opts `run` out of the interpreter's 30 s limit (a `wait` for a human, say). */
  timeout?: false;
  /** `fire` starts a run with `vars`; its promise settles once that run has no live branch (`stop()` settles it too). */
  arm?(props: P, fire: (vars?: Record<string, unknown>) => Promise<void>, ctx: RunCtx): () => void;
  run?(props: P, ctx: RunCtx): Promise<{ out: string; vars?: Record<string, unknown> }>;
}

export interface FlowNodesService {
  /** Last-wins; notifies. The disposer takes back only its own registration. */
  register(k: FlowNodeKind<any>): () => void;
  get(kind: string): FlowNodeKind | undefined;
  list(): FlowNodeKind[];
  subscribe(fn: () => void): () => void;
}

export function createFlowNodes(): FlowNodesService {
  const registry = createRegistry<FlowNodeKind>({ policy: 'last-wins' });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    register(k) {
      const off = registry.add(k.kind, k);
      notify();
      return () => {
        off();
        notify();
      };
    },
    get: (kind) => registry.get(kind),
    list: () => registry.keys().map((k) => registry.get(k)!),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const service = <T>(ctx: Context, name: string): T => {
  const s = ctx.reflect.get(name, false) as T | undefined;
  if (!s) throw new Error(`no '${name}' service in this composition`);
  return s;
};

/** `resolveValue` (a literal, `$expr`, or a `{…}` template); a value that does not parse is a WARNING on the node and stays as written. */
const resolve = (value: unknown, vars: Record<string, unknown>, report: RunCtx['report']) =>
  resolveValue(value, vars, (m) => report(m, 'warning'));

/** `v` as a number: a number as is, a non-blank numeric string via `Number()`, anything else `NaN`. */
const asNumber = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `v` for a diagnostic: JSON where JSON can (`"Bonus"`, `null`, `{…}`), `String()` where it cannot (`undefined`, a cyclic object). */
const quote = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

const none = Schema.object({});

interface MechanicsLike {
  present(stage: string, data: Record<string, unknown>): { plan: PresentationStep[]; diagnostics: Diagnostic[] };
}

const boot: FlowNodeKind = {
  kind: 'boot',
  schema: none,
  outs: ['next'],
  trigger: true,
  arm(_p, fire) {
    queueMicrotask(fire);
    return () => {};
  },
};

const on: FlowNodeKind<{ event: string; busy: 'ignore' | 'queue' | 'parallel' }> = {
  kind: 'on',
  schema: Schema.object({
    event: Schema.string().required().description('event name'),
    busy: Schema.union(['ignore', 'queue', 'parallel'])
      .default('ignore')
      .description('a fire while a run is live: drop it, fire once after the runs drain, or start a concurrent run at once'),
  }),
  outs: ['next'],
  trigger: true,
  arm(p, fire, { ctx, busy, idle, report }) {
    if (!p.event) {
      report("'on' needs an 'event'");
      return () => {};
    }
    let queued: Record<string, unknown> | undefined;
    // Fires the queued payload once the runs drain; a run that slipped in
    // between `idle` resolving and this running means one more wait.
    const drain = (): void =>
      void idle().then(() => {
        if (busy()) return drain();
        const vars = queued;
        queued = undefined;
        void fire(vars);
      });
    // The run's promise goes back to the bus, so an `emit { wait }` can hold
    // for it; a queued fire is nobody's to wait for.
    return service<EventsService>(ctx, 'events').on(p.event, (event) => {
      if (!busy() || p.busy === 'parallel') return fire({ event });
      if (p.busy !== 'queue') return undefined;
      if (queued === undefined) drain();
      queued = { event }; // coalesce: the latest payload wins
      return undefined;
    });
  },
};

/**
 * Plays one request through the composition's `session` seam and turns the
 * answer into the `spin`/`step` kinds' own `run` result. Shared: both kinds
 * build the same `{ out: 'result', vars: { result, request } }` /
 * `{ out: 'failed', vars: { error } }` shape, only the request differs.
 *
 * Lenient on the seam — a page composed `without: ['session', 'ui.shell']`
 * (a composition editor; the shell must go with the session, since `shell1`
 * injects it and would otherwise stay pending) has none. No session, a play
 * without a result (the
 * provider's diagnostics are re-reported on the node, with their severity)
 * and a `play` that throws all leave by `failed` with the reason, rather
 * than ending the branch: the flow still reaches whatever it wired there
 * (a `shell { busy: false }` that re-enables Spin, say).
 */
async function playThrough(
  ctx: Context,
  request: PlayRequest,
  report: RunCtx['report'],
  idle: RunCtx['idle'],
): Promise<{ out: string; vars?: Record<string, unknown> }> {
  const session = ctx.reflect.get('session', false) as SessionService | undefined;
  if (!session) {
    report('no session row in this composition');
    return { out: 'failed', vars: { error: 'no session' } };
  }
  // "A plan is on its way" (`PlayService.arm`): a second tap while this
  // request is in flight is kept for the plan instead of landing on no live
  // run. Released at once on a failure (no plan is coming), else when the
  // run goes idle — normally long after `present`'s `execute` spent it.
  // Lenient: a composition without a play row still spins.
  const release = (ctx.reflect.get('play', false) as PlayService | undefined)?.arm?.();
  const out = await (async () => {
    try {
      const { result, diagnostics } = await session.play(request);
      if (result) return { out: 'result', vars: { result, request } };
      for (const d of diagnostics) report(d.message, d.severity);
      return { out: 'failed', vars: { error: diagnostics.map((d) => d.message).join('; ') || 'no result' } };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      report(message);
      return { out: 'failed', vars: { error: message } };
    }
  })();
  if (out.out === 'failed') release?.();
  else void idle().then(() => release?.());
  return out;
}

/**
 * Resolves a `betLevel` prop (a numeric literal, `$expr` or template) into
 * `request.betLevel`, converting a literal string with `Number()` and
 * reporting + omitting one that isn't a number. `spin`'s own — `step` has
 * no `betLevel` prop (see its own doc: a `Step` carries no bet on the wire).
 */
function applyBetLevel(
  betLevelProp: string | undefined,
  vars: Record<string, unknown>,
  request: PlayRequest,
  report: (message: string, severity?: Severity) => void,
): void {
  const betLevelRaw = resolve(betLevelProp, vars, report);
  if (betLevelRaw === undefined) return;
  const betLevel = asNumber(betLevelRaw);
  if (Number.isNaN(betLevel)) report(`betLevel "${betLevelRaw}" is not a number`);
  else request.betLevel = betLevel;
}

const spin: FlowNodeKind<{ action: string; betLevel?: string }> = {
  kind: 'spin',
  schema: Schema.object({
    action: Schema.string().default('spin').description('action name: a literal, `$expr`, or a `{…}` template'),
    // A string, not a number: the IDE's number field cannot hold a `$expr` —
    // `applyBetLevel` converts a literal with `Number()`.
    betLevel: Schema.string().description('bet level (a number): a literal, `$expr`, or a `{…}` template'),
  }),
  outs: ['result', 'failed'],
  async run(p, { ctx, vars, report, idle }) {
    const action = resolve(p.action, vars, report);
    if (typeof action !== 'string' || action === '') {
      report(`'spin' has no action to send (resolved from '${p.action}')`);
      return { out: 'failed', vars: { error: "'spin' has no action" } };
    }
    const request: PlayRequest = { action };
    applyBetLevel(p.betLevel, vars, request, report);
    return playThrough(ctx, request, report, idle);
  },
};

/**
 * Steps an open round to its next response: unlike `spin` (which always
 * starts a fresh round), `step` carries the `roundId` a prior `result`
 * named and the `action` it offered in `nextActions` — the loop a `result.
 * roundComplete === false` puts the flow into. Both default to reading the
 * PREVIOUS response off `vars.result` (the expression's path token accepts
 * a numeric segment — `nextActions.0` — while `readPath` itself only reads
 * the leaf), so a bare node needs no props;
 * either can still be a literal or a different `$expr` for a flow that
 * wants to choose the next action itself (a bonus pick, say).
 *
 * No `betLevel` prop: a step keeps the round's bet. A gRPC `Step` carries
 * `round_id, action, params_json, request_id` and nothing else — there is
 * no bet field on the wire for it to reach (`e8server.ts`'s
 * `RoundStepRequest`) — so the prop would be dead the way `spin`'s is not.
 */
const step: FlowNodeKind<{ roundId: string; action: string }> = {
  kind: 'step',
  schema: Schema.object({
    roundId: Schema.string()
      .default('$result.roundId')
      .description('the open round id: a literal, `$expr`, or a `{…}` template'),
    action: Schema.string()
      .default('$result.nextActions.0')
      .description('next action name: a literal, `$expr`, or a `{…}` template'),
  }),
  outs: ['result', 'failed'],
  async run(p, { ctx, vars, report, idle }) {
    const roundId = resolve(p.roundId, vars, report);
    if (typeof roundId !== 'string' || roundId === '') {
      report(`'step' has no roundId to send (resolved from '${p.roundId}')`);
      return { out: 'failed', vars: { error: "'step' has no roundId" } };
    }
    const action = resolve(p.action, vars, report);
    if (typeof action !== 'string' || action === '') {
      report(`'step' has no action to send (resolved from '${p.action}')`);
      return { out: 'failed', vars: { error: "'step' has no action" } };
    }
    const request: PlayRequest = { action, roundId };
    return playThrough(ctx, request, report, idle);
  },
};

/**
 * `timeout: false`, like `wait`/`emit`: a plan is as long as its board steps
 * and its `emit { wait }` holds, so a board step that never resolves holds
 * the flow until `ui.skip` or `stop()` — the interpreter's 30 s cap no
 * longer nets it.
 */
const present: FlowNodeKind<{ turbo: string }> = {
  kind: 'present',
  schema: Schema.object({
    turbo: Schema.string()
      .default('$turbo')
      .description(
        "literal 'true', or a `$expr` / `{…}` template (`true`, or a number > 0 — the shell's `$shell.turbo`) — hurries the board while this plan plays",
      ),
  }),
  outs: ['next', 'failed'],
  timeout: false,
  async run(p, { ctx, vars, report }) {
    const result = vars.result as { stage: string; data: Record<string, unknown> } | undefined;
    if (!result) throw new Error('vars.result is missing — run `spin` first');
    const { plan, diagnostics } = service<MechanicsLike>(ctx, 'mechanics').present(result.stage, result.data);
    const play = service<PlayService>(ctx, 'play');
    const turbo = resolve(p.turbo, vars, report);
    const on = turbo === true || turbo === 'true' || (typeof turbo === 'number' && turbo > 0);
    // `''` is what the form's empty option commits: absent, like `undefined`.
    const off = turbo === false || turbo === 'false' || turbo === 0 || turbo == null || turbo === '';
    if (!on && !off) report(`turbo "${turbo}" is not true/false`, 'warning');
    const opts = { turbo: on };
    const problems = diagnostics.length
      ? diagnostics
      : await play.execute(plan, ctx.reflect.get('board', false), undefined, opts);
    // Fatal is an `error` — or any mechanics diagnostic at all, since then
    // the plan was never played. A `warning` alone is a `wait: false` step
    // that failed (slice 32): the author declared it must not hold the plan,
    // so it does not fail the round either — it is already reported by
    // `play.execute`, and the round leaves by `next`.
    const fatal = diagnostics.length > 0 || problems.some((d) => d.severity === 'error');
    // The spin log: what was drawn — `[]` when the presentation failed. An
    // `error` zeroes the recorded plan even though other steps drew
    // (a blocking step that failed, or a `wait: false` one that never
    // settled within `pendingMs`): a log claiming a broken plan drew is
    // worse than an empty one.
    play.record({
      request: (vars.request as Record<string, unknown>) ?? {},
      result,
      plan: fatal ? [] : plan,
    });
    // `error` names why the round failed: a mechanics diagnostic, or a
    // play `error` — never a warning that rode along.
    const why = diagnostics.length > 0 ? problems : problems.filter((d) => d.severity === 'error');
    if (fatal) return { out: 'failed', vars: { plan, error: why.map((d) => d.message).join('; ') } };
    return { out: 'next', vars: { plan } };
  },
};

/** `scenes` once its own boot GET has landed: a `show` at boot would otherwise race the documents and answer `notDeclared`. */
const scenesReady = async (ctx: Context): Promise<ScenesService> => {
  const scenes = service<ScenesService>(ctx, 'scenes');
  await scenes.ready?.catch(() => {});
  return scenes;
};

const show: FlowNodeKind<{ scene: string; transition?: string }> = {
  kind: 'show',
  schema: Schema.object({
    scene: Schema.string().required().extra('pick', 'scene').description('scene id'),
    transition: Schema.string().description('transition id; the scene default when empty'),
  }),
  outs: ['next'],
  async run(p, { ctx }) {
    const scenes = await scenesReady(ctx);
    await scenes.show(p.scene, { transition: p.transition });
    return { out: 'next' };
  },
};

const hide: FlowNodeKind<{ scene: string }> = {
  kind: 'hide',
  schema: Schema.object({ scene: Schema.string().required().extra('pick', 'scene').description('scene id') }),
  outs: ['next'],
  async run(p, { ctx }) {
    const scenes = await scenesReady(ctx);
    await scenes.hide(p.scene);
    return { out: 'next' };
  },
};

/**
 * F16 — poses a document (its `assetsOf`, any row `require`d) ahead of a
 * `show`, so the `show` that follows has nothing left to fetch: a bonus
 * scene loaded while the base game still plays, say. Unlike `show`/`hide`,
 * a missing `scenes` service is NOT a throw — a preload is a nicety, not
 * something the flow can't run without — so this reaches the service
 * LENIENTLY (`ctx.reflect.get`, not `service()`) and reports a warning
 * instead. A rejected `load` is the loader's own diagnostic; this only
 * waits `ready` (the same boot-race guard as `show`/`hide`) and moves on.
 */
const load: FlowNodeKind<{ scene: string }> = {
  kind: 'load',
  schema: Schema.object({ scene: Schema.string().required().extra('pick', 'scene').description('scene id') }),
  outs: ['next'],
  async run(p, { ctx, report }) {
    const scenes = ctx.reflect.get('scenes', false) as ScenesService | undefined;
    if (!scenes) {
      report(`no 'scenes' service in this composition`, 'warning');
      return { out: 'next' };
    }
    await scenes.ready?.catch(() => {});
    await scenes.load(p.scene).catch(() => {});
    return { out: 'next' };
  },
};

const wait: FlowNodeKind<{ ms?: number; event?: string }> = {
  kind: 'wait',
  schema: Schema.object({
    ms: Schema.number().description('milliseconds'),
    event: Schema.string().description('event name'),
  }),
  outs: ['next'],
  timeout: false,
  run(p, { ctx, signal }) {
    return new Promise((resolve, reject) => {
      // `''` is what the form's empty option commits: absent, like `undefined`.
      if (!p.event && p.ms === undefined) return reject(new Error("'wait' needs an 'event' or 'ms'"));
      if (signal.aborted) return reject(signal.reason);
      const offs: (() => void)[] = [];
      const settle = (fn: () => void) => () => {
        offs.forEach((off) => off());
        fn();
      };
      const done = settle(() => resolve({ out: 'next' }));
      const abort = settle(() => reject(signal.reason));
      // Events first: a missing service throws before any timer is set.
      if (p.event) offs.push(service<EventsService>(ctx, 'events').on(p.event, done));
      if (p.ms !== undefined) {
        const t = setTimeout(done, p.ms);
        offs.push(() => clearTimeout(t));
      }
      signal.addEventListener('abort', abort);
      offs.push(() => signal.removeEventListener('abort', abort));
    });
  },
};

const ifKind: FlowNodeKind<{ when: string }> = {
  kind: 'if',
  schema: Schema.object({ when: Schema.string().required().description('condition over vars') }),
  outs: ['true', 'false'],
  async run(p, { vars, report }) {
    try {
      return { out: String(evaluate(p.when, vars)) };
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      report(`bad expression '${p.when}': ${e.message}`);
      return { out: 'false' };
    }
  },
};

const set: FlowNodeKind<{ name: string; value?: unknown }> = {
  kind: 'set',
  schema: Schema.object({
    name: Schema.string().required().description('var name'),
    value: Schema.any().description('literal, `$expr`, or a `{…}` template'),
  }),
  outs: ['next'],
  async run(p, { vars, report }) {
    return { out: 'next', vars: { [p.name]: resolve(p.value, vars, report) } };
  },
};

/**
 * `timeout: false` is for `wait`: a branch held for a human-paced run must not hit the 30 s limit.
 * Inside one flow, a fire to a default `on { busy: ignore }` while that `on`'s run is live is
 * DROPPED — nothing holds it; only `busy: parallel` (or an idle flow) gives a `wait { event }`
 * something to wait for.
 *
 * F17 — `wait` also covers a PLUGIN's `events.on` handler: `createEvents().emit`'s promise
 * already settles only once every listener's returned promise has (a rejection included), flow
 * run or plain handler alike, so `wait: true` here needs no extra code to hold for one.
 */
const emit: FlowNodeKind<{ event: string; payload?: unknown; wait: boolean }> = {
  kind: 'emit',
  schema: Schema.object({
    event: Schema.string().required().description('event name'),
    payload: Schema.any().description('literal, `$expr`, or a `{…}` template'),
    wait: Schema.boolean()
      .default(false)
      .description(
        "hold this branch until every run the event started has ended and every plugin handler's returned promise has settled",
      ),
  }),
  outs: ['next'],
  timeout: false,
  async run(p, { ctx, vars, report }) {
    const done = service<EventsService>(ctx, 'events').emit(p.event, resolve(p.payload, vars, report));
    if (p.wait) await done;
    return { out: 'next' };
  },
};

/**
 * Splits a `<scene>/<node>` string into a `SceneRef` on the FIRST `/`
 * (`scene` up to it, `node` the rest — a node id containing its own `/`
 * stays intact). `null` when there's no `/` at all: not a ref with an
 * empty scene, just not a ref. Shared with flow-fx's `tween`, which packs
 * a target the same way (`ctx.reflect.get('scenes')?.view(ref)`).
 */
export function parseTarget(target: string): SceneRef | null {
  const i = target.indexOf('/');
  if (i < 0) return null;
  return { scene: target.slice(0, i), node: target.slice(i + 1) };
}

/**
 * Sets one prop on a mounted scene node. `target`/`value` are each a
 * literal, `$expr` or `{…}` template (`resolve`); a literal `value` is coerced by the
 * node's OWN schema type (`scenes.nodeSchema`) — `'number'` via `Number()`
 * (NaN reports and does nothing further), `'boolean'` by `=== 'true'`,
 * anything else left as the string. `value` defaults to `''` (not left
 * undefined) so a bare node still sets SOMETHING rather than silently
 * dropping the key — `Number('')` is `0`, matching a fresh numeric field.
 *
 * Waits for `scenes.ready` (the boot GET, same race `show`/`hide` guard
 * against) before touching `nodeSchema`/`setProps` — but only once a
 * `scenes` service exists at all; a missing one still reports and leaves
 * by `next` without waiting on anything.
 *
 * A `prop` name the node's merged schema doesn't have is its own
 * diagnostic: schemastery's `object` schema passes unknown keys through
 * unvalidated, so without this check a typo'd prop would make `setProps`
 * silently "succeed" at setting nothing real. `setProps` itself already
 * reports its own diagnostic (to the scenes plugin) for a missing node or
 * a refused value — this only needs to add the flow node's own
 * diagnostic and move on; nothing here ever fails the branch.
 */
const prop: FlowNodeKind<{ target: string; prop: string; value: string }> = {
  kind: 'prop',
  schema: Schema.object({
    target: Schema.string()
      .required()
      .extra('pick', 'node')
      .description('`<scene>/<node>`: a literal, `$expr`, or a `{…}` template'),
    prop: Schema.string().required().description('prop name'),
    value: Schema.string()
      .default('')
      .description(
        "literal, coerced by the prop's schema type (number/boolean/string), or `$expr` / a `{…}` template",
      ),
  }),
  outs: ['next'],
  async run(p, { ctx, vars, report }) {
    const scenes = ctx.reflect.get('scenes', false) as ScenesService | undefined;
    if (!scenes) {
      report(`no 'scenes' service in this composition`);
      return { out: 'next' };
    }
    await scenes.ready?.catch(() => {});

    const ref = parseTarget(String(resolve(p.target, vars, report) ?? ''));
    if (!ref) {
      report('target must be <scene>/<node>');
      return { out: 'next' };
    }

    const dict = scenes.nodeSchema(ref)?.dict;
    // `hasOwn`, not `in`: `constructor`/`toString` are on every object's
    // prototype, and a prop named one of those would sail past the guard
    // into `setProps` as a prop the node does not have.
    if (dict && !Object.hasOwn(dict, p.prop)) {
      report(`node "${ref.scene}/${ref.node}" has no prop "${p.prop}"`);
      return { out: 'next' };
    }

    // Dynamic when a `$expr`/template changed it — a value that did not
    // parse comes back as written (reported above) and takes the literal
    // branch, whose own type check names the prop.
    let value: unknown = resolve(p.value, vars, report);
    if (value !== p.value) {
      // The var IS already typed, so a `$expr` skips the literal branch's
      // own Number()/boolean coercion below for everything EXCEPT a
      // `string` target — `Schema.string()` throws outright on anything
      // but a JS string, and `setProps` would refuse the whole patch (a
      // `$result.win` float into a `text` node's `text` prop — what the
      // example's `show_win` did before it became a `count` node — is
      // exactly this case). Only a
      // number/boolean is stringified; an object or `null` is left for
      // `setProps` to refuse, same as before this branch existed. A
      // template is always a string — a number prop refuses it there too.
      const type = dict?.[p.prop]?.type;
      if (type === 'number' && typeof value === 'number' && Number.isNaN(value)) {
        report(`value "${p.value}" is not a number for '${p.prop}'`);
        return { out: 'next' };
      }
      if (type === 'string' && (typeof value === 'number' || typeof value === 'boolean')) {
        value = String(value);
      }
    } else {
      const type = dict?.[p.prop]?.type;
      if (type === 'number') {
        value = Number(p.value);
        if (Number.isNaN(value)) {
          report(`value "${p.value}" is not a number for '${p.prop}'`);
          return { out: 'next' };
        }
      } else if (type === 'boolean') {
        value = p.value === 'true';
      } else {
        value = p.value;
      }
    }

    if (!scenes.setProps(ref, { [p.prop]: value })) {
      report(`could not set '${p.prop}' on "${ref.scene}/${ref.node}"`);
    }
    return { out: 'next' };
  },
};

/**
 * The `Shell` handle (`@energy8engine/shell-pixi` provides it as `shell`),
 * as much of it as the `shell` kind drives — declared structurally here so
 * the flow does not depend on the shell package.
 */
interface ShellLike {
  state: {
    autoplay: { active: boolean; remaining: number };
    freeSpins: { current?: number | null; total: number; totalWin: number };
    bonus: { label: string; value: string } | null;
  };
  setBalance(n: number): void;
  setWin(n: number, opts?: { animate?: boolean }): void;
  setBet(n: number): void;
  setMode(mode: string): void;
  setBusy(busy: boolean): void;
  setTurbo(level: number): void;
  setBuyBonusEnabled(enabled: boolean): void;
  setFreeSpins(fs: { current?: number | null; total: number; totalWin: number }): void;
  setBonus(b: { label: string; value: string; totalWin: number }): void;
  setAutoplay(a: { active: boolean; remaining: number }): void;
}

type ShellFlag = '' | 'true' | 'false';
interface ShellProps {
  balance: string;
  win: string;
  bet: string;
  mode: '' | 'base' | 'bonus' | 'freeSpins' | 'replay';
  busy: ShellFlag;
  turbo: string;
  buyBonusEnabled: ShellFlag;
  freeSpins: string;
  freeSpinsCurrent: string;
  freeSpinsTotalWin: string;
  bonus: string;
  bonusTotalWin: string;
  autoplay: string;
}

const SHELL_MODES = ['base', 'bonus', 'freeSpins', 'replay'];

/**
 * The flow's one door to the shell's readouts. Every prop is a string:
 * `''` leaves that readout untouched, a `$expr`/template resolves first, a
 * literal is coerced by the setter's type. `mode`/`busy`/`buyBonusEnabled` are
 * unions of their literals, so the IDE draws a dropdown and a typo is
 * refused at the schema; `run` checks the same sets again for a value that
 * reached it unvalidated. A value that cannot be set (NaN, a bad enum, a
 * setter that throws) is a diagnostic on the node and the OTHER props
 * still apply, in schema order — a readout that cannot be set does not
 * stop the round. No `shell` service at all (the scene editor, composed
 * `without: ['ui.shell']`) is a
 * warning, and `next`. `freeSpinsCurrent`/`freeSpinsTotalWin` are applied
 * together — either one refused (a NaN) refuses both, so it's one
 * `setFreeSpins` call or none.
 */
const shell: FlowNodeKind<ShellProps> = {
  kind: 'shell',
  schema: Schema.object({
    balance: Schema.string()
      .default('')
      .description('balance readout, currency units (a number): a literal, `$expr`, or a `{…}` template — e.g. `$result.balance`'),
    win: Schema.string()
      .default('')
      .description(
        'win readout, currency units (a number): a literal, `$expr`, or a `{…}` template — e.g. `$result.winAmount`; counts up, 0 snaps (a clear)',
      ),
    bet: Schema.string().default('').description('bet readout, currency units (a number): a literal, `$expr`, or a `{…}` template'),
    mode: Schema.union(['', 'base', 'bonus', 'freeSpins', 'replay'])
      .default('')
      .description('what the bar shows'),
    busy: Schema.union(['', 'true', 'false']).default('').description('Spin disabled while a round plays'),
    turbo: Schema.string().default('').description('turbo level (a number): a literal, `$expr`, or a `{…}` template'),
    buyBonusEnabled: Schema.union(['', 'true', 'false'])
      .default('')
      .description('whether Buy Bonus can be pressed'),
    freeSpins: Schema.string()
      .default('')
      .description('spins total (a number), or a `$path` to `{ current?, total, totalWin }`; a literal, `$expr` or `{…}` template'),
    freeSpinsCurrent: Schema.string()
      .default('')
      .description(
        'spins played so far (a number) — merged over the current free-spins readout; reaches `setFreeSpins`, which clears a `bonus` readout — in bonus mode use `bonusTotalWin`',
      ),
    freeSpinsTotalWin: Schema.string()
      .default('')
      .description(
        'free-spins total win, currency units — merged over the current readout; reaches `setFreeSpins`, which clears a `bonus` readout — in bonus mode use `bonusTotalWin`',
      ),
    bonus: Schema.string()
      .default('')
      .description('`$expr` to `{ label, value, totalWin }` — a bonus readout in the bar hero'),
    bonusTotalWin: Schema.string().default('').description('bonus total win, currency units — merged over the bonus readout set earlier'),
    autoplay: Schema.string()
      .default('')
      .description("'tick' (one autoplay spin done), 'stop', or a count (a number: a literal, `$expr`, or a `{…}` template)"),
  }),
  outs: ['next'],
  async run(p, { ctx, vars, report }) {
    const shell = ctx.reflect.get('shell', false) as ShellLike | undefined;
    if (!shell) {
      report('no shell row in this composition', 'warning');
      return { out: 'next' };
    }
    /** The prop's value, resolved; `undefined` for an untouched (`''`) prop. */
    const value = (prop: keyof ShellProps): unknown =>
      p[prop] === '' ? undefined : resolve(p[prop], vars, report);
    /** A refused value, as resolved AND as written — `null (from "$result.balance")` tells a missing var from a wrong one. */
    const bad = (prop: keyof ShellProps, v: unknown, what: string) =>
      report(`shell: ${prop} ${quote(v)} (from "${p[prop]}") is not ${what}`);
    /** One setter throwing is reported; the props after it still apply. */
    const apply = (prop: keyof ShellProps, set: () => void) => {
      try {
        set();
      } catch (e) {
        report(`shell: ${prop}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    const num = (prop: keyof ShellProps, set: (n: number) => void) => {
      const v = value(prop);
      if (v === undefined) return;
      const n = asNumber(v);
      if (Number.isNaN(n)) bad(prop, v, 'a number');
      else apply(prop, () => set(n));
    };
    const flag = (prop: keyof ShellProps, set: (b: boolean) => void) => {
      const v = value(prop);
      if (v === undefined) return;
      if (v !== true && v !== false && v !== 'true' && v !== 'false') bad(prop, v, 'a boolean');
      else apply(prop, () => set(v === true || v === 'true'));
    };

    num('balance', (n) => shell.setBalance(n));
    // `0` is a clear (`busy: true, win: 0` at spin start), never a win to
    // count to — it snaps; a count-DOWN from the last win is what the
    // shell's own `setWin` doc calls wrong-looking.
    num('win', (n) => shell.setWin(n, { animate: n !== 0 }));
    num('bet', (n) => shell.setBet(n));
    const mode = value('mode');
    if (mode !== undefined) {
      if (typeof mode === 'string' && SHELL_MODES.includes(mode)) apply('mode', () => shell.setMode(mode));
      else bad('mode', mode, `a mode (${SHELL_MODES.join('|')})`);
    }
    flag('busy', (b) => shell.setBusy(b));
    num('turbo', (n) => shell.setTurbo(n));
    flag('buyBonusEnabled', (b) => shell.setBuyBonusEnabled(b));
    const freeSpins = value('freeSpins');
    if (freeSpins !== undefined) {
      const n = asNumber(freeSpins);
      if (isObject(freeSpins)) {
        apply('freeSpins', () => shell.setFreeSpins(freeSpins as { total: number; totalWin: number }));
      } else if (!Number.isNaN(n)) {
        apply('freeSpins', () => shell.setFreeSpins({ total: n, totalWin: 0 }));
      } else {
        bad('freeSpins', freeSpins, 'a number or a free-spins object');
      }
    }
    const fsCurrent = value('freeSpinsCurrent');
    const fsTotalWin = value('freeSpinsTotalWin');
    if (fsCurrent !== undefined || fsTotalWin !== undefined) {
      const next = { ...shell.state.freeSpins };
      let ok = true;
      if (fsCurrent !== undefined) {
        const n = asNumber(fsCurrent);
        if (Number.isNaN(n)) {
          bad('freeSpinsCurrent', fsCurrent, 'a number');
          ok = false;
        } else next.current = n;
      }
      if (fsTotalWin !== undefined) {
        const n = asNumber(fsTotalWin);
        if (Number.isNaN(n)) {
          bad('freeSpinsTotalWin', fsTotalWin, 'a number');
          ok = false;
        } else next.totalWin = n;
      }
      if (ok) apply('freeSpins', () => shell.setFreeSpins(next));
    }
    const bonus = value('bonus');
    if (bonus !== undefined) {
      if (isObject(bonus)) {
        apply('bonus', () => shell.setBonus(bonus as { label: string; value: string; totalWin: number }));
      } else {
        bad('bonus', bonus, 'a bonus object');
      }
    }
    const bonusTotalWin = value('bonusTotalWin');
    if (bonusTotalWin !== undefined) {
      const n = asNumber(bonusTotalWin);
      if (Number.isNaN(n)) bad('bonusTotalWin', bonusTotalWin, 'a number');
      else if (!shell.state.bonus) report('shell: bonusTotalWin: no bonus to update', 'warning');
      else apply('bonusTotalWin', () => shell.setBonus({ ...shell.state.bonus!, totalWin: n }));
    }
    const autoplay = value('autoplay');
    if (autoplay === 'tick') {
      apply('autoplay', () => {
        const a = shell.state.autoplay;
        // An unbounded autoplay (`remaining: Infinity`) is not counted down.
        if (!Number.isFinite(a.remaining)) return;
        const remaining = Math.max(0, a.remaining - 1);
        shell.setAutoplay({ active: remaining > 0, remaining });
      });
    } else if (autoplay === 'stop') {
      apply('autoplay', () => shell.setAutoplay({ active: false, remaining: 0 }));
    } else if (autoplay !== undefined) {
      const n = asNumber(autoplay);
      if (Number.isNaN(n)) bad('autoplay', autoplay, "a number, 'tick' or 'stop'");
      else apply('autoplay', () => shell.setAutoplay({ active: n > 0, remaining: n }));
    }
    return { out: 'next' };
  },
};

/**
 * "The result was shown" — `SessionService.ack`, a provider's credit hook
 * (`session-sdk`'s `playAck`). No session, or no `vars.result` to ack, is
 * a warning and `next`; a provider WITHOUT the hook (`session-host`, by
 * design) is silence — the hook is optional, and a flow authored once
 * runs against either provider without a warning per spin. A hook that
 * throws is an error on the node; the flow carries on either way.
 */
const ack: FlowNodeKind = {
  kind: 'ack',
  schema: none,
  outs: ['next'],
  async run(_p, { ctx, vars, report }) {
    const session = ctx.reflect.get('session', false) as SessionService | undefined;
    const result = vars.result as SpinResult | undefined;
    if (!session || !result) {
      report('nothing to ack', 'warning');
      return { out: 'next' };
    }
    try {
      session.ack?.(result);
    } catch (e) {
      report(e instanceof Error ? e.message : String(e));
    }
    return { out: 'next' };
  },
};

/** Special-cased by the interpreter: passes once every incoming edge has arrived this run. */
const merge: FlowNodeKind = { kind: 'merge', schema: none, outs: ['next'] };

export const BUILTIN_KINDS: FlowNodeKind<any>[] = [
  boot,
  on,
  spin,
  step,
  present,
  show,
  hide,
  load,
  wait,
  ifKind,
  set,
  emit,
  prop,
  shell,
  ack,
  merge,
];
