import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import * as layoutPlugin from '../src/plugins/layout';

const Dummy = () => <div>x</div>;

/**
 * A hand-built `Context`, not `createIdeClient()`. Every test below calls
 * `harness()` synchronously (`const ctx = harness()`, no `await`), and
 * `createIdeClient()` cannot honour that: cordis defers a plugin's own
 * `apply()` to the microtask after `ctx.plugin()` returns (see
 * `context.ts`'s own comment on why creating a real client is async), so
 * `ctx.layout` would not exist yet if nothing here awaited it. This is the
 * same choice `diagnostics-panel.test.tsx`'s `harness()` already made, for
 * the same reason — copied here rather than the async `createIdeClient()`
 * harness `composition-screen.test.tsx`/`preview.test.tsx` use, which is
 * built for a different shape of test (an already-composed app, not a
 * single service in isolation).
 *
 * What `diagnostics-panel.test.tsx` does not need, and this does, is the
 * REAL `layout.apply()` — the module under test — run against a minimal
 * fake rather than hand-duplicated a second time. `apply()` runs entirely
 * synchronously once invoked directly (registering effects and providing
 * a service are synchronous calls in cordis; only the plugin-loading
 * machinery `ctx.plugin()` bootstraps defers), so a plain function call
 * against a fake `ctx` exposing just the three primitives `layout.apply`
 * uses — `effect`, `reflect.get`, `provide` — is enough to exercise it for
 * real.
 *
 * `connection` is hand-rolled rather than composed via the real plugin,
 * the same choice `diagnostics-panel.test.tsx` already made for it —
 * `layout` only ever calls `report()` on it, so a real `report`/
 * `diagnostics` pair is enough; nothing here needs a socket.
 *
 * `fiber.dispose` mirrors what a real client context actually offers.
 * cordis 4's `Context` has no `scope` — verified by reading
 * `cordis/lib/fiber.d.ts` (`Fiber.dispose: () => Promise<void>`, exposed
 * on every `Context` via `fiber`) and by probing it directly: disposing
 * the root fiber runs every `ctx.effect()` cleanup registered under it.
 * `slots.test.tsx`'s own last test already disposes the same way
 * (`await ctx.fiber.dispose()`), so this keeps the one spelling the
 * codebase already uses rather than inventing a second.
 */
function harness(): Context {
  let diagnostics: Diagnostic[] = [];
  const diagListeners = new Set<() => void>();
  const connection = {
    snapshot: null,
    get diagnostics() {
      return diagnostics;
    },
    subscribe(listener: () => void) {
      diagListeners.add(listener);
      return () => diagListeners.delete(listener);
    },
    update() {},
    report(next: Diagnostic) {
      diagnostics = [...diagnostics, next];
      for (const listener of diagListeners) listener();
    },
  };

  const disposers: (() => void)[] = [];
  const ctx: any = {
    connection,
    reflect: {
      get: (name: string) => ctx[name],
    },
    provide(name: string, value: unknown) {
      ctx[name] = value;
      return () => {
        delete ctx[name];
      };
    },
    effect(execute: () => void | (() => void)) {
      const dispose = execute();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose ?? (() => {});
    },
    fiber: {
      async dispose() {
        for (const dispose of disposers.splice(0).reverse()) dispose();
      },
    },
  };

  layoutPlugin.apply(ctx as Context);
  return ctx as Context;
}

// The deep-link and back-button tests below both write `location.hash`
// directly, outside `ctx.layout.go()` — left alone, a hash set by one
// test is still there when the next test's `harness()` reads it.
beforeEach(() => {
  location.hash = '';
});

