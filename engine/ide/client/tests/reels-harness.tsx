import { act, render, screen } from '@testing-library/react';
import { Context } from 'cordis';
import Schema from 'schemastery';
import { afterEach, vi } from 'vitest';
import type { GameCompositionRow, SymbolsDoc } from '@energy8engine/contracts';
import * as slots from '../src/plugins/slots';
import * as shell from '../src/plugins/shell';
import * as reels from '../src/plugins/reels';

/**
 * The one reels test harness, shared by `reels-document.test.tsx` and
 * `reels-settings.test.tsx` — `flow-harness.tsx`'s shape, trimmed to what
 * `reels.tsx`, `ReelsDocument` and `ReelsSettings` actually read: `slots`
 * and `shell` for real (the plugin registers into both, and a
 * `shell.sideRight` presence test needs the real `setSideRight`/
 * `sideRight()` pair), and bare `gameComposition`/`workspace`/`symbols`
 * stubs — no socket, no fetch, nothing else either ever touches.
 * `reels.tsx` only injects `gameComposition`/`slots`/`shell`; `ReelsDocument`
 * also reads `workspace`, and `ReelsSettings` reads `symbols`
 * (`useWorkspace`/`useSymbols`, same as `SymbolsDocument`), so those stubs
 * ride along even though the plugin itself never declares either.
 */
const json = (schema: Schema) => JSON.parse(JSON.stringify(schema.toJSON()));

/** The chips override's and the board painter's `known` — a small, fixed
 * set unless a test overrides it via `harness`'s `opts.known`. */
export const KNOWN_SYMBOLS = [
  { id: 'scatter', name: 'Scatter' },
  { id: 'wild', name: 'Wild' },
];

const REELS_SCHEMA = json(
  Schema.object({
    grid: Schema.object({
      cols: Schema.number().default(5),
      rows: Schema.number().default(3),
      rowsPerReel: Schema.array(Schema.number()),
    }),
    win: Schema.object({
      glow: Schema.boolean().default(true),
      frameShake: Schema.object({
        enabled: Schema.boolean().default(false),
        onlyOnSymbols: Schema.union([Schema.const(null), Schema.array(Schema.string())]).default(
          null,
        ),
      }),
    }),
    board: Schema.any(),
  }),
);
const MOTION_SCHEMA = json(Schema.object({ style: Schema.string().default('swap') }));
const ANTICIPATION_SCHEMA = json(
  Schema.object({
    enabled: Schema.boolean().default(false),
    triggerSymbols: Schema.array(Schema.string()).default(['scatter']),
    threshold: Schema.natural().default(2),
  }),
);
const CASCADE_SCHEMA = json(Schema.object({ gravity: Schema.boolean().default(true) }));
const FEATURES_SCHEMA = json(
  Schema.object({ walkWild: Schema.object({ enabled: Schema.boolean().default(false) }) }),
);

const SCHEMAS: Record<string, unknown> = {
  reels1: REELS_SCHEMA,
  motion1: MOTION_SCHEMA,
  anticipation1: ANTICIPATION_SCHEMA,
  cascade1: CASCADE_SCHEMA,
  features1: FEATURES_SCHEMA,
};

export function row(id: string, config: Record<string, unknown> = {}): GameCompositionRow {
  return {
    id,
    name: id,
    config,
    from: 'bundle:test',
    runtimeUrl: null,
    schema: SCHEMAS[id] ?? null,
    hot: true,
  };
}

export const PREVIEW_URL = 'http://127.0.0.1:5682';

const built: Context[] = [];
afterEach(async () => {
  for (const ctx of built.splice(0)) await ctx.fiber.dispose();
});

