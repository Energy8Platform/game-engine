// packages/game-engine/src/slot/motion/SpinEngine.ts
//
// Configurable spin motion. Supports three styles — 'swap' (texture-swap ring),
// 'strip' (a tape of symbols slides past a masked window) and 'cascade-drop'
// (symbols drop in from above) — plus stop modes, turbo/intensity scaling, motion
// blur, settle-bounce, squash-on-impact and slam (quick) stop.
//
// Presentation only: the landing grid is the already-resolved outcome. The engine
// never re-rolls a result.

import { BlurFilter, Container } from 'pixi.js';
import { Tween } from '../../animation';
import { EASING_BY_NAME, easingByName } from '../anim/easing-map';
import type { ReelGrid } from '../grid/ReelGrid';
import { SymbolCell, type CellData } from '../grid/SymbolCell';
import type { SymbolResolver } from '../grid/SymbolView';
import {
  DEFAULT_REEL_CONFIG,
  INTENSITY_SCALE,
  perReelValue,
  type MotionConfig,
  type PerReel,
  type WinConfig,
} from '../config/ReelSystemConfig';

export interface SpinData {
  /** Target board: targetGrid[col][row]. */
  targetGrid: CellData[][];
  /** Optional per-reel symbol tape for the spinning illusion (defaults to random of the landing symbols). */
  strip?: (reel: number) => string[];
}

export interface SpinRunOpts {
  turbo?: boolean;
  /** Reels to slow for anticipation (computed by the ReelSystem from config + targetGrid). */
  anticipateReels?: number[];
  /** Speed factor for anticipated reels (lower = slower). Scalar, or per-reel indexed by reel. */
  anticipateSlowdown?: PerReel<number>;
  /** Extra hold (ms) for anticipated reels. Scalar, or per-reel indexed by reel. */
  anticipateHoldMs?: PerReel<number>;
  /**
   * Reels whose tape runs normally but whose landing is NOT handed back. The engine stops and
   * disposes of the tape as usual and leaves the real cells hidden and unseated; the caller owns
   * their data and visibility from that point (and `skip()` will not reveal them either).
   */
  deferReveal?: number[];

  // ── lifecycle ────────────────────────────────────────────────────────────
  /** The resolved schedule, handed over before the first frame runs. Schedule against THESE
   *  numbers rather than re-deriving `plan()`'s formula. */
  onPlan?: (plan: ReelStopPlan[]) => void;
  /** Fires on the frame a reel lands — after its cells are seated, before settle/squash/shake.
   *  For a deferred reel it still fires (the reel DID stop); nothing was seated. */
  onReelStop?: (reel: number, plan: ReelStopPlan) => void;
  /** Fires as each cell takes its landing symbol. In `cascade-drop` this is the per-cell impact
   *  frame (after the fall, before the squash) — the hook for a per-cell sound or shake. */
  onCellSeated?: (reel: number, row: number, data: CellData) => void;
}

export interface ReelStopPlan {
  reel: number;
  /** Wall-clock time (ms) from spin start when this reel stops. */
  stopTime: number;
  landing: CellData[];
  settle: { amp: number; ms: number };
  anticipated: boolean;
  /** Time-stretch applied to this reel's tape (>= 1, longer = slower). 1 when not anticipated. */
  slowdown: number;
  /** True when `deferReveal` withheld this reel's landing (see `SpinRunOpts.deferReveal`). */
  deferred: boolean;
}

export class SpinEngine {
  private _grid: ReelGrid;
  private _resolve: SymbolResolver;
  private _cfg: MotionConfig;
  private _win: WinConfig = DEFAULT_REEL_CONFIG.win;
  private _killed = false;
  private _shaking = false;
  private _temp: Container[] = [];
  private _deferred = new Set<number>();

  constructor(grid: ReelGrid, resolve: SymbolResolver, cfg: MotionConfig, win?: WinConfig) {
    this._grid = grid;
    this._resolve = resolve;
    this._cfg = cfg;
    if (win) this._win = win;
  }

  setConfig(cfg: MotionConfig): void {
    this._cfg = cfg;
  }
  setWin(win: WinConfig): void {
    this._win = win;
  }

  /** Quick decaying frame shake when a landed reel carries a configured trigger symbol. */
  private async _frameShake(landing: CellData[]): Promise<void> {
    const fs = this._win.frameShake;
    if (!fs.enabled || this._shaking || this._killed) return;
    const triggers = fs.onlyOnSymbols;
    if (triggers && !landing.some((c) => c.symbol && triggers.includes(c.symbol))) return;
    this._shaking = true;
    const baseX = this._grid.x;
    const amp = fs.amp * INTENSITY_SCALE[this._cfg.intensity];
    const steps = 4;
    for (let i = 0; i < steps && !this._killed; i++) {
      const a = amp * (1 - i / steps) * (i % 2 ? -1 : 1);
      await Tween.to(
        this._grid,
        { x: baseX + a },
        fs.ms / (steps + 1),
        EASING_BY_NAME['easeOutQuad'],
      );
    }
    if (!this._killed && !this._grid.destroyed) this._grid.x = baseX;
    this._shaking = false;
  }

