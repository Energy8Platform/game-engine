// engine/game/reel-core/tests/reelSystem.test.ts
//
// The pluggable reel system: motion styles, the anticipator and board controllers are REGISTERED
// into it rather than built in. Fake styles/controllers throughout — no real motion runs, so no
// ticker pumping is needed.
import { describe, it, expect, vi } from 'vitest';
import { Container } from 'pixi.js';
import {
  createReelSystem,
  BUILTIN_MOTION_STYLES,
  DEFAULT_REEL_CONFIG,
  type Anticipator,
  type BoardController,
  type CellData,
  type ControllerRunner,
  type MotionRunner,
  type MotionStyle,
  type SymbolResolver,
  type TumbleStep,
} from '../src/index';

const resolve: SymbolResolver = vi.fn(() => new Container() as any);
const motionCfg = DEFAULT_REEL_CONFIG.motion;

const board = (syms: string[][]): CellData[][] =>
  syms.map((col) => col.map((symbol) => ({ symbol })));
const TARGET = board([
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
  ['G', 'H', 'I'],
]);

function make() {
  const report = vi.fn();
  const sys = createReelSystem({ resolve, grid: { cols: 3, rows: 3 }, report });
  return { sys, report };
}

const cellSymbols = (sys: ReturnType<typeof make>['sys']): (string | null)[][] =>
  [0, 1, 2].map((c) => [0, 1, 2].map((r) => sys.grid.getCell(c, r).data.symbol));

function fakeStyle(key = 'fake', onRun?: () => void) {
  const runners: (MotionRunner & {
    run: ReturnType<typeof vi.fn>;
    plan: ReturnType<typeof vi.fn>;
    skip: ReturnType<typeof vi.fn>;
  })[] = [];
  const style: MotionStyle = {
    key,
    create: vi.fn(() => {
      const r = { plan: vi.fn(() => []), run: vi.fn(async () => onRun?.()), skip: vi.fn() };
      runners.push(r);
      return r;
    }),
  };
  return { style, runners };
}

function fakeController(kind = 'tumble') {
  const runners: (ControllerRunner<TumbleStep> & {
    run: ReturnType<typeof vi.fn>;
    skip: ReturnType<typeof vi.fn>;
  })[] = [];
  const controller: BoardController<TumbleStep> = {
    kind,
    create: vi.fn(() => {
      const r = { run: vi.fn(async () => {}), skip: vi.fn() };
      runners.push(r);
      return r;
    }),
  };
  return { controller, runners };
}

