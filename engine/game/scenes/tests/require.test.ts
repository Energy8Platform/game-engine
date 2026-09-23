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
    scenes.require(['x.png', 'y.png']);
    await tick();
    expect(report).toHaveBeenCalledTimes(2);
    for (const p of ['x.png', 'y.png'])
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining(`"${p}" failed to load`),
        }),
      );
  });
});
