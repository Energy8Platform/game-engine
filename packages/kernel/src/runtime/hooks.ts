import { type Diagnostic, describeError, error } from '../diagnostics';
import { isPlainObject } from '../schema/validate';

export type HookFn = (payload: unknown) => void | Promise<void>;

/**
 * Deepest chain of SYNCHRONOUSLY nested `emit()` calls on one bus (a handler of hook A emitting hook
 * B whose own handler emits hook A, and so on, with none of them yielding to the event loop in
 * between). A chain this deep is a cycle between plugins, not a design — mirrors `MAX_SCHEMA_DEPTH`'s
 * role in `schema/validate.ts`: the cap turns a stack overflow that reports nothing into a diagnostic
 * that names the hook.
 *
 * Deliberately SYNCHRONOUS nesting only, not "how many `emit()` calls are currently in flight": the
 * failure mode this guards is a stack overflow, and stacks only overflow from synchronous recursion.
 * A purely asynchronous hook ping-pong — each side properly `await`s the other, yielding to the event
 * loop every round — never overflows the stack (each `emit()` call's synchronous portion returns
 * before the next one begins) and so is deliberately NOT bounded by this cap; nothing in this package
 * currently detects that shape, and it would need a different mechanism (each hop is indistinguishable
 * from two unrelated callers happening to emit into each other) if it ever needed to be.
 */
export const MAX_HOOK_DEPTH = 16;

export interface HookBus {
  /** The hook ids this bus accepts. */
  ids(): readonly string[];
  /** Register a handler. Returns a diagnostic instead of registering when the call is not allowed. */
  on(pluginId: string, hook: string, fn: HookFn): Diagnostic | null;
  /** Run every handler of a hook, in registration order. Never rejects. */
  emit(hook: string, payload?: unknown): Promise<Diagnostic[]>;
}

export interface HookBusOptions {
  /** The closed list of hook ids. Supplied by the caller — the kernel names no game-domain hooks. */
  ids: readonly string[];
  /** Plugin id → the hooks that plugin declared in its manifest. */
  declared: Record<string, readonly string[]>;
}

/**
 * The escape hatch, deliberately narrow.
 *
 * A hook is opaque to the IDE — no schema, no form. That is why the list is closed and why a plugin
 * must DECLARE the hooks it uses: the IDE cannot show what a hook does, but it can at least show
 * that one exists and name the plugin responsible. Registering an undeclared hook is refused.
 *
 * `ids` and `declared` are both defended once, here, rather than on every `on()`/`emit()` call:
 *  - `ids` is filtered down to actual strings. Besides membership tests, the only other thing this
 *    module does with it is `.join(', ')` for a diagnostic's `fix` text, and `Array.prototype.join`
 *    throws on a Symbol element exactly like a template literal does — one bad entry from a hostile
 *    caller would otherwise take down every `on()` call that ever misses, not just the one that
 *    supplied it.
 *  - `declared` is copied into a `Map`, keyed by plugin id, instead of read as a plain object on
 *    every `on()` call. A plugin id is caller-controlled data (a manifest's own `id` field), and on
 *    a plain object `declared['__proto__']` / `declared['constructor']` do not read as "not found" —
 *    they silently return `Object.prototype` / the `Object` constructor (inherited, not own,
 *    properties), which then breaks the `.includes` call immediately after it. This is not
 *    hypothetical: `resolve.ts` stores its own hook → plugin-ids map the same way, keyed by hook
 *    instead of plugin id, and `(hooks[hook] ??= []).push(...)` throws for exactly these three names
 *    — confirmed by running it, not assumed; see the task report. A `Map`'s keys are never confused
 *    with inherited properties, which closes this off by construction rather than by remembering to
 *    guard every read.
 */
