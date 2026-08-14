import { describe, expect, it, vi } from 'vitest';
import { createHookBus, declaredFromPlan } from '@/runtime/hooks';
import { describeError } from '@/diagnostics';

const IDS = ['bootstrap', 'dispose'] as const;

function bus(declared: Record<string, readonly string[]> = { a: ['bootstrap'], b: ['bootstrap', 'dispose'] }) {
  return createHookBus({ ids: IDS, declared });
}

describe('createHookBus', () => {
  it('exposes the ids it was built with', () => {
    expect(bus().ids()).toEqual(['bootstrap', 'dispose']);
  });

  it('registers a hook the plugin declared', async () => {
    const b = bus();
    const fn = vi.fn();
    expect(b.on('a', 'bootstrap', fn)).toBeNull();
    await b.emit('bootstrap', { n: 1 });
    expect(fn).toHaveBeenCalledWith({ n: 1 });
  });

  it('refuses a hook the plugin did not declare, and does not register it', async () => {
    const b = bus();
    const fn = vi.fn();
    const diagnostic = b.on('a', 'dispose', fn);
    expect(diagnostic).toMatchObject({ severity: 'error', code: 'hooks/undeclared', pluginId: 'a' });
    await b.emit('dispose');
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a hook id that does not exist at all', () => {
    const b = bus();
    expect(b.on('a', 'nonsense', vi.fn())).toMatchObject({ code: 'hooks/unknown' });
  });

  it('runs handlers in registration order', async () => {
    const b = bus();
    const calls: string[] = [];
    b.on('a', 'bootstrap', () => void calls.push('a'));
    b.on('b', 'bootstrap', () => void calls.push('b'));
    await b.emit('bootstrap');
    expect(calls).toEqual(['a', 'b']);
  });

  it('awaits async handlers before resolving', async () => {
    const b = bus();
    let done = false;
    b.on('a', 'bootstrap', async () => {
      await new Promise((r) => setTimeout(r, 5));
      done = true;
    });
    await b.emit('bootstrap');
    expect(done).toBe(true);
  });

  it('isolates a throwing handler and still runs the rest', async () => {
    const b = bus();
    const after = vi.fn();
    b.on('a', 'bootstrap', () => {
      throw new Error('handler exploded');
    });
    b.on('b', 'bootstrap', after);
    const diagnostics = await b.emit('bootstrap');
    expect(after).toHaveBeenCalled();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'hooks/handler-failed', pluginId: 'a' });
    expect(diagnostics[0].message).toContain('handler exploded');
  });

  it('emitting a hook with no handlers is a no-op', async () => {
    expect(await bus().emit('dispose')).toEqual([]);
  });
});

// ── Hostile construction: `ids` ─────────────────────────────────────────────

