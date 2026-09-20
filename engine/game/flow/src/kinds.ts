/**
 * The flow node-kind registry (`ctx.flowNodes`) and the thirteen built-in
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
import type { Diagnostic, PresentationStep, Severity } from '@energy8engine/contracts';
import type { PlayService } from '@energy8engine/play-loop/runtime';
import type { SceneRef, ScenesService } from '@energy8engine/scenes';
import { createRegistry } from '@energy8engine/registry';
import type { EventsService } from './events';
import { evaluate, readPath } from './expr';

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
  fetchFn: typeof fetch;
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
  arm?(props: P, fire: (vars?: Record<string, unknown>) => void, ctx: RunCtx): () => void;
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

/** A prop value: a `$path` string reads a var, anything else is the literal. */
const resolve = (value: unknown, vars: Record<string, unknown>) =>
  typeof value === 'string' && value.startsWith('$') ? readPath(value, vars) : value;

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

const on: FlowNodeKind<{ event: string; busy: 'ignore' | 'queue' }> = {
  kind: 'on',
  schema: Schema.object({
    event: Schema.string().required().description('event name'),
    busy: Schema.union(['ignore', 'queue'])
      .default('ignore')
      .description('a fire while a run is live: drop it, or fire once after the runs drain'),
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
        fire(vars);
      });
    return service<EventsService>(ctx, 'events').on(p.event, (event) => {
      if (!busy()) return fire({ event });
      if (p.busy !== 'queue') return;
      if (queued === undefined) drain();
      queued = { event }; // coalesce: the latest payload wins
    });
  },
};

/**
 * POSTs a spin/step request body to `/api/spin` and turns the answer into
 * the `spin`/`step` kinds' own `run` result. Shared: both kinds build the
 * same `{ out: 'result', vars: { result, request } }` /
 * `{ out: 'failed', vars: { error } }` shape from the same endpoint, only
 * the request body they build differs.
 */