export function createHookBus(opts: HookBusOptions): HookBus {
  const rawIds: unknown = opts?.ids;
  const ids: readonly string[] = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === 'string') : [];

  const rawDeclared: unknown = opts?.declared;
  const declared = new Map<string, readonly string[]>();
  if (isPlainObject(rawDeclared)) {
    for (const [pluginId, hookList] of Object.entries(rawDeclared)) {
      declared.set(pluginId, Array.isArray(hookList) ? hookList : []);
    }
  }

  // hook -> handlers, in registration order. A Map for the same reason as `declared` above: `hook`
  // is plugin-supplied data too, and this is exactly the `storage[dynamicKey]` shape that breaks for
  // '__proto__' et al. on a plain object.
  const handlers = new Map<string, { pluginId: string; fn: HookFn }[]>();

  // Re-entrancy bookkeeping for `emit()`, explained in full where it is used below. `syncDepth` counts
  // only the SYNCHRONOUS portion of calling a handler, not the whole `emit()` call's async lifetime —
  // see MAX_HOOK_DEPTH's own doc for why that distinction is load-bearing.
  let syncDepth = 0;
  let overflow: Diagnostic[] = [];

  const fixForUnknown = ids.length > 0 ? `Known hooks: ${ids.join(', ')}.` : 'This bus has no known hooks at all — check how it was constructed.';

  return {
    // A copy, not the live array: `ids` also backs every `on()` membership check below, so handing
    // out the reference itself would let a caller that merely wants to list the known hooks (the IDE,
    // say) mutate what this bus considers "closed" from the outside.
    ids: () => [...ids],

    on(pluginId, hook, fn) {
      const hookName = typeof hook === 'string' ? hook : undefined;
      const pluginName = typeof pluginId === 'string' ? pluginId : undefined;

      if (hookName === undefined || !ids.includes(hookName)) {
        return error('hooks/unknown', `There is no hook called "${String(hook)}".`, {
          pluginId: pluginName,
          fix: fixForUnknown,
        });
      }
      if (pluginName === undefined || !(declared.get(pluginName) ?? []).includes(hookName)) {
        return error('hooks/undeclared', `"${String(pluginId)}" uses hook "${hookName}" without declaring it.`, {
          pluginId: pluginName,
          fix: `Add \`hooks: ['${hookName}']\` to the plugin manifest.`,
        });
      }
      if (typeof fn !== 'function') {
        return error(
          'hooks/not-a-function',
          `"${pluginName}" registered something other than a function for hook "${hookName}".`,
          { pluginId: pluginName, fix: 'Pass a function (sync or async) as the third argument to on().' },
        );
      }

      let list = handlers.get(hookName);
      if (!list) {
        list = [];
        handlers.set(hookName, list);
      }
      list.push({ pluginId: pluginName, fn });
      return null;
    },

    async emit(hook, payload) {
      // Re-entrancy guard. Two hooks whose handlers emit each other (a's `bootstrap` handler emits
      // `dispose`, b's `dispose` handler emits `bootstrap`) is a plausible accidental coupling between
      // two unrelated plugins, not an attack — and an unbounded version of exactly that recurses the
      // JS call stack (not just "loops a lot") and throws `RangeError: Maximum call stack size
      // exceeded` a few thousand frames in — confirmed by running it, not assumed.
      //
      // `isTopLevelEntry` captures, once, whether THIS call is nested inside another handler's
      // synchronous execution (`syncDepth > 0`) or is a fresh entry (`syncDepth === 0`) — used below to
      // decide which call is allowed to drain `overflow`. Fix round 1 tracked one `depth` counter for
      // an `emit()` call's entire async lifetime (entry to its final return) and got this wrong: TWO
      // unrelated, non-recursive, concurrently in-flight top-level `emit()` calls (e.g.
      // `Promise.all(ids.map((id) => bus.emit(id)))`, the common "notify and move on" shape) both hold
      // that counter up for as long as either is still awaiting something, so past ~16 concurrently
      // in-flight calls the LATER ones were refused as a false "recursion", even though nothing was
      // nested at all — confirmed by running it: 25 concurrent, unrelated, shallow emits left 9 of them
      // silently unrun. Fixed by tracking only SYNCHRONOUS nesting (`syncDepth`, below): JS is
      // single-threaded, so two calls can never both be inside their own synchronous portion at the
      // same instant, which makes that false positive structurally impossible while still catching
      // genuine synchronous recursion. See `MAX_HOOK_DEPTH`'s own doc for what this does and does not
      // bound.
      const isTopLevelEntry = syncDepth === 0;

      if (syncDepth >= MAX_HOOK_DEPTH) {
        // Recorded in the shared `overflow` bucket, not returned directly, because THIS call is
        // reachable only from deep inside another handler's own synchronous call chain — often via a
        // `void`-fired, never-awaited `emit()` — which means whatever this call resolves with is
        // discarded by its caller and never seen again. `overflow` is how the diagnostic reaches
        // somewhere anyone is actually listening: the top-level entry, below.
        overflow.push(
          error(
            'hooks/recursion-limit',
            `Hook "${String(hook)}" recursed past ${MAX_HOOK_DEPTH} nested emit() calls — this usually means two hooks are triggering each other.`,
            { fix: 'Break the cycle: avoid emitting a hook from directly inside another handler chain for a hook.' },
          ),
        );
        return [];
      }

      const diagnostics: Diagnostic[] = [];
      const list = handlers.get(hook);
      if (list) {
        // A snapshot of the ARRAY, not just its length: `list` is the very array `on()` pushes onto.
        // A length-only snapshot is correct only as long as nothing can ever REMOVE a handler — true
        // today (there is no `off()`), but that invariant would then live entirely in the reader's
        // head, not in this loop. A shrink would make the destructure below throw (it sits outside
        // the try), and any future reordering could double-run one handler while skipping another.
        // Copying the array costs the same as recording its length and is correct regardless: this
        // pass runs exactly the handlers present when it started, full stop — including a handler
        // registered mid-emit (queued for the NEXT emit() instead of running in this one, since it
        // is appended to `list` after the snapshot was already taken).
        const snapshot = [...list];
        for (const { pluginId, fn } of snapshot) {
          try {
            // `syncDepth` brackets ONLY the synchronous act of calling `fn` and capturing whatever it
            // returns — not the `await` below. A handler that is itself `async` (or otherwise returns
            // a promise) only runs synchronously up to ITS OWN first `await`/`return`; a nested
            // `emit()` call started from within that synchronous portion sees `syncDepth` elevated and
            // is correctly treated as nested, but by the time this handler's ASYNC TAIL resumes (its
            // internal await settling, a microtask or more later), `syncDepth` is already back down —
            // so a sibling call that starts while THIS one is merely awaiting something never sees it.
            let result: unknown;
            syncDepth++;
            try {
              result = fn(payload);
            } finally {
              syncDepth--;
            }
            await result;
          } catch (err) {
            diagnostics.push(
              error('hooks/handler-failed', `"${pluginId}" failed in hook "${String(hook)}": ${describeError(err)}`, {
                pluginId,
              }),
            );
          }
        }
      }

      // Only a call that was ITSELF a fresh, non-nested entry drains `overflow` — never one nested
      // inside another handler's synchronous execution, even though (for a `void`-fired recursive
      // chain) an inner call's own await can settle, and so reach this point, BEFORE the outer one's
      // does. Draining from a nested call would let an orphaned, nobody-is-awaiting-it frame consume
      // the diagnostic before the call an actual caller is awaiting ever gets a chance to see it. This
      // remains an approximation, not a precise per-chain tracker (unreachable without something like
      // `AsyncLocalStorage`, a Node builtin this package does not depend on): of the calls that DO
      // qualify as top-level entries, whichever one happens to reach this line first, while `overflow`
      // is non-empty, claims it — sufficient for the case this guards against (a synchronous cycle
      // entirely inside one top-level call's own handler chain), without a dependency for it.
      if (isTopLevelEntry && overflow.length > 0) {
        diagnostics.push(...overflow);
        overflow = [];
      }

      return diagnostics;
    },
  };
}