describe('createHookBus — hostile construction: ids', () => {
  it('ids: null does not throw; nothing is known', () => {
    expect(() => createHookBus({ ids: null as never, declared: {} })).not.toThrow();
    const b = createHookBus({ ids: null as never, declared: {} });
    expect(b.ids()).toEqual([]);
    expect(b.on('a', 'bootstrap', vi.fn())).toMatchObject({ code: 'hooks/unknown' });
  });

  it('ids: a string does not throw; behaves like no known hooks (a string is not an array)', () => {
    const b = createHookBus({ ids: 'bootstrap' as never, declared: {} });
    expect(b.ids()).toEqual([]);
    expect(b.on('a', 'bootstrap', vi.fn())).toMatchObject({ code: 'hooks/unknown' });
  });

  it('ids: an array containing non-strings keeps only the real strings, and a filtered-out Symbol can never reach Array.prototype.join', () => {
    const weird = ['bootstrap', 42, null, undefined, Symbol('x'), {}, 'dispose'] as unknown as readonly string[];
    const b = createHookBus({ ids: weird, declared: { a: ['bootstrap', 'dispose'] } });
    expect(b.ids()).toEqual(['bootstrap', 'dispose']);
    expect(() => b.on('a', 'nonsense', vi.fn())).not.toThrow();
    expect(b.on('a', 'nonsense', vi.fn())).toMatchObject({ code: 'hooks/unknown', fix: 'Known hooks: bootstrap, dispose.' });
  });

  it('ids: [] means nothing is known — every on() is refused, every emit() is a no-op', async () => {
    const b = createHookBus({ ids: [], declared: { a: ['bootstrap'] } });
    expect(b.ids()).toEqual([]);
    expect(await b.emit('bootstrap')).toEqual([]);
    // Minor fix round 1: `Known hooks: ${ids.join(', ')}.` on an empty list rendered the useless
    // "Known hooks: .", not "there are none" — the actual, more useful state of the bus.
    const diagnostic = b.on('a', 'bootstrap', vi.fn());
    expect(diagnostic).toMatchObject({ code: 'hooks/unknown' });
    expect(diagnostic?.fix).not.toBe('Known hooks: .');
    expect(diagnostic?.fix?.toLowerCase()).toContain('no known hooks');
  });

  it('ids(): returns a copy — mutating the returned array cannot corrupt the bus\'s own closed list', () => {
    const b = bus();
    const snapshot = b.ids();
    (snapshot as string[]).push('evil');
    expect(b.ids()).toEqual(['bootstrap', 'dispose']);
    expect(b.on('a', 'evil', vi.fn())).toMatchObject({ code: 'hooks/unknown' });
  });
});

// ── Hostile construction: `declared` ────────────────────────────────────────

describe('createHookBus — hostile construction: declared', () => {
  it('declared: null does not throw; nothing is declared for anyone', () => {
    expect(() => createHookBus({ ids: IDS, declared: null as never })).not.toThrow();
    const b = createHookBus({ ids: IDS, declared: null as never });
    expect(b.on('a', 'bootstrap', vi.fn())).toMatchObject({ code: 'hooks/undeclared', pluginId: 'a' });
  });

  it('declared: an array does not throw; treated the same as no declarations (isPlainObject rejects arrays)', () => {
    const b = createHookBus({ ids: IDS, declared: [] as never });
    expect(b.on('a', 'bootstrap', vi.fn())).toMatchObject({ code: 'hooks/undeclared' });
  });

  it('declared: an object whose values are not arrays does not throw; that plugin is treated as having declared nothing', () => {
    const b = createHookBus({ ids: IDS, declared: { a: 'bootstrap' as never, b: 42 as never } });
    expect(b.on('a', 'bootstrap', vi.fn())).toMatchObject({ code: 'hooks/undeclared' });
    expect(b.on('b', 'bootstrap', vi.fn())).toMatchObject({ code: 'hooks/undeclared' });
  });
});

// ── Prototype-shaped hook ids ────────────────────────────────────────────────
//
// A sibling module in this package (resolve.ts's `hooks: Record<string, string[]> = {}`, built with
// `(hooks[hook] ??= []).push(...)`) throws for a hook literally named '__proto__', 'constructor', or
// 'toString': reading a plain object's inherited property of that name does not return undefined, so
// `??=` never assigns a fresh array, and the inherited value (Object.prototype / the Object
// constructor / Object.prototype.toString) has no `.push`. This module's handler storage is a `Map`
// specifically to avoid that. The tests below prove it, rather than assume it.

describe('createHookBus — prototype-shaped hook ids: Map-backed handler storage is unaffected', () => {
  const NASTY = ['__proto__', 'constructor', 'toString'] as const;

  it.each(NASTY)('registers and emits a hook literally named "%s" with no crash and no data loss', async (hookId) => {
    const b = createHookBus({ ids: NASTY, declared: { p: NASTY } });
    const fn = vi.fn();
    expect(b.on('p', hookId, fn)).toBeNull();
    await b.emit(hookId, 'payload');
    expect(fn).toHaveBeenCalledWith('payload');
  });

  it('all three can be declared and used by the same plugin without interfering with each other or with real Object internals', async () => {
    const b = createHookBus({ ids: NASTY, declared: { p: NASTY } });
    const calls: string[] = [];
    for (const hookId of NASTY) b.on('p', hookId, () => void calls.push(hookId));
    for (const hookId of NASTY) await b.emit(hookId);
    expect(calls).toEqual(['__proto__', 'constructor', 'toString']);
  });
});

