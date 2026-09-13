import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CompositionRow, ServerMessage, WorkspaceState } from '@energy8engine/contracts';
import { Preview, PreviewWall, createIdeClient } from '../src/index';

/**
 * Falling tests for Task 12, step 1: the preview panel draws an iframe at
 * `dev-game`'s address; a snapshot with a changed setting must reach the
 * running game without a reload of the IDE page; a row that declared
 * `hot: false` must cause an honest RELOAD of the iframe rather than a
 * silent no-op (the host tears the plugin down and re-applies it — nothing
 * guarantees an already-running game picked that up on its own).
 *
 * `hot: true` here stands in for `@energy8engine/ide-bridge` (declared
 * `hot: true` in its own package.json) — genuinely hot means it pushes its
 * own update straight into the running game over the SAME `/ide` websocket
 * this screen uses (see ide-bridge's module doc), so `Preview` itself has
 * nothing to do for that case. This suite fabricates rows directly rather
 * than depending on a second real plugin package — `Preview`'s reload
 * logic reacts to `CompositionRow.hot`/`config` generically, independent of
 * which plugin produced them.
 */

const PREVIEW_URL = 'http://game.test:5679';

/** What the host sends when nothing is open — see `WorkspaceState.previewUrl`. */
const NO_PROJECT: WorkspaceState = {
  projects: [{ id: 'a', name: 'Game A' }],
  active: null,
  previewUrl: null,
  diagnostics: [],
};

function workspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    projects: [{ id: 'a', name: 'Game A' }],
    active: 'a',
    previewUrl: PREVIEW_URL,
    diagnostics: [],
    ...overrides,
  };
}

/**
 * One fake socket shared by every plugin `createIdeClient` composes
 * (`connection`, `workspace`, `game-diagnostics` each open their own; the
 * factory hands them the same one), so `push` reaches all of them. The
 * boot fetches never answer — every workspace state below arrives as a
 * frame, which lands synchronously. `initial` is the first one pushed
 * before returning: a project open on `PREVIEW_URL` by default; `null`
 * pushes nothing, so the workspace has not answered at all yet.
 */
async function harness(initial: WorkspaceState | null = workspace()) {
  const listeners: ((event: { data: string }) => void)[] = [];
  const socket = {
    readyState: 1,
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send() {},
    close() {},
  };
  const ctx = await createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    fetchFn: () => new Promise<Response>(() => {}),
  });
  const push = (message: ServerMessage) => {
    act(() => {
      for (const listener of listeners) listener({ data: JSON.stringify(message) });
    });
  };
  if (initial) push({ type: 'workspace', workspace: initial });
  return { ctx, push };
}

function row(overrides: Partial<CompositionRow>): CompositionRow {
  return {
    id: 'a:x',
    name: 'x',
    disabled: false,
    state: 2,
    config: {},
    schema: null,
    hot: true,
    clientUrl: null,
    clientInject: [],
    ...overrides,
  };
}

