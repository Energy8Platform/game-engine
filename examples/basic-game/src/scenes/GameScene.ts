import { Container, Graphics, Text } from 'pixi.js';
import { Scene, Tween, Easing } from '@energy8platform/game-engine';

// Minimal, dependency-light demo scene: a 5×3 symbol grid that re-rolls on tap.
// It uses ONLY the engine core (Scene) + animation (Tween/Easing) — no UI components
// or StateMachine. For a real game, scaffold a slot project (`npm create @energy8platform/slot`).

const SYMBOLS = [
  { color: 0xe74c3c, label: '🍒' },
  { color: 0xf1c40f, label: '🍋' },
  { color: 0x9b59b6, label: '🍇' },
  { color: 0xf39c12, label: '🔔' },
  { color: 0xe74c3c, label: '7' },
  { color: 0x3498db, label: '💎' },
  { color: 0xffd700, label: '⭐' },
];

const COLS = 5;
const ROWS = 3;
const CELL = 120;
const GAP = 6;

export class GameScene extends Scene {
  private _bg = new Graphics();
  private _reels = new Container();
  private _hint!: Text;
  private _grid: Container[][] = [];
  private _spinning = false;
  private _viewW = 0;
  private _viewH = 0;

  override async onEnter(): Promise<void> {
    this.container.addChild(this._bg);
    this.container.addChild(this._reels);

    for (let col = 0; col < COLS; col++) {
      this._grid[col] = [];
      for (let row = 0; row < ROWS; row++) {
        const cell = this.makeCell(this.randomSymbol());
        this._reels.addChild(cell);
        this._grid[col][row] = cell;
      }
    }
    this.positionGrid();

    this._hint = new Text({
      text: 'TAP TO SPIN',
      style: { fontFamily: 'sans-serif', fontSize: 28, fill: 0xffffff, fontWeight: '700', letterSpacing: 4 },
    });
    this._hint.anchor.set(0.5);
    this.container.addChild(this._hint);

    this.container.eventMode = 'static';
    this.container.on('pointertap', () => void this.spin());
  }

  override onResize(width: number, height: number): void {
    this._viewW = width;
    this._viewH = height;

    this._bg.clear();
    this._bg.rect(0, 0, width, height).fill(0x0f0f23);
    this._bg.circle(width / 2, height * 0.42, 400).fill({ color: 0x1a1a4a, alpha: 0.35 });

    const gridW = COLS * CELL + (COLS - 1) * GAP;
    const gridH = ROWS * CELL + (ROWS - 1) * GAP;
    const fit = Math.min((width * 0.9) / gridW, (height * 0.7) / gridH, 1);
    this._reels.scale.set(fit);
    this._reels.x = width / 2;
    this._reels.y = height / 2;

    this._hint.position.set(width / 2, height - 60);
  }

  private async spin(): Promise<void> {
    if (this._spinning) return;
    this._spinning = true;
    this._hint.alpha = 0.3;

    const cols: Promise<void>[] = [];
    for (let col = 0; col < COLS; col++) cols.push(this.spinColumn(col, col * 120));
    await Promise.all(cols);

    this._hint.alpha = 1;
    this._spinning = false;
  }

  private async spinColumn(col: number, delay: number): Promise<void> {
    if (delay > 0) await Tween.delay(delay);
    for (let row = 0; row < ROWS; row++) {
      const old = this._grid[col][row];
      const next = this.makeCell(this.randomSymbol());
      next.position.set(old.x, old.y);
      next.alpha = 0;
      next.scale.set(0.5);
      this._reels.removeChild(old);
      old.destroy();
      this._reels.addChild(next);
      this._grid[col][row] = next;
      await Tween.to(next, { alpha: 1, 'scale.x': 1, 'scale.y': 1 }, 200, Easing.easeOutBack);
    }
  }

  private positionGrid(): void {
    const totalW = COLS * CELL + (COLS - 1) * GAP;
    const totalH = ROWS * CELL + (ROWS - 1) * GAP;
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const cell = this._grid[col][row];
        cell.x = -totalW / 2 + col * (CELL + GAP) + CELL / 2;
        cell.y = -totalH / 2 + row * (CELL + GAP) + CELL / 2;
      }
    }
  }

  private makeCell(idx: number): Container {
    const sym = SYMBOLS[idx];
    const cell = new Container();
    const bg = new Graphics();
    bg.roundRect(-CELL / 2, -CELL / 2, CELL, CELL, 12).fill({ color: 0x1a1a3e, alpha: 0.9 });
    bg.roundRect(-CELL / 2, -CELL / 2, CELL, CELL, 12).stroke({ color: 0x2a2a5a, width: 1 });
    cell.addChild(bg);
    const text = new Text({
      text: sym.label,
      style: { fontFamily: 'sans-serif', fontSize: sym.label.length > 1 ? 40 : 56, fill: sym.color, fontWeight: 'bold' },
    });
    text.anchor.set(0.5);
    cell.addChild(text);
    return cell;
  }

  private randomSymbol(): number {
    return Math.floor(Math.random() * SYMBOLS.length);
  }
}
