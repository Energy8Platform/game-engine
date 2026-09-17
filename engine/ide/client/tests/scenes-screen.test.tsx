import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Config } from '@energy8engine/stage/schema';
import type { Diagnostic, GameCompositionRow } from '@energy8engine/contracts';
import { ScenesScreen, createIdeClient } from '../src/index';

/**
 * The Scenes screen against a real `createIdeClient` and the real stage
 * schema (`@energy8engine/stage/schema`'s `Config.toJSON()`, the same
 * bytes the host puts on `GET /api/composition`): which layers each scene
 * shows, in what z-order, with what transition — every edit a `PUT` of the
 * whole stage config, recorded here and asserted whole. The DOM contract
 * (testids, labels) is what the e2e suite (Task 7) drives, so the names
 * here are the names there.
 */
const STAGE_SCHEMA = JSON.parse(JSON.stringify(Config.toJSON()));

const STAGE_CONFIG = {
  design: { width: 1280, height: 720 },
  layers: [
    { id: 'bg', z: 0 },
    { id: 'reels', z: 10 },
  ],
  scenes: { base_game: { layers: ['bg', 'reels'] } },
};

function stageRow(config: Record<string, unknown> = STAGE_CONFIG): GameCompositionRow {
  return {
    id: 'stage1',
    name: '@energy8engine/stage',
    config,
    from: 'patch',
    runtimeUrl: null,
    schema: STAGE_SCHEMA,
    hot: true,
  };
}

interface HarnessOptions {
  rows?: GameCompositionRow[];
  diagnostics?: Diagnostic[];
  stages?: string[];
  transitions?: string[];
  previewDiagnostics?: Diagnostic[];
}

async function harness({
  rows = [stageRow()],
  diagnostics = [],
  stages = ['base_game', 'free_spins'],
  transitions = ['cut', 'fade'],
  previewDiagnostics = [],
}: HarnessOptions = {}) {
  const puts: { url: string; body: { config: Record<string, unknown> } }[] = [];
  const posts: { url: string; body: unknown }[] = [];
  let current = rows;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (init?.method === 'PUT' && path.includes('/api/composition/rows/')) {
      const body = JSON.parse(String(init.body));
      puts.push({ url: path, body });
      // The host writes the row and answers with the rows it resolved after
      // — so the next edit builds on THIS one, like it does for real.
      const id = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
      current = current.map((row) => (row.id === id ? { ...row, config: body.config } : row));
      return json({ rows: current, reload: false, diagnostics: [] });
    }
    if (init?.method === 'POST' && path.includes('/api/scenes/preview')) {
      posts.push({ url: path, body: JSON.parse(String(init.body)) });
      return json({ diagnostics: previewDiagnostics });
    }
    if (path.includes('/api/composition')) {
      const schema = { stages: Object.fromEntries(stages.map((s) => [s, {}])) };
      return json({ rows: current, diagnostics, schema, transitions });
    }
    // `workspace`'s boot GET and anything else: never answered, never wrong.
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
  const socket = {
    readyState: 1,
    addEventListener() {},
    send() {},
    close() {},
  };
  const ctx = await createIdeClient({
    url: 'ws://x/ide',
    socketFactory: () => socket,
    importModule: async () => ({}),
    fetchFn,
  });
  render(<ScenesScreen ctx={ctx} />);
  return { ctx, puts, posts };
}