describe('createReelSystem (pluggable)', () => {
  it('spin with no style in use snaps to the target and warns once', async () => {
    const { sys, report } = make();
    await sys.spin(TARGET);
    expect(sys.board).toBe(TARGET);
    expect(cellSymbols(sys)).toEqual([
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('warning', 'no motion row — the reels snap to the result');
  });

  it('an unknown style reports an error naming it and the registered keys, then snaps', async () => {
    const { sys, report } = make();
    for (const s of BUILTIN_MOTION_STYLES) sys.motions.register(s);
    sys.useMotion('nope', motionCfg);
    await sys.spin(TARGET);
    expect(report).toHaveBeenCalledTimes(1);
    const [severity, message] = report.mock.calls[0];
    expect(severity).toBe('error');
    expect(message).toContain('nope');
    expect(message).toContain('swap, strip, cascade-drop');
    expect(sys.board).toBe(TARGET);
    expect(cellSymbols(sys)[1]).toEqual(['D', 'E', 'F']);
  });

  it('a registered style runs the spin; its runner is cached per useMotion', async () => {
    const { sys } = make();
    const { style, runners } = fakeStyle();
    sys.motions.register(style);
    sys.useMotion('fake', motionCfg);
    const opts = { turbo: true };
    await sys.spin(TARGET, opts);
    expect(runners).toHaveLength(1);
    expect(runners[0].run).toHaveBeenCalledTimes(1);
    expect(runners[0].run.mock.calls[0][0]).toBe(TARGET);
    expect(runners[0].run.mock.calls[0][1]).toMatchObject({ turbo: true });
    sys.planSpin(TARGET, opts);
    expect(runners[0].plan).toHaveBeenCalledTimes(1);
    expect(runners[0].plan.mock.calls[0][0]).toBe(TARGET);
    await sys.spin(TARGET);
    expect(style.create).toHaveBeenCalledTimes(1);
    expect(sys.board).toBe(TARGET);

    sys.useMotion('fake', { ...motionCfg, spinUp: 1 });
    expect(runners[0].skip).toHaveBeenCalled();
    await sys.spin(TARGET);
    expect(style.create).toHaveBeenCalledTimes(2);
    expect(runners[1].run).toHaveBeenCalledTimes(1);
    expect((style.create as any).mock.calls[1][1].spinUp).toBe(1);
  });

  it('a style registered after useMotion names it is used at spin time', async () => {
    const { sys, report } = make();
    sys.useMotion('late', motionCfg);
    const { style, runners } = fakeStyle('late');
    sys.motions.register(style);
    await sys.spin(TARGET);
    expect(runners[0].run).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it('the disposer of motions.register removes the style', async () => {
    const { sys, report } = make();
    const { style } = fakeStyle();
    const dispose = sys.motions.register(style);
    expect(sys.motions.keys()).toEqual(['fake']);
    dispose();
    expect(sys.motions.get('fake')).toBeUndefined();
    sys.useMotion('fake', motionCfg);
    await sys.spin(TARGET);
    expect(report).toHaveBeenCalledWith('error', expect.stringContaining('fake'));
    expect(sys.board).toBe(TARGET);
  });

  it('the anticipator decides the reels and zooms around the run; explicit reels win', async () => {
    const { sys } = make();
    const order: string[] = [];
    const { style, runners } = fakeStyle('fake', () => void order.push('run'));
    sys.motions.register(style);
    sys.useMotion('fake', motionCfg);
    const reset = vi.fn(async () => void order.push('reset'));
    const anticipator: Anticipator = {
      config: DEFAULT_REEL_CONFIG.anticipation,
      decide: vi.fn(() => ({
        active: true,
        reels: [2],
        slowdown: 0.5,
        holdMs: 100,
        cellStaggerRamp: 1,
      })),
      zoomIn: vi.fn(async () => {
        order.push('zoomIn');
        return reset;
      }),
    };
    sys.anticipation.set(anticipator);
    await sys.spin(TARGET);
    expect(runners[0].run.mock.calls[0][1]).toMatchObject({
      anticipateReels: [2],
      anticipateSlowdown: 0.5,
    });
    expect(anticipator.zoomIn).toHaveBeenCalledWith(sys.grid);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['zoomIn', 'run', 'reset']);

    await sys.spin(TARGET, { anticipateReels: [0] });
    expect(runners[0].run.mock.calls[1][1].anticipateReels).toEqual([0]);
  });

  it('cascade rejects without a tumble controller, and runs through one with it', async () => {
    const { sys } = make();
    const step: TumbleStep = {
      winningCells: [],
      removedCells: [],
      newCells: [],
      settledGrid: TARGET,
    };
    await expect(sys.cascade([step])).rejects.toThrow(
      'no reels-cascade row — a tumble step cannot play',
    );
    const { controller, runners } = fakeController();
    sys.controllers.register(controller);
    await sys.cascade([step], { turbo: true });
    expect(runners[0].run).toHaveBeenCalledWith(step, { turbo: true });
    expect(sys.board).toBe(TARGET);
  });

  it('skip skips the active runner and every created controller runner, and sweeps fx', async () => {
    const { sys } = make();
    const { style, runners } = fakeStyle();
    sys.motions.register(style);
    sys.useMotion('fake', motionCfg);
    await sys.spin(TARGET);
    const { controller, runners: ctl } = fakeController();
    sys.controllers.register(controller);
    await sys.cascade([{ winningCells: [], removedCells: [], newCells: [], settledGrid: TARGET }]);

    sys.fx.addChild(new Container());
    sys.skip({ overlays: false });
    expect(sys.fx.children).toHaveLength(1);
    expect(runners[0].skip).toHaveBeenCalledTimes(1);
    expect(ctl[0].skip).toHaveBeenCalledTimes(1);

    sys.skip();
    expect(sys.fx.children).toHaveLength(0);
    expect(runners[0].skip).toHaveBeenCalledTimes(2);
    expect(ctl[0].skip).toHaveBeenCalledTimes(2);
  });

  it('destroy skips and destroys the view; a later spin is a no-op', async () => {
    const { sys, report } = make();
    const { style, runners } = fakeStyle();
    sys.motions.register(style);
    sys.useMotion('fake', motionCfg);
    await sys.spin(TARGET);
    sys.destroy();
    expect(runners[0].skip).toHaveBeenCalled();
    expect(sys.view.destroyed).toBe(true);
    await expect(sys.spin(TARGET)).resolves.toBeUndefined();
    expect(runners[0].run).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it('unregistering the active style skips and drops its runner; re-registering builds a fresh one', async () => {
    const { sys } = make();
    const { style, runners } = fakeStyle();
    const dispose = sys.motions.register(style);
    sys.useMotion('fake', motionCfg);
    await sys.spin(TARGET);
    dispose();
    expect(runners[0].skip).toHaveBeenCalledTimes(1);
    sys.motions.register(style);
    await sys.spin(TARGET);
    expect(runners).toHaveLength(2);
    expect(runners[1].run).toHaveBeenCalledTimes(1);
  });

  it('skip after destroy is a no-op', async () => {
    const { sys } = make();
    const { style, runners } = fakeStyle();
    sys.motions.register(style);
    sys.useMotion('fake', motionCfg);
    await sys.spin(TARGET);
    sys.destroy();
    sys.skip();
    expect(runners[0].skip).toHaveBeenCalledTimes(1);
  });
});
