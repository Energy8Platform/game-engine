import { type Diagnostic, error } from '../diagnostics';
import { isPlainObject } from '../schema/validate';

export type HookFn = (payload: unknown) => void | Promise<void>;

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

/** `err instanceof Error ? err.message : String(err)`. `String()`, not a template literal or `+`:
 *  a handler is free to throw anything, including a Symbol, and a template literal's implicit
 *  ToString throws on exactly that where `String()` does not (same rule `manifest/define.ts` and
 *  `resolve/resolve.ts` apply to untrusted manifest data — a handler's thrown value is no different). */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
          fix: `Known hooks: ${ids.join(', ')}.`,
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
      const diagnostics: Diagnostic[] = [];
      const list = handlers.get(hook);
      if (!list) return diagnostics;

      // Snapshot the LENGTH, not the list itself: `list` is the very array `on()` pushes onto, and a
      // handler is free to call `on()` again for THIS hook while this loop is running — a plugin
      // registering a follow-up handler from inside its own bootstrap hook, say. The default array
      // iterator re-reads `.length` on every step, so iterating the live array would run a handler
      // added mid-emit within the SAME pass — and if that handler's own execution registers another
      // one, nothing would bound how long this loop runs. Freezing `len` up front means a handler
      // added during emit is queued for the NEXT emit() call instead: this pass runs exactly the
      // handlers that existed when it started, full stop, regardless of what any of them do while
      // they run.
      const len = list.length;
      for (let i = 0; i < len; i++) {
        const { pluginId, fn } = list[i];
        try {
          await fn(payload);
        } catch (err) {
          diagnostics.push(
            error('hooks/handler-failed', `"${pluginId}" failed in hook "${String(hook)}": ${messageOf(err)}`, {
              pluginId,
            }),
          );
        }
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