describe('ScenesScreen', () => {
  it('lists scenes and layers, checks the layers the selected scene shows', async () => {
    await harness({
      rows: [
        stageRow({
          ...STAGE_CONFIG,
          scenes: { base_game: { layers: ['bg', 'reels'] }, free_spins: { layers: ['reels'] } },
        }),
      ],
    });
    expect(await screen.findByTestId('scene-base_game')).toBeTruthy();
    expect(screen.getByTestId('scene-free_spins')).toBeTruthy();
    expect(screen.getByTestId('layer-bg')).toBeTruthy();
    expect(screen.getByTestId('layer-reels')).toBeTruthy();
    expect(screen.getByLabelText('bg in base_game')).toBeChecked();
    expect(screen.getByLabelText('reels in base_game')).toBeChecked();

    fireEvent.click(screen.getByTestId('scene-free_spins'));
    expect(screen.getByLabelText('bg in free_spins')).not.toBeChecked();
    expect(screen.getByLabelText('reels in free_spins')).toBeChecked();
  });

  it('unchecking a layer PUTs the full config with it removed from the scene', async () => {
    const { puts } = await harness();
    fireEvent.click(await screen.findByLabelText('reels in base_game'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/composition/rows/stage1');
    expect(puts[0].body).toEqual({
      config: { ...STAGE_CONFIG, scenes: { base_game: { layers: ['bg'] } } },
    });

    // Re-rendered from the host's answer; checking it back follows the
    // stage's layer order, not click order.
    await waitFor(() => expect(screen.getByLabelText('reels in base_game')).not.toBeChecked());
    fireEvent.click(screen.getByLabelText('reels in base_game'));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].body.config.scenes).toEqual({ base_game: { layers: ['bg', 'reels'] } });
  });

  it('down on bg swaps z with reels', async () => {
    const { puts } = await harness();
    fireEvent.click(
      within(await screen.findByTestId('layer-bg')).getByRole('button', { name: 'down' }),
    );
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({
      config: {
        ...STAGE_CONFIG,
        layers: [
          { id: 'bg', z: 10 },
          { id: 'reels', z: 0 },
        ],
      },
    });
    // Now reels draws first: `up` on bg swaps back.
    await waitFor(() =>
      expect(screen.getAllByTestId(/^layer-/).map((el) => el.dataset.testid)).toEqual([
        'layer-reels',
        'layer-bg',
      ]),
    );
    fireEvent.click(within(screen.getByTestId('layer-bg')).getByRole('button', { name: 'up' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].body.config.layers).toEqual(STAGE_CONFIG.layers);
  });

  it('down on a z-tie swaps array positions, since the runtime breaks ties by index', async () => {
    const tied = [
      { id: 'bg', z: 0 },
      { id: 'reels', z: 0 },
    ];
    const { puts } = await harness({ rows: [stageRow({ ...STAGE_CONFIG, layers: tied })] });
    fireEvent.click(
      within(await screen.findByTestId('layer-bg')).getByRole('button', { name: 'down' }),
    );
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body.config.layers).toEqual([
      { id: 'reels', z: 0 },
      { id: 'bg', z: 0 },
    ]);
  });

  it('choosing a transition writes it; the stage default clears it', async () => {
    const { puts } = await harness();
    const select = await screen.findByTestId('scene-transition');
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      '',
      'cut',
      'fade',
    ]);
    fireEvent.change(select, { target: { value: 'fade' } });
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({
      config: {
        ...STAGE_CONFIG,
        scenes: { base_game: { layers: ['bg', 'reels'], transition: 'fade' } },
      },
    });

    await waitFor(() => expect(screen.getByTestId('scene-transition')).toHaveValue('fade'));
    fireEvent.change(screen.getByTestId('scene-transition'), { target: { value: '' } });
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].body).toEqual({ config: STAGE_CONFIG });
  });

  it('adding a scene from a stage the script declares creates it with every layer', async () => {
    const { puts } = await harness();
    const input = await screen.findByTestId('scene-add-input');
    // Only the stages that are not scenes yet are suggested.
    const offered = Array.from(
      screen.getByTestId('scene-add').querySelectorAll('datalist option'),
    ).map((o) => (o as HTMLOptionElement).value);
    expect(offered).toEqual(['free_spins']);

    fireEvent.change(input, { target: { value: 'free_spins' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({
      config: {
        ...STAGE_CONFIG,
        scenes: { base_game: { layers: ['bg', 'reels'] }, free_spins: { layers: ['bg', 'reels'] } },
      },
    });
    // The new scene is listed, and selected.
    expect(await screen.findByTestId('scene-free_spins')).toBeTruthy();
    expect(screen.getByLabelText('bg in free_spins')).toBeChecked();
  });

  it('Show in preview POSTs the scene', async () => {
    const { posts } = await harness({
      previewDiagnostics: [
        { severity: 'warning', plugin: 'scenes', where: 'base_game', message: 'no preview is up' },
      ],
    });
    fireEvent.click(await screen.findByTestId('scene-show'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe('/api/scenes/preview');
    expect(posts[0].body).toEqual({ scene: 'base_game' });
    // The host's answer is shown, not swallowed.
    expect(await screen.findByText('no preview is up')).toBeTruthy();
  });

  it('without a stage row the screen says so', async () => {
    await harness({
      rows: [
        {
          id: 'reels1',
          name: '@energy8engine/reels',
          config: {},
          from: 'patch',
          runtimeUrl: null,
          schema: null,
          hot: true,
        },
      ],
    });
    expect(await screen.findByTestId('scenes-empty')).toBeTruthy();
    expect(screen.queryByTestId('scene-add')).toBeNull();
  });

  it('scenes diagnostics for the selected scene are shown under it', async () => {
    await harness({
      rows: [
        stageRow({
          ...STAGE_CONFIG,
          scenes: { base_game: { layers: ['bg', 'nope'] }, free_spins: { layers: [] } },
        }),
      ],
      diagnostics: [
        {
          severity: 'error',
          plugin: 'scenes',
          where: 'base_game',
          message: 'scene "base_game" shows layer "nope" the stage does not declare',
        },
        {
          severity: 'warning',
          plugin: 'scenes',
          where: 'free_spins',
          message: 'scene "free_spins" shows nothing',
        },
        { severity: 'error', plugin: 'e8-base', where: 'profile', message: 'bundle not found' },
      ],
    });
    const scenes = await screen.findByTestId('scenes-screen');
    expect(scenes).toHaveTextContent('layer "nope" the stage does not declare');
    expect(scenes).not.toHaveTextContent('shows nothing');
    expect(scenes).not.toHaveTextContent('bundle not found');

    fireEvent.click(screen.getByTestId('scene-free_spins'));
    expect(scenes).toHaveTextContent('shows nothing');
    expect(scenes).not.toHaveTextContent('the stage does not declare');
  });
});