  private scale(opts?: SpinRunOpts): number {
    const turbo = opts?.turbo ? this._cfg.turboFactor : 1;
    return turbo * INTENSITY_SCALE[this._cfg.intensity];
  }

  /** PURE: per-reel stop schedule. No Pixi mutation. */
  plan(data: SpinData, opts?: SpinRunOpts): ReelStopPlan[] {
    const f = this.scale(opts);
    const cols = this._grid.cols;
    const order = (reel: number) => (this._cfg.stopOrder === 'rtl' ? cols - 1 - reel : reel);
    const anticipate = new Set(opts?.anticipateReels ?? []);
    const defer = new Set(opts?.deferReveal ?? []);
    const out: ReelStopPlan[] = [];
    for (let reel = 0; reel < cols; reel++) {
      const idx = order(reel);
      let stopTime: number;
      if (this._cfg.stopMode === 'sync') stopTime = (this._cfg.spinUp + this._cfg.hold) * f;
      else if (this._cfg.stopMode === 'random')
        stopTime =
          (this._cfg.spinUp +
            this._cfg.hold +
            idx * this._cfg.stopStagger * (0.4 + (reel % 3) * 0.3)) *
          f;
      else stopTime = (this._cfg.spinUp + this._cfg.hold + idx * this._cfg.stopStagger) * f;

      const isAnticipated = anticipate.has(reel);
      if (isAnticipated) stopTime += perReelValue(opts?.anticipateHoldMs, reel, 0) * f;
      const speed = isAnticipated ? perReelValue(opts?.anticipateSlowdown, reel, 1) : 1;

      out.push({
        reel,
        stopTime,
        landing: data.targetGrid[reel] ?? [],
        settle: { amp: this._cfg.settle.amp, ms: this._cfg.settle.ms * f },
        anticipated: isAnticipated,
        slowdown: Math.max(1, 1 / (speed || 1)),
        deferred: defer.has(reel),
      });
    }
    return out;
  }

  /** Execute the spin for every reel concurrently. */
  async run(data: SpinData, opts?: SpinRunOpts): Promise<void> {
    this._killed = false;
    this._temp = [];
    const plan = this.plan(data, opts);
    // remembered for skip(): a deferred reel's cells belong to the caller, not to us
    this._deferred = new Set(plan.filter((p) => p.deferred).map((p) => p.reel));
    opts?.onPlan?.(plan);
    const f = this.scale(opts);
    await Promise.all(plan.map((p) => this._runReel(p, data, opts, f)));
    this._cleanupTemp();
  }

  private async _runReel(
    p: ReelStopPlan,
    data: SpinData,
    opts: SpinRunOpts | undefined,
    f: number,
  ): Promise<void> {
    if (this._killed) return;
    switch (this._cfg.style) {
      case 'strip':
        return this._runStrip(p, data, opts, f);
      case 'cascade-drop':
        return this._runDrop(p, opts, f);
      case 'swap':
      default:
        return this._runSwap(p, data, opts, f);
    }
  }

  /** Anticipation time-stretch factor for a reel (>=1, longer = slower). Resolved in `plan()`. */
  private slowOf(p: ReelStopPlan): number {
    return p.slowdown;
  }

  // ── swap: cycle symbols quickly in the real cells, then land ──────────────
  private async _runSwap(
    p: ReelStopPlan,
    data: SpinData,
    opts: SpinRunOpts | undefined,
    f: number,
  ): Promise<void> {
    const rows = this._grid.rowsOf(p.reel);
    const cells = Array.from({ length: rows }, (_, r) => this._grid.getCell(p.reel, r));
    const strip = data.strip?.(p.reel) ?? p.landing.map((c) => c.symbol ?? '').filter(Boolean);
    const tape = strip.length ? strip : ['?'];
    const blur = this._applyBlur(cells, true);
    const tickMs = 1000 / 30;
    // anticipation makes the reel spin longer before it lands
    const ticks = Math.max(6, Math.floor((p.stopTime * this.slowOf(p)) / tickMs));
    for (let i = 0; i < ticks; i++) {
      if (this._killed) break;
      for (let r = 0; r < cells.length; r++)
        cells[r].setData({ symbol: tape[(i + r) % tape.length] || null });
      await Tween.delay(tickMs);
    }
    blur?.();
    if (p.deferred) {
      // the caller owns this reel's result — go dark and unseated instead of handing it back.
      // NB 'swap' cycles the tape THROUGH the real cells, so a deferred reel only truly withholds
      // its result when `SpinData.strip` supplies filler for it; otherwise the tape is built from
      // the landing symbols. 'strip' and 'cascade-drop' have no such caveat.
      cells.forEach((c) => {
        c.setData({ symbol: null });
        c.visible = false;
      });
      opts?.onReelStop?.(p.reel, p);
      return;
    }
    for (let r = 0; r < cells.length; r++) {
      const cell = p.landing[r] ?? { symbol: null };
      cells[r].setData(cell);
      opts?.onCellSeated?.(p.reel, r, cell);
    }
    opts?.onReelStop?.(p.reel, p);
    await this._settle(p.reel, p.settle, f);
    await this._frameShake(p.landing);
  }

