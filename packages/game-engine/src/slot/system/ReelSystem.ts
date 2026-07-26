// packages/game-engine/src/slot/system/ReelSystem.ts
//
// The configurable reel system facade. `createReelSystem({ resolve, config })` builds a grid and
// wires the spin engine, anticipation controller, tumble/cascade controller and the special-feature
// registry — all driven by one `ReelSystemConfig`. Presentation only: it draws boards you feed it.

import { Container } from 'pixi.js';
import { Tween } from '../../animation';
import { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';
import type { SymbolResolver } from '../grid/SymbolView';
import { SpinEngine, type SpinData, type SpinRunOpts } from '../motion/SpinEngine';
import { AnticipationController } from '../motion/AnticipationController';
import { TumbleController, type TumbleStep } from '../cascade/TumbleController';
import { ReelStepController, type ReelStepData } from '../cascade/ReelStepController';
import { FEATURES, FEATURE_LIST, type FeatureContext, type ReelFeature } from '../features';
import {
  DEFAULT_REEL_CONFIG,
  effectiveRowsPerReel,
  mergeReelConfig,
  resolveReelConfig,
  waysCount,
  type DeepPartial,
  type FeatureKey,
  type ReelSystemConfig,
} from '../config/ReelSystemConfig';

export interface CreateReelSystemOptions {
  resolve: SymbolResolver;
  config?: DeepPartial<ReelSystemConfig>;
  /** Initial board (board[col][row]); defaults to empty cells. */
  board?: CellData[][];
  log?: (msg: string) => void;
  /** Custom feature modules to register alongside the 13 built-ins. */
  features?: ReelFeature[];
}

/** Options for a stepped chain (`cascade` / `reelStep`). */
export interface StepRunOpts<TStep> {
  turbo?: boolean;
  /** Carry the running multiplier across free spins (with `cascade.multiplier.persistInFreeSpins`). */
  freeSpins?: boolean;
  /**
   * Fires after each step has settled, with the step's index and the running multiplier AFTER it.
   * The hook for a step-by-step payout readout: report the win accrued so far to the shell via
   * `api.shell.reportWin(...)`. Awaited, so an async hook paces the chain.
   */
  onStep?: (index: number, step: TStep, multiplier: number) => void | Promise<void>;
}

export interface ReelSystem {
  /** Root container — add this to your scene. */
  readonly view: Container;
  readonly grid: ReelGrid;
  /** Overlay layer above the grid (masked off) — draw bespoke rings/labels/sprites here. */
  readonly fx: Container;
  readonly config: ReelSystemConfig;
  /** Current board (board[col][row]). */
  readonly board: CellData[][];
  /** Ways-to-win for the current grid (ways/megaways evaluation). */
  readonly ways: number;
  setBoard(board: CellData[][]): void;
  /** Merge a partial config; rebuilds the grid when geometry changes. */
  update(partial: DeepPartial<ReelSystemConfig>): void;
  /** Replace the whole config. */
  setConfig(config: ReelSystemConfig): void;
  spin(target: CellData[][], opts?: SpinRunOpts): Promise<void>;
  /** Run a cascade chain. With `freeSpins` + `cascade.multiplier.persistInFreeSpins`, the multiplier
   *  carries over instead of resetting. Generic in the step type, so `onStep` hands back the game's
   *  own step (with its per-step win) rather than the bare TumbleStep. */
  cascade<TStep extends TumbleStep>(steps: TStep[], opts?: StepRunOpts<TStep>): Promise<void>;
  /**
   * Run a ReelStep™ chain: each step pays its winning cells, then scrolls every reel down by
   * `shifts[col]` positions (0 = reel stays put). Multiplier carries over with `freeSpins` +
   * `cascade.multiplier.persistInFreeSpins`, same as `cascade`.
   */
  reelStep<TStep extends ReelStepData>(steps: TStep[], opts?: StepRunOpts<TStep>): Promise<void>;
  /** Current running cascade / reel-step multiplier. */
  readonly multiplier: number;
  /** Register a custom feature (or override a built-in by reusing its key). */
  registerFeature(feature: ReelFeature): void;
  /** All registered features (built-ins + custom) in canonical order. */
  features(): ReelFeature[];
  /** Enabled feature modules (built-ins + custom). */
  enabledFeatures(): ReelFeature[];
  /** Run a feature by key — built-in `FeatureKey` or a custom feature's key. */
  runFeature(key: FeatureKey | string, opts?: { freeSpins?: boolean }): Promise<void>;
  /** Build a FeatureContext for driving a feature/bespoke animation yourself. */
  featureContext(opts?: { freeSpins?: boolean }): FeatureContext;
  resize(cellSize: number): void;
  skip(): void;
  destroy(): void;
}

/** Drop a `rowsPerReel` whose length no longer matches `cols` so geometry/ways stay consistent. */
function normalizeGrid(cfg: ReelSystemConfig): ReelSystemConfig {
  if (cfg.grid.rowsPerReel && cfg.grid.rowsPerReel.length !== cfg.grid.cols) {
    const next = { ...cfg, grid: { ...cfg.grid } };
    delete next.grid.rowsPerReel;
    return next;
  }
  return cfg;
}

export function createReelSystem(opts: CreateReelSystemOptions): ReelSystem {
  let config = normalizeGrid(resolveReelConfig(opts.config));
  const resolve = opts.resolve;
  const log = opts.log;

  const view = new Container();
  let grid!: ReelGrid;
  let fx!: Container;
  let spin!: SpinEngine;
  let anticipation!: AnticipationController;
  let tumble!: TumbleController;
  let reelStepCtl!: ReelStepController;
  let board: CellData[][] = opts.board ?? emptyBoard(config);
  // custom features keyed by id; built-ins live in FEATURES/FEATURE_LIST
  const custom = new Map<string, ReelFeature>();
  for (const f of opts.features ?? []) custom.set(f.key, f);
  const allFeatures = (): ReelFeature[] => {
    const seen = new Set<string>();
    const out: ReelFeature[] = [];
    for (const f of [...FEATURE_LIST, ...custom.values()]) {
      const eff = custom.get(f.key) ?? f; // a custom feature overrides a built-in with the same key
      if (seen.has(eff.key)) continue;
      seen.add(eff.key);
      out.push(eff);
    }
    return out;
  };
  const findFeature = (key: string): ReelFeature | undefined =>
    custom.get(key) ?? (FEATURES as Record<string, ReelFeature>)[key];

  function buildGrid(): void {
    if (grid) {
      spin?.skip();
      tumble?.skip();
      reelStepCtl?.skip();
      for (const child of fx?.children.slice() ?? []) Tween.killTweensOf(child);
      grid.destroy({ children: true });
    }
    grid = new ReelGrid({
      cols: config.grid.cols,
      rows: config.grid.rows,
      rowsPerReel: config.grid.rowsPerReel ?? effectiveRowsPerReel(config.grid),
      cellSize: config.grid.cellSize,
      cellWidth: config.grid.cellWidth,
      cellHeight: config.grid.cellHeight,
      cellSizePerReel: config.grid.cellSizePerReel,
      gap: config.grid.gap,
      colGap: config.grid.colGap,
      rowGap: config.grid.rowGap,
      resolve,
      frameStyle: config.grid.frameStyle,
      mask: config.grid.mask,
      decoration: config.grid.decoration?.padding
        ? { padding: config.grid.decoration.padding }
        : undefined,
    });
    fx = new Container();
    grid.addChild(fx);
    view.addChild(grid);
    spin = new SpinEngine(grid, resolve, config.motion, config.win);
    anticipation = new AnticipationController(config.anticipation);
    tumble = new TumbleController(grid, config.cascade, config.win);
    reelStepCtl = new ReelStepController(grid, resolve, config.cascade, config.win);
    grid.setGrid(board);
  }

  function geometryChanged(next: ReelSystemConfig): boolean {
    const a = config.grid,
      b = next.grid;
    return (
      a.cols !== b.cols ||
      a.rows !== b.rows ||
      a.cellSize !== b.cellSize ||
      a.cellWidth !== b.cellWidth ||
      a.cellHeight !== b.cellHeight ||
      a.gap !== b.gap ||
      a.mask !== b.mask ||
      JSON.stringify(a.cellSizePerReel) !== JSON.stringify(b.cellSizePerReel) ||
      JSON.stringify(a.colGap) !== JSON.stringify(b.colGap) ||
      JSON.stringify(a.rowGap) !== JSON.stringify(b.rowGap) ||
      JSON.stringify(a.rowsPerReel) !== JSON.stringify(b.rowsPerReel) ||
      (a.decoration?.padding ?? 0) !== (b.decoration?.padding ?? 0)
    );
  }

  function ctx(freeSpins?: boolean): FeatureContext {
    return { grid, resolve, cfg: config, fx, board, freeSpins, log };
  }

  buildGrid();

  const api: ReelSystem = {
    view,
    get grid() {
      return grid;
    },
    get fx() {
      return fx;
    },
    get config() {
      return config;
    },
    get board() {
      return board;
    },
    get ways() {
      return waysCount(config.grid);
    },

    setBoard(next) {
      board = next;
      // grow the board to the grid shape so feature code can index safely
      grid.setGrid(next);
    },

    setConfig(next) {
      const norm = normalizeGrid(next);
      const rebuild = geometryChanged(norm);
      config = norm;
      if (rebuild) buildGrid();
      else {
        spin.setConfig(config.motion);
        spin.setWin(config.win);
        anticipation.setConfig(config.anticipation);
        tumble.setConfig(config.cascade);
        tumble.setWin(config.win);
        reelStepCtl.setConfig(config.cascade);
        reelStepCtl.setWin(config.win);
      }
    },

    update(partial) {
      api.setConfig(mergeReelConfig(config, partial));
    },

    async spin(target, runOpts) {
      const data: SpinData = { targetGrid: target };
      const decision = anticipation.decide(target);
      let resetZoom: (() => Promise<void>) | null = null;
      if (decision.active) {
        log?.(`Anticipation on reels [${decision.reels.join(', ')}]`);
        resetZoom = await anticipation.zoomIn(grid);
      }
      await spin.run(data, {
        ...runOpts,
        anticipateReels: decision.active ? decision.reels : undefined,
        anticipateSlowdown: decision.slowdown,
        anticipateHoldMs: decision.holdMs,
      });
      if (resetZoom) await resetZoom();
      board = target;
    },

    get multiplier() {
      // cascade and reelStep share the same config start; only the active mechanic climbs.
      return Math.max(tumble.multiplier, reelStepCtl.multiplier);
    },

    async cascade(steps, cOpts) {
      // keep the multiplier climbing across free-spins when configured; otherwise reset per spin
      const persist = config.cascade.multiplier.persistInFreeSpins && !!cOpts?.freeSpins;
      if (!persist) tumble.resetMultiplier();
      for (let i = 0; i < steps.length; i++) {
        await tumble.step(steps[i], i, cOpts);
        board = steps[i].settledGrid;
        await cOpts?.onStep?.(i, steps[i], tumble.multiplier);
      }
      if (config.cascade.multiplier.enabled) log?.(`Cascade multiplier ×${tumble.multiplier}`);
    },

    async reelStep(steps, rOpts) {
      const persist = config.cascade.multiplier.persistInFreeSpins && !!rOpts?.freeSpins;
      if (!persist) reelStepCtl.resetMultiplier();
      for (let i = 0; i < steps.length; i++) {
        await reelStepCtl.step(steps[i], i, rOpts);
        board = steps[i].settledGrid;
        await rOpts?.onStep?.(i, steps[i], reelStepCtl.multiplier);
      }
      if (config.cascade.multiplier.enabled)
        log?.(`ReelStep multiplier ×${reelStepCtl.multiplier}`);
    },

    registerFeature(feature) {
      custom.set(feature.key, feature);
    },

    features() {
      return allFeatures();
    },

    enabledFeatures() {
      return allFeatures().filter((f) => f.enabled(config));
    },

    featureContext(fOpts) {
      return ctx(fOpts?.freeSpins);
    },

    async runFeature(key, fOpts) {
      const feature = findFeature(key);
      if (!feature) {
        log?.(`Unknown feature "${key}"`);
        return;
      }
      if (!feature.enabled(config)) {
        log?.(`${feature.label} is disabled`);
        return;
      }
      await feature.demo(ctx(fOpts?.freeSpins));
    },

    resize(cellSize) {
      config = mergeReelConfig(config, { grid: { cellSize } } as DeepPartial<ReelSystemConfig>);
      grid.resize(cellSize);
    },

    skip() {
      spin.skip();
      tumble.skip();
      reelStepCtl.skip();
      // kill in-flight overlay tweens (labels/rings) so a rebuild never animates destroyed nodes
      for (const child of fx.children.slice()) Tween.killTweensOf(child);
      fx.removeChildren().forEach((c) => c.destroy());
    },

    destroy() {
      api.skip();
      grid.destroy({ children: true });
      view.destroy({ children: true });
    },
  };

  return api;
}

function emptyBoard(cfg: ReelSystemConfig): CellData[][] {
  const rows = effectiveRowsPerReel(cfg.grid);
  return Array.from({ length: cfg.grid.cols }, (_, c) =>
    Array.from({ length: rows[c] }, () => ({ symbol: null as string | null })),
  );
}

export { DEFAULT_REEL_CONFIG };
