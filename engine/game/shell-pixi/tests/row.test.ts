import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { Container } from 'pixi.js';
import type { SessionInit } from '@energy8engine/contracts';
import { SHELL_EVENTS } from '../src/relay';

/**
 * The shell package is mocked whole: `createPixiShell` would build the
 * real Pixi bar (fonts, a live `app.renderer`), none of which exists in
 * node. What this fake keeps is exactly what the row touches — the
 * emitter (`on`/`off`), `state`, the setters, `destroy` — plus a capture
 * of the config the row built, which is what the seam contract is about.
 */
const captured: {
  config?: Record<string, unknown>;
  shell?: FakeShell;
  /** What `PixiRenderer.mount` adds to `config.parent` — a real Container, so the teardown probe below is real too. */
  root?: Container;
  removed: number;
  fadeError?: unknown;
} = { removed: 0 };

interface FakeShell {
  on: (name: string, fn: (p: unknown) => void) => FakeShell;
  off: (name: string, fn: (p: unknown) => void) => FakeShell;
  emit: (name: string, p?: unknown) => void;
  listeners: () => number;
  state: { bet: number; turbo: number; busy: boolean; autoplay: { active: boolean; remaining: number } };
  actions: Record<string, () => void>;
  setBalance: ReturnType<typeof vi.fn>;
  setBusy: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function fakeShell(): FakeShell {
  const map = new Map<string, Set<(p: unknown) => void>>();
  const shell: FakeShell = {
    on(name, fn) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name)!.add(fn);
      return shell;
    },
    off(name, fn) {
      map.get(name)?.delete(fn);
      return shell;
    },
    emit: (name, p) => map.get(name)?.forEach((fn) => fn(p)),
    listeners: () => [...map.values()].reduce((n, s) => n + s.size, 0),
    state: { bet: 2, turbo: 1, busy: false, autoplay: { active: false, remaining: 0 } },
    actions: { spin: vi.fn() },
    setBalance: vi.fn(),
    setBusy: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
  return shell;
}

vi.mock('@energy8platform/shell/pixi', () => ({
  createPixiShell: vi.fn((config: Record<string, unknown>) => {
    captured.config = config;
    captured.shell = fakeShell();
    captured.root = new Container();
    (config.parent as Container).addChild(captured.root);
    return captured.shell;
  }),
  // The real one fades the root over 250 ms on the ticker and destroys it
  // at the end — i.e. AFTER the row has already destroyed the layer that
  // holds it. The tick's two touches, replayed here on the next macrotask.
  removePixiShell: vi.fn(async () => {
    captured.removed += 1;
    await captured.shell?.destroy();
    await new Promise((r) => setTimeout(r, 0));
    try {
      captured.root!.alpha = 0.5;
      captured.root!.destroy({ children: true });
    } catch (error) {
      captured.fadeError = error;
    }
  }),
}));

import * as shellPixi from '../src/index';

const INIT: SessionInit = {
  balance: 1000,
  currency: { code: 'USD', symbol: '$', decimals: 2, position: 'left' },
  betLevels: [1, 2, 5],
  defaultBet: 2,
  language: 'de',
};

/** A real pixi `Container` as the stage — `addChild`/`setChildIndex`/`removeChild` behave, and nothing in it needs a renderer. */
function fakeApp() {
  const stage = new Container();
  return { stage, setChildIndex: vi.spyOn(stage, 'setChildIndex') };
}

async function boot(opts: { events?: boolean; flow?: boolean; config?: Record<string, unknown> } = {}) {
  const ctx = new Context();
  const app = fakeApp();
  ctx.provide('renderer', { app: { stage: app.stage } });
  ctx.provide('session', { init: INIT, play: vi.fn() });
  const emit = vi.fn();
  if (opts.events !== false) ctx.provide('events', { emit, on: vi.fn() });
  const provideRoot = vi.fn((_name: string, _getter: () => unknown) => () => {});
  if (opts.flow !== false) ctx.provide('flow', { provideRoot });
  // Every case now falls into the empty-`gameInfo.sections` default, so the
  // row's own `GET /api/spec` runs unless a case supplies its own `fetchFn`
  // (the three paytable cases below) — without this, the 8 other cases hit
  // a REAL `fetch('/api/spec')`, rejected by undici and swallowed, making
  // them depend on undici's relative-URL behaviour rather than this row's.
  const fetchFn = async () => {
    throw new Error('no host in this test');
  };
  await ctx.plugin(shellPixi, { fetchFn, ...opts.config });
  return { ctx, app, emit, provideRoot };
}

beforeEach(() => {
  captured.config = undefined;
  captured.shell = undefined;
  captured.root = undefined;
  captured.removed = 0;
  captured.fadeError = undefined;
});

