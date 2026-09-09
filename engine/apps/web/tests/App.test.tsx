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
    // the only thing here that draws a `role="tab"` at all.
    const ctx = await harness();
    render(<App ctx={ctx} />);
    expect(screen.getByRole('tab', { name: /composition/i })).toBeTruthy();
  });
});
