import { describe, expect, it } from 'vitest';
// Duplicated deliberately, not imported across the package boundary: each
// engine package has its own vitest config and alias, and a relative climb
// into another workspace's test directory resolves on one machine and not
// the next. Twelve lines are cheaper than a shared test-utils package for
// two callers — see the helpers file itself for the canonical text.
import { fakeFetch, row } from './helpers';
import { createGame } from '../src/index';

// Stands in for the real network + dynamic import: each row resolves to a
// half that marks the context, so the test observes composition ORDER and
// CONTENT without needing a server or a bundler.
const halves: Record<string, (ctx: any, cfg: any) => void> = {
  reels1: (ctx, cfg) => {
    ctx.reels = { config: cfg };
  },
  renderer1: (ctx) => {
    ctx.renderer = { app: { canvas: document.createElement('canvas') } };
  },
};
const importHalf = async (url: string) => ({ apply: halves[url.split('/').pop()!] });

describe('createGame composes from the project', () => {
  it('composes what the project says, not what the module imports', async () => {
    const mount = document.createElement('div');
    const game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({
          rows: [row('renderer1'), row('reels1', { grid: { cols: 5, rows: 3 } })],
          diagnostics: [],
        }),
        importModule: importHalf,
      },
    });
    expect(game.diagnostics).toEqual([]);
    expect(game.ctx.reels.config).toEqual({ grid: { cols: 5, rows: 3 } });
  });

  it('a project with no renderer row still boots and says why the screen is empty', async () => {
    const mount = document.createElement('div');
    const game = await createGame({
      mount,
      loader: { fetchFn: fakeFetch({ rows: [row('reels1')], diagnostics: [] }), importModule: importHalf },
    });
    expect(game.ctx.renderer).toBeUndefined();
    // Visible text, not a field: `boot` already knows how to draw the reason,
    // and that is what a person would actually be looking at.
    expect(mount.textContent).toContain('renderer');
  });

  it('a project offering two renderer providers boots with an ambiguity diagnostic, not a silent pick', async () => {
    const mount = document.createElement('div');
    const game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({ rows: [row('renderer1'), row('renderer2')], diagnostics: [] }),
        importModule: importHalf,
      },
    });
    expect(game.ctx.renderer).toBeUndefined();
    expect(
      game.diagnostics.some(
        (d) => d.message.includes('renderer1') && d.message.includes('renderer2'),
      ),
    ).toBe(true);
    expect(mount.textContent).toMatch(/renderer/i);
  });
});
