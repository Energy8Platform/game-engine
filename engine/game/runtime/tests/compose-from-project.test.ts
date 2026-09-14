import { describe, expect, it } from 'vitest';
// Duplicated deliberately, not imported across the package boundary: each
// engine package has its own vitest config and alias, and a relative climb
// into another workspace's test directory resolves on one machine and not
// the next. Twelve lines are cheaper than a shared test-utils package for
// two callers — see the helpers file itself for the canonical text.
import type { GameCompositionRow } from '@energy8engine/contracts';
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
  // A competing renderer provider — the canonical third-party story: an
  // `@acme/gl` package declaring `e8.seam: { renderer, matcher: { urlParam } }`,
  // ADDED as a row rather than replacing `renderer1` in place.
  renderer2: (ctx) => {
    ctx.renderer = { app: { canvas: document.createElement('canvas') }, gl: true };
  },
  // Stands in for every row that reads a seam's service — `stage1` is the
  // real one. Throws exactly the way the real `stage` runtime half does
  // when nothing has provided `renderer` yet.
  stage1: (ctx) => {
    if (!ctx.renderer) throw new Error('stage needs a renderer');
    ctx.stageRenderer = ctx.renderer;
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
      loader: {
        fetchFn: fakeFetch({ rows: [row('reels1')], diagnostics: [] }),
        importModule: importHalf,
      },
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

  /**
   * The documented third-party story, in the order a real project actually
   * produces: `resolveComposition` APPENDS a row a patch adds, so a patch
   * that adds `@acme/gl` as `renderer2` lands it LAST — after every row
   * that reads `ctx.renderer`.
   *
   * Before the seam plan re-slotted the winner, this composed as
   * `stage1, …, renderer2`: `renderer1` was filtered out for losing,
   * `stage1` read a context nothing had provided `renderer` on and threw,
   * and the player got a failure screen blaming `stage1` — an innocent
   * row, for a mistake the person never made. The only arrangement that
   * worked was replacing `renderer1` in place, which is undocumented and
   * abandons the seam competition entirely.
   */
  it('a patch that ADDS a competing renderer composes, rather than blaming the row that reads it', async () => {
    const mount = document.createElement('div');
    // The host serves rows in resolution order, and a patch-added row is
    // last. This is not a contrived ordering — it is the only one
    // `resolveComposition` produces for an added row.
    const acmeGl: GameCompositionRow = {
      ...row('renderer2'),
      seam: { name: 'renderer', matcher: { urlParam: 'webgpu' } },
    };
    const game = await createGame({
      mount,
      urlParams: { webgpu: '1' },
      loader: {
        fetchFn: fakeFetch({
          rows: [row('renderer1'), row('stage1'), acmeGl],
          diagnostics: [],
        }),
        importModule: importHalf,
      },
    });

    expect(game.diagnostics).toEqual([]);
    // The specific matcher beat the default, so the winner is `@acme/gl`.
    expect((game.ctx as unknown as { renderer: { gl?: boolean } }).renderer.gl).toBe(true);
    // And the row that reads the seam saw it — the winner applied BEFORE
    // it, in the losing candidate's position, not after it at the end.
    expect((game.ctx as unknown as { stageRenderer: { gl?: boolean } }).stageRenderer.gl).toBe(
      true,
    );
    // Nothing was drawn over the game.
    expect(mount.textContent).toBe('');
  });
});
