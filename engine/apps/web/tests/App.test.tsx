import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIdeClient, useGameComposition } from '@energy8engine/ide-client';
import {
  diagnostic as d,
  type CompositionRow,
  type Diagnostic,
  type ServerMessage,
  type WorkspaceState,
} from '@energy8engine/contracts';
import { App } from '../src/App';

/**
 * `App` registers what the engine ships into the shell's slots and draws
 * `<Shell/>`, which is the thing that actually puts it on screen. What
 * `Shell` itself does with a registration (tabs, the boundary, the empty
 * state) is `ide-client`'s own `shell.test.tsx` — this file only has to
 * prove `App` hands `ctx` the registrations, in the right order, and calls
 * `ready()` after the last of them.
 *
 * `harness()` goes through the REAL `createIdeClient`, not a hand-built
 * `ctx` double: `ide-web` is the one package that composes it for a
 * running IDE — `main.tsx` does exactly this — and whether `ctx.shell`
 * reaches `App` along that real path (and `ctx.layout` no longer does,
 * Ruling 2) is what a fake could never show.
 */
function fakeSocket() {
  const listeners: ((event: { data: string }) => void)[] = [];
  return {
    readyState: 1,
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send() {},
    close() {},
    push(message: ServerMessage) {
      for (const listener of listeners) listener({ data: JSON.stringify(message) });
    },
  };
}

