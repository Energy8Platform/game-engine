/**
 * `scenes.require` — the paths a ROW draws with that no document names.
 * The service builder is `mount.test.ts`'s, with a fresh loader per test:
 * `require`'s whole story is which batches the loader was asked for.
 */
import { describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createDiagnostics } from '@energy8engine/diagnostics';
import { createNodeTypes } from '../src/node-types';
import { container, image, scene, type AssetLoader } from '../src/builtin';
import { createScenes } from '../src/scenes';

const tick = () => new Promise((r) => setTimeout(r, 0));

function spyLoader(fail?: string): AssetLoader & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    load: vi.fn(async (urls: string[]) => {
      calls.push([...urls]);
      if (fail) throw new Error(fail);
    }),
    unload: vi.fn(async () => {}),
    get: () => Texture.EMPTY,
  };
}

function boot(docs: SceneDoc[], loader: AssetLoader, update?: () => void) {
  const ctx = new Context();
  const report = vi.fn<(d: Diagnostic) => void>();
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene]) nodeTypes.register(t);
  if (update)
    nodeTypes.register({
      type: 'probe',
      schema: Schema.object({}),
      mount: () => new Container(),
      update,
    });
  const scenes = createScenes({
    root: new Container(),
    design: { width: 100, height: 50 },
    nodeTypes,
    loader,
    ctx,
    report,
  });
  scenes.replace(docs);
  return { scenes, report };
}

const docA: SceneDoc = { id: 'a', nodes: [{ id: 'bg', type: 'image', props: { src: 'bg.png' } }] };
const docProbe: SceneDoc = {
  id: 'a',
  nodes: [
    { id: 'bg', type: 'image', props: { src: 'bg.png' } },
    { id: 'p', type: 'probe', props: {} },
  ],
};

describe('require', () => {
  it("a require before the first load takes its own batch, ahead of the document's", async () => {
    const loader = spyLoader();
    const { scenes } = boot([docA], loader);
    scenes.require(['x.png']);
    await scenes.show('a');
    expect(loader.calls).toEqual([['x.png'], ['bg.png']]);
  });

  it('a require with no show ever still loads — a row that draws no document is the point', async () => {
    const loader = spyLoader();
    const { scenes } = boot([docA], loader);
    scenes.require(['x.png']);
    await tick();
    expect(loader.calls).toEqual([['x.png']]);
  });

  it('two requires racing on one path load it once — the second batch re-reads what landed', async () => {
    const loader = spyLoader();
    const { scenes } = boot([docA], loader);
    scenes.require(['x.png']);
    scenes.require(['x.png', 'y.png']);
    await tick();
    expect(loader.calls).toEqual([['x.png'], ['y.png']]);
  });

  it('a require after it loads only what is new, and the views refresh', async () => {
    const loader = spyLoader();
    const update = vi.fn();
    const { scenes } = boot([docProbe], loader, update);
    await scenes.show('a');
    loader.calls.length = 0;
    update.mockClear();
    scenes.require(['x.png', 'bg.png']);
    await tick();
    expect(loader.calls).toEqual([['x.png']]);
    expect(update).toHaveBeenCalled();
  });

  it('two holders of one path load it once, and one disposer leaves it required', async () => {
    const loader = spyLoader();
    const { scenes } = boot([docA], loader);
    const first = scenes.require(['x.png']);
    const second = scenes.require(['x.png']);
    await scenes.show('a');
    expect(loader.calls).toEqual([['x.png'], ['bg.png']]);
    first();
    await scenes.hide('a');
    // `second` still holds it: the orphan sweep takes the document's path only.
    expect(loader.unload).toHaveBeenCalledWith(['bg.png']);
    // And once the last holder goes, the next sweep is free to take it.
    second();
    await scenes.show('a');
    await scenes.hide('a');
    expect(loader.unload).toHaveBeenLastCalledWith(expect.arrayContaining(['x.png']));
  });

  it('a path the hiding document names too survives the sweep while a holder lives', async () => {
    const loader = spyLoader();
    const { scenes } = boot([docA], loader);
    const off = scenes.require(['bg.png']);
    await scenes.show('a');
    // One batch's worth: the document's own path was already required.
    expect(loader.calls).toEqual([['bg.png']]);
    await scenes.hide('a');
    expect(loader.unload).not.toHaveBeenCalled();
    // And the next sweep after the holder goes is free to take it.
    off();
    await scenes.show('a');
    await scenes.hide('a');
    expect(loader.unload).toHaveBeenCalledWith(['bg.png']);
  });

  it('the last disposer drops the claim, and nothing is unloaded for it', async () => {
    const loader = spyLoader();
    const { scenes } = boot([docA], loader);
    scenes.require(['x.png'])();
    await scenes.show('a');
    expect(loader.calls).toEqual([['bg.png']]);
    expect(loader.unload).not.toHaveBeenCalled();
  });

  it('an empty require is a no-op, and a path twice in one call is asked for once', async () => {
    const loader = spyLoader();
    const { scenes } = boot([docA], loader);
    const off = scenes.require([]);
    await scenes.show('a');
    expect(loader.calls).toEqual([['bg.png']]);
    off();
    scenes.require(['x.png', 'x.png']);
    await tick();
    expect(loader.calls).toEqual([['bg.png'], ['x.png']]);
  });

  it('a failed require load is reported per path, as a document path is', async () => {
    const loader = spyLoader('404');
    const { scenes, report } = boot([docA], loader);
    await scenes.show('a');
    report.mockClear();
    scenes.require(['assets/x.png', 'assets/y.png']);
    await tick();
    expect(report).toHaveBeenCalledTimes(2);
    for (const p of ['assets/x.png', 'assets/y.png'])
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining(`"${p}" failed to load`),
        }),
      );
  });
  it('a path outside assets/ is one warning at assetLoader, and is still requested', async () => {
    const loader = spyLoader();
    const { scenes, report } = boot([docA], loader);
    const diag = createDiagnostics();
    report.mockImplementation((d) => diag.report(d));
    scenes.require(['plugins/x/art.png', 'assets/ok.png']);
    scenes.require(['plugins/x/art.png']);
    await tick();
    expect(loader.calls[0]).toEqual(['plugins/x/art.png', 'assets/ok.png']);
    expect(diag.list()).toEqual([
      expect.objectContaining({
        severity: 'warning',
        where: 'assetLoader',
        message: '"plugins/x/art.png" is outside assets/ — a built dist will not carry it',
        fix: 'move it under assets/',
      }),
    ]);
  });

  it('a path under assets/ is silent, a leading ./ included', async () => {
    const { scenes, report } = boot([docA], spyLoader());
    scenes.require(['assets/ok.png', './assets/also.png']);
    await tick();
    expect(report).not.toHaveBeenCalled();
  });

  it('a root-relative /assets/ path still warns — it is not the project folder', async () => {
    const { scenes, report } = boot([docA], spyLoader());
    scenes.require(['/assets/x.png']);
    await tick();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', where: 'assetLoader', fix: 'move it under assets/' }),
    );
  });
});