/**
 * Invert `plan.hooks` (hook → plugin ids) into the `declared` map this bus wants (plugin id →
 * hooks). Never throws: `hooks` comes off a `ResolvedPlan` this module does not control the
 * construction of, so it gets the same defense `createHookBus` gives `declared` — accumulated into a
 * `Map` (immune to a plugin literally named '__proto__' turning up inside one of the arrays) and
 * only converted to the plain object the return type promises at the very end, via
 * `Object.fromEntries`. That conversion is itself deliberate: unlike an object LITERAL, which
 * special-cases a `__proto__` key as "set the prototype" instead of "add a property",
 * `Object.fromEntries` assigns it as a genuine own property — confirmed by running it, not assumed.
 */
export function declaredFromPlan(hooks: Record<string, string[]>): Record<string, string[]> {
  const raw: unknown = hooks;
  const out = new Map<string, string[]>();
  if (isPlainObject(raw)) {
    for (const [hook, pluginIds] of Object.entries(raw)) {
      if (!Array.isArray(pluginIds)) continue;
      for (const pluginId of pluginIds) {
        if (typeof pluginId !== 'string') continue;
        const list = out.get(pluginId);
        if (list) {
          // A plugin can end up here twice for the same hook only if ITS OWN manifest declared that
          // hook twice (resolvePlan does not deduplicate `manifest.hooks` before pushing) — `declared`
          // is conceptually a set of "hooks this plugin uses", so that redundancy is absorbed here
          // rather than handed to createHookBus as a growing, increasingly misleading array.
          if (!list.includes(hook)) list.push(hook);
        } else {
          out.set(pluginId, [hook]);
        }
      }
    }
  }
  return Object.fromEntries(out);
}
