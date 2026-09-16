import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CompositionRow, ServerMessage, WorkspaceState } from '@energy8engine/contracts';
import { Preview, PreviewWall, createIdeClient } from '../src/index';

/**
 * Falling tests for Task 12, step 1: the preview panel draws an iframe at
 * `dev-game`'s address, and reloads it when — and only when — the host's
 * `game-composition` frame says `reload: true` (see the block of four
 * below for what that replaced).
 */

const PREVIEW_URL = 'http://game.test:5679';

/** What the host sends when nothing is open — see `WorkspaceState.previewUrl`. */
const NO_PROJECT: WorkspaceState = {
  projects: [{ id: 'a', name: 'Game A' }],
  templates: [],
  active: null,
  previewUrl: null,
  diagnostics: [],
};

function workspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    projects: [{ id: 'a', name: 'Game A' }],
    templates: [],
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
    const iframe = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.src).toBe(`${PREVIEW_URL}/`);
  });

  it('with no project open there is no iframe, only the note', async () => {
    const { ctx } = await harness(NO_PROJECT);
    render(<Preview ctx={ctx} />);
    expect(screen.queryByTitle('game preview')).toBeNull();
    expect(screen.getByTestId('preview-unavailable')).toHaveTextContent(/no project open/);
  });

  it('before the workspace has answered at all there is no iframe either — it is loading, not unavailable', async () => {
    const { ctx } = await harness(null);
    render(<Preview ctx={ctx} />);
    expect(screen.queryByTitle('game preview')).toBeNull();
    expect(screen.getByTestId('preview-loading')).toHaveTextContent('loading…');
    expect(screen.queryByTestId('preview-unavailable')).toBeNull();
  });

  it('a workspace change to a different previewUrl remounts the iframe — a real navigation', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    push({
      type: 'workspace',
      workspace: workspace({ active: 'b', previewUrl: 'http://other.test:5679' }),
    });
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.src).toBe('http://other.test:5679/');
  });

  it('a different active project on the SAME previewUrl remounts the iframe — same port, different game', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    push({ type: 'workspace', workspace: workspace({ active: 'b' }) });
    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.src).toBe(`${PREVIEW_URL}/`);
  });

  it('a workspace change that keeps the same previewUrl does not reload', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    push({ type: 'workspace', workspace: workspace({ diagnostics: [] }) });
    expect(screen.getByTitle('game preview')).toBe(before);
  });

  /**
   * Whether an edit needs the game reloaded is the HOST's verdict now —
   * `GameCompositionMessage.reload`, decided from the row's `hot` and the
   * changed keys' `applies: 'restart'` (hot-fork slice, spec §2 "Клиент").
   * The four cases that used to sit here fingerprinted the EDITOR's own
   * `hot: false` rows out of `snapshot` frames (`coldSignature`); no editor
   * row of the reference project is cold (`bridge1`, `screendemo1`, `probe1`
   * all declare `hot: true`), so that property guarded nothing a person
   * could reach, and the one it stood for — "a cold change reloads" — is
   * the host's `reload` now, pinned host-side. What the client pins is:
   * it follows `reload`.
   */
  it('a game-composition frame with reload: true remounts the iframe — a real navigation', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');

    push({ type: 'game-composition', rows: [], reload: true, changed: ['renderer1'] });

    const after = screen.getByTitle('game preview') as HTMLIFrameElement;
    expect(after).not.toBe(before);
    expect(after.src).toBe(`${PREVIEW_URL}/`);
  });

  it('a game-composition frame with reload: false keeps the same iframe — the game re-applied the row itself', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');

    push({ type: 'game-composition', rows: [], reload: false, changed: ['reels1'] });

    expect(screen.getByTitle('game preview')).toBe(before);
  });

  it('every reload: true frame remounts again — two edits, two navigations', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    push({ type: 'game-composition', rows: [], reload: true, changed: ['renderer1'] });
    const first = screen.getByTitle('game preview');
    push({ type: 'game-composition', rows: [], reload: true, changed: ['renderer1'] });
    expect(screen.getByTitle('game preview')).not.toBe(first);
  });

  it('a snapshot of the EDITOR’s rows, cold or not, never reloads on its own', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} />);
    const before = screen.getByTitle('game preview');
    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:res', hot: false, config: { resolution: '720p' } })],
        diagnostics: [],
      },
    });
    push({
      type: 'snapshot',
      snapshot: {
        rows: [row({ id: 'a:res', hot: false, config: { resolution: '1080p' } })],
        diagnostics: [],
      },
    });
    expect(screen.getByTitle('game preview')).toBe(before);
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

  it('a reload: true frame gives every tile a new frame; reload: false leaves them', async () => {
    const { ctx, push } = await harness();
    render(<PreviewWall ctx={ctx} />);
    const before = screen.getAllByTestId(/^tile-/);
    push({ type: 'game-composition', rows: [], reload: false, changed: ['reels1'] });
    expect(screen.getAllByTestId(/^tile-/)).toEqual(before);
    push({ type: 'game-composition', rows: [], reload: true, changed: ['renderer1'] });
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
