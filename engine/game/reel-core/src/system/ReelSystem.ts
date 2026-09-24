// engine/game/reel-core/src/system/ReelSystem.ts
//
// The pluggable reel system (slice 35). Ported from the legacy facade
// (packages/game-engine/src/slot/system/ReelSystem.ts), minus features, config hot-swap/geometry
// rebuild, the multiplier bookkeeping and `reelStep`: the core builds the grid and the overlay
// layer once and owns the board; motion styles, the anticipator and board controllers are
// REGISTERED into it (see ./contracts.ts) — the rows that provide them do the registering.

import { Container } from 'pixi.js';
import { Tween } from '@energy8platform/game-engine/animation';
import { ReelGrid } from '../grid/ReelGrid';
import type { CellData } from '../grid/SymbolCell';
import type { SymbolResolver } from '../grid/SymbolView';
import {
  DEFAULT_REEL_CONFIG,
  effectiveRowsPerReel,
  mergeReelConfig,
  type DeepPartial,
  type GridConfig,
  type MotionConfig,
  type WinConfig,
} from '../config/ReelSystemConfig';
import type { ReelStopPlan, SpinRunOpts } from '../motion/SpinEngine';
import type { AnticipationDecision } from '../motion/AnticipationController';
import type { TumbleStep } from '../cascade/TumbleController';
import type {
  Anticipator,
  BoardController,
  ControllerRunner,
  MotionRunner,
  MotionStyle,
  ReelKit,
  Registry,
  Report,
} from './contracts';

export interface CreateReelSystemOptions {
  resolve: SymbolResolver;
  grid?: DeepPartial<GridConfig>;
  win?: DeepPartial<WinConfig>;
  /** Initial board (board[col][row]); defaults to empty cells. */
  board?: CellData[][];
  log?: (message: string) => void;
  /** Where a missing/unknown motion style is reported. */
  report?: Report;
}

export interface ReelSystem {
  /** Root container — add this to your scene. */
  readonly view: Container;
  readonly grid: ReelGrid;
  /** Overlay layer above the grid (masked off) — draw bespoke rings/labels/sprites here. */
  readonly fx: Container;
  readonly config: { grid: GridConfig; win: WinConfig };
  /** Current board (board[col][row]). */
  readonly board: CellData[][];
  kit(): ReelKit;
  setBoard(board: CellData[][]): void;
  readonly motions: Registry<MotionStyle>;
  /** Picks the active style; resolved at spin time, so a style registered later still counts. */
  useMotion(key: string, config: MotionConfig): () => void;
  readonly anticipation: { set(a: Anticipator): () => void };
  readonly controllers: Registry<BoardController>;
  planSpin(target: CellData[][], opts?: SpinRunOpts): ReelStopPlan[];
  spin(target: CellData[][], opts?: SpinRunOpts): Promise<void>;
  /** One `tumble` round per step, through the registered `tumble` controller; throws `no reels-cascade row — a tumble step cannot play` without one. */
  cascade(steps: TumbleStep[], opts?: { turbo?: boolean }): Promise<void>;
  skip(opts?: { overlays?: boolean }): void;
  destroy(): void;
}

/** A `Map` in insertion order; re-registering a key replaces it, a disposer removes only its own entry. */
function createRegistry<T>(
  keyOf: (item: T) => string,
  onRemove: (key: string) => void,
): Registry<T> {
  const items = new Map<string, T>();
  return {
    register(item) {
      const key = keyOf(item);
      items.set(key, item);
      return () => {
        if (items.get(key) !== item) return;
        items.delete(key);
        onRemove(key);
      };
    },
    get: (key) => items.get(key),
    keys: () => [...items.keys()],
  };
}

