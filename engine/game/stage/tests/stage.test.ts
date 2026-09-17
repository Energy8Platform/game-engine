import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import type { Diagnostic } from '@energy8engine/contracts';
import { createStage, createTransitions, cut, fitStage, type LayerView } from '../src/index';

describe('fitStage: contain', () => {
  it('scales by height and letterboxes left/right when the viewport is wider than the design aspect', () => {
    // design 800x600 (4:3), viewport 1600x600 (much wider) -> limited by height
    const fit = fitStage({ width: 1600, height: 600 }, { width: 800, height: 600 });
    expect(fit.scale).toBe(1); // 600/600
    expect(fit.y).toBe(0);
    expect(fit.x).toBe((1600 - 800 * 1) / 2); // 400
  });

  it('scales by width and letterboxes top/bottom when the viewport is taller than the design aspect', () => {
    const fit = fitStage({ width: 800, height: 1600 }, { width: 800, height: 600 });
    expect(fit.scale).toBe(1); // 800/800
    expect(fit.x).toBe(0);
    expect(fit.y).toBe((1600 - 600 * 1) / 2); // 500
  });

  it('scales down uniformly when the viewport is smaller than the design in both axes', () => {
    const fit = fitStage({ width: 400, height: 300 }, { width: 800, height: 600 });
    expect(fit.scale).toBe(0.5);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(0);
  });
});

describe('fitStage: cover', () => {
  it('picks the LARGER of the two axis scales, opposite of contain', () => {
    const containFit = fitStage(
      { width: 1600, height: 600 },
      { width: 800, height: 600 },
      'contain',
    );
    const coverFit = fitStage({ width: 1600, height: 600 }, { width: 800, height: 600 }, 'cover');
    expect(containFit.scale).toBe(1); // limited by height
    expect(coverFit.scale).toBe(2); // limited by width: 1600/800
    // cover overflows the shorter axis rather than letterboxing it
    expect(coverFit.y).toBeLessThan(0);
  });
});

describe('createStage', () => {
  it('mounts its container as a child of root', () => {
    const root = new Container();
    const stage = createStage({ root, design: { width: 800, height: 600 } });
    expect(root.children).toContain(stage.container);
  });

  it('resize() applies the fit to the real container scale/position, and returns it', () => {
    const root = new Container();
    const stage = createStage({ root, design: { width: 800, height: 600 } });

    const fit = stage.resize(1600, 600);

    expect(fit).toEqual({ scale: 1, x: 400, y: 0 });
    expect(stage.container.scale.x).toBe(1);
    expect(stage.container.scale.y).toBe(1);
    expect(stage.container.position.x).toBe(400);
    expect(stage.container.position.y).toBe(0);
  });

  it('a later resize() overwrites the earlier fit', () => {
    const root = new Container();
    const stage = createStage({ root, design: { width: 800, height: 600 } });

    stage.resize(1600, 600);
    stage.resize(400, 300);

    expect(stage.container.scale.x).toBe(0.5);
    expect(stage.container.position.x).toBe(0);
    expect(stage.container.position.y).toBe(0);
  });

  it('destroy() removes the container from root', () => {
    const root = new Container();
    const stage = createStage({ root, design: { width: 800, height: 600 } });

    stage.destroy();

    expect(root.children).not.toContain(stage.container);
  });
});

