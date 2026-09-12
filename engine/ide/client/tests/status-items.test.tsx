import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic, type ServerMessage } from '@energy8engine/contracts';
import * as slotsPlugin from '../src/plugins/slots';
import * as shellPlugin from '../src/plugins/shell';
import * as gameDiagnosticsPlugin from '../src/plugins/diagnostics';
import * as gameCompositionPlugin from '../src/plugins/game-composition';
import { ProjectStatus, SessionStatus, DirtyStatus, ThemeStatus } from '../src/shell/StatusItems';

/** These tests only care about `.message`/`.code` — severity/plugin/where are fixed filler. */
function d(message: string, extra?: Partial<Diagnostic>): Diagnostic {
  return { ...diagnostic('error', 'session', 'runtime', message), ...extra };
}

/**
 * `DirtyStatus` is the only one of the four that reads `ctx.shell` — same
 * hand-built `Context` shape `shell.test.tsx`'s own `harness()` uses, and
 * for the same reason (cordis defers `ctx.plugin()`'s own `apply()`, so a
 * synchronous harness has to call the plugins' `apply()` directly). No
 * `ctx.connection` mock: `shell`'s own `report()` reads it leniently
 * through `ctx.reflect.get`, and nothing under test here ever calls
 * `report()` at all.
 */
function shellHarness(): Context {
  const disposers: (() => void)[] = [];
  const ctx: Record<string, unknown> = {
    reflect: { get: (name: string) => ctx[name] },
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
  slotsPlugin.apply(ctx as unknown as Context);
  shellPlugin.apply(ctx as unknown as Context);
  return ctx as unknown as Context;
}

/** The slice of WebSocket this store needs, plus `receive()` — identical shape to `diagnostics.test.ts`'s own `FakeSocket`. */
class FakeSocket {
  private listeners: ((event: { data: string }) => void)[] = [];
  readyState = 1;
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    if (type === 'message') this.listeners.push(listener);
  }
  send() {}
  close() {}
  receive(message: ServerMessage) {
    for (const listener of this.listeners) listener({ data: JSON.stringify(message) });
  }
}

/**
 * `SessionStatus` reads `ctx.gameDiagnostics`, fed over the `/ide` socket
 * — not a method the service has (there is no `push`; frames arrive
 * exactly the way `diagnostics.test.ts`'s own suite delivers them, through
 * this same `FakeSocket`).
 */
function gameDiagnosticsHarness(): Context & { socket: FakeSocket } {
  const socket = new FakeSocket();
  const result = { socket } as unknown as Context & { socket: FakeSocket };
  const fakeCtx = {
    effect: (execute: () => unknown) => execute(),
    provide: (key: string, value: unknown) => {
      (result as unknown as Record<string, unknown>)[key] = value;
    },
  } as unknown as Context;
  gameDiagnosticsPlugin.apply(fakeCtx, { url: 'ws://x/ide', socketFactory: () => socket });
  return result;
}

/** `ProjectStatus` reads `ctx.gameComposition`, whose `apply()` kicks off `fetchFn` immediately and provides synchronously before it settles — see that plugin's own module doc. */
function gameCompositionHarness(fetchFn: typeof fetch): Context {
  const result = {} as unknown as Context;
  const fakeCtx = {
    provide: (key: string, value: unknown) => {
      (result as unknown as Record<string, unknown>)[key] = value;
    },
  } as unknown as Context;
  gameCompositionPlugin.apply(fakeCtx, { fetchFn });
  return result;
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // not expected under jsdom, but this suite touches the same storage
    // ThemeStatus does — leave it as lenient as the code under test.
  }
  delete document.documentElement.dataset.theme;
});

describe('ProjectStatus', () => {
  it('says so while the composition fetch is still in flight', () => {
    const ctx = gameCompositionHarness(() => new Promise<Response>(() => {}));
    const { container } = render(<ProjectStatus ctx={ctx} />);
    expect(container).toHaveTextContent('loading');
  });

  it("shows the first composition row's id — the closest thing /api/composition actually carries to a project name", async () => {
    const ctx = gameCompositionHarness(() =>
      jsonResponse({ rows: [{ id: 'bridge1', name: '@energy8engine/ide-bridge' }], diagnostics: [] }),
    );
    const { container } = render(<ProjectStatus ctx={ctx} />);
    await waitFor(() => expect(container).toHaveTextContent('bridge1'));
  });

  it('says "no project" for a composition that resolved with zero rows, rather than showing nothing', async () => {
    const ctx = gameCompositionHarness(() => jsonResponse({ rows: [], diagnostics: [] }));
    const { container } = render(<ProjectStatus ctx={ctx} />);
    await waitFor(() => expect(container).toHaveTextContent(/no project/i));
  });
});

describe('SessionStatus', () => {
  it('reads as up once any frame has arrived and none of it is a restart', () => {
    const ctx = gameDiagnosticsHarness();
    const { container } = render(<SessionStatus ctx={ctx} />);
    act(() => ctx.socket.receive({ type: 'game-diagnostics', diagnostics: [], dropped: 0, source: 'host' }));
    expect(container).not.toHaveTextContent(/restart/i);
    expect(container).toHaveTextContent('●');
  });

  it('follows the live session state, not a boot-time snapshot', () => {
    // Slice 6 made `pid` a getter for exactly this: a status item that
    // read it once would show a dead process as alive after a restart.
    // The status is fed by the game-diagnostics channel: a `restarting`
    // code shows one state, an empty list after it another.
    const ctx = gameDiagnosticsHarness();
    const { container } = render(<SessionStatus ctx={ctx} />);
    act(() =>
      ctx.socket.receive({
        type: 'game-diagnostics',
        diagnostics: [d('the math engine is restarting', { code: 'restarting' })],
        dropped: 0,
        source: 'host',
      }),
    );
    expect(container).toHaveTextContent(/restart/i);
    act(() => ctx.socket.receive({ type: 'game-diagnostics', diagnostics: [], dropped: 0, source: 'host' }));
    expect(container).not.toHaveTextContent(/restart/i);
  });
});

describe('DirtyStatus', () => {
  it('counts zero with nothing open', () => {
    const { container } = render(<DirtyStatus ctx={shellHarness()} />);
    expect(container).toHaveTextContent('0 unsaved');
  });

  it('counts only the documents actually marked dirty, not every open one', () => {
    const ctx = shellHarness();
    ctx.shell.open({ key: 'a', title: 'A', component: () => null, closable: true });
    ctx.shell.open({ key: 'b', title: 'B', component: () => null, closable: true });
    ctx.shell.markDirty('a', true);
    const { container } = render(<DirtyStatus ctx={ctx} />);
    expect(container).toHaveTextContent('1 unsaved');
  });
});

describe('ThemeStatus', () => {
  it('defaults to dark when nothing was ever stored', () => {
    render(<ThemeStatus ctx={{} as Context} />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'toggle theme' })).toBeTruthy();
  });

  it('the theme toggle flips data-theme and survives a reload via localStorage', async () => {
    render(<ThemeStatus ctx={{} as Context} />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('e8.theme')).toBe('light');
    cleanup();
    render(<ThemeStatus ctx={{} as Context} />); // "reload"
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