async function harness(
  importModule?: (url: string) => Promise<unknown>,
  workspace: WorkspaceState = {
    projects: [],
    templates: [],
    active: null,
    previewUrl: null,
    diagnostics: [],
  },
  // `/api/composition`'s own `diagnostics` — namespace 1, `project` in
  // `DiagnosticsPanel`'s terms. Empty by default, like every other route
  // here; the diagnostics-badge test below is the one that sets it.
  compositionDiagnostics: Diagnostic[] = [],
) {
  const socket = fakeSocket();
  const ctx = await createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    importModule,
    // `gameComposition` fetches `/api/composition` the moment its plugin
    // applies, `workspace` fetches `/api/workspace`, and the Explorer `App`
    // opens on load fetches `/api/files` — all answered here, empty, so the
    // tests exercise real responses instead of real (and, in this
    // environment, doomed) requests.
    fetchFn: (async (input: unknown) => {
      const url = String(input);
      // One file the editor tests below can open: the bytes, as the host
      // would serve them.
      if (url === '/api/files/game%2Fscript.spin' || url === '/api/files/game/script.spin') {
        return new Response('game = Spin');
      }
      return new Response(
        JSON.stringify(
          url === '/api/files'
            ? { entries: [], diagnostics: [] }
            : url === '/api/workspace'
              ? workspace
              : url === '/api/composition'
                ? { rows: [], diagnostics: compositionDiagnostics }
                : { rows: [], diagnostics: [] },
        ),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch,
  });
  return { ctx, socket };
}

/** What `/api/workspace` answers when a project is open — the harness's default answers with none. */
const OPEN_PROJECT: WorkspaceState = {
  projects: [{ id: 'a', name: 'A' }],
  templates: [],
  active: 'a',
  previewUrl: 'http://game.test:5679',
  diagnostics: [],
};

/** The composition row the host would broadcast for `first-slot`'s `screen-demo` plugin. */
function demoRow(): CompositionRow {
  return {
    id: 'demo1',
    name: 'screen-demo',
    disabled: false,
    state: 2,
    config: {},
    schema: null,
    hot: true,
    clientUrl: '/plugin-client/demo1',
    clientInject: ['slots', 'gameComposition'],
  };
}

// `ctx.shell` writes `location.hash`, and a deep-link test below sets it
// by hand — left alone, one test's address is the next test's deep link.
beforeEach(() => {
  location.hash = '';
});

describe('App', () => {
  it('registers projects, explorer, composition and preview in the activity bar, in that order, and the scenes/flow plugins after them', async () => {
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    expect(ctx.slots.list('shell.activity').map((e) => e.key)).toEqual(
      expect.arrayContaining(['workspace', 'explorer', 'composition', 'preview']),
    );
    // What the bar DRAWS is the `order`-sorted list, and projects come first.
    const buttons = within(screen.getByTestId('activity-bar')).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual([
      'activity-workspace',
      'activity-explorer',
      'activity-composition',
      'activity-preview',
      'activity-scenes',
      'activity-flow',
      'activity-symbols',
    ]);
  });

  it('the projects button opens the «Projects» sidebar', async () => {
    const { ctx } = await harness(undefined, OPEN_PROJECT);
    render(<App ctx={ctx} />);
    await waitFor(() => expect(ctx.shell.sidebar()).toBe('explorer'));
    fireEvent.click(screen.getByTestId('activity-workspace'));
    expect(ctx.shell.sidebar()).toBe('workspace');
    expect(await screen.findByText('Projects')).toBeTruthy();
  });

  it('registers composition, preview and flow as documents, none closable', async () => {
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    const docs = ctx.slots.list<{ name: string; key: string; closable?: boolean }>(
      'shell.document',
    );
    // `flow` composes ahead of `App`'s own effects (inside `createIdeClient`,
    // before `App` ever renders), so it lands first in registration order.
    expect(docs.map((d) => [d.key, d.closable])).toEqual([
      ['flow', false],
      ['symbols', false],
      ['composition', false],
      ['preview', false],
    ]);
  });

  it('registers the diagnostics panel, and nothing as a composition.card', async () => {
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    expect(ctx.slots.list('shell.panel').map((e) => e.key)).toEqual(['diagnostics']);
    expect(ctx.slots.list('composition.card')).toEqual([]);
  });

  it('the diagnostics badge counts errors and warnings across project, game and editor — never info', async () => {
    // One error from `/api/composition` (project), one warning and one info
    // from a `game-diagnostics` frame (game — the info row must NOT count),
    // one error from the editor's own `ctx.connection.report` — 3 counted.
    const projectDiagnostics: Diagnostic[] = [d('error', 'reels1', 'package', 'could not resolve')];
    const { ctx, socket } = await harness(undefined, undefined, projectDiagnostics);
    render(<App ctx={ctx} />);
    await waitFor(() =>
      expect(ctx.slots.list('shell.panel').map((e: { key: string }) => e.key)).toEqual([
        'diagnostics',
      ]),
    );

    act(() => {
      socket.push({
        type: 'game-diagnostics',
        diagnostics: [
          d('warning', 'reels', 'runtime', 'reels wobble'),
          d('info', 'reels', 'runtime', 'just fyi'),
        ],
      } as unknown as ServerMessage);
    });
    act(() => {
      ctx.connection.report(d('error', 'slots', 'shell', 'two cards claim a key'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('panel-badge-diagnostics')).toHaveTextContent('3'),
    );
  });

  it('registers the five status items, two on the left and three on the right', async () => {
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    const items = ctx.slots.list<{ name: string; key: string; side: string; order: number }>(
      'shell.status',
    );
    expect(items.map((i) => [i.key, i.side, i.order])).toEqual([
      ['project', 'left', 0],
      ['dirty', 'left', 1],
      ['session', 'right', 0],
      ['theme', 'right', 1],
      ['game', 'right', -1],
    ]);
  });

  it("the status bar's right side starts with status-game — game status leads session/theme", async () => {
    // `order: -1` outranks `session` (0) and `theme` (1) — `Shell.tsx` draws
    // `statusEntries` `byOrder`, not in registration order (task 5).
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    const right = screen.getByTestId('status-bar').querySelector('[data-side="right"]');
    const keys = within(right as HTMLElement)
      .getAllByTestId(/^status-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(keys[0]).toBe('status-game');
  });

  it('draws the shell — five regions — and no old tab bar', async () => {
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    for (const region of ['activity-bar', 'sidebar', 'doc-tabs', 'panel', 'status-bar']) {
      expect(screen.getByTestId(region)).toBeTruthy();
    }
    expect(screen.queryByTestId('tab-composition')).toBeNull();
  });

  it('calls shell.ready() after every registration', async () => {
    // Slice 6 debt 2: no false "not registered" on a deep link.
    location.hash = '#/doc/preview';
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    expect(ctx.connection.diagnostics).toEqual([]);
    expect(ctx.shell.active()?.key).toBe('preview');
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeTruthy();
  });

  it('a fresh load with a project open shows the composition and the Explorer, not five empty regions', async () => {
    const { ctx } = await harness(undefined, OPEN_PROJECT);
    render(<App ctx={ctx} />);
    // Both wait for the workspace's answer (the boot GET), then pick: a
    // project is open, so the composition and the Explorer.
    await waitFor(() => expect(ctx.shell.active()?.key).toBe('composition'));
    await waitFor(() => expect(ctx.shell.sidebar()).toBe('explorer'));
    expect(screen.getByTestId('sidebar-explorer')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Composition' })).toBeTruthy();
  });

  it('a fresh load with no project open shows the projects list instead, and opens no document', async () => {
    // A4: the composition with no project behind it said «connecting…»
    // forever. An empty group that points at Projects is the honest one.
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    await waitFor(() => expect(ctx.shell.sidebar()).toBe('workspace'));
    expect(screen.getByTestId('sidebar-workspace')).toBeTruthy();
    expect(ctx.shell.documents()).toEqual([]);
    expect(ctx.shell.active()).toBeUndefined();
    expect(screen.getByTestId('doc-none')).toHaveTextContent('open a project from Projects');
  });

  it('a project opened later, from the list, opens the composition then — once per null → id', async () => {
    // Fix round 1 of task 4: with no project on load nothing opens; a
    // click on Projects makes `active` go null → id on a later frame, and
    // THAT is when the composition opens. A repeated frame is not a second
    // open, and a switch between two projects touches nothing.
    const { ctx, socket } = await harness();
    render(<App ctx={ctx} />);
    await waitFor(() => expect(ctx.shell.sidebar()).toBe('workspace'));
    expect(ctx.shell.documents()).toEqual([]);
    act(() => socket.push({ type: 'workspace', workspace: OPEN_PROJECT }));
    expect(ctx.shell.active()?.key).toBe('composition');
    // Back past it: no active document, nothing pending — the one state a
    // repeated `x` frame could wrongly re-open into.
    act(() => {
      location.hash = '';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(ctx.shell.active()).toBeUndefined();
    act(() => socket.push({ type: 'workspace', workspace: OPEN_PROJECT }));
    expect(ctx.shell.active()).toBeUndefined();
    // A switch, the way the host actually sends it: `a → null → y` (the
    // `null` frame while it closes `a`). The active document is `preview`
    // — contributed `closable: false`, so `workspace` leaves it where it
    // is on the switch (it closes every CLOSABLE tab) — and the rule must
    // not paint the composition over it on the `null → y` edge: a
    // document IS active. With only file tabs open the outcome differs
    // for a reason that is not this rule: `workspace` closes them on the
    // `null` frame, nothing is active on the `y` frame, and the
    // composition opens — the fresh-project default, for a project that
    // has just become the open one.
    act(() => ctx.shell.openContributed('preview'));
    expect(ctx.shell.active()?.key).toBe('preview');
    const switched = { ...OPEN_PROJECT, projects: [{ id: 'y', name: 'Y' }], active: 'y' };
    act(() => socket.push({ type: 'workspace', workspace: { ...switched, active: null } }));
    act(() => socket.push({ type: 'workspace', workspace: switched }));
    expect(ctx.shell.active()?.key).toBe('preview');
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['composition', 'preview']);
  });

  it('the sidebar is decided once — a collapsed sidebar is not re-opened by a later frame', async () => {
    // Task 4's deferred pin: the default sidebar is chosen on the FIRST
    // state only. `showSidebar(undefined)` collapses it (the API toggles:
    // the current key again, or `undefined`, is "none"); a frame after
    // that — a project switch, here — must leave it collapsed.
    const { ctx, socket } = await harness(undefined, OPEN_PROJECT);
    render(<App ctx={ctx} />);
    await waitFor(() => expect(ctx.shell.sidebar()).toBe('explorer'));
    act(() => ctx.shell.showSidebar(undefined));
    expect(ctx.shell.sidebar()).toBeUndefined();
    act(() =>
      socket.push({
        type: 'workspace',
        workspace: { ...OPEN_PROJECT, projects: [{ id: 'y', name: 'Y' }], active: 'y' },
      }),
    );
    expect(ctx.shell.sidebar()).toBeUndefined();
  });

  it('a resolved deep link is left alone by the composition default', async () => {
    location.hash = '#/doc/preview';
    const { ctx } = await harness(undefined, OPEN_PROJECT);
    render(<App ctx={ctx} />);
    await waitFor(() => expect(ctx.shell.sidebar()).toBe('explorer'));
    expect(ctx.shell.active()?.key).toBe('preview');
    expect(ctx.shell.documents().map((d) => d.key)).toEqual(['preview']);
  });

  it('a deep link still pending when the workspace answers is left alone too', async () => {
    // The project is open, so the composition WOULD be the default — but
    // the address names a plugin's document whose client half has not
    // landed, and the default must not paint over that wait.
    location.hash = '#/doc/demo';
    const { ctx } = await harness(() => new Promise(() => {}), OPEN_PROJECT);
    render(<App ctx={ctx} />);
    await waitFor(() => expect(ctx.shell.sidebar()).toBe('explorer'));
    expect(ctx.shell.pending()).toBe('demo');
    expect(ctx.shell.active()).toBeUndefined();
    expect(ctx.shell.documents()).toEqual([]);
  });

  it('a sidebar the person chose before the workspace answered is left alone', async () => {
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    act(() => ctx.shell.showSidebar('explorer'));
    await waitFor(() => expect(ctx.workspace.state()).not.toBeNull());
    expect(ctx.shell.sidebar()).toBe('explorer');
  });

  it('the fresh-load default replaces the empty address, so Back has nowhere emptier to go', async () => {
    // Finding 1 of the final review: the default composition was PUSHED
    // over the empty address, and Back from it reached a page with three
    // tabs and no pane. A default is not a place a person navigated to.
    const before = history.length;
    const { ctx } = await harness(undefined, OPEN_PROJECT);
    render(<App ctx={ctx} />);
    await waitFor(() => expect(ctx.shell.active()?.key).toBe('composition'));
    expect(history.length).toBe(before);
  });

  it('a cold load on a file opens the editor with a clean panel', async () => {
    // Ruling 18: F5 on a file tab used to land on the composition with a
    // false "not registered". The shell now asks the opener `App`
    // registered, and the Explorer's chooser picks the editor.
    location.hash = '#/doc/f:game/script.spin';
    const { ctx } = await harness();
    render(<App ctx={ctx} />);
    expect(ctx.shell.active()?.key).toBe('f:game/script.spin');
    const pane = screen.getByTestId('doc-pane-f:game/script.spin');
    expect(await within(pane).findByTestId('editor')).toBeTruthy();
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('a sidebar view with no imports opens a file through ctx.shell.openPath', async () => {
    // Ruling 22's other half: a plugin's own view has only `ctx`, and
    // `ctx.shell.open()` demands a component it cannot build. `openPath`
    // is the one call that opens a file for it.
    const { ctx } = await harness();
    ctx.slots.register({ name: 'shell.sidebar', key: 'mine', title: 'Mine' }, ({ ctx: c }) => (
      <button type="button" onClick={() => c.shell.openPath('game/script.spin')}>
        open the math
      </button>
    ));
    render(<App ctx={ctx} />);
    act(() => ctx.shell.showSidebar('mine'));
    fireEvent.click(screen.getByRole('button', { name: 'open the math' }));
    expect(ctx.shell.active()?.key).toBe('f:game/script.spin');
    const pane = screen.getByTestId('doc-pane-f:game/script.spin');
    expect(await within(pane).findByTestId('editor')).toBeTruthy();
  });

  it('ctx.layout is gone from the real client', async () => {
    // Ruling 2: the assertion Task 1 could not make while `layout` and
    // `shell` overlapped.
    const { ctx } = await harness();
    expect((ctx as unknown as { layout?: unknown }).layout).toBeUndefined();
  });

  it('composition.card still works for anything else', async () => {
    // `App` itself registers no `composition.card` any more, but the slot
    // a THIRD PARTY registers still has to reach the composition document
    // — rendered through the real `<App/>`, the actual path a registration
    // takes: App → Shell → the composition document → `CompositionScreen`'s
    // own `EditorComposition`, the one thing here that reads it.
    const { ctx } = await harness(undefined, OPEN_PROJECT);
    ctx.slots.register({ name: 'composition.card', key: 'other' }, () => <div>CARD</div>);
    render(<App ctx={ctx} />);
    expect(await screen.findByText('CARD')).toBeTruthy();
  });

  it('the composition tab reads "Composition", matching the document it opens', async () => {
    // The one place in this suite that pins WORDING rather than structure:
    // the NAVIGATION reads in the same language as the document it opens,
    // and `CompositionScreen`'s own `<h1>` says `Composition`. Addressed by the
    // tab's accessible name, the one thing that carries the wording.
    const { ctx } = await harness(undefined, OPEN_PROJECT);
    render(<App ctx={ctx} />);
    expect(await screen.findByRole('tab', { name: 'Composition' })).toBeTruthy();
  });

  it('a cold load on a plugin’s tab opens it once its client half lands — no false diagnostic', async () => {
    // Fix round 1, item 4: F5 while on `#/doc/demo`. `ready()` runs before
    // `modules` has imported the plugin; the shell holds the key as
    // pending, says so in the body, and opens the tab when it registers.
    location.hash = '#/doc/demo';
    (globalThis as { __E8_IDE__?: unknown }).__E8_IDE__ = { React, useGameComposition };
    const { ctx, socket } = await harness(
      // @ts-expect-error — a plain ES module with no types, imported the way the browser imports it
      async () => import('../../../examples/first-slot/plugins/screen-demo/src/client.js'),
    );
    render(<App ctx={ctx} />);
    expect(ctx.shell.active()).toBeUndefined();
    expect(screen.getByTestId('doc-opening')).toHaveTextContent('demo');
    socket.push({ type: 'snapshot', snapshot: { rows: [demoRow()], diagnostics: [] } });
    await waitFor(() => expect(ctx.shell.active()?.key).toBe('demo'));
    expect(await screen.findByTestId('demo-screen')).toBeTruthy();
    expect(location.hash).toBe('#/doc/demo');
    expect(ctx.connection.diagnostics).toEqual([]);
  });

  it('a cold load on a key no plugin registers reports once, after the loader settles', async () => {
    location.hash = '#/doc/ghost';
    const { ctx, socket } = await harness();
    render(<App ctx={ctx} />);
    expect(ctx.connection.diagnostics).toEqual([]); // the loader has not spoken yet
    socket.push({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    await waitFor(() =>
      expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
        expect.stringContaining('ghost'),
      ]),
    );
    expect(ctx.shell.active()?.key).toBe('composition');
  });

  it('the demo plugin brings an activity button AND a document', async () => {
    // Through `modules`, the real loader: a fake snapshot names the
    // plugin's client half, and `importModule` hands back its real source.
    // The plugin reads React off the global `main.tsx` publishes; the
    // test publishes the same before the import runs.
    (globalThis as { __E8_IDE__?: unknown }).__E8_IDE__ = { React, useGameComposition };
    const { ctx, socket } = await harness(
      // @ts-expect-error — a plain ES module with no types, imported the way the browser imports it
      async () => import('../../../examples/first-slot/plugins/screen-demo/src/client.js'),
    );
    render(<App ctx={ctx} />);
    socket.push({ type: 'snapshot', snapshot: { rows: [demoRow()], diagnostics: [] } });
    await waitFor(() =>
      expect(ctx.slots.list('shell.activity').map((e) => e.key)).toContain('demo'),
    );
    expect(ctx.slots.list('shell.document').map((e) => e.key)).toContain('demo');
    expect(ctx.connection.diagnostics).toEqual([]);
    // And it is on screen without a reload — the button the shell drew for
    // a contribution that landed after mount.
    expect(await screen.findByTestId('activity-demo')).toBeTruthy();
  });
});