// ── Prototype-shaped plugin ids ──────────────────────────────────────────────
//
// This is the sharper case: `declared` is a plain object per HookBusOptions's own type
// (`Record<string, readonly string[]>`), keyed by PLUGIN id. `declared['__proto__']` on an ordinary
// object returns the inherited Object.prototype, not undefined — `(declared[pluginId] ?? []).includes`
// would then call `.includes` on Object.prototype itself and throw. createHookBus converts `declared`
// to a Map up front for exactly this reason.

describe('createHookBus — prototype-shaped plugin ids: converting declared to a Map up front closes this', () => {
  const NASTY = ['__proto__', 'constructor', 'toString'];

  it.each(NASTY)('a plugin literally named "%s" can declare and use a hook without crashing on()', async (pluginId) => {
    const b = createHookBus({ ids: IDS, declared: { [pluginId]: ['bootstrap'] } });
    expect(() => b.on(pluginId, 'bootstrap', vi.fn())).not.toThrow();
    const fn = vi.fn();
    expect(b.on(pluginId, 'bootstrap', fn)).toBeNull();
    await b.emit('bootstrap', 42);
    expect(fn).toHaveBeenCalledWith(42);
  });

  it.each(NASTY)('a plugin literally named "%s" is refused (not crashed) for a hook it did not declare', (pluginId) => {
    const b = bus(); // default fixture: declared = { a: [...], b: [...] }; pluginId below is not a key
    expect(() => b.on(pluginId, 'dispose', vi.fn())).not.toThrow();
    expect(b.on(pluginId, 'dispose', vi.fn())).toMatchObject({ code: 'hooks/undeclared' });
  });
});

// ── on(): hostile pluginId / hook / fn ──────────────────────────────────────

describe('createHookBus — on() hostile pluginId', () => {
  it('pluginId: null does not throw; refused as undeclared (there is no declaration on file for it)', () => {
    const b = bus();
    expect(() => b.on(null as never, 'bootstrap', vi.fn())).not.toThrow();
    expect(b.on(null as never, 'bootstrap', vi.fn())).toMatchObject({ code: 'hooks/undeclared' });
  });

  it('pluginId: a Symbol does not throw building the message; refused as undeclared', () => {
    const b = bus();
    const sym = Symbol('plugin');
    expect(() => b.on(sym as never, 'bootstrap', vi.fn())).not.toThrow();
    const diagnostic = b.on(sym as never, 'bootstrap', vi.fn());
    expect(diagnostic).toMatchObject({ code: 'hooks/undeclared' });
    expect(diagnostic?.message).toContain('Symbol(plugin)');
  });

  // Task 11 review round 1: a Symbol didn't throw building this message (String(Symbol(...)) is
  // fine), but String() itself is not total — it throws for a null-prototype value, which a Symbol
  // test alone does not catch. describeError does.
  it('pluginId: a null-prototype value does not throw building the "undeclared" message', () => {
    const b = bus();
    const hostile = Object.create(null);
    expect(() => b.on(hostile as never, 'bootstrap', vi.fn())).not.toThrow();
    expect(b.on(hostile as never, 'bootstrap', vi.fn())).toMatchObject({ code: 'hooks/undeclared' });
  });
});

