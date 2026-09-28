import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'cordis';
import { type Diagnostic } from '@energy8engine/contracts';
import * as slotsPlugin from '../src/plugins/slots';
import * as shellPlugin from '../src/plugins/shell';
import { createIdeClient } from '../src/context';
import { Shell } from '../src/shell/Shell';
import { DirtyStatus } from '../src/shell/StatusItems';
import * as viewersPlugin from '../src/plugins/viewers';
import { openPath } from '../src/shell/Explorer';

const Dummy = () => <div>x</div>;
/** Contributes nothing visible — for `shell.activity` registrations, whose own `component` is never rendered. */
const Nop = () => null;

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
/** Every harness built in a test, disposed after it — see `afterEach` below. */
const built: Context[] = [];

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
      // The real `connection.report`'s retract, by identity.
      return () => {
        diagnostics = diagnostics.filter((d) => d !== next);
        for (const listener of diagListeners) listener();
      };
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
  built.push(ctx as Context);
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

// A shell past `ready()` resolves the address on every `hashchange`, and
// falls back by writing the hash. Two harnesses left alive from earlier
// tests, with different contributed documents, would answer each other's
// fallback with their own forever — one shell per page is the rule this
// suite has to keep by hand.
afterEach(async () => {
  for (const ctx of built.splice(0)) await ctx.fiber.dispose();
});