describe('layout', () => {
  it('a registered screen shows up, and its disposer takes it away', () => {
    const ctx = harness();
    const off = ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
    expect(ctx.layout.screens().map((s) => s.id)).toEqual(['a']);
    off();
    expect(ctx.layout.screens()).toEqual([]);
  });

  it('orders by order, then by when it was registered', () => {
    const ctx = harness();
    ctx.layout.screen({ id: 'late', title: 'L', order: 9 }, Dummy);
    ctx.layout.screen({ id: 'first', title: 'F', order: 1 }, Dummy);
    ctx.layout.screen({ id: 'alsolate', title: 'A', order: 9 }, Dummy);
    expect(ctx.layout.screens().map((s) => s.id)).toEqual(['first', 'late', 'alsolate']);
  });

  it('a screen with no order sorts after every screen that has one', () => {
    // Otherwise an unordered screen would land at position zero and shove
    // the deliberate ordering aside — the opposite of what omitting it means.
    const ctx = harness();
    ctx.layout.screen({ id: 'none', title: 'N' }, Dummy);
    ctx.layout.screen({ id: 'ordered', title: 'O', order: 5 }, Dummy);
    expect(ctx.layout.screens().map((s) => s.id)).toEqual(['ordered', 'none']);
  });

  it('two screens claiming one id is a diagnostic, and the last one wins', () => {
    // Same policy as `slots`, for the same reason: this is a rendered LIST,
    // and a project that forks a plugin must be able to replace its screen.
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'First' }, Dummy);
    ctx.layout.screen({ id: 'a', title: 'Second' }, Dummy);
    expect(ctx.layout.screens().map((s) => s.title)).toEqual(['Second']);
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('"a"'),
    ]);
  });

  it('the address hash names the current screen', () => {
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
    ctx.layout.screen({ id: 'b', title: 'B' }, Dummy);
    ctx.layout.go('b');
    expect(location.hash).toBe('#/b');
    expect(ctx.layout.current()?.id).toBe('b');
  });

  it('reads the hash it was loaded with, so a deep link opens that screen', () => {
    location.hash = '#/b';
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
    ctx.layout.screen({ id: 'b', title: 'B' }, Dummy);
    expect(ctx.layout.current()?.id).toBe('b');
  });

  it('a hash naming no screen falls back to the first, and says so', () => {
    // Not a blank page: a stale bookmark is a thing that happens, and the
    // reader has to be told why they are looking at something else.
    location.hash = '#/gone';
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
    expect(ctx.layout.current()?.id).toBe('a');
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('gone'),
    ]);
  });

  it('no hash yet is the ordinary first load, not a stale link — no diagnostic for it', () => {
    // `beforeEach` already leaves `location.hash` at `''`; asserted here
    // rather than assumed, since it is the one case `current()` must tell
    // apart from "names a screen nothing recognizes" (the test above) —
    // both read as "nothing found" unless the empty string is caught first.
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
    expect(ctx.layout.current()?.id).toBe('a');
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('the browser back button changes the current screen', () => {
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
    ctx.layout.screen({ id: 'b', title: 'B' }, Dummy);
    ctx.layout.go('b');
    const seen: (string | undefined)[] = [];
    ctx.layout.subscribe(() => seen.push(ctx.layout.current()?.id));
    location.hash = '#/a';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(seen).toEqual(['a']);
  });

  it('registering a screen notifies subscribers', () => {
    const ctx = harness();
    let calls = 0;
    ctx.layout.subscribe(() => calls++);
    ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
    expect(calls).toBe(1);
  });

  it('navigating notifies subscribers too, not only registering a screen', () => {
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
    ctx.layout.screen({ id: 'b', title: 'B' }, Dummy);
    let calls = 0;
    ctx.layout.subscribe(() => calls++);
    ctx.layout.go('b');
    expect(calls).toBe(1);
  });

  it('stops listening to the address once disposed', async () => {
    // The hashchange listener is on `window`; a torn-down context that keeps
    // reacting is a leak that survives every later test in the file.
    const ctx = harness();
    let calls = 0;
    ctx.layout.subscribe(() => calls++);
    await ctx.fiber.dispose();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(calls).toBe(0);
  });

  it('registering a collision does not throw when composed without ctx.connection', async () => {
    // Every test above goes through `harness()`, whose `connection` is a
    // plain object that is simply always there and whose fake `reflect.get`
    // is `(name) => ctx[name]` — it cannot tell "works because the lenient
    // read degrades" apart from "works because the double always had
    // `connection` sitting on it regardless of how it was read". Only a
    // REAL cordis `Context`, with no `connection` plugin composed at all,
    // can prove `ctx.reflect.get('connection', false)` genuinely tolerates
    // the service being absent — a direct `ctx.connection` read throws in
    // that situation instead (cordis's own not-injected guard), which is
    // the mistake this guards against. Same shape as `slots.test.tsx`'s own
    // "composed without ctx.connection" test.
    const ctx = new Context();
    await ctx.plugin(layoutPlugin);

    ctx.layout.screen({ id: 'a', title: 'First' }, Dummy);
    expect(() =>
      ctx.layout.screen({ id: 'a', title: 'Second' }, Dummy),
    ).not.toThrow();
    expect(ctx.layout.screens().map((s) => s.title)).toEqual(['Second']);

    await ctx.fiber.dispose();
  });
});