describe('Preview', () => {
  it('renders an iframe pointed where the host says the game is served', async () => {
    const { ctx } = await harness();
    render(<Preview ctx={ctx} />);
    const iframe = screen.getByTitle('превью игры') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.src).toBe(`${PREVIEW_URL}/`);
  });

  it('with no project open there is no iframe, only the note', async () => {
    const { ctx } = await harness(NO_PROJECT);
    render(<Preview ctx={ctx} />);
    expect(screen.queryByTitle('превью игры')).toBeNull();
    expect(screen.getByTestId('preview-unavailable')).toHaveTextContent(/no project open/);
  });

  it('before the workspace has answered at all there is no iframe either — it is loading, not unavailable', async () => {
    const { ctx } = await harness(null);
    render(<Preview ctx={ctx} />);
    expect(screen.queryByTitle('превью игры')).toBeNull();
    expect(screen.getByTestId('preview-loading')).toHaveTextContent('loading…');
    expect(screen.queryByTestId('preview-unavailable')).toBeNull();
  });

  it('a workspace change to a different previewUrl remounts the iframe — a real navigation', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('превью игры');
    push({
      type: 'workspace',
      workspace: workspace({ active: 'b', previewUrl: 'http://other.test:5679' }),
    });
    const after = screen.getByTitle('превью игры') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.src).toBe('http://other.test:5679/');
  });

  it('a different active project on the SAME previewUrl remounts the iframe — same port, different game', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('превью игры');
    push({ type: 'workspace', workspace: workspace({ active: 'b' }) });
    const after = screen.getByTitle('превью игры') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.src).toBe(`${PREVIEW_URL}/`);
  });

  it('a workspace change that keeps the same previewUrl does not reload', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('превью игры');
    push({ type: 'workspace', workspace: workspace({ diagnostics: [] }) });
    expect(screen.getByTitle('превью игры')).toBe(before);
  });

  it('the first snapshot after connecting establishes a baseline, not a reload', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('превью игры');

    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:bridge', hot: false, config: { base_game: 'classic' } })],
        diagnostics: [],
      },
    });

    expect(screen.getByTitle('превью игры')).toBe(before);
  });

  it('does NOT reload the iframe when only a hot row config changes', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);

    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:bridge', hot: true, config: { base_game: 'classic' } })],
        diagnostics: [],
      },
    });
    const before = screen.getByTitle('превью игры');

    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:bridge', hot: true, config: { base_game: 'cascade' } })],
        diagnostics: [],
      },
    });

    expect(screen.getByTitle('превью игры')).toBe(before);
  });

  it('DOES reload the iframe — an honest navigation, not a silent no-op — when a hot:false row config changes', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);

    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:res', hot: false, config: { resolution: '720p' } })],
        diagnostics: [],
      },
    });
    const before = screen.getByTitle('превью игры');

    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:res', hot: false, config: { resolution: '1080p' } })],
        diagnostics: [],
      },
    });

    expect(screen.getByTitle('превью игры')).not.toBe(before);
  });

  it('does not reload again on a snapshot that repeats the same non-hot config', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);

    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:res', hot: false, config: { resolution: '720p' } })],
        diagnostics: [],
      },
    });
    const first = screen.getByTitle('превью игры');
    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:res', hot: false, config: { resolution: '1080p' } })],
        diagnostics: [],
      },
    });
    const second = screen.getByTitle('превью игры');
    expect(second).not.toBe(first);

    // Same non-hot config repeated verbatim — nothing changed, no reload.
    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:res', hot: false, config: { resolution: '1080p' } })],
        diagnostics: [],
      },
    });
    expect(screen.getByTitle('превью игры')).toBe(second);
  });
});

/**
 * Falling tests for Task 6: the wall §5 of the design spec asks for —
 * device presets, orientations and languages open at once, not the single
 * zoomed frame `Preview` (above) already covered under Task 3.
 *
 * Every `it` below calls `await harness()` where the plan's own brief
 * writes the synchronous `harness()` — this file's `harness()` goes through
 * the real `createIdeClient`, which is async (see `context.ts`'s own doc:
 * cordis defers a plugin's `apply()` to the microtask after `ctx.plugin()`
 * returns, so `ctx.connection` would not exist yet without the await). The
 * plan's pseudocode elides that; the assertions themselves are unchanged.
 */