describe('shell', () => {
  it('opening an instance document adds a tab and activates it', () => {
    const ctx = harness();
    ctx.shell.open({
      key: 'f:game/script.spin',
      title: 'script.spin',
      component: Dummy,
      closable: true,
    });
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

  it('a contribution withdrawn while open closes its tab, moves on, and says so once', () => {
    // A3: the plugin that contributed the document was unloaded. The tab
    // used to stay — non-closable, painting a component that no longer
    // exists. Force-closed, the neighbour takes over, and one warning
    // names the key.
    const ctx = harness();
    const off = ctx.slots.register({ name: 'shell.document', key: 'demo' }, Dummy);
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.openContributed('demo');
    expect(ctx.shell.active()?.key).toBe('demo');
    off();
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['a']);
    expect(ctx.shell.active()?.key).toBe('a');
    // `plugin: <document key>, where: 'shell'` — case 3 of the contract's
    // own `Diagnostic.plugin` doc, the shape every other shell report has.
    expect(ctx.connection.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        plugin: 'demo',
        where: 'shell',
        message: 'document withdrawn by its plugin',
      }),
    ]);
  });

  it('an open contributed document survives an unrelated contribution landing or leaving', () => {
    // Every slot change runs the withdrawal check; only a key whose OWN
    // contribution is gone is withdrawn.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'demo' }, Dummy);
    ctx.shell.openContributed('demo');
    const off = ctx.slots.register({ name: 'shell.panel', key: 'p', title: 'P' }, Dummy);
    off();
    expect(ctx.shell.active()?.key).toBe('demo');
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('a contribution withdrawn before anyone opened it is nothing to report', () => {
    const ctx = harness();
    const off = ctx.slots.register({ name: 'shell.document', key: 'demo' }, Dummy);
    off();
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('a contribution registered again after a withdrawal opens fresh on the next click, and takes the warning back', () => {
    const ctx = harness();
    const off = ctx.slots.register({ name: 'shell.document', key: 'demo' }, Dummy);
    ctx.shell.openContributed('demo');
    off();
    expect(ctx.shell.documents()).toEqual([]);
    expect(ctx.connection.diagnostics).toHaveLength(1);
    const Again = () => <div>AGAIN</div>;
    ctx.slots.register({ name: 'shell.document', key: 'demo' }, Again);
    // Final review F2: the plugin is back, so "was unloaded" is no longer
    // the case — the warning used to stand for the life of the page, one
    // more per project switch.
    expect(ctx.connection.diagnostics).toHaveLength(0);
    ctx.shell.openContributed('demo');
    expect(ctx.shell.active()?.key).toBe('demo');
    expect(ctx.shell.documents()[0]?.component).toBe(Again);
    expect(ctx.connection.diagnostics).toHaveLength(0);
  });

  it('opening a contributed key nobody registered is a diagnostic, not a blank tab', () => {
    const ctx = harness();
    ctx.shell.openContributed('ghost');
    expect(ctx.shell.documents()).toEqual([]);
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('ghost'),
    ]);
  });

  // --- Task 8b: `background` mounts a contributed document without
  // navigating to it — the Preview's game has to be running before anyone
  // opens its tab (see `openContributed`'s own doc in shell.tsx).

  it('background adds a tab after the active one, without activating it or moving the address', () => {
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.slots.register({ name: 'shell.document', key: 'preview' }, Dummy);
    ctx.shell.openContributed('composition');
    const hashBefore = location.hash;
    ctx.shell.openContributed('preview', { background: true });
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['composition', 'preview']);
    expect(ctx.shell.active()?.key).toBe('composition');
    expect(location.hash).toBe(hashBefore);
  });

  it('background on a key already open — even the active one — is a no-op', () => {
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'preview' }, Dummy);
    ctx.shell.openContributed('preview'); // opens it in front, foreground
    ctx.shell.openContributed('preview', { background: true }); // already open: nothing moves
    expect(ctx.shell.documents()).toHaveLength(1);
    expect(ctx.shell.active()?.key).toBe('preview');
  });

  it('background called twice adds one tab, not two, and never activates it', () => {
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.slots.register({ name: 'shell.document', key: 'preview' }, Dummy);
    ctx.shell.openContributed('composition');
    ctx.shell.openContributed('preview', { background: true });
    ctx.shell.openContributed('preview', { background: true });
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['composition', 'preview']);
    expect(ctx.shell.active()?.key).toBe('composition');
  });

  it('background on a key nobody registered reports the same diagnostic the foreground path does', () => {
    const ctx = harness();
    ctx.shell.openContributed('ghost', { background: true });
    expect(ctx.shell.documents()).toEqual([]);
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('ghost'),
    ]);
  });

  it('closing a clean tab removes it and activates the neighbour', () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
    expect(ctx.shell.close('b')).toBe(true);
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['a']);
    expect(ctx.shell.active()?.key).toBe('a');
  });

  it('closing a MIDDLE tab activates the one that slid into its position', () => {
    // Distinct from the "closing the last tab" case above: there,
    // "neighbour" and "the first remaining document" happen to be the
    // same document, so that test alone cannot tell `remaining[index]`
    // apart from a fixed `remaining[0]`.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
    ctx.shell.open({ key: 'c', title: 'C', component: Dummy, closable: true });
    ctx.shell.activate('b');
    expect(ctx.shell.close('b')).toBe(true);
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['a', 'c']);
    expect(ctx.shell.active()?.key).toBe('c');
  });

  it('closing a dirty tab is refused unless forced', () => {
    // The slice-6 leave guard, re-homed: the thing that must not happen is
    // typed math vanishing on a click. `force` replaces a registered
    // guard — the one call site this ever gated is right here, behind
    // `doc.dirty`, so a confirm flow is two calls: `close(k)` first,
    // `close(k, { force: true })` only if the caller means it.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.markDirty('a', true);
    expect(ctx.shell.close('a')).toBe(false);
    expect(ctx.shell.documents()).toHaveLength(1);
    expect(ctx.shell.close('a', { force: true })).toBe(true);
  });

  it('hasDirtyDocuments reports true while any tab is dirty', () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    expect(ctx.shell.hasDirtyDocuments()).toBe(false);
    ctx.shell.markDirty('a', true);
    expect(ctx.shell.hasDirtyDocuments()).toBe(true);
    ctx.shell.markDirty('a', false);
    expect(ctx.shell.hasDirtyDocuments()).toBe(false);
  });

  it('a non-closable contributed document has no close, and close() says so', () => {
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.openContributed('composition');
    expect(ctx.shell.close('composition')).toBe(false);
  });

  it('the hash names the active document, and a hashchange NOTIFIES subscribers', () => {
    // `active()` reads the hash live and would answer right without any
    // listener at all; what a listener is FOR is telling `useShell` to
    // re-render on Back. The subscriber count is the assertion that
    // reaches it — the reviewer deleted the listener with every test
    // still green (thirty-fourth on this branch).
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
    const listener = vi.fn();
    ctx.shell.subscribe(listener);
    location.hash = '#/doc/a';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(listener).toHaveBeenCalledTimes(1);
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
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('gone'),
    ]);
  });

  it('after ready(), a hash naming a closed tab falls back live and says so', () => {
    // Item 1 of fix round 1: Back onto a tab that was closed left zero
    // panes and a blank body, because only the `ready()` instant resolved
    // the address. `hashchange` resolves it too now.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.ready();
    ctx.shell.open({ key: 'f:x', title: 'x', component: Dummy, closable: true });
    expect(ctx.shell.close('f:x')).toBe(true);
    location.hash = '#/doc/f:x'; // the browser's Back
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(ctx.shell.active()?.key).toBe('composition');
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('f:x'),
    ]);
  });

  it('after ready(), a hash edited to a contributed-but-unopened document opens it', () => {
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.slots.register({ name: 'shell.document', key: 'preview' }, Dummy);
    ctx.shell.ready();
    expect(ctx.shell.documents().map((d) => d.key)).toEqual([]);
    location.hash = '#/doc/preview';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(ctx.shell.active()?.key).toBe('preview');
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('a deep link to a document a plugin has not registered yet waits, then opens it, with no diagnostic', () => {
    // Item 4: on a cold F5 while on a plugin's tab, `ready()` runs before
    // `modules` has imported the plugin's client half. Held as pending
    // while the loader is unsettled; opened the moment the document lands.
    location.hash = '#/doc/demo';
    const ctx = harness();
    let settled = false;
    const loaderListeners = new Set<() => void>();
    (ctx as any).modules = {
      loaded: () => [],
      settled: () => settled,
      subscribe(listener: () => void) {
        loaderListeners.add(listener);
        return () => loaderListeners.delete(listener);
      },
    };
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.ready();
    expect(ctx.shell.active()).toBeUndefined();
    expect(ctx.shell.pending()).toBe('demo');
    expect(ctx.connection.diagnostics).toEqual([]);
    ctx.slots.register({ name: 'shell.document', key: 'demo' }, Dummy);
    expect(ctx.shell.active()?.key).toBe('demo');
    expect(ctx.shell.pending()).toBeUndefined();
    settled = true;
    for (const listener of loaderListeners) listener();
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('a deep link nothing ever registers reports exactly once, after the loader settles', () => {
    location.hash = '#/doc/ghost';
    const ctx = harness();
    let settled = false;
    const loaderListeners = new Set<() => void>();
    (ctx as any).modules = {
      loaded: () => [],
      settled: () => settled,
      subscribe(listener: () => void) {
        loaderListeners.add(listener);
        return () => loaderListeners.delete(listener);
      },
    };
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.ready();
    expect(ctx.connection.diagnostics).toEqual([]); // not yet a guess to make
    for (const listener of loaderListeners) listener(); // a settle notice that is not settled
    expect(ctx.connection.diagnostics).toEqual([]);
    settled = true;
    for (const listener of loaderListeners) listener();
    for (const listener of loaderListeners) listener();
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('ghost'),
    ]);
    expect(ctx.shell.active()?.key).toBe('composition');
  });

  it('a stale address with nothing open falls back to the lowest activity order, not the first registered', () => {
    // A plugin's document lands during `createIdeClient`, before the app's
    // core screens register theirs, so it sorts first by registration;
    // the fallback is the bar's first document instead.
    location.hash = '#/doc/ghost';
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'scenes', title: 'Scenes' }, Dummy);
    ctx.slots.register({
      name: 'shell.activity',
      key: 'scenes',
      title: 'Scenes',
      icon: 'x',
      order: 35,
      opens: 'document',
    });
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.slots.register({
      name: 'shell.activity',
      key: 'composition',
      title: 'Composition',
      icon: 'x',
      order: 10,
      opens: 'document',
    });
    ctx.shell.ready();
    expect(ctx.shell.active()?.key).toBe('composition');
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('showing "composition" instead'),
    ]);
  });

  it('a stale address falls back to the document that WAS active, and replaces the entry', async () => {
    // Finding 2 of the final review: `giveUp` pushed `#/doc/composition`
    // over a typo, so Back landed on the typo again, re-reported, and
    // pushed again — `history.length` grew by one per press and the
    // document a person was on was never reached. Two contributed
    // documents, the SECOND active: a fallback to `contributed[0]` is
    // told apart from "the previous document" only when they differ.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.slots.register({ name: 'shell.document', key: 'preview' }, Dummy);
    ctx.shell.ready();
    ctx.shell.openContributed('composition');
    ctx.shell.openContributed('preview');
    location.hash = '#/doc/ghost'; // typed by hand: one entry, the person's own
    const typed = history.length;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(ctx.shell.active()?.key).toBe('preview');
    expect(ctx.shell.documents()).toHaveLength(2);
    expect(history.length).toBe(typed); // replaced, not pushed
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('ghost'),
    ]);
    // Back once, through jsdom's own session history: the entry before
    // the (now overwritten) typo is `preview` itself — nothing stale is
    // left to re-resolve, so the one diagnostic stays one.
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(location.hash).toBe('#/doc/preview');
    expect(ctx.shell.active()?.key).toBe('preview');
    expect(ctx.connection.diagnostics).toHaveLength(1);
  });

  it('closing the last tab empties the address without adding an entry', () => {
    // The neighbour (or nothing) after a close is the shell's pick, not a
    // place the person went, so it overwrites the closed tab's entry.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    const before = history.length;
    expect(ctx.shell.close('a')).toBe(true);
    expect(location.hash).toBe('');
    expect(history.length).toBe(before);
    expect(ctx.shell.documents()).toHaveLength(0);
    expect(ctx.shell.active()).toBeUndefined();
  });

  it('a cold address naming a file asks the registered opener, and waits for nothing', () => {
    // Ruling 18/22: `f:` keys exist only once something opens them, so a
    // cold `#/doc/f:<path>` — F5 on a file tab — used to be given up on as
    // "not registered" and replaced by the composition. A file is never a
    // plugin's contribution, so an UNSETTLED loader must not hold it
    // pending either: the opener is asked at once.
    location.hash = '#/doc/f:game/script.spin';
    const ctx = harness();
    (ctx as any).modules = { loaded: () => [], settled: () => false, subscribe: () => () => {} };
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    const opened: string[] = [];
    ctx.shell.registerPathOpener((path) => {
      opened.push(path);
      ctx.shell.open({ key: `f:${path}`, title: path, component: Dummy, closable: true });
    });
    ctx.shell.ready();
    expect(opened).toEqual(['game/script.spin']);
    expect(ctx.shell.active()?.key).toBe('f:game/script.spin');
    expect(ctx.shell.pending()).toBeUndefined();
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('openPath hands the path to the registered opener', () => {
    const ctx = harness();
    const opened: string[] = [];
    ctx.shell.registerPathOpener((path) => opened.push(path));
    ctx.shell.openPath('art/logo.png');
    expect(opened).toEqual(['art/logo.png']);
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('openPath with no opener registered is a diagnostic, not a throw', () => {
    const ctx = harness();
    expect(() => ctx.shell.openPath('game/script.spin')).not.toThrow();
    expect(ctx.shell.documents()).toEqual([]);
    expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('game/script.spin'),
    ]);
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
  // The two guard-shaped ports that used to live here ("a guard is told
  // which key...", "a guard returning false blocks...") lost their
  // subject when fix round 1 replaced `guard()` with `close(key, {force})`
  // — see task-1-report.md's Round 2 entry. The veto semantics they
  // pinned went with `layout` itself in Task 6.

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

describe('Shell', () => {
  // Three tests below deliberately throw from inside a render; React's own
  // error-boundary contract logs that to console.error as it happens (twice,
  // in a dev build) even though `DocumentBoundary` catches it a line later.
  // Same noise `layout.test.tsx`'s own `Layout` describe silences, for the
  // same reason.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws one activity button per contribution, in order', () => {
    const ctx = harness();
    ctx.slots.register(
      { name: 'shell.activity', key: 'z', title: 'Z', icon: 'z', order: 9, opens: 'sidebar' },
      Nop,
    );
    ctx.slots.register(
      { name: 'shell.activity', key: 'a', title: 'A', icon: 'a', order: 1, opens: 'sidebar' },
      Nop,
    );
    // Same order as `z`, registered after it, and sorting before it by
    // key: only registration order keeps `y` after `z`. A comparator that
    // broke ties by key would pass without this pair.
    ctx.slots.register(
      { name: 'shell.activity', key: 'y', title: 'Y', icon: 'y', order: 9, opens: 'sidebar' },
      Nop,
    );
    render(<Shell ctx={ctx} />);
    // Scoped to the bar, not `getAllByTestId(/^activity-/)` — that regex is
    // unanchored on the RIGHT, so it would also match the bar's own
    // `data-testid="activity-bar"` (it starts with "activity-" too) and
    // count it as a phantom sixth button. The bar is a `<nav>`, the buttons
    // are `<button>`, so `getAllByRole('button')` inside it can't pick up
    // its own container by accident.
    const buttons = within(screen.getByTestId('activity-bar')).getAllByRole('button');
    expect(buttons.map((b) => b.dataset.testid)).toEqual([
      'activity-a',
      'activity-z',
      'activity-y',
    ]);
  });

  it('a contribution with no order sorts after every one that has one', () => {
    // Ported from `layout.test.tsx`'s "a screen with no order sorts after
    // every screen that has one": registered FIRST, with no order, it
    // still draws last — and after `z`'s 9, not just after `a`'s 1.
    const ctx = harness();
    ctx.slots.register(
      { name: 'shell.activity', key: 'n', title: 'N', icon: 'n', opens: 'sidebar' },
      Nop,
    );
    ctx.slots.register(
      { name: 'shell.activity', key: 'z', title: 'Z', icon: 'z', order: 9, opens: 'sidebar' },
      Nop,
    );
    ctx.slots.register(
      { name: 'shell.activity', key: 'a', title: 'A', icon: 'a', order: 1, opens: 'sidebar' },
      Nop,
    );
    render(<Shell ctx={ctx} />);
    const buttons = within(screen.getByTestId('activity-bar')).getAllByRole('button');
    expect(buttons.map((b) => b.dataset.testid)).toEqual([
      'activity-a',
      'activity-z',
      'activity-n',
    ]);
  });

  it('leaves the main landmark to the document that owns one', () => {
    // Ported from `layout.test.tsx`: `CompositionScreen` and `Preview`
    // both open with a `<main>`, so the shell's own body must not be one —
    // a landmark inside a landmark on every shipped document.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: () => <main>OWN</main>, closable: true });
    render(<Shell ctx={ctx} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('OWN');
  });

  it('an activity button that opens a sidebar shows that sidebar view', async () => {
    const ctx = harness();
    ctx.slots.register(
      {
        name: 'shell.activity',
        key: 'explorer',
        title: 'Explorer',
        icon: 'files',
        opens: 'sidebar',
      },
      Nop,
    );
    ctx.slots.register({ name: 'shell.sidebar', key: 'explorer', title: 'Explorer' }, () => (
      <div>TREE</div>
    ));
    render(<Shell ctx={ctx} />);
    await userEvent.click(screen.getByTestId('activity-explorer'));
    expect(screen.getByTestId('sidebar')).toHaveTextContent('TREE');
  });

  it('an activity button that opens a document opens ONE tab, and again activates it', async () => {
    const ctx = harness();
    ctx.slots.register(
      {
        name: 'shell.activity',
        key: 'composition',
        title: 'Composition',
        icon: 'c',
        opens: 'document',
      },
      Nop,
    );
    ctx.slots.register({ name: 'shell.document', key: 'composition', title: 'Composition' }, () => (
      <div>COMP</div>
    ));
    render(<Shell ctx={ctx} />);
    await userEvent.click(screen.getByTestId('activity-composition'));
    await userEvent.click(screen.getByTestId('activity-composition'));
    expect(screen.getAllByTestId(/^doc-composition$/)).toHaveLength(1);
    expect(screen.getByTestId('doc-body')).toHaveTextContent('COMP');
  });

  it('an activity contribution with an unknown `opens` is one diagnostic and no button', () => {
    // Spec §8, bullet 4, unimplemented until the final review: `list<M>`
    // is a cast, so `opens: 'popup'` was drawn and its click reported
    // "no document is registered for x" — a cause the code did not know.
    const ctx = harness();
    ctx.slots.register(
      { name: 'shell.activity', key: 'ok', title: 'OK', icon: 'o', opens: 'sidebar' },
      Nop,
    );
    ctx.slots.register(
      { name: 'shell.activity', key: 'odd', title: 'Odd', icon: 'x', opens: 'popup' as any },
      Nop,
    );
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('activity-ok')).toBeTruthy();
    expect(screen.queryByTestId('activity-odd')).toBeNull();
    const messages = () => ctx.connection.diagnostics.map((d) => d.message);
    expect(messages()).toEqual([expect.stringMatching(/"odd".*"popup"/)]);
    // Once, not once per render: a re-render for any reason must not
    // add a second row for the same contribution.
    act(() => ctx.shell.showSidebar('ok'));
    expect(messages()).toHaveLength(1);
  });

  it('an activity button whose sidebar nobody registered explains itself', async () => {
    const ctx = harness();
    ctx.slots.register(
      { name: 'shell.activity', key: 'orphan', title: 'O', icon: 'o', opens: 'sidebar' },
      Nop,
    );
    render(<Shell ctx={ctx} />);
    await userEvent.click(screen.getByTestId('activity-orphan'));
    expect(screen.getByTestId('sidebar')).toHaveTextContent(/nothing registered/i);
  });

  // --- Task 4: the panel is a tab strip a plugin contributes, with a
  // badge and `showPanel` — every `shell.panel` entry gets its own tab
  // (title + optional badge), all entries stay mounted (hidden, not
  // unmounted, when inactive or collapsed), and the chosen tab survives a
  // reload via `localStorage['e8.panel-tab']`.

  /** Two `shell.panel` entries, `b` registered before `a` but ordered after it — the same trap `byOrder`'s own activity-bar tests set. */
  function twoPanelEntries(ctx: Context) {
    ctx.slots.register({ name: 'shell.panel', key: 'b', title: 'B', order: 1 }, () => (
      <div>B-BODY</div>
    ));
    ctx.slots.register({ name: 'shell.panel', key: 'a', title: 'A', order: 0 }, () => (
      <div>A-BODY</div>
    ));
  }

  it('draws one tab per entry, ordered, the lowest order selected by default', () => {
    const ctx = harness();
    twoPanelEntries(ctx);
    render(<Shell ctx={ctx} />);
    const tabs = within(screen.getByTestId('panel')).getAllByRole('tab');
    expect(tabs.map((t) => t.dataset.testid)).toEqual(['panel-tab-a', 'panel-tab-b']);
    expect(screen.getByTestId('panel-tab-a')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('panel-tab-b')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('panel-a')).toBeVisible();
    expect(screen.getByTestId('panel-b')).not.toBeVisible();
  });

  it('clicking a tab selects it and remembers the choice for the next shell over the same storage', () => {
    localStorage.removeItem('e8.panel-tab');
    const ctx = harness();
    twoPanelEntries(ctx);
    const first = render(<Shell ctx={ctx} />);
    fireEvent.click(screen.getByTestId('panel-tab-b'));
    expect(screen.getByTestId('panel-tab-b')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('panel-b')).toBeVisible();
    expect(localStorage.getItem('e8.panel-tab')).toBe('b');
    first.unmount();

    // A fresh shell — a reload — reads the same storage back and opens on `b`.
    const ctx2 = harness();
    twoPanelEntries(ctx2);
    render(<Shell ctx={ctx2} />);
    expect(screen.getByTestId('panel-tab-b')).toHaveAttribute('aria-selected', 'true');
  });

  it('a stored key nothing answers to falls back to the first tab', () => {
    localStorage.setItem('e8.panel-tab', 'ghost');
    const ctx = harness();
    twoPanelEntries(ctx);
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('panel-tab-a')).toHaveAttribute('aria-selected', 'true');
  });

  it('a throwing localStorage — a private window, storage switched off — still renders the panel', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const ctx = harness();
    twoPanelEntries(ctx);
    expect(() => render(<Shell ctx={ctx} />)).not.toThrow();
    expect(screen.getByTestId('panel-tab-a')).toHaveAttribute('aria-selected', 'true');
    expect(() => fireEvent.click(screen.getByTestId('panel-tab-b'))).not.toThrow();
  });

  it('collapsing hides both entries without unmounting them — a component inside keeps its own state', async () => {
    // Same shape as "typed text survives a tab switch" above, for the
    // identical reason: `hidden`, not removed, is what keeps the SAME
    // `<input>` node (and whatever it holds) alive across a collapse — the
    // selected entry's AND the inactive one's.
    localStorage.removeItem('e8.panel-tab');
    const ctx = harness();
    ctx.slots.register({ name: 'shell.panel', key: 'a', title: 'A', order: 0 }, () => (
      <input data-testid="panel-input" />
    ));
    ctx.slots.register({ name: 'shell.panel', key: 'b', title: 'B', order: 1 }, () => (
      <input data-testid="panel-input-b" />
    ));
    render(<Shell ctx={ctx} />);
    const input = screen.getByTestId<HTMLInputElement>('panel-input');
    const inactive = screen.getByTestId<HTMLInputElement>('panel-input-b');
    expect(inactive).not.toBeVisible(); // `a` is the selected tab
    await userEvent.type(input, 'hello');
    await userEvent.click(screen.getByTestId('panel-toggle'));
    expect(screen.getByTestId('panel-a')).not.toBeVisible();
    expect(screen.getByTestId('panel-b')).not.toBeVisible();
    expect(input).not.toBeVisible();
    // Both still mounted while collapsed — the inactive entry too.
    expect(input.isConnected).toBe(true);
    expect(inactive.isConnected).toBe(true);
    await userEvent.click(screen.getByTestId('panel-toggle'));
    expect(screen.getByTestId('panel-a')).toBeVisible();
    expect(screen.getByTestId('panel-b')).not.toBeVisible();
    expect(screen.getByTestId('panel-input')).toBe(input); // the same node, not a fresh mount
    expect(screen.getByTestId('panel-input-b')).toBe(inactive);
    expect(input.value).toBe('hello');
  });

  it('a `shell.panel` entry registered after mount — how a project plugin’s client half arrives — gets its tab, the fallback selection and its badge', () => {
    localStorage.removeItem('e8.panel-tab');
    const ctx = harness();
    // Something to draw, so the shell is not the all-empty explanation.
    ctx.shell.open({ key: 'doc', title: 'D', component: () => <div>D</div>, closable: true });
    render(<Shell ctx={ctx} />);
    expect(screen.queryByTestId('panel-tab-late')).toBeNull();

    act(() => {
      ctx.slots.register({ name: 'shell.panel', key: 'late', title: 'Late', order: 1 }, () => (
        <div>LATE-BODY</div>
      ));
    });
    // The only entry: `panel()` falls back to it.
    expect(ctx.shell.panel()).toBe('late');
    expect(screen.getByTestId('panel-tab-late')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('panel-late')).toBeVisible();
    act(() => ctx.shell.setPanelBadge('late', 2));
    expect(screen.getByTestId('panel-badge-late')).toHaveTextContent('2');

    // A second late entry ordered ahead of it: with nothing chosen by hand,
    // the fallback is the first by order, and the strip draws it first.
    act(() => {
      ctx.slots.register({ name: 'shell.panel', key: 'early', title: 'Early', order: 0 }, () => (
        <div>EARLY-BODY</div>
      ));
    });
    const tabs = within(screen.getByTestId('panel')).getAllByRole('tab');
    expect(tabs.map((t) => t.dataset.testid)).toEqual(['panel-tab-early', 'panel-tab-late']);
    expect(screen.getByTestId('panel-tab-early')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('panel-badge-late')).toHaveTextContent('2');
  });

  it('ctx.shell.showPanel expands a collapsed panel and selects the named tab', () => {
    const ctx = harness();
    twoPanelEntries(ctx);
    render(<Shell ctx={ctx} />);
    fireEvent.click(screen.getByTestId('panel-toggle'));
    expect(screen.getByTestId('panel')).toHaveAttribute('data-collapsed', '');
    act(() => ctx.shell.showPanel('b'));
    expect(screen.getByTestId('panel')).not.toHaveAttribute('data-collapsed');
    expect(screen.getByTestId('panel-tab-b')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('panel-b')).toBeVisible();
  });

  it('setPanelBadge shows a badge; 0 and undefined remove it; one set while collapsed shows once expanded', () => {
    const ctx = harness();
    twoPanelEntries(ctx);
    render(<Shell ctx={ctx} />);
    act(() => ctx.shell.setPanelBadge('a', 3));
    expect(screen.getByTestId('panel-badge-a')).toHaveTextContent('3');
    act(() => ctx.shell.setPanelBadge('a', 0));
    expect(screen.queryByTestId('panel-badge-a')).toBeNull();
    act(() => ctx.shell.setPanelBadge('a', 3));
    act(() => ctx.shell.setPanelBadge('a', undefined));
    expect(screen.queryByTestId('panel-badge-a')).toBeNull();

    fireEvent.click(screen.getByTestId('panel-toggle'));
    act(() => ctx.shell.setPanelBadge('b', 5));
    expect(screen.getByTestId('panel-badge-b')).toHaveTextContent('5');
    fireEvent.click(screen.getByTestId('panel-toggle'));
    expect(screen.getByTestId('panel-badge-b')).toHaveTextContent('5');
  });

  it('a dirty tab shows a dot, and its close asks first', async () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: () => <div>A</div>, closable: true });
    ctx.shell.markDirty('a', true);
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('doc-a')).toHaveTextContent('●');
    await userEvent.click(screen.getByTestId('doc-close-a'));
    expect(screen.getByTestId('confirm-yes')).toBeTruthy();
    expect(ctx.shell.documents()).toHaveLength(1);
  });

  it('confirming a dirty close actually force-closes the tab', async () => {
    // The other half of the test above: the confirm has to be wired to
    // `close(key, { force: true })`, not just shown.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: () => <div>A</div>, closable: true });
    ctx.shell.markDirty('a', true);
    render(<Shell ctx={ctx} />);
    await userEvent.click(screen.getByTestId('doc-close-a'));
    await userEvent.click(screen.getByTestId('confirm-yes'));
    expect(ctx.shell.documents()).toHaveLength(0);
    expect(screen.queryByTestId('doc-a')).toBeNull();
  });

  it('declining a dirty close leaves the tab exactly as it was', async () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: () => <div>A</div>, closable: true });
    ctx.shell.markDirty('a', true);
    render(<Shell ctx={ctx} />);
    await userEvent.click(screen.getByTestId('doc-close-a'));
    await userEvent.click(screen.getByTestId('confirm-no'));
    expect(ctx.shell.documents()).toHaveLength(1);
    expect(screen.getByTestId('doc-a')).toHaveTextContent('●');
    expect(screen.queryByTestId('confirm-yes')).toBeNull();
  });

  it('a document that throws does not take the panel or the other tabs with it', () => {
    const ctx = harness();
    ctx.shell.open({
      key: 'bad',
      title: 'B',
      component: () => {
        throw new Error('boom');
      },
      closable: true,
    });
    ctx.shell.open({ key: 'ok', title: 'O', component: () => <div>OK</div>, closable: true });
    ctx.slots.register({ name: 'shell.panel', key: 'p', title: 'P' }, () => <div>PANEL</div>);
    ctx.shell.activate('bad');
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('doc-error')).toHaveTextContent('boom');
    expect(screen.getByTestId('panel')).toHaveTextContent('PANEL');
    expect(screen.getByTestId('doc-ok')).toBeTruthy();
  });

  it('typed text survives a tab switch, in the same editor node', async () => {
    // Ruling 13: the shell used to mount only the active document, so
    // switching tabs unmounted the editor and its typed text with it.
    // Identity, not content — the SAME `<input>` element is still there,
    // holding what was typed into it; a re-mounted pane re-fed from some
    // fake would pass a content check and still have lost cursor, scroll
    // and undo.
    const ctx = harness();
    ctx.shell.open({
      key: 'a',
      title: 'A',
      component: () => <input data-testid="a-input" />,
      closable: true,
    });
    ctx.shell.open({ key: 'b', title: 'B', component: () => <div>B</div>, closable: true });
    render(<Shell ctx={ctx} />);
    await userEvent.click(screen.getByTestId('doc-a'));
    const input = screen.getByTestId<HTMLInputElement>('a-input');
    await userEvent.type(input, 'hello');
    await userEvent.click(screen.getByTestId('doc-b'));
    expect(input).not.toBeVisible();
    await userEvent.click(screen.getByTestId('doc-a'));
    expect(screen.getByTestId('a-input')).toBe(input);
    expect(input.value).toBe('hello');
    expect(input).toBeVisible();
  });

  it('a contribution registered after mount appears without a reload', () => {
    // Ported from `layout.test.tsx`'s "a screen registered after mount
    // appears without a reload": a plugin's client half lands through
    // `modules` well after `<Shell/>` first drew, and `useShell` alone
    // hears nothing from `ctx.slots`.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    render(<Shell ctx={ctx} />);
    expect(screen.queryByTestId('activity-late')).toBeNull();
    act(() => {
      ctx.slots.register(
        { name: 'shell.activity', key: 'late', title: 'Late', icon: 'l', opens: 'sidebar' },
        Nop,
      );
    });
    expect(screen.getByTestId('activity-late')).toBeTruthy();
  });

  it("a reload with unsaved changes is held for the browser's own confirm; a clean one is not", () => {
    // Ported from `code-screen.test.tsx`: `beforeunload` is registered once,
    // by the shell, off `hasDirtyDocuments()` — not by each editor.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    render(<Shell ctx={ctx} />);
    const fire = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(false);
    act(() => ctx.shell.markDirty('a', true));
    expect(fire()).toBe(true);
    act(() => ctx.shell.markDirty('a', false));
    expect(fire()).toBe(false);
  });

  it('the panel node survives switching documents', async () => {
    // Lifecycle through identity, not content — the pattern five vacuous
    // assertions on this branch got wrong.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.panel', key: 'p', title: 'P' }, () => <div>PANEL</div>);
    ctx.shell.open({ key: 'a', title: 'A', component: () => <div>A</div>, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: () => <div>B</div>, closable: true });
    render(<Shell ctx={ctx} />);
    const before = screen.getByTestId('panel');
    await userEvent.click(screen.getByTestId('doc-a'));
    expect(screen.getByTestId('panel')).toBe(before);
  });

  it('status items sit left and right by side, ordered', () => {
    // Two entries on the SAME side, registered out of order-sequence
    // ('l2' order 9 registered before 'l1' order 1) — one entry per side
    // would pass on bucketing by `side` alone and never exercise `byOrder`
    // at all.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.status', key: 'r', side: 'right', order: 1 }, () => (
      <span>R</span>
    ));
    ctx.slots.register({ name: 'shell.status', key: 'l2', side: 'left', order: 9 }, () => (
      <span>L2</span>
    ));
    ctx.slots.register({ name: 'shell.status', key: 'l1', side: 'left', order: 1 }, () => (
      <span>L1</span>
    ));
    render(<Shell ctx={ctx} />);
    const bar = screen.getByTestId('status-bar');
    expect(bar.querySelector('[data-side=left]')).toHaveTextContent('L1L2');
    expect(bar.querySelector('[data-side=right]')).toHaveTextContent('R');
  });

  it('a shipped status item under the shell answers to ONE status-<key> testid', () => {
    // Ruling 9: the shell wraps each entry in `status-<key>`, and the item
    // used to repeat the same testid on its own root, so `getByTestId`
    // threw "multiple elements" for every one of the four. `getByTestId`
    // is the assertion — it throws on a duplicate.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.status', key: 'dirty', side: 'right' }, DirtyStatus);
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('status-dirty')).toHaveTextContent('0 unsaved');
  });

  it('dragging the sidebar edge and the panel edge resizes them, and the sizes survive a remount', async () => {
    // Ruling 10. The token in the stylesheet is the default, so nothing is
    // inline until a drag; after one, the shell root carries the variable,
    // and a fresh mount reads it back from localStorage.
    localStorage.clear();
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    const first = render(<Shell ctx={ctx} />);
    const root = () => screen.getByTestId('shell');
    expect(root().style.getPropertyValue('--e8-sidebar-w')).toBe('');
    await userEvent.pointer([
      {
        keys: '[MouseLeft>]',
        target: screen.getByTestId('resize-sidebar'),
        coords: { x: 10, y: 0 },
      },
      { coords: { x: 310, y: 0 } },
      { keys: '[/MouseLeft]' },
    ]);
    // jsdom measures every box as 0, so the start is 0 and the drag alone is the width.
    expect(root().style.getPropertyValue('--e8-sidebar-w')).toBe('300px');
    await userEvent.pointer([
      {
        keys: '[MouseLeft>]',
        target: screen.getByTestId('resize-panel'),
        coords: { x: 0, y: 500 },
      },
      { coords: { x: 0, y: 250 } }, // up = taller
      { keys: '[/MouseLeft]' },
    ]);
    expect(root().style.getPropertyValue('--e8-panel-h')).toBe('250px');
    first.unmount();
    render(<Shell ctx={ctx} />);
    expect(root().style.getPropertyValue('--e8-sidebar-w')).toBe('300px');
    expect(root().style.getPropertyValue('--e8-panel-h')).toBe('250px');
  });

  it('a pending deep link is words in the body, not an empty pane', () => {
    location.hash = '#/doc/demo';
    const ctx = harness();
    (ctx as any).modules = { loaded: () => [], settled: () => false, subscribe: () => () => {} };
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.ready();
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('doc-opening')).toHaveTextContent('demo');
  });

  it("Cmd+S and Ctrl+S on a document that is not an editor are swallowed, not the browser's save-page dialog", () => {
    // A2: the editor's own listener answers only on its tab; on any other
    // tab the keystroke used to reach the browser. The shell swallows it
    // once, for every tab; the editor still saves on its own.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.openContributed('composition');
    render(<Shell ctx={ctx} />);
    const fire = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { ...init, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire({ key: 's', metaKey: true })).toBe(true);
    expect(fire({ key: 'S', ctrlKey: true })).toBe(true);
    expect(fire({ key: 's' })).toBe(false);
    expect(fire({ key: 'a', metaKey: true })).toBe(false);
  });

  it('a reload with unsaved changes also sets returnValue, the form Safari listens to', () => {
    // jsdom's `Event` carries `returnValue` as the legacy boolean alias of
    // the canceled flag, so `= ''` would read back as `false` and a
    // `preventDefault` alone would pass. An own data property on the event
    // is what makes the assignment itself observable.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    render(<Shell ctx={ctx} />);
    const fire = () => {
      const event = new Event('beforeunload', { cancelable: true });
      Object.defineProperty(event, 'returnValue', { value: true, writable: true });
      window.dispatchEvent(event);
      return (event as { returnValue: unknown }).returnValue;
    };
    expect(fire()).toBe(true);
    act(() => ctx.shell.markDirty('a', true));
    expect(fire()).toBe('');
  });

  it('documents open but none named by the address is words in the body, not an empty pane', () => {
    // Finding 1 of the final review: open A, open B, Back past both — the
    // address is `''`, every pane is hidden, and the body was blank.
    // Pinned by state, not content: two documents, no active one, nothing
    // pending — and the explanation rendered.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.shell.ready();
    ctx.shell.open({ key: 'a', title: 'A', component: () => <div>A</div>, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: () => <div>B</div>, closable: true });
    render(<Shell ctx={ctx} />);
    expect(screen.queryByTestId('doc-none')).toBeNull();
    act(() => {
      location.hash = ''; // the browser's Back, past the first document opened
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(ctx.shell.documents()).toHaveLength(2);
    expect(ctx.shell.active()).toBeUndefined();
    expect(ctx.shell.pending()).toBeUndefined();
    expect(screen.getByTestId('doc-none')).toBeVisible();
    expect(screen.getByTestId('doc-pane-a')).not.toBeVisible();
    expect(screen.getByTestId('doc-pane-b')).not.toBeVisible();
  });

  it('with nothing registered anywhere it explains itself instead of painting nothing', () => {
    render(<Shell ctx={harness()} />);
    expect(screen.getByTestId('shell-empty')).toHaveTextContent(/no contributions/i);
  });

  // --- Ported from Layout.test.tsx (see task-2-brief.md's correction A):
  // the shape of the crash boundary and the panel's independence from the
  // active document outlive the "one screen" form just as much as the
  // properties Step 2's tests above already pin. "screen" becomes
  // "document" throughout.

  it('a crashed document still lets you navigate away from it', async () => {
    // Ported from "a crashed screen still lets you navigate away from it".
    // A boundary that swallows the crash but leaves the tabs unreachable
    // leaves the IDE just as stuck as no boundary at all — and, unlike the
    // single-render crash test above, this is the one test that actually
    // NAVIGATES after the crash, so it is the one that goes red if
    // `DocumentBoundary` loses its `key={active.key}`: without the key, the
    // same class instance stays committed to its caught state and keeps
    // rendering the old error no matter which document becomes active next.
    const ctx = harness();
    ctx.shell.open({
      key: 'bad',
      title: 'Bad',
      component: () => {
        throw new Error('boom');
      },
      closable: true,
    });
    ctx.shell.open({ key: 'ok', title: 'OK', component: () => <div>OK BODY</div>, closable: true });
    ctx.shell.activate('bad');
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('doc-error')).toBeTruthy();
    await userEvent.click(screen.getByTestId('doc-ok'));
    expect(screen.getByText('OK BODY')).toBeTruthy();
  });

  it('reports the crashed document, so it reaches the one list', () => {
    // Ported from "reports the crashed screen, so it reaches the one list".
    const ctx = harness();
    ctx.shell.open({
      key: 'bad',
      title: 'Bad',
      component: () => {
        throw new Error('boom');
      },
      closable: true,
    });
    render(<Shell ctx={ctx} />);
    expect(ctx.connection.diagnostics.map((d) => d.plugin)).toContain('bad');
  });

  it('a crashed document is still data when composed without ctx.connection', async () => {
    // Ported from "a crashed screen is still data when composed without
    // ctx.connection". The boundary is the last thing standing when a
    // document throws, so a direct `ctx.connection` read inside
    // `componentDidCatch` — instead of the lenient `ctx.reflect.get` read
    // — would turn the one failure that has to be data into a crash of the
    // whole page. A real `Context` with `slots`+`shell` composed and no
    // `connection`, for the reason `shell.test.tsx`'s own "composed
    // without ctx.connection" test above already gives.
    const ctx = new Context();
    await ctx.plugin(slotsPlugin);
    await ctx.plugin(shellPlugin);
    ctx.shell.open({
      key: 'bad',
      title: 'Bad',
      component: () => {
        throw new Error('boom');
      },
      closable: true,
    });

    expect(() => render(<Shell ctx={ctx} />)).not.toThrow();
    expect(screen.getByTestId('doc-error').textContent).toContain('boom');

    await ctx.fiber.dispose();
  });

  it('a background-opened document is mounted in the DOM, hidden — not just recorded as open', () => {
    // Task 8b: `background` exists so the component actually MOUNTS — an
    // entry in `documents()` proves nothing on its own if `Shell` never
    // draws its pane. Composition stays active; the Preview's pane is in
    // the DOM but `hidden`, the same as any other inactive tab.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
    ctx.slots.register({ name: 'shell.document', key: 'preview' }, Dummy);
    ctx.shell.openContributed('composition');
    ctx.shell.openContributed('preview', { background: true });
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('doc-pane-composition')).toBeVisible();
    expect(screen.getByTestId('doc-pane-preview')).not.toBeVisible();
  });

  it('the panel is visible on every document, not only one', async () => {
    // Ported from "the panel is visible on every screen, not only on
    // composition" — the diagnostics panel used to be a `composition.card`,
    // reachable on one screen alone; the panel region here answers no
    // document in particular, so navigating to an unrelated one must not
    // hide it.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.panel', key: 'p', title: 'P' }, () => <div>PANEL</div>);
    ctx.shell.open({
      key: 'other',
      title: 'Other',
      component: () => <div>OTHER</div>,
      closable: true,
    });
    render(<Shell ctx={ctx} />);
    await userEvent.click(screen.getByTestId('doc-other'));
    expect(screen.getByTestId('panel')).toHaveTextContent('PANEL');
  });
});