describe('createStage — layers and scenes', () => {
  const layers = [
    { id: 'ui', z: 20 },
    { id: 'bg', z: 0 },
    { id: 'reels', z: 10 },
  ];
  const design = { width: 1, height: 1 };

  it('creates one child container per layer, ordered by z, ties by declaration order', () => {
    const root = new Container();
    const stage = createStage({ root, design, layers: [...layers, { id: 'fx', z: 10 }] });
    expect(stage.layers().map((l) => l.id)).toEqual(['bg', 'reels', 'fx', 'ui']);
    expect(stage.container.children).toEqual(stage.layers().map((l) => l.container));
    expect(stage.layer('reels')).toBe(stage.layers()[1].container);
    expect(stage.layer('nope')).toBeUndefined();
  });

  it('defaults to one layer named reels', () => {
    const stage = createStage({ root: new Container(), design });
    expect(stage.layers().map((l) => l.id)).toEqual(['reels']);
  });

  it('enter shows the scene’s layers and hides the rest; current() follows; the same scene again is a no-op', async () => {
    const stage = createStage({
      root: new Container(),
      design,
      layers,
      scenes: { base_game: { layers: ['bg', 'reels'] }, free_spins: { layers: ['bg', 'ui'] } },
    });
    expect(stage.current()).toBeNull();
    await stage.enter('base_game');
    expect(stage.current()).toBe('base_game');
    expect(stage.layer('bg')!.visible).toBe(true);
    expect(stage.layer('reels')!.visible).toBe(true);
    expect(stage.layer('ui')!.visible).toBe(false);
    await stage.enter('free_spins');
    expect(stage.layer('reels')!.visible).toBe(false);
    expect(stage.layer('ui')!.visible).toBe(true);
    const before = stage.layer('ui')!.visible;
    await stage.enter('free_spins');
    expect(stage.layer('ui')!.visible).toBe(before);
  });

  it('an undeclared scene shows every layer and warns once', async () => {
    const reported: Diagnostic[] = [];
    const stage = createStage({
      root: new Container(),
      design,
      layers,
      scenes: { base_game: { layers: ['reels'] } },
      report: (d) => reported.push(d),
    });
    await stage.enter('bonus');
    await stage.enter('bonus2');
    await stage.enter('bonus');
    expect(stage.layers().every((l) => l.container.visible)).toBe(true);
    expect(reported.map((d) => d.where)).toEqual(['bonus', 'bonus2']);
    expect(reported[0]).toMatchObject({ severity: 'warning', plugin: 'stage' });
  });

  it('a stage declaring no scenes at all enters any scene silently — every layer shown, nothing to cross-check', async () => {
    for (const scenes of [{}, undefined]) {
      const reported: Diagnostic[] = [];
      const stage = createStage({
        root: new Container(),
        design,
        layers,
        scenes,
        report: (d) => reported.push(d),
      });
      await stage.enter('unbound-stage');
      expect(stage.current()).toBe('unbound-stage');
      expect(stage.layers().every((l) => l.container.visible)).toBe(true);
      expect(reported).toEqual([]);
    }
  });

  it('uses the scene’s transition, else the stage default, else cut; unknown → cut + warning; a failing run → error, visibility still applied', async () => {
    const reported: Diagnostic[] = [];
    const calls: string[] = [];
    const transitions = createTransitions();
    transitions.register({
      id: 'wipe',
      run: async () => {
        calls.push('wipe');
      },
    });
    transitions.register({
      id: 'boom',
      run: async () => {
        throw new Error('no gpu');
      },
    });
    transitions.register(cut);
    const stage = createStage({
      root: new Container(),
      design,
      layers,
      scenes: {
        a: { layers: ['bg'], transition: 'wipe' },
        b: { layers: ['ui'] },
        c: { layers: ['reels'], transition: 'ghost' },
        d: { layers: ['bg'], transition: 'boom' },
      },
      transition: 'wipe',
      transitions,
      report: (d) => reported.push(d),
    });
    await stage.enter('a');
    await stage.enter('b');
    expect(calls).toEqual(['wipe', 'wipe']);
    await stage.enter('c');
    expect(reported.at(-1)).toMatchObject({ severity: 'warning', where: 'ghost' });
    expect(stage.layer('reels')!.visible).toBe(true);
    await stage.enter('d');
    expect(reported.at(-1)).toMatchObject({ severity: 'error', where: 'boom' });
    expect(stage.layer('bg')!.visible).toBe(true);
    expect(stage.layer('reels')!.visible).toBe(false);
  });

  it('a from layer is hidden only after the transition, a to layer shown before it', async () => {
    const seen: Array<{ from: boolean[]; to: boolean[] }> = [];
    const transitions = createTransitions();
    transitions.register({
      id: 'spy',
      run: async ({ from, to }) => {
        seen.push({ from: from.map((c) => c.visible), to: to.map((c) => c.visible) });
      },
    });
    const stage = createStage({
      root: new Container(),
      design,
      layers,
      scenes: { a: { layers: ['bg'] }, b: { layers: ['ui'] } },
      transition: 'spy',
      transitions,
    });
    await stage.enter('a');
    await stage.enter('b');
    expect(seen[1]).toEqual({ from: [true], to: [true] });
    expect(stage.layer('bg')!.visible).toBe(false);
  });

  it('destroy detaches what rows mounted on the root container too — a root mount stays legal', () => {
    const root = new Container();
    const stage = createStage({ root, design, layers });
    const view = new Container();
    stage.container.addChild(view);
    stage.destroy();
    expect(view.destroyed).toBe(false);
    expect(view.parent).toBeNull();
    expect(root.children).toEqual([]);
  });

  it('layers() cannot be spliced from outside', () => {
    const stage = createStage({ root: new Container(), design, layers });
    expect(() => (stage.layers() as LayerView[]).splice(0, 1)).toThrow();
    expect(stage.layers()).toHaveLength(3);
  });

  it('destroy detaches what rows mounted into layers instead of destroying it', () => {
    const root = new Container();
    const stage = createStage({ root, design, layers });
    const view = new Container();
    stage.layer('reels')!.addChild(view);
    stage.destroy();
    expect(view.destroyed).toBe(false);
    expect(view.parent).toBeNull();
    expect(root.children).toEqual([]);
  });
});
