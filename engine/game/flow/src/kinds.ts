/**
 * The flow node-kind registry (`ctx.flowNodes`) and the fifteen built-in
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
import type {
  Diagnostic,
  PlayRequest,
  PresentationStep,
  SessionService,
  Severity,
  SpinResult,
} from '@energy8engine/contracts';
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

/** `v` as a number: a number as is, a non-blank numeric string via `Number()`, anything else `NaN`. */
const asNumber = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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
 * Plays one request through the composition's `session` seam and turns the
 * answer into the `spin`/`step` kinds' own `run` result. Shared: both kinds
 * build the same `{ out: 'result', vars: { result, request } }` /
 * `{ out: 'failed', vars: { error } }` shape, only the request differs.
 *
 * Lenient on the seam — a page composed `without: ['session']` (the
 * composition editor) has none. No session, a play without a result (the
 * provider's diagnostics are re-reported on the node, with their severity)
 * and a `play` that throws all leave by `failed` with the reason, rather
 * than ending the branch: the flow still reaches whatever it wired there
 * (a `shell { busy: false }` that re-enables Spin, say).
 */
async function playThrough(
  ctx: Context,
  request: PlayRequest,
  report: RunCtx['report'],
): Promise<{ out: string; vars?: Record<string, unknown> }> {
  const session = ctx.reflect.get('session', false) as SessionService | undefined;
  if (!session) {
    report('no session row in this composition');
    return { out: 'failed', vars: { error: 'no session' } };
  }
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
  request: PlayRequest,
  report: (message: string, severity?: Severity) => void,
): void {
  const betLevelRaw = resolve(betLevelProp, vars);
  if (betLevelRaw === undefined) return;
  const betLevel = asNumber(betLevelRaw);
  if (Number.isNaN(betLevel)) report(`betLevel "${betLevelRaw}" is not a number`);
  else request.betLevel = betLevel;
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
  async run(p, { ctx, vars, report }) {
    const action = resolve(p.action, vars);
    if (action == null || action === '') {
      report(`'spin' has no action to send (resolved from '${p.action}')`);
      return { out: 'failed', vars: { error: "'spin' has no action" } };
    }
    const request: PlayRequest = { action: action as string };
    applyBetLevel(p.betLevel, vars, request, report);
    return playThrough(ctx, request, report);
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
  async run(p, { ctx, vars, report }) {
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
    const request: PlayRequest = { action: action as string, roundId: roundId as string };
    return playThrough(ctx, request, report);
  },
};

const present: FlowNodeKind<{ turbo: string }> = {
  kind: 'present',
  schema: Schema.object({
    turbo: Schema.string()
      .default('$turbo')
      .description(
        "literal 'true', or a `$path` to a var (`true`, or a number > 0 — the shell's `$shell.turbo`) — hurries the board while this plan plays",
      ),
  }),
  outs: ['next', 'failed'],
  async run(p, { ctx, vars }) {
    const result = vars.result as { stage: string; data: Record<string, unknown> } | undefined;
    if (!result) throw new Error('vars.result is missing — run `spin` first');
    const { plan, diagnostics } = service<MechanicsLike>(ctx, 'mechanics').present(result.stage, result.data);
    const play = service<PlayService>(ctx, 'play');
    const turbo = resolve(p.turbo, vars);
    const opts = {
      turbo: turbo === true || turbo === 'true' || (typeof turbo === 'number' && turbo > 0),
    };
    const problems = diagnostics.length
      ? diagnostics
      : await play.execute(plan, ctx.reflect.get('board', false), undefined, opts);
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

/**
 * The `Shell` handle (`@energy8engine/shell-pixi` provides it as `shell`),
 * as much of it as the `shell` kind drives — declared structurally here so
 * the flow does not depend on the shell package.
 */
interface ShellLike {
  state: { autoplay: { active: boolean; remaining: number } };
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
  bonus: string;
  autoplay: string;
}

const SHELL_MODES = ['base', 'bonus', 'freeSpins', 'replay'];

/**
 * The flow's one door to the shell's readouts. Every prop is a string:
 * `''` leaves that readout untouched, a `$path` resolves first, a literal
 * is coerced by the setter's type. `mode`/`busy`/`buyBonusEnabled` are
 * unions of their literals, so the IDE draws a dropdown and a typo is
 * refused at the schema; `run` checks the same sets again for a value that
 * reached it unvalidated. A value that cannot be set (NaN, a bad enum, a
 * setter that throws) is a diagnostic on the node and the OTHER props
 * still apply, in schema order — a readout that cannot be set does not
 * stop the round. No `shell` service at all (the composition editor) is a
 * warning, and `next`.
 */
const shell: FlowNodeKind<ShellProps> = {
  kind: 'shell',
  schema: Schema.object({
    balance: Schema.string()
      .default('')
      .description('balance readout, currency units (a number), or `$path` — e.g. `$result.balance`'),
    win: Schema.string()
      .default('')
      .description('win readout, currency units (a number), or `$path` — e.g. `$result.winAmount`; counts up'),
    bet: Schema.string().default('').description('bet readout, currency units (a number), or `$path`'),
    mode: Schema.union(['', 'base', 'bonus', 'freeSpins', 'replay'])
      .default('')
      .description('what the bar shows'),
    busy: Schema.union(['', 'true', 'false']).default('').description('Spin disabled while a round plays'),
    turbo: Schema.string().default('').description('turbo level (a number), or `$path`'),
    buyBonusEnabled: Schema.union(['', 'true', 'false'])
      .default('')
      .description('whether Buy Bonus can be pressed'),
    freeSpins: Schema.string()
      .default('')
      .description('spins total (a number), or `$path` to `{ current?, total, totalWin }`'),
    bonus: Schema.string()
      .default('')
      .description('`$path` to `{ label, value, totalWin }` — a bonus readout in the bar hero'),
    autoplay: Schema.string()
      .default('')
      .description("'tick' (one autoplay spin done), 'stop', or a count (a number, or `$path`)"),
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
      p[prop] === '' ? undefined : resolve(p[prop], vars);
    const bad = (prop: keyof ShellProps, what: string) =>
      report(`shell: ${prop} "${p[prop]}" is not ${what}`);
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
      if (Number.isNaN(n)) bad(prop, 'a number');
      else apply(prop, () => set(n));
    };
    const flag = (prop: keyof ShellProps, set: (b: boolean) => void) => {
      const v = value(prop);
      if (v === undefined) return;
      if (v !== true && v !== false && v !== 'true' && v !== 'false') bad(prop, 'a boolean');
      else apply(prop, () => set(v === true || v === 'true'));
    };

    num('balance', (n) => shell.setBalance(n));
    num('win', (n) => shell.setWin(n, { animate: true }));
    num('bet', (n) => shell.setBet(n));
    const mode = value('mode');
    if (mode !== undefined) {
      if (typeof mode === 'string' && SHELL_MODES.includes(mode)) apply('mode', () => shell.setMode(mode));
      else bad('mode', `a mode (${SHELL_MODES.join('|')})`);
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
        bad('freeSpins', 'a number or a free-spins object');
      }
    }
    const bonus = value('bonus');
    if (bonus !== undefined) {
      if (isObject(bonus)) {
        apply('bonus', () => shell.setBonus(bonus as { label: string; value: string; totalWin: number }));
      } else {
        bad('bonus', 'a bonus object');
      }
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
      if (Number.isNaN(n)) bad('autoplay', "a number, 'tick' or 'stop'");
      else apply('autoplay', () => shell.setAutoplay({ active: n > 0, remaining: n }));
    }
    return { out: 'next' };
  },
};

/**
 * "The result was shown" — `SessionService.ack`, a provider's credit hook
 * (`session-sdk`'s `playAck`; `session-host` has none). No session, no
 * hook, or no `vars.result` to ack is a warning and `next` — the flow
 * carries on either way; a hook that throws is an error on the node.
 */
const ack: FlowNodeKind = {
  kind: 'ack',
  schema: none,
  outs: ['next'],
  async run(_p, { ctx, vars, report }) {
    const session = ctx.reflect.get('session', false) as SessionService | undefined;
    const result = vars.result as SpinResult | undefined;
    if (!session?.ack || !result) {
      report('nothing to ack', 'warning');
      return { out: 'next' };
    }
    try {
      session.ack(result);
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
  wait,
  ifKind,
  set,
  emit,
  prop,
  shell,
  ack,
  merge,
];