describe('createHookBus — on() hostile hook', () => {
  it('hook: null does not throw; refused as unknown', () => {
    const b = bus();
    expect(() => b.on('a', null as never, vi.fn())).not.toThrow();
    expect(b.on('a', null as never, vi.fn())).toMatchObject({ code: 'hooks/unknown' });
  });

  it('hook: a Symbol does not throw building the "unknown hook" message', () => {
    const b = bus();
    const sym = Symbol('hook');
    expect(() => b.on('a', sym as never, vi.fn())).not.toThrow();
    const diagnostic = b.on('a', sym as never, vi.fn());
    expect(diagnostic).toMatchObject({ code: 'hooks/unknown' });
    expect(diagnostic?.message).toContain('Symbol(hook)');
  });

  // Task 11 review round 1: same gap as the pluginId case above — String() throws for a
  // null-prototype value even though it survives a Symbol.
  it('hook: a null-prototype value does not throw building the "unknown hook" message', () => {
    const b = bus();
    const hostile = Object.create(null);
    expect(() => b.on('a', hostile as never, vi.fn())).not.toThrow();
    expect(b.on('a', hostile as never, vi.fn())).toMatchObject({ code: 'hooks/unknown' });
  });

  it('hook: "" is refused as unknown, not silently accepted', () => {
    const b = bus();
    expect(b.on('a', '', vi.fn())).toMatchObject({ code: 'hooks/unknown' });
  });
});

describe('createHookBus — on() hostile fn', () => {
  it('fn: null is refused AT REGISTRATION, not silently accepted and left to fail every future emit', async () => {
    const b = bus();
    const diagnostic = b.on('a', 'bootstrap', null as never);
    expect(diagnostic).toMatchObject({ code: 'hooks/not-a-function', pluginId: 'a' });
    expect(await b.emit('bootstrap')).toEqual([]); // nothing was registered
  });

  it('fn: not a function (a plain string) is refused at registration', () => {
    const b = bus();
    expect(b.on('a', 'bootstrap', 'not a function' as never)).toMatchObject({ code: 'hooks/not-a-function' });
  });

  it('fn: an arrow that returns a rejected promise registers FINE — the rejection is an emit()-time concern, not a registration-time one', async () => {
    const b = bus();
    expect(b.on('a', 'bootstrap', () => Promise.reject(new Error('nope')))).toBeNull();
    const diagnostics = await b.emit('bootstrap');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'hooks/handler-failed', pluginId: 'a' });
    expect(diagnostics[0].message).toContain('nope');
  });
});

// ── Repeated identical registration ─────────────────────────────────────────