  // ── strip: a tape Container slides down past the window, then lands ────────
  private async _runStrip(
    p: ReelStopPlan,
    data: SpinData,
    opts: SpinRunOpts | undefined,
    f: number,
  ): Promise<void> {
    const rows = this._grid.rowsOf(p.reel);
    const realCells = Array.from({ length: rows }, (_, r) => this._grid.getCell(p.reel, r));
    const base = this._grid.cellPosition(p.reel, 0);
    const step = this._grid.cellPosition(p.reel, 1).y - base.y;
    const tapeLen = Math.max(this._cfg.symbolsPerReel, rows + 4);
    const strip = data.strip?.(p.reel) ?? p.landing.map((c) => c.symbol ?? '').filter(Boolean);
    const pool = strip.length ? strip : ['?'];

    // Tape cells laid out top→bottom at local y = i*step. The bottom `rows` cells carry the
    // landing symbols; everything above is filler.
    const tape = new Container();
    tape.x = base.x;
    const landingStart = tapeLen - rows;
    for (let i = 0; i < tapeLen; i++) {
      const cell = new SymbolCell({ size: this._grid.cellSize(p.reel), resolve: this._resolve });
      const sym =
        i >= landingStart
          ? (p.landing[i - landingStart]?.symbol ?? null)
          : (pool[i % pool.length] ?? null);
      cell.setData({ symbol: sym });
      cell.position.set(0, i * step);
      tape.addChild(cell);
    }
    // At rest the bottom block aligns with the window; start shifted up by the whole tape.
    const restY = base.y - landingStart * step;
    const startY = restY - tapeLen * step;
    tape.y = startY;
    realCells.forEach((c) => (c.visible = false));
    this._grid.addChild(tape);
    this._temp.push(tape);
    const clearBlur = this._applyBlur([tape], true);

    const slow = this.slowOf(p);
    // overshoot/settle honour the configured settle (amp in px, easing)
    const overshoot = p.settle.amp || step * 0.18;
    await Tween.to(
      tape,
      { y: restY + overshoot },
      p.stopTime * slow,
      easingByName('easeInOutQuad'),
    );
    if (this._killed) {
      clearBlur?.();
      return;
    }
    clearBlur?.();
    await Tween.to(
      tape,
      { y: restY },
      Math.max(120, p.settle.ms),
      easingByName(this._cfg.settle.easing),
    );
    // hand the result back to the real cells — unless the caller deferred the reveal, in which
    // case the tape simply goes away and the reel is left dark, unseated and owned by the caller
    if (!p.deferred) {
      for (let r = 0; r < rows; r++) {
        const cell = p.landing[r] ?? { symbol: null };
        realCells[r].setData(cell);
        opts?.onCellSeated?.(p.reel, r, cell);
      }
      realCells.forEach((c) => (c.visible = true));
    }
    tape.destroy();
    this._temp = this._temp.filter((t) => t !== tape);
    opts?.onReelStop?.(p.reel, p);
    if (p.deferred) return;
    // squash the real cells on impact when enabled
    if (this._cfg.squash.enabled) await Promise.all(realCells.map((c) => this._squashCell(c, f)));
    await this._frameShake(p.landing);
  }