describe('sidebars follow the active tab', () => {
  /** A contributed document declaring `meta`'s sidebars, opened (and so active). */
  function doc(ctx: Context, key: string, meta: { sidebar?: string; sideRight?: string } = {}) {
    ctx.slots.register({ name: 'shell.document', key, title: key, ...meta }, Dummy);
    ctx.shell.openContributed(key);
  }

  it("the active document's declared sidebar shows; its right one only while that key's flag is on", () => {
    const ctx = harness();
    doc(ctx, 'd', { sidebar: 'a', sideRight: 'r' });
    expect(ctx.shell.sidebar()).toBe('a');
    expect(ctx.shell.sideRight()).toBeUndefined();
    ctx.shell.setSideRight('r', true);
    expect(ctx.shell.sideRight()).toBe('r');
    ctx.shell.setSideRight('r', false);
    expect(ctx.shell.sideRight()).toBeUndefined();
  });

  it('a document declaring nothing collapses both', () => {
    const ctx = harness();
    ctx.shell.setSideRight('r', true);
    doc(ctx, 'plain');
    expect(ctx.shell.sidebar()).toBeUndefined();
    expect(ctx.shell.sideRight()).toBeUndefined();
  });

  it('a background-opened document carries its declared sidebars to the tab', () => {
    const ctx = harness();
    ctx.slots.register({ name: 'shell.document', key: 'bg', sidebar: 'a', sideRight: 'r' }, Dummy);
    ctx.shell.openContributed('bg', { background: true });
    expect(ctx.shell.documents()).toEqual([
      expect.objectContaining({ key: 'bg', sidebar: 'a', sideRight: 'r' }),
    ]);
    ctx.shell.activate('bg');
    expect(ctx.shell.sidebar()).toBe('a');
  });

  it('an activity view shows over tabs with no sidebar, yields to one with its own, and a second press gives it back', () => {
    const ctx = harness();
    doc(ctx, 'code1');
    ctx.shell.showSidebar('explorer');
    expect(ctx.shell.sidebar()).toBe('explorer');
    doc(ctx, 'code2');
    expect(ctx.shell.sidebar()).toBe('explorer');
    doc(ctx, 'sym', { sidebar: 'a' });
    expect(ctx.shell.sidebar()).toBe('a');
    ctx.shell.showSidebar('explorer');
    expect(ctx.shell.sidebar()).toBe('explorer');
    ctx.shell.showSidebar('explorer');
    expect(ctx.shell.sidebar()).toBe('a');
  });

  it("the activity view's own sideRight wins over the tab's; one without leaves the tab's", () => {
    const ctx = harness();
    ctx.slots.register({ name: 'shell.sidebar', key: 'scenes', title: 'S', sideRight: 's' }, Dummy);
    ctx.slots.register({ name: 'shell.sidebar', key: 'explorer', title: 'E' }, Dummy);
    doc(ctx, 'd', { sideRight: 'r' });
    ctx.shell.setSideRight('s', true);
    ctx.shell.setSideRight('r', true);
    expect(ctx.shell.sideRight()).toBe('r');
    ctx.shell.showSidebar('scenes');
    expect(ctx.shell.sideRight()).toBe('s');
    // The view's key is chosen first, then its flag read: off is collapsed, not the tab's.
    ctx.shell.setSideRight('s', false);
    expect(ctx.shell.sideRight()).toBeUndefined();
    ctx.shell.showSidebar('explorer');
    expect(ctx.shell.sideRight()).toBe('r');
  });

  it('the right sidebar leaves with its tab and comes back with it, the flag untouched', () => {
    const ctx = harness();
    doc(ctx, 'flow', { sideRight: 'flow' });
    ctx.shell.setSideRight('flow', true);
    expect(ctx.shell.sideRight()).toBe('flow');
    doc(ctx, 'preview');
    expect(ctx.shell.sideRight()).toBeUndefined();
    ctx.shell.activate('flow');
    expect(ctx.shell.sideRight()).toBe('flow');
  });

  it("a file opened through a viewer carries the viewer's declared sidebars", () => {
    const ctx = harness();
    viewersPlugin.apply(ctx);
    ctx.viewers.register({
      id: 'v',
      match: (path) => path.endsWith('.scene.yml'),
      component: Dummy,
      sidebar: 'a',
      sideRight: 'r',
    });
    openPath(ctx, 'scenes/x.scene.yml');
    expect(ctx.shell.active()).toEqual(
      expect.objectContaining({ key: 'f:scenes/x.scene.yml', sidebar: 'a', sideRight: 'r' }),
    );
    expect(ctx.shell.sidebar()).toBe('a');
  });

  it('setSideRight notifies only on a change', () => {
    const ctx = harness();
    const listener = vi.fn();
    ctx.shell.subscribe(listener);
    ctx.shell.setSideRight('r', true);
    ctx.shell.setSideRight('r', true);
    expect(listener).toHaveBeenCalledTimes(1);
    ctx.shell.setSideRight('r', false);
    expect(listener).toHaveBeenCalledTimes(2);
    // Never on is already off.
    ctx.shell.setSideRight('other', false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('sidebars stay mounted', () => {
  it('a sidebar entry keeps its own state, hidden rather than unmounted, when another shows in its place', async () => {
    // Mirrors "typed text survives a tab switch" for the document panes:
    // the SAME node, not a fresh mount fed from some cache.
    const ctx = harness();
    ctx.slots.register({ name: 'shell.sidebar', key: 'a', title: 'A' }, () => (
      <input data-testid="sidebar-a-input" />
    ));
    ctx.slots.register({ name: 'shell.sidebar', key: 'b', title: 'B' }, () => <div>B</div>);
    ctx.shell.showSidebar('a');
    render(<Shell ctx={ctx} />);
    // Never shown, so not mounted at all — not merely hidden.
    expect(screen.queryByTestId('sidebar-b')).toBeNull();
    const input = screen.getByTestId<HTMLInputElement>('sidebar-a-input');
    await userEvent.type(input, 'hello');
    act(() => ctx.shell.showSidebar('b'));
    expect(screen.getByTestId('sidebar-a')).not.toBeVisible();
    expect(screen.getByTestId('sidebar-a-input')).toBe(input); // still mounted
    expect(input.value).toBe('hello');
    act(() => ctx.shell.showSidebar('a'));
    expect(screen.getByTestId('sidebar-a-input')).toBe(input); // the same node back
    expect(input.value).toBe('hello');
    expect(screen.getByTestId('sidebar-a')).toBeVisible();
  });

  it("the activity button of the override is highlighted; a tab's own sidebar highlights no activity button", async () => {
    const ctx = harness();
    ctx.slots.register(
      { name: 'shell.activity', key: 'a', title: 'A', icon: 'a', opens: 'sidebar' },
      Nop,
    );
    ctx.slots.register(
      { name: 'shell.activity', key: 'explorer', title: 'Explorer', icon: 'e', opens: 'sidebar' },
      Nop,
    );
    ctx.slots.register({ name: 'shell.sidebar', key: 'a', title: 'A' }, Dummy);
    ctx.slots.register({ name: 'shell.sidebar', key: 'explorer', title: 'Explorer' }, Dummy);
    ctx.slots.register({ name: 'shell.document', key: 'd', title: 'D', sidebar: 'a' }, Dummy);
    ctx.shell.openContributed('d');
    render(<Shell ctx={ctx} />);
    // The active tab's OWN sidebar is showing — no activity button lit,
    // even though its key matches one.
    expect(screen.getByTestId('activity-a')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByTestId('activity-explorer'));
    // An override is showing now — its own button lights, the tab's does not.
    expect(screen.getByTestId('activity-explorer')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('activity-a')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('right sidebar', () => {
  it('is collapsed with nothing registered', () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('shell').className).toContain('e8-side-right-collapsed');
  });

  it("shows the active tab's contribution while its flag is on, and hides (not unmounts) when it goes off", () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true, sideRight: 'props' });
    render(<Shell ctx={ctx} />);
    ctx.slots.register({ name: 'shell.sideRight', key: 'props', title: 'Properties' }, () => (
      <p>props here</p>
    ));
    act(() => ctx.shell.setSideRight('props', true));
    expect(screen.getByTestId('side-right-props')).toHaveTextContent('props here');
    expect(screen.getByTestId('shell').className).not.toContain('e8-side-right-collapsed');
    act(() => ctx.shell.setSideRight('props', false));
    // Once shown, `side-right-props` stays in the DOM — hidden, not
    // removed — the same rule the document panes and the panel's own
    // entries already keep; only the collapsed class says nothing is
    // showing.
    expect(screen.getByTestId('side-right-props')).not.toBeVisible();
    expect(screen.getByTestId('shell').className).toContain('e8-side-right-collapsed');
  });

  it('a retracted contribution stops rendering, though its key stays flagged on', () => {
    // The collapsed class is keyed on the effective key alone (`sideRight
    // === undefined`), not on whether a component still backs it — the
    // same simplification the left sidebar's own collapse already made.
    // A plugin unloaded out from under a still-flagged key leaves the
    // column open (nothing tells the shell to give it up) but empty:
    // `sideRightEntries` no longer has a component for that key, so
    // there is nothing left to keep mounted.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true, sideRight: 'props' });
    render(<Shell ctx={ctx} />);
    const off = ctx.slots.register(
      { name: 'shell.sideRight', key: 'props', title: 'Properties' },
      () => <p>x</p>,
    );
    act(() => ctx.shell.setSideRight('props', true));
    act(() => off());
    expect(screen.getByTestId('shell').className).not.toContain('e8-side-right-collapsed');
    expect(screen.queryByTestId('side-right-props')).toBeNull();
  });

  it('an entry never shown is not mounted at all', () => {
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true, sideRight: 'x' });
    ctx.slots.register({ name: 'shell.sideRight', key: 'x', title: 'X' }, Dummy);
    ctx.slots.register({ name: 'shell.sideRight', key: 'y', title: 'Y' }, Dummy);
    render(<Shell ctx={ctx} />);
    act(() => ctx.shell.setSideRight('x', true));
    expect(screen.getByTestId('side-right-x')).toBeVisible();
    expect(screen.queryByTestId('side-right-y')).toBeNull();
  });

  it('a side-right entry keeps its own state, hidden rather than unmounted, when another shows in its place', async () => {
    // Mirrors "typed text survives a tab switch" for the document panes:
    // the SAME node, not a fresh mount fed from some cache.
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true, sideRight: 'a' });
    ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true, sideRight: 'b' });
    ctx.slots.register({ name: 'shell.sideRight', key: 'a', title: 'A' }, () => (
      <input data-testid="side-right-a-input" />
    ));
    ctx.slots.register({ name: 'shell.sideRight', key: 'b', title: 'B' }, () => <div>B</div>);
    ctx.shell.activate('a');
    ctx.shell.setSideRight('a', true);
    ctx.shell.setSideRight('b', true);
    render(<Shell ctx={ctx} />);
    const input = screen.getByTestId<HTMLInputElement>('side-right-a-input');
    await userEvent.type(input, 'hello');
    act(() => ctx.shell.activate('b'));
    expect(screen.getByTestId('side-right-a')).not.toBeVisible();
    expect(screen.getByTestId('side-right-a-input')).toBe(input);
    expect(input.value).toBe('hello');
    act(() => ctx.shell.activate('a'));
    expect(screen.getByTestId('side-right-a-input')).toBe(input);
    expect(input.value).toBe('hello');
    expect(screen.getByTestId('side-right-a')).toBeVisible();
  });

  it('dragging resize-side-right leftwards widens it, and the width survives a remount', async () => {
    // Mirrors the left sidebar's own drag/remount test above.
    localStorage.removeItem('e8.side-right-w');
    const ctx = harness();
    ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true, sideRight: 'props' });
    ctx.slots.register({ name: 'shell.sideRight', key: 'props', title: 'Properties' }, () => (
      <p>P</p>
    ));
    ctx.shell.setSideRight('props', true);
    const first = render(<Shell ctx={ctx} />);
    const root = () => screen.getByTestId('shell');
    expect(root().style.getPropertyValue('--e8-side-right-w')).toBe('');
    await userEvent.pointer([
      {
        keys: '[MouseLeft>]',
        target: screen.getByTestId('resize-side-right'),
        coords: { x: 300, y: 0 },
      },
      { coords: { x: 0, y: 0 } }, // dragged LEFT — widens, the opposite sign from the left sidebar's handle
      { keys: '[/MouseLeft]' },
    ]);
    expect(root().style.getPropertyValue('--e8-side-right-w')).toBe('300px');
    expect(localStorage.getItem('e8.side-right-w')).toBe('300');
    first.unmount();
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('shell').style.getPropertyValue('--e8-side-right-w')).toBe('300px');
  });
});