describe('createHookBus — registering the same (pluginId, hook, fn) twice', () => {
  it('runs it twice: on() does not deduplicate by identity, matching Node EventEmitter-style semantics rather than DOM addEventListener-style ones', async () => {
    const b = bus();
    const fn = vi.fn();
    expect(b.on('a', 'bootstrap', fn)).toBeNull();
    expect(b.on('a', 'bootstrap', fn)).toBeNull();
    await b.emit('bootstrap', 'x');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ── emit(): hostile inputs ──────────────────────────────────────────────────

describe('createHookBus — emit() hostile inputs', () => {
  it('a hook id that was never in ids at all is a no-op, not a crash', async () => {
    const b = bus();
    expect(await b.emit('totallyMadeUp')).toEqual([]);
  });

  it('payload omitted — the handler receives undefined', async () => {
    const b = bus();
    const fn = vi.fn();
    b.on('a', 'bootstrap', fn);
    await b.emit('bootstrap');
    expect(fn).toHaveBeenCalledWith(undefined);
  });

  it('payload: a Symbol reaches the handler unchanged; emit never stringifies the payload', async () => {
    const b = bus();
    const sym = Symbol('payload');
    const fn = vi.fn();
    b.on('a', 'bootstrap', fn);
    await b.emit('bootstrap', sym);
    expect(fn).toHaveBeenCalledWith(sym);
  });

  it('payload: a circular object reaches the handler unchanged; emit never serializes it', async () => {
    const b = bus();
    const circular: Record<string, unknown> = { name: 'x' };
    circular.self = circular;
    let received: unknown;
    b.on('a', 'bootstrap', (payload) => {
      received = payload;
    });
    await expect(b.emit('bootstrap', circular)).resolves.toEqual([]);
    expect(received).toBe(circular);
  });

  it('hook: null/a Symbol is a no-op, not a crash — Map#get never throws on a key of the wrong type', async () => {
    const b = bus();
    expect(await b.emit(null as never)).toEqual([]);
    expect(await b.emit(Symbol('x') as never)).toEqual([]);
  });
});

// ── Handler failure isolation: exotic throw/reject shapes ──────────────────

describe('createHookBus — handler failure isolation, exotic throw/reject shapes', () => {
  it('a handler that throws a plain string is isolated and reported', async () => {
    const b = bus();
    b.on('a', 'bootstrap', () => {
      throw 'plain string boom';
    });
    const diagnostics = await b.emit('bootstrap');
    expect(diagnostics[0]).toMatchObject({ code: 'hooks/handler-failed' });
    expect(diagnostics[0].message).toContain('plain string boom');
  });

  it('a handler that throws undefined is isolated and reported', async () => {
    const b = bus();
    b.on('a', 'bootstrap', () => {
      throw undefined;
    });
    const diagnostics = await b.emit('bootstrap');
    expect(diagnostics[0]).toMatchObject({ code: 'hooks/handler-failed' });
    expect(diagnostics[0].message).toContain('undefined');
  });

  it('a handler that throws a Symbol is isolated and reported, without crashing the message build', async () => {
    const b = bus();
    b.on('a', 'bootstrap', () => {
      throw Symbol('sym boom');
    });
    const diagnostics = await b.emit('bootstrap');
    expect(diagnostics[0]).toMatchObject({ code: 'hooks/handler-failed' });
    expect(diagnostics[0].message).toContain('Symbol(sym boom)');
  });

  it('a handler whose promise rejects with a non-Error reason is isolated the same as a throw', async () => {
    const b = bus();
    b.on('a', 'bootstrap', async () => {
      throw { code: 'weird' };
    });
    const diagnostics = await b.emit('bootstrap');
    expect(diagnostics[0]).toMatchObject({ code: 'hooks/handler-failed' });
    expect(diagnostics[0].message).toContain('[object Object]');
  });

  // Fix round 1: `String(err)` — the previous message-building idiom — throws
  // `TypeError: Cannot convert object to primitive value` for a value with no toString/valueOf/
  // Symbol.toPrimitive anywhere on its chain, which a null-prototype object is. Confirmed against
  // the pre-fix source: this exact case made emit() REJECT and abandon every handler after the
  // thrower, rather than isolating it — the two guarantees this describe block exists to hold.
  it('does not reject when a handler throws a null-prototype value, and still runs the handlers after it', async () => {
    const b = bus();
    const calls: string[] = [];
    b.on('a', 'bootstrap', () => void calls.push('before'));
    b.on('a', 'bootstrap', () => {
      throw Object.create(null);
    });
    b.on('a', 'bootstrap', () => void calls.push('after'));

    const diagnostics = await b.emit('bootstrap');
    expect(calls).toEqual(['before', 'after']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'hooks/handler-failed' });
  });

  // Fix round 2: round 1's `describeError` fallback chain ended at
  // `Object.prototype.toString.call(err)`, reasoned to be a safe dead end — it is not. That call
  // performs its own `[[Get]]` of `err[Symbol.toStringTag]`, so a PLAIN object (no Proxy required)
  // with a throwing getter for that symbol reopens the exact same bug: confirmed against the
  // pre-fix source, this made emit() reject and abandon 'after', same as the null-prototype case.
  it('does not reject when a handler throws a plain object whose Symbol.toStringTag getter throws, and still runs the handlers after it', async () => {
    const b = bus();
    const calls: string[] = [];
    const hostile = {
      get [Symbol.toStringTag]() {
        throw new Error('get boom');
      },
    };
    b.on('a', 'bootstrap', () => void calls.push('before'));
    b.on('a', 'bootstrap', () => {
      throw hostile;
    });
    b.on('a', 'bootstrap', () => void calls.push('after'));

    const diagnostics = await b.emit('bootstrap');
    expect(calls).toEqual(['before', 'after']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'hooks/handler-failed' });
  });

  // Explicitly NOT given a timeout — see the task brief, and activate.ts's identical documented
  // stance for a hung factory. This races the outer emit() promise against a short real delay and
  // checks it has not settled; it does not await the hung handler itself, so it cannot hang the run.
  it('documents that a handler which never settles stalls emit() itself, forever', async () => {
    const b = bus();
    b.on('a', 'bootstrap', () => new Promise(() => {}));
    let settled = false;
    void b.emit('bootstrap').then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
  });
});

// ── A handler registers another handler mid-emit ────────────────────────────

describe('createHookBus — a handler registers another handler mid-emit', () => {
  it('the newly registered handler does NOT run in the current emit — it runs starting from the next one', async () => {
    const b = bus();
    const calls: string[] = [];
    b.on('a', 'bootstrap', () => {
      calls.push('a');
      b.on('b', 'bootstrap', () => void calls.push('late'));
    });

    await b.emit('bootstrap');
    expect(calls).toEqual(['a']); // 'late' did not run this pass, even though it was registered during it

    await b.emit('bootstrap');
    expect(calls).toEqual(['a', 'a', 'late']); // now it does, starting from the second emit
  });

  it('a handler that keeps re-registering itself cannot make a single emit() run forever', async () => {
    const b = bus();
    let ran = 0;
    function selfPerpetuating() {
      ran++;
      if (ran < 1000) b.on('a', 'bootstrap', selfPerpetuating);
    }
    b.on('a', 'bootstrap', selfPerpetuating);

    await b.emit('bootstrap');
    // Only the originally registered call ran. It queued a second one (ran < 1000), which queues a
    // third on ITS turn, and so on — but each is queued for a FUTURE emit(), because emit() iterates a
    // SNAPSHOT of the handler array taken once, before the loop starts, not the live array `on()` keeps
    // appending to.
    expect(ran).toBe(1);
  });

  it('runs exactly the handlers present when emit started, even under mutation — a handler AFTER the mutating one still runs', async () => {
    const b = bus();
    const calls: string[] = [];
    b.on('a', 'bootstrap', () => {
      calls.push('first');
      b.on('a', 'bootstrap', () => void calls.push('late'));
    });
    b.on('b', 'bootstrap', () => void calls.push('second'));

    await b.emit('bootstrap');
    // Proves the snapshot approach isn't merely "stop as soon as something changes": 'second' was
    // already registered before emit() started, same as 'first', and both run; only 'late' (appended
    // to the live array during this pass) is excluded.
    expect(calls).toEqual(['first', 'second']);
  });
});

// ── Cross-hook emit cycles (re-entrancy) ────────────────────────────────────
//
// Two plugins whose hooks trigger each other — a's `bootstrap` handler emits `dispose`, b's
// `dispose` handler emits `bootstrap` — is a plausible accidental coupling, not an attack. Each
// `emit()` call below reaches its first `await` only after synchronously calling the next handler, so
// an unbounded version of this recurses the actual JS call stack (not just "loops a lot") and throws
// `RangeError: Maximum call stack size exceeded` — confirmed by running it, not assumed, before this
// guard existed. Worse, because the recursive `emit()` calls here are fire-and-forget (`void`, the
// natural way to "notify and move on"), the frame that would catch that RangeError is several async
// calls removed from anyone awaiting it — so without the depth guard, the RangeError is not merely
// uncaught, it makes the TOP-level `emit()` resolve with `diagnostics: []`, silently. Confirmed by
// running the unbounded version of the exact scenario below.

describe('createHookBus — cross-hook emit cycles', () => {
  it('bounds a cross-hook emit cycle instead of overflowing the stack, and reports it at the top level', async () => {
    const b = createHookBus({ ids: ['x', 'y'], declared: { p: ['x', 'y'] } });
    b.on('p', 'x', () => {
      void b.emit('y');
    });
    b.on('p', 'y', () => {
      void b.emit('x');
    });
    const diagnostics = await b.emit('x');
    expect(diagnostics.some((d) => d.code === 'hooks/recursion-limit')).toBe(true);
  });

  it('does not falsely flag ordinary bounded nesting (one hook emitting a different hook a few levels deep, then stopping)', async () => {
    const b = createHookBus({ ids: ['x', 'y', 'z'], declared: { p: ['x', 'y', 'z'] } });
    const calls: string[] = [];
    b.on('p', 'x', async () => {
      calls.push('x');
      await b.emit('y');
    });
    b.on('p', 'y', async () => {
      calls.push('y');
      await b.emit('z');
    });
    b.on('p', 'z', () => void calls.push('z'));

    const diagnostics = await b.emit('x');
    expect(calls).toEqual(['x', 'y', 'z']);
    expect(diagnostics).toEqual([]);
  });

  // Fix round 2: round 1's `depth` counter spanned an emit() call's whole async lifetime (entry to
  // its final return), not just synchronous nesting — so 17+ UNRELATED, non-recursive, concurrently
  // in-flight top-level emit() calls (nothing nested in anything) tripped the same cap a genuine
  // cycle does, because none of them had returned (and so decremented `depth`) by the time the 17th
  // started. Confirmed against the pre-fix source: of 25 concurrent shallow emits, only 16 ran; the
  // other 9 were each refused with a hooks/recursion-limit diagnostic blaming a recursion that never
  // happened. `void`-fired, never-awaited emit() — this bus's own natural "notify and move on" shape
  // — is exactly what produces overlapping in-flight calls like this.
  it('does not refuse unrelated concurrent emits', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `h${i}`);
    const b = createHookBus({ ids, declared: { p: ids } });
    const ran: string[] = [];
    for (const id of ids) {
      b.on('p', id, async () => {
        await Promise.resolve();
        ran.push(id);
      });
    }
    const results = await Promise.all(ids.map((id) => b.emit(id)));
    expect(ran).toHaveLength(25);
    expect(results.flat()).toEqual([]);
  });

  // Task 11 review round 1: the recursion-limit diagnostic's own message built `String(hook)` on
  // `emit()`'s raw, unnarrowed parameter. Reaching it with a hostile hook value requires a void-fired
  // nested emit() — this bus's own established "notify and move on" shape, and exactly how deep
  // synchronous recursion is built elsewhere in this file — that carries a hostile hook once already
  // past MAX_HOOK_DEPTH. Because `emit()` is async, `String(hook)` throwing there does not surface as
  // a synchronous exception to any caller; it turns the void-fired call's own promise into an
  // UNHANDLED REJECTION instead — which is what this test actually detects, via Node's own
  // `unhandledRejection` event, rather than a plain `.not.toThrow()` (which would pass trivially for
  // an async function regardless of whether this bug were still present). Confirmed reachable against
  // a plain-JS mirror of the pre-fix logic before writing this: the hostile call's rejection was
  // exactly what crashed the reproduction script.
  it('does not produce an unhandled rejection when a void-fired nested emit() carries a hostile hook id, deep in synchronous recursion', async () => {
    const b = createHookBus({ ids: ['x'], declared: { p: ['x'] } });
    const hostileHook = Object.create(null);
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      b.on('p', 'x', () => {
        void b.emit('x');
        void b.emit(hostileHook as never);
      });
      const diagnostics = await b.emit('x');
      expect(diagnostics.some((d) => d.code === 'hooks/recursion-limit')).toBe(true);
      // Let any fire-and-forgotten promise rejections actually surface before asserting on them.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(rejections).toEqual([]);
  });
});