async function postSpin(
  body: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<{ out: string; vars?: Record<string, unknown> }> {
  try {
    const res = await fetchFn('/api/spin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST /api/spin → ${res.status}`);
    const result: unknown = await res.json();
    return { out: 'result', vars: { result, request: body } };
  } catch (e) {
    return { out: 'failed', vars: { error: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Resolves a `betLevel` prop (a numeric literal or `$path`) into
 * `request.betLevel`, converting a literal string with `Number()` and
 * reporting + omitting one that isn't a number. `spin`'s own — `step` has
 * no `betLevel` prop (see its own doc: a `Step` carries no bet on the wire).
 */
function applyBetLevel(
  betLevelProp: string | undefined,
  vars: Record<string, unknown>,
  request: Record<string, unknown>,
  report: (message: string, severity?: Severity) => void,
): void {
  const betLevelRaw = resolve(betLevelProp, vars);
  if (betLevelRaw === undefined) return;
  if (typeof betLevelRaw === 'number') {
    request.betLevel = betLevelRaw;
    return;
  }
  const betLevel = Number(betLevelRaw);
  if (typeof betLevelRaw !== 'string' || betLevelRaw.trim() === '' || Number.isNaN(betLevel)) {
    report(`betLevel "${betLevelRaw}" is not a number`);
  } else {
    request.betLevel = betLevel;
  }
}

const spin: FlowNodeKind<{ action: string; betLevel?: string }> = {
  kind: 'spin',
  schema: Schema.object({
    action: Schema.string().default('spin').description('action name, or `$path` to read a var'),
    // A string, not a number: the IDE's number field cannot hold a `$path` —
    // `applyBetLevel` converts a literal with `Number()`.
    betLevel: Schema.string().description('bet level (a number), or `$path` to read a var'),
  }),
  outs: ['result', 'failed'],
  async run(p, { vars, fetchFn, report }) {
    const request: Record<string, unknown> = {};
    const action = resolve(p.action, vars);
    if (action !== undefined) request.action = action;
    applyBetLevel(p.betLevel, vars, request, report);
    return postSpin(request, fetchFn);
  },
};

/**
 * Steps an open round to its next response: unlike `spin` (which always
 * starts a fresh round), `step` carries the `roundId` a prior `result`
 * named and the `action` it offered in `nextActions` — the loop a `result.
 * roundComplete === false` puts the flow into. Both default to reading the
 * PREVIOUS response off `vars.result` (`readPath` follows the numeric
 * `nextActions.0` segment into the array), so a bare node needs no props;
 * either can still be a literal or a different `$path` for a flow that
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
      .description('the open round id (a literal), or `$path` to read a var'),
    action: Schema.string()
      .default('$result.nextActions.0')
      .description('next action name (a literal), or `$path` to read a var'),
  }),
  outs: ['result', 'failed'],
  async run(p, { vars, fetchFn, report }) {
    const roundId = resolve(p.roundId, vars);
    if (roundId == null || roundId === '') {
      report(`'step' has no roundId to send (resolved from '${p.roundId}')`);
      return { out: 'failed', vars: { error: "'step' has no roundId" } };
    }
    const action = resolve(p.action, vars);
    if (action == null || action === '') {
      report(`'step' has no action to send (resolved from '${p.action}')`);
      return { out: 'failed', vars: { error: "'step' has no action" } };
    }
    const request: Record<string, unknown> = { action, roundId };
    return postSpin(request, fetchFn);
  },
};

const present: FlowNodeKind = {
  kind: 'present',
  schema: none,
  outs: ['next', 'failed'],
  async run(_p, { ctx, vars }) {
    const result = vars.result as { stage: string; data: Record<string, unknown> } | undefined;
    if (!result) throw new Error('vars.result is missing — run `spin` first');
    const { plan, diagnostics } = service<MechanicsLike>(ctx, 'mechanics').present(result.stage, result.data);
    const play = service<PlayService>(ctx, 'play');
    const problems = diagnostics.length ? diagnostics : await play.execute(plan, ctx.reflect.get('board', false));
    // The spin log: what was drawn — `[]` when the presentation failed.
    play.record({
      request: (vars.request as Record<string, unknown>) ?? {},
      result,
      plan: problems.length ? [] : plan,
    });
    if (problems.length) return { out: 'failed', vars: { plan, error: problems.map((d) => d.message).join('; ') } };
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
    value: Schema.any().description('literal, or `$path` to read a var'),
  }),
  outs: ['next'],
  async run(p, { vars }) {
    return { out: 'next', vars: { [p.name]: resolve(p.value, vars) } };
  },
};

const emit: FlowNodeKind<{ event: string; payload?: unknown }> = {
  kind: 'emit',
  schema: Schema.object({
    event: Schema.string().required().description('event name'),
    payload: Schema.any().description('literal, or `$path` to read a var'),
  }),
  outs: ['next'],
  async run(p, { ctx, vars }) {
    service<EventsService>(ctx, 'events').emit(p.event, resolve(p.payload, vars));
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
 * literal or `$path` (`resolve`); a literal `value` is coerced by the
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
      .description('`<scene>/<node>` (a literal), or `$path` to read a var'),
    prop: Schema.string().required().description('prop name'),
    value: Schema.string()
      .default('')
      .description(
        "literal, coerced by the prop's schema type (number/boolean/string), or `$path` to read a var",
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

    const ref = parseTarget(String(resolve(p.target, vars) ?? ''));
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

    let value: unknown;
    if (typeof p.value === 'string' && p.value.startsWith('$')) {
      value = resolve(p.value, vars);
      // The var IS already typed, so a `$path` skips the literal branch's
      // own Number()/boolean coercion below for everything EXCEPT a
      // `string` target — `Schema.string()` throws outright on anything
      // but a JS string, and `setProps` would refuse the whole patch (a
      // `$result.win` float into a `text` node's `text` prop, the
      // example's own `show_win` node, is exactly this case). Only a
      // number/boolean is stringified; an object or `null` is left for
      // `setProps` to refuse, same as before this branch existed.
      const type = dict?.[p.prop]?.type;
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
  wait,
  ifKind,
  set,
  emit,
  prop,
  merge,
];
