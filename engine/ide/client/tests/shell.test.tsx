import { describe, expect, it, beforeEach } from 'vitest';
import { Context } from 'cordis';
import { type Diagnostic } from '@energy8engine/contracts';
import * as slotsPlugin from '../src/plugins/slots';
import * as shellPlugin from '../src/plugins/shell';
import { createIdeClient } from '../src/context';

const Dummy = () => <div>x</div>;

/**
 * A hand-built `Context`, the same shape `layout.test.tsx`'s own `harness()`
 * uses and for the same reason: every test below calls `harness()`
 * synchronously, and `createIdeClient()` cannot honour that (cordis defers
 * a plugin's own `apply()` to the fiber's own lifecycle — see
 * `context.ts`). `slotsPlugin.apply()` and `shellPlugin.apply()` both run
 * synchronously when invoked directly, so a plain fake exposing the three
 * primitives they use — `effect`, `reflect.get`, `provide` — is enough to
 * exercise the real modules under test. `shell` reads `ctx.slots` directly
 * (a hard dependency, not a lenient one — see `shell.tsx`'s own doc), so
 * `slotsPlugin` is applied to the same fake first.
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

  slotsPlugin.apply(ctx as Context);
  shellPlugin.apply(ctx as Context);
  return ctx as Context;
}

function fakeSocket() {
  return { readyState: 1, addEventListener() {}, send() {}, close() {} };
}

// The deep-link tests below write `location.hash` directly, outside any
// `ctx.shell` call — left alone, a hash set by one test is still there
// when the next test's `harness()` reads it.
beforeEach(() => {
  location.hash = '';
});

describe('shell', () => {
  it('opening an instance document adds a tab and activates it', () => {
    const ctx = harness();
    ctx.shell.open({ key: 'f:game/script.spin', title: 'script.spin', component: Dummy, closable: true });
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['f:game/script.spin']);
    expect(ctx.shell.active()?.key).toBe('f:game/script.spin');
    expect(location.hash).toBe('#/doc/f:game/script.spin');
  });

  it('opening the same key twice activates, and does not add a second tab', () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['a', 'b']);
    expect(ctx.shell.active()?.key).toBe('a');
  });

  it('a contributed document opens from its slot key', () => {
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.openContributed('composition');
    expect(ctx.shell.active()?.key).toBe('composition');
  });

  it('opening a contributed key nobody registered is a diagnostic, not a blank tab', () => {
    const ctx = harness();
    ctx.shell.openContributed('ghost');
    expect(ctx.shell.documents()).toEqual([]);
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('ghost')]);
  });

  it('closing a clean tab removes it and activates the neighbour', () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
    expect(ctx.shell.close('b')).toBe(true);
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['a']);
    expect(ctx.shell.active()?.key).toBe('a');
  });

  it('closing a dirty tab is refused until a guard lets it through', () => {
    // The slice-6 leave guard, re-homed: the thing that must not happen is
    // typed math vanishing on a click.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.markDirty('a', true);
    expect(ctx.shell.close('a')).toBe(false);
    expect(ctx.shell.documents()).toHaveLength(1);
    const off = ctx.shell.guard(() => true);
    expect(ctx.shell.close('a')).toBe(true);
    off();
  });

  it('a non-closable contributed document has no close, and close() says so', () => {
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.openContributed('composition');
    expect(ctx.shell.close('composition')).toBe(false);
  });

  it('the hash names the active document, and a hashchange follows it', () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
    location.hash = '#/doc/a';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(ctx.shell.active()?.key).toBe('a');
  });

  it('a deep link to a contributed document is NOT checked until ready()', () => {
    // Slice 6, debt 2: `layout.current()` reported "not registered" between
    // the first and last registration effect. The shell waits to be told.
    location.hash = '#/doc/preview';
    const ctx = harness();
    expect(ctx.connection.diagnostics).toEqual([]); // nothing yet
    ctx.slots.register({ name: 'shell.document', key: 'preview' }, Dummy);
    ctx.shell.ready();
    expect(ctx.shell.active()?.key).toBe('preview');
    expect(ctx.connection.diagnostics).toEqual([]); // and nothing after
  });

  it('a deep link to nothing, after ready(), is one diagnostic and the first document', () => {
    location.hash = '#/doc/gone';
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.ready();
    expect(ctx.shell.active()?.key).toBe('composition');
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('gone')]);
  });

  it('showSidebar toggles: the active key again collapses it', () => {
    const ctx = harness();
    ctx.shell.showSidebar('explorer');
    expect(ctx.shell.sidebar()).toBe('explorer');
    ctx.shell.showSidebar('explorer');
    expect(ctx.shell.sidebar()).toBeUndefined();
  });

  it('markDirty on an unknown key is a no-op, not a throw', () => {
    const ctx = harness();
    expect(() => ctx.shell.markDirty('nope', true)).not.toThrow();
  });

  it('stops listening to the address once disposed', async () => {
    const ctx = harness();
    let calls = 0;
    ctx.shell.subscribe(() => calls++);
    await ctx.fiber.dispose();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(calls).toBe(0);
  });

  it('is on the context the real createIdeClient hands back', async () => {
    const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => fakeSocket() });
    expect(ctx.shell).toBeDefined();
  });

  // --- Ported from layout.test.tsx: properties that outlive the "one
  // screen" form (see task-1-report.md for the full per-test disposition).

  it('a guard is told which key it is being asked about', () => {
    // Ported from "a guard is told which screen navigation was headed to".
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.markDirty('a', true);
    let seen: string | undefined;
    ctx.shell.guard((key) => {
      seen = key;
      return true;
    });
    ctx.shell.close('a');
    expect(seen).toBe('a');
  });

  it('a guard returning false blocks even when another guard would allow it', () => {
    // Ported from "go() proceeds once its guard is disposed" — adapted,
    // not copied verbatim: layout's guard is an opt-in VETO (no guards at
    // all means allowed), while shell's is documented the other way
    // around ("refuses ... until a guard lets it through" — see the given
    // test above), so "dispose the only guard" does not carry the same
    // meaning here. What does carry over is that EVERY guard is
    // consulted, not just the first: a lone "yes" is not enough to
    // override a "no" sitting next to it, and removing the "no" is what
    // lets the standing "yes" through.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.markDirty('a', true);
    ctx.shell.guard(() => true);
    const offBlock = ctx.shell.guard(() => false);
    expect(ctx.shell.close('a')).toBe(false);
    offBlock();
    expect(ctx.shell.close('a')).toBe(true);
  });

  it('opening a document notifies subscribers', () => {
    // Ported from "registering a screen notifies subscribers".
    const ctx = harness();
    let calls = 0;
    ctx.shell.subscribe(() => calls++);
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    expect(calls).toBe(1);
  });

  it('activating a document notifies subscribers too, not only opening one', () => {
    // Ported from "navigating notifies subscribers too, not only registering a screen".
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
    let calls = 0;
    ctx.shell.subscribe(() => calls++);
    ctx.shell.activate('a');
    expect(calls).toBe(1);
  });

  it('opening an unregistered contributed key does not throw when composed without ctx.connection', async () => {
    // Ported from "registering a collision does not throw when composed
    // without ctx.connection" — same lenient-read property, `slots`
    // instead of a bare `Context`, so `ctx.slots` (a hard dependency of
    // `shell`) still exists.
    const ctx = new Context();
    await ctx.plugin(slotsPlugin);
    await ctx.plugin(shellPlugin);

    expect(() => ctx.shell.openContributed('ghost')).not.toThrow();
    expect(ctx.shell.documents()).toEqual([]);

    await ctx.fiber.dispose();
  });

  it('ready() with no hash yet does nothing — not a stale link, no diagnostic', () => {
    // Ported from "no hash yet is the ordinary first load, not a stale
    // link — no diagnostic for it", re-homed onto ready()'s own gate:
    // an empty hash at boot opens nothing and reports nothing, the same
    // as before any document was ever contributed.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.ready();
    expect(ctx.shell.documents()).toEqual([]);
    expect(ctx.shell.active()).toBeUndefined();
    expect(ctx.connection.diagnostics).toEqual([]);
  });
});