describe('PreviewWall', () => {
  it('draws one frame per chosen preset, at that preset’s size', async () => {
    const { ctx } = await harness();
    render(<PreviewWall ctx={ctx} />);
    const tiles = screen.getAllByTestId(/^tile-/);
    expect(tiles.length).toBeGreaterThan(1); // a wall, not one frame
    expect(tiles[0].getAttribute('width')).toBe('1200');
  });

  it('starts with a few tiles, not all seven', async () => {
    // Every tile is a whole game booting Pixi and opening a socket. The
    // wall is worth having because you can see several at once, not
    // because it opens every size anyone ever defined.
    const { ctx } = await harness();
    render(<PreviewWall ctx={ctx} />);
    expect(screen.getAllByTestId(/^tile-/).length).toBeLessThanOrEqual(3);
  });

  it('turning a preset on adds its tile, turning it off removes it', async () => {
    const { ctx } = await harness();
    render(<PreviewWall ctx={ctx} />);
    const before = screen.getAllByTestId(/^tile-/).length;
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mobile S' }));
    expect(screen.getAllByTestId(/^tile-/)).toHaveLength(before + 1);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mobile S' }));
    expect(screen.getAllByTestId(/^tile-/)).toHaveLength(before);
  });

  it('each tile carries its own game identity, so the panel can tell them apart', async () => {
    const { ctx } = await harness();
    render(<PreviewWall ctx={ctx} />);
    const urls = screen.getAllByTestId(/^tile-/).map((t) => t.getAttribute('src'));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('every tile is addressed where the host says the game is served', async () => {
    const { ctx } = await harness();
    render(<PreviewWall ctx={ctx} />);
    for (const tile of screen.getAllByTestId(/^tile-/)) {
      expect(new URL(tile.getAttribute('src')!).origin).toBe(new URL(PREVIEW_URL).origin);
    }
  });

  it('a different active project on the SAME previewUrl gives every tile a new frame', async () => {
    const { ctx, push } = await harness();
    render(<PreviewWall ctx={ctx} />);
    const before = screen.getAllByTestId(/^tile-/);
    push({ type: 'workspace', workspace: workspace({ active: 'b' }) });
    const after = screen.getAllByTestId(/^tile-/);
    expect(after).toHaveLength(before.length);
    for (const tile of after) expect(before).not.toContain(tile);
  });

  it('with no project open the wall draws no tiles, only the note', async () => {
    const { ctx } = await harness(NO_PROJECT);
    render(<PreviewWall ctx={ctx} />);
    expect(screen.queryAllByTestId(/^tile-/)).toHaveLength(0);
    expect(screen.getByTestId('preview-unavailable')).toHaveTextContent(/no project open/);
  });

  it('before the workspace has answered the wall is loading, not unavailable', async () => {
    const { ctx } = await harness(null);
    render(<PreviewWall ctx={ctx} />);
    expect(screen.queryAllByTestId(/^tile-/)).toHaveLength(0);
    expect(screen.getByTestId('preview-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-unavailable')).toBeNull();
  });

  it('a project opening after the wall did brings the tiles', async () => {
    const { ctx, push } = await harness(NO_PROJECT);
    render(<PreviewWall ctx={ctx} />);
    push({ type: 'workspace', workspace: workspace() });
    expect(screen.queryByTestId('preview-unavailable')).toBeNull();
    expect(screen.getAllByTestId(/^tile-/).length).toBeGreaterThan(1);
  });

  it('rotating a tile swaps its width and height', async () => {
    const { ctx } = await harness();
    render(<PreviewWall ctx={ctx} />);
    const tile = screen.getAllByTestId(/^tile-/)[0];
    const [w, h] = [tile.getAttribute('width'), tile.getAttribute('height')];
    await userEvent.click(screen.getByRole('button', { name: /rotate/i }));
    const rotated = screen.getAllByTestId(/^tile-/)[0];
    expect([rotated.getAttribute('width'), rotated.getAttribute('height')]).toEqual([h, w]);
  });

  it('a language choice reaches the tile’s address', async () => {
    const { ctx } = await harness();
    render(<PreviewWall ctx={ctx} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /lang/i }), 'de');
    for (const tile of screen.getAllByTestId(/^tile-/)) {
      expect(new URL(tile.getAttribute('src')!, 'http://x').searchParams.get('lang')).toBe('de');
    }
  });

  it('the wall survives a preset the harness does not know', async () => {
    // Failures are data: an unknown preset name is a diagnostic and a
    // skipped tile, not a crashed screen.
    const { ctx } = await harness();
    render(<PreviewWall ctx={ctx} chosen={['Desktop', 'Hologram']} />);
    expect(screen.getAllByTestId(/^tile-/)).toHaveLength(1);
    expect(ctx.connection.diagnostics.map((x) => x.message)).toEqual([
      expect.stringContaining('Hologram'),
    ]);
  });
});
