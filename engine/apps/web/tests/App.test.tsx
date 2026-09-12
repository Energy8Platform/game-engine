import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createIdeClient } from '@energy8engine/ide-client';
import { App } from '../src/App';

/**
 * `App` used to render `CompositionScreen` directly — the one screen this
 * shell knew about, wired in by hand. This suite proves the replacement:
 * `App` REGISTERS the composition screen with `ctx.layout` and draws
 * `<Layout/>`, which is the thing that actually puts it on screen. What
 * `Layout` itself does with a registered screen (tabs, the error boundary,
 * the empty state) is `ide-client`'s own `layout.test.tsx` — this file only
 * has to prove `App` hands `ctx` the one registration a screen needs.
 *
 * `harness()` goes through the REAL `createIdeClient`, not a hand-built
 * `ctx` double. That choice matters specifically for this file: `ide-web`
 * is the one package that composes `createIdeClient` for a running IDE —
 * `main.tsx` does exactly this — and whether `ctx.layout` actually reaches
 * `App` along that real path is the thing this task closes (`context.ts`
 * used to compose `connection`, `slots`, `modules`, `gameComposition` and
 * `gameDiagnostics`, and never `layout`, so `ctx.layout` did not exist in
 * the app a person actually opens). A fake `ctx` would only prove `App`
 * calls the right method names; the real client is what proves those names
 * resolve to something.
 */
async function harness() {
  const socket = {
    readyState: 1,
    addEventListener() {},
    send() {},
    close() {},
  };
  return createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    // `gameComposition` fetches `/api/composition` the moment its plugin
    // applies, unprompted by anything this suite does — answered here so
    // the test exercises a real response instead of a real (and, in this
    // environment, doomed) network request. Same shape as `game-composition
    // .test.ts`'s own `answer()` helper in `ide-client`.
    fetchFn: (async () =>
      new Response(JSON.stringify({ rows: [], diagnostics: [] }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
}

describe('App', () => {
  it('registers the composition screen rather than rendering it directly', async () => {
    const ctx = await harness();
    render(<App ctx={ctx} />);
    expect(ctx.layout.screens().map((s) => s.id)).toContain('composition');
  });

  it('draws Layout’s chrome, not a screen on its own', async () => {
    // The guard against the old shape coming back. `App` used to render
    // `CompositionScreen` directly; if it still did, the composition body
    // would be on screen even though nothing put a tab there — `Layout` is
    // the only thing here that draws a `role="tab"` at all. Addressed by
    // id (`Layout`'s own `data-testid={`tab-${id}`}`), not by the tab's
    // wording: this test is about the STRUCTURE — a tab exists for the
    // registered screen — and pinning it to visible text would fail on a
    // translation that changed nothing this test actually cares about.
    const ctx = await harness();
    render(<App ctx={ctx} />);
    expect(screen.getByTestId('tab-composition')).toBeTruthy();
  });

  it('registers preview after composition, not before it', async () => {
    // `layout.tsx`'s own comparator sorts an UNORDERED screen after every
    // ORDERED one, regardless of that one's number (see `layout.test.tsx`'s
    // "a screen with no order sorts after every screen that has one") — so
    // giving `preview` an order while leaving `composition` without one
    // would have put `preview` first, the opposite of what `App` intends.
    // This is the guard against that going unnoticed a second time.
    const ctx = await harness();
    render(<App ctx={ctx} />);
    expect(ctx.layout.screens().map((s) => s.id)).toEqual([
      'composition',
      'preview',
      'assets',
      'code',
    ]);
  });

  it('registers the assets screen, after preview', async () => {
    const ctx = await harness();
    render(<App ctx={ctx} />);
    expect(screen.getByTestId('tab-assets')).toBeTruthy();
  });

  it('registers the code screen, after assets', async () => {
    const ctx = await harness();
    render(<App ctx={ctx} />);
    expect(screen.getByTestId('tab-code')).toBeTruthy();
  });

  it('the composition screen no longer registers the panel as a card', async () => {
    // Task 7's debt: the panel used to be a `composition.card` registration,
    // reachable only on the composition tab. It is now hardcoded chrome in
    // `Layout` itself — see `ide-client`'s own `layout.test.tsx`. This is
    // the guard against the registration coming back.
    const ctx = await harness();
    render(<App ctx={ctx} />);
    expect(ctx.slots.list('composition.card').map((c) => c.key)).not.toContain('diagnostics');
  });

  it('composition.card still works for anything else', async () => {
    // Уходит одна карточка, не механизм: `App` itself registers no
    // `composition.card` any more, but the slot a THIRD PARTY registers
    // still has to reach the screen. Rendered through the real `<App/>`
    // (whose own JSX is exactly `<Layout ctx={ctx}/>`) rather than a bare
    // `<Layout/>`, so this exercises the actual path a registration takes:
    // App → Layout → the composition screen → `CompositionScreen`'s own
    // `EditorComposition`, which is the one thing in this tree that still
    // reads `composition.card` — untouched by this task.
    const ctx = await harness();
    ctx.slots.register({ name: 'composition.card', key: 'other' }, () => <div>CARD</div>);
    render(<App ctx={ctx} />);
    expect(screen.getByText('CARD')).toBeTruthy();
  });

  it('registers the explorer activity and sidebar view, inert until Shell replaces Layout', async () => {
    // Task 4's own addition, alongside the `ctx.layout.screen` calls above,
    // not instead of them — `App` still draws `<Layout/>`, so nothing on
    // screen reads either slot yet (Task 6 is what switches `App` onto
    // `<Shell/>`). Proven the only way it can be today: the registration
    // itself, through `ctx.slots.list`, the same primitive
    // `composition.card still works for anything else` above already
    // reads.
    const ctx = await harness();
    render(<App ctx={ctx} />);
    expect(ctx.slots.list('shell.activity').map((e) => e.key)).toContain('explorer');
    expect(ctx.slots.list('shell.sidebar').map((e) => e.key)).toContain('explorer');
  });

  it('the composition tab reads in the IDE’s own language, not a stray English one', async () => {
    // The one place in this suite that pins WORDING rather than structure.
    // The reason it used to give — that EVERY visible string in
    // `ide/client/src` is Russian — was retracted by Ruling 13 and is
    // less true now than it was then: the layout's own empty and crashed
    // states, and the diagnostics panel's rows, are all English. What is
    // actually being held is narrower and still worth holding: the
    // NAVIGATION reads in the same language as the screen it opens, and
    // `CompositionScreen`'s own `<h1>` says `Состав`. A tab reading
    // "Composition" above that heading is the inconsistency, whatever the
    // rest of the app does. Addressed by the tab's accessible name
    // (`role="tab"`'s `name`, which is `entry.title` — see `Layout.tsx`),
    // the one thing that actually carries the wording; the testid above
    // deliberately does not.
    const ctx = await harness();
    render(<App ctx={ctx} />);
    expect(screen.getByRole('tab', { name: 'Состав' })).toBeTruthy();
  });
});
