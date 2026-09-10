import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import * as layoutPlugin from '../src/plugins/layout';
import { Layout } from '../src/screens/Layout';

const Dummy = () => <div>x</div>;

/** These tests only care about `.message` — severity/plugin/where are fixed filler. Same shape as `assets-screen.test.tsx`'s own `d`. */
function d(message: string): Diagnostic {
  return diagnostic('error', 'test', 'test', message);
}

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

  // `Layout` now mounts the diagnostics panel unconditionally (Task 7), and
  // the panel's own hooks (`useGameComposition`/`useGameDiagnostics`) read
  // `ctx.gameComposition`/`ctx.gameDiagnostics` directly — inert stand-ins
  // are enough here since nothing in this file exercises the game's own
  // composition or diagnostics feed; only `connection`'s traffic matters to
  // these tests.
  const gameComposition = {
    rows: null,
    diagnostics: [] as Diagnostic[],
    subscribe: () => () => {},
  };
  const gameDiagnostics = {
    groups: null,
    dropped: 0,
    subscribe: () => () => {},
  };

  const disposers: (() => void)[] = [];
  const ctx: any = {
    connection,
    gameComposition,
    gameDiagnostics,
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
    expect(() => ctx.layout.screen({ id: 'a', title: 'Second' }, Dummy)).not.toThrow();
    expect(ctx.layout.screens().map((s) => s.title)).toEqual(['Second']);

    await ctx.fiber.dispose();
  });
});