  // ── cascade-drop: symbols drop in from above with stagger + bounce + squash ─
  private async _runDrop(p: ReelStopPlan, opts: SpinRunOpts | undefined, f: number): Promise<void> {
    const rows = this._grid.rowsOf(p.reel);
    if (p.deferred) {
      // nothing to drop — the caller brings this reel in itself
      for (let r = 0; r < rows; r++) this._grid.getCell(p.reel, r).visible = false;
      opts?.onReelStop?.(p.reel, p);
      return;
    }
    const step = this._grid.cellPosition(p.reel, 1).y - this._grid.cellPosition(p.reel, 0).y;
    const slow = this.slowOf(p); // anticipation drops the reel in more slowly
    await Promise.all(
      Array.from({ length: rows }, (_, r) => r).map(async (r) => {
        if (this._killed) return;
        const cell = this._grid.getCell(p.reel, r);
        const to = this._grid.cellPosition(p.reel, r);
        const data = p.landing[r] ?? { symbol: null };
        cell.setData(data);
        cell.position.set(to.x, to.y - step * (rows + 1));
        cell.alpha = 1;
        const delay =
          (p.reel * this._cfg.stopStagger * this._cfg.reelStaggerFactor +
            r * this._cfg.cellStagger) *
          f *
          slow;
        if (delay) await Tween.delay(delay);
        await Tween.to(
          cell,
          { 'position.y': to.y },
          this._cfg.spinUp * this._cfg.dropFallFactor * f * slow,
          easingByName(this._cfg.settle.easing),
        );
        // the impact frame — fired before the squash so a game can sync its own hit feedback
        opts?.onCellSeated?.(p.reel, r, data);
        await this._squashCell(cell, f);
      }),
    );
    opts?.onReelStop?.(p.reel, p);
    await this._frameShake(p.landing);
  }

  // ── shared helpers ────────────────────────────────────────────────────────
  private async _settle(
    reel: number,
    settle: { amp: number; ms: number },
    f: number,
  ): Promise<void> {
    if (this._killed || settle.amp <= 0) return;
    const cells = Array.from({ length: this._grid.rowsOf(reel) }, (_, r) =>
      this._grid.getCell(reel, r),
    );
    const parent = cells[0]?.parent;
    if (!parent) return;
    // bounce the whole reel column by moving each cell, then squash the impact
    await Promise.all(
      cells.map((c) => {
        const y = c.y;
        return Tween.fromTo(
          c,
          { y: y - settle.amp },
          { y },
          settle.ms,
          EASING_BY_NAME[this._cfg.settle.easing] ?? EASING_BY_NAME['easeOutBack'],
        );
      }),
    );
    if (this._cfg.squash.enabled) await Promise.all(cells.map((c) => this._squashCell(c, f)));
  }

  private async _squashCell(cell: SymbolCell, f: number): Promise<void> {
    if (!this._cfg.squash.enabled || this._killed) return;
    const { scaleX, scaleY, ms } = this._cfg.squash;
    await Tween.to(
      cell,
      { 'scale.x': scaleX, 'scale.y': scaleY },
      ms * 0.5 * f,
      EASING_BY_NAME['easeOutQuad'],
    );
    await Tween.to(
      cell,
      { 'scale.x': 1, 'scale.y': 1 },
      ms * 0.5 * f,
      EASING_BY_NAME['easeOutBack'],
    );
  }

  /** Apply motion blur (alpha + optional BlurFilter) to targets; returns a disposer that clears it. */
  private _applyBlur(targets: Container[], _motion: boolean): (() => void) | null {
    if (!this._cfg.blur.enabled) return null;
    const filter =
      this._cfg.blur.strength > 0
        ? new BlurFilter({ strength: this._cfg.blur.strength, quality: 2 })
        : null;
    for (const t of targets) {
      t.alpha = this._cfg.blur.alpha;
      if (filter) t.filters = [filter];
    }
    return () => {
      for (const t of targets) {
        t.alpha = 1;
        t.filters = [];
      }
      filter?.destroy();
    };
  }

  private _cleanupTemp(): void {
    for (const t of this._temp) {
      if (!t.destroyed) t.destroy();
    }
    this._temp = [];
  }

  /** Slam / quick stop: snap everything to the target and stop animating. */
  skip(): void {
    if (!this._cfg.slamStop && !this._killed) {
      // even without slam, skip() is the hard-cancel path
    }
    this._killed = true;
    this._shaking = false;
    this._cleanupTemp();
    if (this._grid.destroyed) return;
    Tween.killTweensOf(this._grid);
    this._grid.x = 0; // undo any in-flight frame shake
    for (let c = 0; c < this._grid.cols; c++) {
      // a deferred reel's visibility belongs to the caller — a slam stop must not reveal it
      const deferred = this._deferred.has(c);
      for (let r = 0; r < this._grid.rowsOf(c); r++) {
        const cell = this._grid.getCell(c, r);
        if (cell.destroyed) continue;
        Tween.killTweensOf(cell);
        if (!deferred) {
          cell.visible = true;
          cell.alpha = 1;
        }
        cell.filters = [];
        cell.scale.set(1);
      }
    }
    this._cleanupTemp();
  }
}