describe('shell-pixi — the Pixi shell as a row', () => {
  it('builds the shell from session.init plus the row config, on its own layer under app.stage', async () => {
    const { ctx, app } = await boot({ config: { language: '', features: { turbo: 2 } } });

    expect(captured.config).toMatchObject({
      availableBets: [1, 2, 5],
      defaultBet: 2,
      currentBet: 2,
      balance: 1000,
      win: 0,
      mode: 'base',
      currency: { symbol: '$', position: 'left', maxDecimals: 2 },
      language: 'de',
      features: { turbo: 2, autoplay: {}, buyBonus: false },
      gameInfo: { sections: [] },
    });
    // `app` is the renderer's; `parent` is a layer the ROW owns, already on the stage.
    expect(captured.config!.app).toBe(ctx.get('renderer')!.app);
    const layer = captured.config!.parent as Container;
    expect(layer).toBeInstanceOf(Container);
    expect(layer.label).toBe('shell');
    expect(layer.parent).toBe(app.stage);

    await ctx.fiber.dispose();
  });

  it('a blank YAML `theme:` (null after validation) reaches createPixiShell as undefined, and the row mounts', async () => {
    const { ctx, app } = await boot({ config: { theme: null, menu: null } });
    expect(captured.config).toBeDefined();
    expect(captured.config!.theme).toBeUndefined();
    expect(captured.config!.menu).toBeUndefined();
    expect(app.stage.children.at(-1)).toBe(captured.config!.parent);
    await ctx.fiber.dispose();
  });

  it('a createPixiShell that throws fails the row and leaves no layer on the stage', async () => {
    const { createPixiShell } = await import('@energy8platform/shell/pixi');
    vi.mocked(createPixiShell).mockImplementationOnce(() => {
      throw new Error('no shell for you');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ctx = new Context();
      const app = fakeApp();
      ctx.provide('renderer', { app: { stage: app.stage } });
      ctx.provide('session', { init: INIT, play: vi.fn() });
      // Cordis logs a throwing `apply` and marks the fiber failed; whether
      // the returned PromiseLike rejects is its business, not this test's.
      try {
        await ctx.plugin(shellPixi, {});
      } catch {
        /* a rejection is one acceptable answer */
      }
      await new Promise((r) => setTimeout(r, 0));

      expect(app.stage.children).toEqual([]);
      expect(ctx.get('shell')).toBeUndefined();
      await ctx.fiber.dispose();
    } finally {
      error.mockRestore();
    }
  });

  it('provides `shell` — the very handle createPixiShell returned', async () => {
    const { ctx } = await boot();
    expect(ctx.get('shell')).toBe(captured.shell);
    await ctx.fiber.dispose();
  });

  it('re-emits every ShellEvents entry on the flow bus as shell.<name> with an object payload', async () => {
    const { ctx, emit } = await boot();
    const shell = captured.shell!;
    expect(shell.listeners()).toBe(SHELL_EVENTS.length);

    shell.emit('spin');
    shell.emit('betChange', 2);
    shell.emit('turboChange', 3);
    shell.emit('autoplayStart', { active: true, remaining: 10 });
    shell.emit('autoplayStop');
    shell.emit('buyBonusSelect', { id: 'b1' });
    shell.emit('featureActivate', { id: 'ante' });
    shell.emit('featureDeactivate', { id: 'ante' });
    shell.emit('menuOpen');
    shell.emit('settingsOpen');
    shell.emit('infoOpen');
    shell.emit('settingChange', { key: 'music', value: 0.5 });

    expect(emit.mock.calls).toEqual([
      ['shell.spin', {}],
      ['shell.betChange', { value: 2 }],
      ['shell.turboChange', { value: 3 }],
      ['shell.autoplayStart', { active: true, remaining: 10 }],
      ['shell.autoplayStop', {}],
      ['shell.buyBonusSelect', { id: 'b1' }],
      ['shell.featureActivate', { id: 'ante' }],
      ['shell.featureDeactivate', { id: 'ante' }],
      ['shell.menuOpen', {}],
      ['shell.settingsOpen', {}],
      ['shell.infoOpen', {}],
      ['shell.settingChange', { key: 'music', value: 0.5 }],
    ]);

    await ctx.fiber.dispose();
  });

  it('an event before the flow row exists is dropped, not thrown; a bus provided later gets the next one', async () => {
    const { ctx } = await boot({ events: false });
    const shell = captured.shell!;
    expect(() => shell.emit('spin')).not.toThrow();

    // Read per emit, so a bus that arrives after the shell still hears it.
    const emit = vi.fn();
    ctx.provide('events', { emit, on: vi.fn() });
    shell.emit('betChange', 5);
    expect(emit).toHaveBeenCalledWith('shell.betChange', { value: 5 });

    await ctx.fiber.dispose();
  });

  it('registers the live root `shell` with the flow — its getter reads the CURRENT state', async () => {
    const { ctx, provideRoot } = await boot();
    await new Promise((r) => setTimeout(r, 0));

    expect(provideRoot).toHaveBeenCalledWith('shell', expect.any(Function));
    const getter = provideRoot.mock.calls[0][1];
    expect(getter()).toBe(captured.shell!.state);
    captured.shell!.state.bet = 5;
    expect((getter() as { bet: number }).bet).toBe(5);

    await ctx.fiber.dispose();
  });

  it('registers the root when the flow row applies AFTER the shell, too', async () => {
    const { ctx } = await boot({ flow: false });
    const provideRoot = vi.fn((_name: string, _getter: () => unknown) => () => {});
    ctx.provide('flow', { provideRoot });
    await new Promise((r) => setTimeout(r, 0));

    expect(provideRoot).toHaveBeenCalledWith('shell', expect.any(Function));
    await ctx.fiber.dispose();
  });

  it('raises its layer to the top of the stage after apply, and again when scenes is provided later', async () => {
    const ctx = new Context();
    const app = fakeApp();
    // Something already on the stage before the shell — the layer must end up above it.
    app.stage.addChild(new Container());
    ctx.provide('renderer', { app: { stage: app.stage } });
    ctx.provide('session', { init: INIT, play: vi.fn() });
    await ctx.plugin(shellPixi, {});
    const layer = captured.config!.parent as Container;
    expect(app.stage.children.at(-1)).toBe(layer);

    // A (re-)applied `scenes1` appends its own container above the shell...
    app.stage.addChild(new Container());
    expect(app.stage.children.at(-1)).not.toBe(layer);
    // ...and providing `scenes` is what puts the shell back on top.
    ctx.provide('scenes', {});
    await new Promise((r) => setTimeout(r, 0));
    expect(app.stage.children.at(-1)).toBe(layer);
    expect(app.setChildIndex).toHaveBeenCalledWith(layer, app.stage.children.length - 1);

    await ctx.fiber.dispose();
  });

  it('disposing the row removes the shell, unsubscribes the relay and destroys the layer', async () => {
    const { ctx, app } = await boot();
    const shell = captured.shell!;
    const layer = captured.config!.parent as Container;
    expect(app.stage.children).toContain(layer);

    await ctx.fiber.dispose();

    expect(captured.removed).toBe(1);
    expect(shell.destroy).toHaveBeenCalledTimes(1);
    expect(shell.listeners()).toBe(0);
    expect(layer.destroyed).toBe(true);
    expect(app.stage.children).not.toContain(layer);
    expect(ctx.get('shell')).toBeUndefined();

    // The shell's own fade lands on a root the layer's destroy already took
    // with it — and lands harmlessly (pixi 8.20: `alpha` on a destroyed
    // container is a plain write, a second `destroy` is a no-op).
    expect(captured.root!.destroyed).toBe(true);
    await new Promise((r) => setTimeout(r, 1));
    expect(captured.fadeError).toBeUndefined();
  });
});

describe('shell-pixi — a paytable derived from /api/spec when none is authored', () => {
  const SPEC = {
    symbols: [
      { id: 'ROCK', name: 'Rock', pay: { '30': 1.2, '8': 0.15, '9': 0.25 } },
      { id: 'WILD', name: 'Wild' },
      { id: 'NUT', pay: { '8': 0.05 } },
    ],
  };

  it('an empty gameInfo.sections fetches /api/spec and hands the shell a paytable section', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe('/api/spec');
      return { ok: true, json: async () => ({ spec: SPEC }) };
    }) as unknown as typeof fetch;
    const { ctx } = await boot({ config: { gameInfo: { sections: [] }, fetchFn } });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const sections = (captured.config!.gameInfo as { sections: { type: string }[] }).sections;
    expect(sections[0].type).toBe('paytable');

    await ctx.fiber.dispose();
  });

  it('authored sections are left untouched — no fetch at all', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const { ctx } = await boot({
      config: { gameInfo: { sections: [{ type: 'custom', title: 'Rules' }] }, fetchFn },
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(captured.config!.gameInfo).toEqual({ sections: [{ type: 'custom', title: 'Rules' }] });

    await ctx.fiber.dispose();
  });

  it('a fetchFn that rejects leaves sections empty — the row still mounts, no throw', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const { ctx } = await boot({ config: { gameInfo: { sections: [] }, fetchFn } });

    expect((captured.config!.gameInfo as { sections: unknown[] }).sections).toEqual([]);

    await ctx.fiber.dispose();
  });
});