export function createReelSystem(opts: CreateReelSystemOptions): ReelSystem {
  const grid = normalizeGrid(mergeReelConfig(DEFAULT_REEL_CONFIG.grid, opts.grid));
  const config = { grid, win: mergeReelConfig(DEFAULT_REEL_CONFIG.win, opts.win) };
  const { resolve, log, report } = opts;
  let board: CellData[][] = opts.board ?? emptyBoard(grid);
  let destroyed = false;

  // ── the grid + the overlay layer over it — built once (no rebuild path) ─────
  const view = new Container();
  const reelGrid = new ReelGrid({
    cols: grid.cols,
    rows: grid.rows,
    rowsPerReel: grid.rowsPerReel ?? effectiveRowsPerReel(grid),
    cellSize: grid.cellSize,
    cellWidth: grid.cellWidth,
    cellHeight: grid.cellHeight,
    cellSizePerReel: grid.cellSizePerReel,
    gap: grid.gap,
    colGap: grid.colGap,
    rowGap: grid.rowGap,
    resolve,
    frameStyle: grid.frameStyle,
    mask: grid.mask,
    decoration: grid.decoration?.padding ? { padding: grid.decoration.padding } : undefined,
  });
  const fx = new Container();
  reelGrid.addChild(fx);
  view.addChild(reelGrid);
  reelGrid.setGrid(board);

  function setBoard(next: CellData[][]): void {
    board = next;
    reelGrid.setGrid(next);
  }

  const kit: ReelKit = {
    grid: reelGrid,
    fx,
    resolve,
    win: config.win,
    get board() {
      return board;
    },
    setBoard,
    log,
  };

  // ── motion: the active `useMotion` pick, its runner created lazily and cached ─
  let active: { key: string; config: MotionConfig } | null = null;
  let motion: { style: MotionStyle; runner: MotionRunner } | null = null;
  // unregistering the style whose runner is cached skips and drops it (a `motion1` hot re-apply
  // unregisters its styles); the next spin resolves the key again
  const motions = createRegistry<MotionStyle>(
    (s) => s.key,
    (key) => {
      if (motion?.style.key === key) dropMotion();
    },
  );

  function dropMotion(): void {
    motion?.runner.skip();
    motion = null;
  }

  /** The runner for the active pick, or null (reported) when the reels must snap instead. */
  function motionRunner(): MotionRunner | null {
    if (!active) {
      report?.('warning', 'no motion row — the reels snap to the result');
      return null;
    }
    const style = motions.get(active.key);
    if (!style) {
      report?.(
        'error',
        `unknown motion style "${active.key}" — registered: ${motions.keys().join(', ') || 'none'}; the reels snap to the result`,
      );
      return null;
    }
    // a style re-registered under the same key gets a fresh runner
    if (motion?.style !== style) {
      dropMotion();
      motion = { style, runner: style.create(kit, active.config) };
    }
    return motion.runner;
  }

  // ── anticipation ──────────────────────────────────────────────────────────
  let anticipator: Anticipator | null = null;

  /**
   * Which reels get the anticipation treatment for this spin. An explicit `anticipateReels` on the
   * run options WINS over the anticipator's decision — passing it is how a game drives
   * anticipation from its own logic. Omit it and the anticipator (if any) decides.
   */
  function resolveAnticipation(target: CellData[][], runOpts?: SpinRunOpts): AnticipationDecision {
    const explicit = runOpts?.anticipateReels;
    const none: AnticipationDecision = {
      active: false,
      reels: [],
      slowdown: 1,
      holdMs: 0,
      cellStaggerRamp: 1,
    };
    if (!explicit) return anticipator ? anticipator.decide(target) : none;
    if (!explicit.length) return none;
    const cfg = anticipator?.config ?? DEFAULT_REEL_CONFIG.anticipation;
    return {
      active: true,
      reels: explicit.slice(),
      slowdown: runOpts?.anticipateSlowdown ?? cfg.slowdownFactor,
      holdMs: runOpts?.anticipateHoldMs ?? cfg.holdMs,
      cellStaggerRamp: runOpts?.anticipateCellStaggerRamp ?? cfg.progressiveCellStagger,
    };
  }

  /** Fold a resolved decision back onto the caller's run options (everything else passes through). */
  function mergeAnticipation(
    runOpts: SpinRunOpts | undefined,
    decision: AnticipationDecision,
  ): SpinRunOpts {
    return {
      ...runOpts,
      anticipateReels: decision.active ? decision.reels : undefined,
      anticipateSlowdown: decision.slowdown,
      anticipateHoldMs: decision.holdMs,
      anticipateCellStaggerRamp: decision.cellStaggerRamp,
    };
  }

  // ── board controllers: one runner per kind, dropped when its controller goes ─
  const runners = new Map<string, { ctl: BoardController; runner: ControllerRunner<unknown> }>();
  const controllers = createRegistry<BoardController>(
    (c) => c.kind,
    (kind) => {
      runners.get(kind)?.runner.skip();
      runners.delete(kind);
    },
  );
  function controllerRunner(kind: string): ControllerRunner<unknown> | null {
    const ctl = controllers.get(kind);
    if (!ctl) return null;
    let entry = runners.get(kind);
    // a controller re-registered under the same kind gets a fresh runner
    if (entry?.ctl !== ctl) {
      entry?.runner.skip();
      entry = { ctl, runner: ctl.create(kit) };
      runners.set(kind, entry);
    }
    return entry.runner;
  }

  function skip(skipOpts?: { overlays?: boolean }): void {
    if (destroyed) return;
    motion?.runner.skip();
    for (const { runner } of runners.values()) runner.skip();
    if (skipOpts?.overlays !== false) {
      // kill in-flight overlay tweens (labels/rings) before their targets are destroyed
      for (const child of fx.children.slice()) Tween.killTweensOf(child);
      fx.removeChildren().forEach((c) => c.destroy());
    }
  }

  return {
    view,
    grid: reelGrid,
    fx,
    config,
    get board() {
      return board;
    },
    kit: () => kit,
    setBoard,
    motions,

    useMotion(key, motionConfig) {
      const pick = { key, config: motionConfig };
      active = pick;
      dropMotion();
      return () => {
        if (active !== pick) return;
        active = null;
        dropMotion();
      };
    },

    anticipation: {
      set(a) {
        anticipator = a;
        return () => {
          if (anticipator === a) anticipator = null;
        };
      },
    },

    controllers,

    planSpin(target, runOpts) {
      if (destroyed || !active) return [];
      const runner = motions.get(active.key) ? motionRunner() : null;
      return runner
        ? runner.plan(target, mergeAnticipation(runOpts, resolveAnticipation(target, runOpts)))
        : [];
    },

    async spin(target, runOpts) {
      if (destroyed) return;
      const runner = motionRunner();
      if (!runner) {
        setBoard(target);
        return;
      }
      const decision = resolveAnticipation(target, runOpts);
      let resetZoom: (() => Promise<void>) | null = null;
      if (decision.active && anticipator) {
        log?.(`Anticipation on reels [${decision.reels.join(', ')}]`);
        resetZoom = await anticipator.zoomIn(reelGrid);
      }
      await runner.run(target, mergeAnticipation(runOpts, decision));
      if (resetZoom) await resetZoom();
      board = target;
    },

    async cascade(steps, cOpts) {
      if (destroyed) return;
      const runner = controllerRunner('tumble');
      if (!runner) throw new Error('no reels-cascade row — a tumble step cannot play');
      for (const step of steps) {
        await runner.run(step, cOpts);
        board = step.settledGrid;
      }
    },

    skip,

    destroy() {
      if (destroyed) return;
      skip();
      destroyed = true;
      view.destroy({ children: true });
    },
  };
}

/** Drop a `rowsPerReel` whose length does not match `cols` so geometry stays consistent. */
function normalizeGrid(grid: GridConfig): GridConfig {
  if (grid.rowsPerReel && grid.rowsPerReel.length !== grid.cols) {
    const next = { ...grid };
    delete next.rowsPerReel;
    return next;
  }
  return grid;
}

function emptyBoard(grid: GridConfig): CellData[][] {
  return effectiveRowsPerReel(grid).map((rows) =>
    Array.from({ length: rows }, () => ({ symbol: null as string | null })),
  );
}