export async function harness(
  rows: GameCompositionRow[] | null,
  opts: {
    update?: (
      id: string,
      config: Record<string, unknown>,
    ) => Promise<{ reload: boolean; diagnostics: unknown[] }>;
    known?: { id: string; name: string }[];
    symbolsDoc?: SymbolsDoc | null;
    previewUrl?: string | null;
  } = {},
) {
  const ctx = new Context();
  built.push(ctx);
  await ctx.plugin(slots);
  await ctx.plugin(shell);
  let workspace = {
    projects: [],
    templates: [],
    active: 'first',
    previewUrl: opts.previewUrl === undefined ? PREVIEW_URL : opts.previewUrl,
    diagnostics: [],
  };
  const workspaceListeners = new Set<() => void>();
  ctx.provide('workspace', {
    state: () => workspace,
    subscribe: (fn: () => void) => {
      workspaceListeners.add(fn);
      return () => workspaceListeners.delete(fn);
    },
    open: async () => [],
    create: async () => [],
  });
  // Bare `useSymbols` shape, same reason `workspace` is stubbed rather than
  // booting the real plugin (see this file's own top comment): the chips
  // override and the board painter both read `ctx.symbols.known()`/`.doc()`
  // through it, and neither `reels.tsx` nor `ReelsSettings` need the rest
  // of the real service (sockets, PUTs, selection).
  ctx.provide('symbols', {
    doc: () => opts.symbolsDoc ?? null,
    known: () => opts.known ?? KNOWN_SYMBOLS,
    diagnostics: () => [],
    selected: () => null,
    select: () => {},
    update: async () => [],
    subscribe: () => () => {},
  });
  const listeners = new Set<() => void>();
  const updateCalls: { id: string; config: Record<string, unknown> }[] = [];
  const service = {
    rows,
    diagnostics: [] as unknown[],
    reloads: 0,
    transitions: [] as string[],
    status: null,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async update(id: string, config: Record<string, unknown>) {
      updateCalls.push({ id, config });
      const answer = opts.update
        ? await opts.update(id, config)
        : { reload: false, diagnostics: [] };
      // Same shape the real service applies on success: the row's config
      // replaced in `rows`, so a later render sees what was just written.
      if (answer.diagnostics.length === 0 && service.rows) {
        service.rows = service.rows.map((r) => (r.id === id ? { ...r, config } : r));
      }
      for (const fn of listeners) fn();
      return answer;
    },
  };
  ctx.provide('gameComposition', service as never);
  await ctx.plugin(reels);
  // `act()`: a service mutation notifies a mounted component's
  // subscription synchronously, outside any testing-library event helper.
  const setRows = (next: GameCompositionRow[] | null) => {
    act(() => {
      service.rows = next;
      for (const fn of listeners) fn();
    });
  };
  /** Same shape a host `reload: true` verdict leaves: `reloads` up one,
   * remounting the canvas (`canvasKey` includes it) — the one way this
   * fake drives an actual canvas remount. */
  const bumpReloads = () => {
    act(() => {
      service.reloads += 1;
      for (const fn of listeners) fn();
    });
  };
  /** A new preview address (a project opening, say) — a new `workspace` snapshot, as the real service answers. */
  const setPreviewUrl = (previewUrl: string | null) => {
    act(() => {
      workspace = { ...workspace, previewUrl };
      for (const fn of workspaceListeners) fn();
    });
  };
  return { ctx, updateCalls, setRows, bumpReloads, setPreviewUrl };
}

export function renderDocument(ctx: Context) {
  const entry = ctx.slots.list('shell.document').find((e) => e.key === 'reels');
  if (!entry) throw new Error('reels did not register a shell.document entry');
  return render(<entry.component ctx={ctx} />);
}

export function renderSettings(ctx: Context) {
  const entry = ctx.slots.list('shell.sideRight').find((e) => e.key === 'reels');
  if (!entry) throw new Error('reels did not register a shell.sideRight entry');
  return render(<entry.component ctx={ctx} />);
}

/**
 * The canvas iframe, `symbols-harness.tsx`'s `canvas()` trick: stub
 * `contentWindow.postMessage` so a request can be read back, and answer
 * whatever the test configures (`{ ok: true }` by default — every lab
 * action's happy path) through the same `e8:ide:res` wire frame the real
 * canvas would send. `ready()` fires the `e8:ide:evt` frame the document's
 * `rpc.on('ready', …)` listens for.
 */
export function canvas() {
  const iframe = screen.getByTitle('reels canvas') as HTMLIFrameElement;
  const win = iframe.contentWindow as Window & { postMessage: ReturnType<typeof vi.fn> };
  const answers = new Map<string, unknown>();
  const respond = (id: number, result: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'e8:ide:res', id, ok: true, result },
        origin: PREVIEW_URL,
        source: iframe.contentWindow,
      }),
    );
  win.postMessage = vi.fn((data: unknown) => {
    const req = data as { type?: string; id?: number; method?: string };
    if (req.type !== 'e8:ide:req' || typeof req.id !== 'number') return;
    respond(req.id, answers.get(req.method!) ?? { ok: true });
  });
  const posted = () => win.postMessage.mock.calls.map((c) => c[0]);
  const reqs = (method: string) =>
    posted()
      .filter((m) => m.type === 'e8:ide:req' && m.method === method)
      .map((m) => m.params);
  // `act()`: both events can land a synchronous `setStatus` now
  // (`useCanvasSilence`'s `ready` handler, the `error` handler) — outside
  // any testing-library event helper.
  const evt = (event: string, payload: unknown) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'e8:ide:evt', event, payload },
          origin: PREVIEW_URL,
          source: iframe.contentWindow,
        }),
      );
    });
  const ready = () => evt('ready', { reels: true });
  const error = (payload: unknown) => evt('error', payload);
  return {
    iframe,
    posted,
    reqs,
    ready,
    error,
    setAnswer: (m: string, result: unknown) => answers.set(m, result),
  };
}