// ── describeError (diagnostics.ts, exercised here because emit() depends on it) ────────────────────

describe('describeError', () => {
  // Fix round 2: a direct unit test of the shared helper itself, not only of emit()'s use of it —
  // pins the guarantee at its source rather than only observing it secondhand through a handler.
  it('describes a value whose Symbol.toStringTag getter throws, without throwing itself', () => {
    const hostile = {
      get [Symbol.toStringTag]() {
        throw new Error('boom');
      },
    };
    expect(() => describeError(hostile)).not.toThrow();
    expect(typeof describeError(hostile)).toBe('string');
  });
});

// ── declaredFromPlan ─────────────────────────────────────────────────────────

describe('declaredFromPlan', () => {
  it('inverts hook → pluginIds into pluginId → hooks', () => {
    expect(declaredFromPlan({ bootstrap: ['a', 'b'], dispose: ['b'] })).toEqual({
      a: ['bootstrap'],
      b: ['bootstrap', 'dispose'],
    });
  });

  it('hooks: null does not throw; returns {}', () => {
    expect(() => declaredFromPlan(null as never)).not.toThrow();
    expect(declaredFromPlan(null as never)).toEqual({});
  });

  it('a hook entry whose value is not an array is skipped, not thrown on; other entries still work', () => {
    const hooks = { bootstrap: 'not-an-array' as unknown as string[], dispose: ['a'] };
    expect(() => declaredFromPlan(hooks)).not.toThrow();
    expect(declaredFromPlan(hooks)).toEqual({ a: ['dispose'] });
  });

  it('a plugin id repeated within one hook entry is deduplicated, not doubled', () => {
    expect(declaredFromPlan({ bootstrap: ['a', 'a'], dispose: ['a'] })).toEqual({ a: ['bootstrap', 'dispose'] });
  });

  it('prototype-shaped hook ids (the record\'s own keys) do not throw — a hook id only ever becomes an array VALUE here, never a key', () => {
    // Built via JSON.parse, not an object literal: `{ __proto__: [...] }` as a literal sets the
    // prototype rather than creating an own property, which would silently hide the case this test
    // means to cover. JSON.parse has no such special case, so this genuinely has three own keys.
    const hooks = JSON.parse('{"__proto__": ["a"], "constructor": ["b"], "toString": ["c"]}') as Record<string, string[]>;
    expect(() => declaredFromPlan(hooks)).not.toThrow();
    expect(declaredFromPlan(hooks)).toEqual({ a: ['__proto__'], b: ['constructor'], c: ['toString'] });
  });

  it('prototype-shaped plugin ids (array values) do not throw and do not pollute the prototype of the result', () => {
    const hooks = { bootstrap: ['__proto__', 'constructor', 'a'] };
    expect(() => declaredFromPlan(hooks)).not.toThrow();
    const result = declaredFromPlan(hooks);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype); // unpolluted — still an ordinary object
    expect(Object.hasOwn(result, '__proto__')).toBe(true); // genuinely stored, not swallowed
    expect(result['__proto__']).toEqual(['bootstrap']);
    expect(result.constructor).toEqual(['bootstrap']);
    expect(result.a).toEqual(['bootstrap']);
  });

  it('round-trips into createHookBus end to end', async () => {
    const declared = declaredFromPlan({ bootstrap: ['first', 'second'], dispose: ['second'] });
    const b = createHookBus({ ids: ['bootstrap', 'dispose'], declared });
    const fn = vi.fn();
    expect(b.on('first', 'bootstrap', fn)).toBeNull();
    expect(b.on('first', 'dispose', fn)).toMatchObject({ code: 'hooks/undeclared' });
    await b.emit('bootstrap', 'go');
    expect(fn).toHaveBeenCalledWith('go');
  });
});
