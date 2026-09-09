import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CompositionRow, ServerMessage } from '@energy8engine/contracts';
import { Preview, PreviewWall, computePreviewUrl, createIdeClient } from '../src/index';

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

async function harness() {
  const listeners: ((event: { data: string }) => void)[] = [];
  const socket = {
    readyState: 1,
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send() {},
    close() {},
  };
  const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
  const push = (message: ServerMessage) => {
    act(() => {
      for (const listener of listeners) listener({ data: JSON.stringify(message) });
    });
  };
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

describe('computePreviewUrl', () => {
  it('addresses the ide-host directly, on the fixed dev-game port', () => {
    // jsdom's default test origin is http://localhost/ — deterministic.
    expect(computePreviewUrl()).toBe('http://localhost:5679');
  });
});

describe('Preview', () => {
  it('renders an iframe pointed at the same server dev-game serves', async () => {
    const { ctx } = await harness();
    render(<Preview ctx={ctx} url="http://x:5679" />);
    const iframe = screen.getByTitle('превью игры') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.src).toBe('http://x:5679/');
  });

  it('the first snapshot after connecting establishes a baseline, not a reload', async () => {
    const { ctx, push } = await harness();
    render(<Preview ctx={ctx} url="http://x:5679" />);
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
    render(<Preview ctx={ctx} url="http://x:5679" />);

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
    render(<Preview ctx={ctx} url="http://x:5679" />);

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
    render(<Preview ctx={ctx} url="http://x:5679" />);

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