describe('declared paths reach the loader before anything mounts', () => {
  function expectLoader() {
    const order: string[] = [];
    const expected: string[][] = [];
    const loader: AssetLoader = {
      load: vi.fn(async () => {}),
      unload: vi.fn(async () => {}),
      get: (url) => {
        order.push(`get ${url}`);
        return Texture.EMPTY;
      },
      expect: (urls) => {
        order.push(`expect ${[...urls].sort().join(',')}`);
        expected.push([...urls]);
      },
    };
    return { loader, order, expected };
  }

  it('replace expects every declared document’s paths, hidden ones included, before mounting', () => {
    const { loader, order, expected } = expectLoader();
    boot(
      [
        docA,
        { id: 'b', nodes: [{ id: 'art', type: 'image', props: { src: 'b.png' } }] },
      ],
      loader,
    );
    expect(expected.flat().sort()).toEqual(['b.png', 'bg.png']);
    // Mounting calls `get`; the expect must come first.
    const firstGet = order.findIndex((s) => s.startsWith('get '));
    const lastExpect = order.map((s) => s.startsWith('expect ')).lastIndexOf(true);
    expect(lastExpect).toBeGreaterThanOrEqual(0);
    expect(firstGet).toBeGreaterThan(lastExpect);
  });

  it('require expects its paths at once, before its batch runs', () => {
    const { loader, expected } = expectLoader();
    const { scenes } = boot([], loader);
    expected.length = 0;
    scenes.require(['assets/fx.png']);
    // Synchronously — no tick awaited.
    expect(expected).toEqual([['assets/fx.png']]);
  });

  it('a loader without expect still boots and requires', async () => {
    const loader = spyLoader();
    const { scenes } = boot([docA], loader);
    scenes.require(['assets/fx.png']);
    await tick();
    expect(loader.calls).toContainEqual(['assets/fx.png']);
  });
});