describe('Layout', () => {
  // Two crash tests below deliberately throw from inside a render; React's
  // own error-boundary contract logs that to console.error as it happens
  // (twice, in a dev build) even though `ScreenBoundary` catches it a line
  // later. Expected noise from a deliberate throw, not a real failure —
  // silenced here rather than inside each `it`, so the six bodies below
  // stay exactly what the plan wrote rather than each growing its own
  // `vi.spyOn`. Same noise `composition-screen.test.tsx`'s own crash test
  // silences, for the same reason.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws the current screen and a tab per registered screen', () => {
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'Alpha' }, () => <div>ALPHA BODY</div>);
    ctx.layout.screen({ id: 'b', title: 'Beta' }, () => <div>BETA BODY</div>);
    render(<Layout ctx={ctx} />);
    expect(screen.getByText('ALPHA BODY')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Alpha', 'Beta']);
  });

  it('clicking a tab shows that screen', async () => {
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'Alpha' }, () => <div>ALPHA BODY</div>);
    ctx.layout.screen({ id: 'b', title: 'Beta' }, () => <div>BETA BODY</div>);
    render(<Layout ctx={ctx} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByText('BETA BODY')).toBeTruthy();
    expect(screen.queryByText('ALPHA BODY')).toBeNull();
  });

  it('a screen registered after mount appears without a reload', () => {
    // The whole point of screens being contributions: a plugin's client half
    // lands whenever its import resolves, which is after this renders.
    const ctx = harness();
    render(<Layout ctx={ctx} />);
    act(() => {
      ctx.layout.screen({ id: 'late', title: 'Late' }, () => <div>LATE</div>);
    });
    expect(screen.getByRole('tab', { name: 'Late' })).toBeTruthy();
  });

  it('with no screens at all it explains itself instead of painting nothing', () => {
    const ctx = harness();
    render(<Layout ctx={ctx} />);
    expect(screen.getByTestId('layout-empty').textContent).toMatch(/no screens/i);
  });

  it('a screen that throws does not take the rest of the IDE with it', () => {
    const ctx = harness();
    const Bad = () => {
      throw new Error('screen exploded');
    };
    ctx.layout.screen({ id: 'bad', title: 'Bad' }, Bad);
    ctx.layout.screen({ id: 'ok', title: 'OK' }, () => <div>OK BODY</div>);
    render(<Layout ctx={ctx} />);
    expect(screen.getByRole('tab', { name: 'OK' })).toBeTruthy();
    expect(screen.getByTestId('screen-error').textContent).toContain('screen exploded');
  });

  it('reports the crashed screen, so it reaches the one list', () => {
    const ctx = harness();
    ctx.layout.screen({ id: 'bad', title: 'Bad' }, () => {
      throw new Error('screen exploded');
    });
    render(<Layout ctx={ctx} />);
    expect(ctx.connection.diagnostics.map((d) => d.plugin)).toContain('bad');
  });

  it('a crashed screen still lets you navigate away from it', async () => {
    // A boundary that swallows the crash but keeps the tabs unreachable
    // leaves the IDE just as stuck as no boundary at all.
    const ctx = harness();
    ctx.layout.screen({ id: 'bad', title: 'Bad' }, () => {
      throw new Error('boom');
    });
    ctx.layout.screen({ id: 'ok', title: 'OK' }, () => <div>OK BODY</div>);
    render(<Layout ctx={ctx} />);
    await userEvent.click(screen.getByRole('tab', { name: 'OK' }));
    expect(screen.getByText('OK BODY')).toBeTruthy();
  });

  it('a crashed screen is still data when composed without ctx.connection', async () => {
    // The boundary is the last thing standing when a screen throws, so it
    // is the one place a missing service must not throw in turn: a direct
    // `ctx.connection` read fires cordis's own not-injected guard from
    // inside `componentDidCatch`, and React re-throws whatever that hook
    // throws — turning the one failure that has to be data into a crash of
    // the whole page. `layout.tsx`'s own `report()` has always read
    // leniently for exactly this reason; this holds the boundary to the
    // same rule. A real `Context` with no `connection` composed, for the
    // reason the collision test above gives: the fake `reflect.get` cannot
    // tell a lenient read from a lucky one.
    const ctx = new Context();
    await ctx.plugin(layoutPlugin);
    ctx.layout.screen({ id: 'bad', title: 'Bad' }, () => {
      throw new Error('screen exploded');
    });

    expect(() => render(<Layout ctx={ctx} />)).not.toThrow();
    expect(screen.getByTestId('screen-error').textContent).toContain('screen exploded');

    await ctx.fiber.dispose();
  });

  it('leaves the main landmark to the screen that owns one', () => {
    // Both shipped screens open with their own `<main>`, and a plugin's
    // screen may. A `<main>` around the body nested a landmark inside a
    // landmark on every one of them.
    const ctx = harness();
    ctx.layout.screen({ id: 'a', title: 'Alpha' }, () => <main>ALPHA BODY</main>);
    render(<Layout ctx={ctx} />);
    expect(document.querySelectorAll('main')).toHaveLength(1);
  });

  it('the panel is visible on every screen, not only on composition', async () => {
    const ctx = harness();
    ctx.layout.screen({ id: 'other', title: 'Other' }, () => <div>OTHER</div>);
    render(<Layout ctx={ctx} />);
    await userEvent.click(screen.getByTestId('tab-other'));
    expect(screen.getByTestId('diagnostics-panel')).toBeTruthy();
  });

  it('the panel survives a change of screen without losing what it held', async () => {
    // Это и есть смысл переезда: список переживает навигацию.
    const ctx = harness();
    ctx.layout.screen({ id: 'other', title: 'Other' }, () => <div>OTHER</div>);
    ctx.connection.report(d('something went wrong'));
    render(<Layout ctx={ctx} />);
    await userEvent.click(screen.getByTestId('tab-other'));
    expect(screen.getByText(/something went wrong/)).toBeTruthy();
  });

  it('a crashed screen does not take the panel with it', () => {
    // Панель важнее всего именно тогда, когда что-то сломалось.
    const ctx = harness();
    ctx.layout.screen({ id: 'bad', title: 'Bad' }, () => {
      throw new Error('boom');
    });
    render(<Layout ctx={ctx} />);
    expect(screen.getByTestId('screen-error')).toBeTruthy();
    expect(screen.getByTestId('diagnostics-panel')).toBeTruthy();
  });
});
