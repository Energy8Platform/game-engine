import { Container, Graphics, Text } from 'pixi.js';
import {
  Scene,
  FlexContainer,
  Button,
  Label,
  Panel,
  Modal,
  ProgressBar,
  BalanceDisplay,
  WinDisplay,
  Toast,
  Layout,
  ScrollContainer,
  StateMachine,
  Tween,
  Easing,
} from '@energy8platform/game-engine';

// ─── Symbol definitions ──────────────────────────────────

const SYMBOLS = [
  { name: 'cherry', color: 0xe74c3c, label: '🍒', pay3: 5, pay4: 15, pay5: 50 },
  { name: 'lemon', color: 0xf1c40f, label: '🍋', pay3: 5, pay4: 15, pay5: 50 },
  { name: 'grape', color: 0x9b59b6, label: '🍇', pay3: 8, pay4: 25, pay5: 80 },
  { name: 'bell', color: 0xf39c12, label: '🔔', pay3: 10, pay4: 30, pay5: 100 },
  { name: 'seven', color: 0xe74c3c, label: '7', pay3: 20, pay4: 75, pay5: 250 },
  { name: 'bar', color: 0x2ecc71, label: 'BAR', pay3: 15, pay4: 50, pay5: 150 },
  { name: 'diamond', color: 0x3498db, label: '💎', pay3: 25, pay4: 100, pay5: 500 },
  { name: 'star', color: 0xffd700, label: '⭐', pay3: 50, pay4: 200, pay5: 1000 },
];

const COLS = 5;
const ROWS = 3;
const CELL_SIZE = 120;
const CELL_GAP = 6;

interface GameContext {
  balance: number;
  bet: number;
  betIndex: number;
  lastWin: number;
  totalSpins: number;
}

/**
 * Slot game scene — showcases every engine UI component:
 *
 * FlexContainer  — top bar, bottom bar, modal internals
 * Layout         — spin counter (anchored top-right)
 * Button         — spin, bet+/-, paytable, auto, settings, modal close
 * Label          — bet display, modal titles, paytable text
 * Panel          — settings card, paytable header
 * Modal          — settings dialog, paytable dialog
 * ProgressBar    — volume sliders in settings
 * BalanceDisplay — top-left balance
 * WinDisplay     — top-right win presentation
 * Toast          — spin feedback, notifications
 * ScrollContainer— paytable symbol list
 */
export class GameScene extends Scene {
  // Containers
  private _topBar!: FlexContainer;
  private _reelArea!: Container;
  private _bottomBar!: FlexContainer;
  private _spinCounter!: Layout;

  // Components
  private _balance!: BalanceDisplay;
  private _winDisplay!: WinDisplay;
  private _betLabel!: Label;
  private _spinButton!: Button;
  private _toast!: Toast;
  private _spinCountLabel!: Label;

  // Modals
  private _settingsModal!: Modal;
  private _paytableModal!: Modal;
  private _musicBar!: ProgressBar;
  private _sfxBar!: ProgressBar;

  // State
  private _fsm!: StateMachine<GameContext>;
  private _engine: any = null;
  private _grid: Container[][] = [];
  private _reelBg!: Graphics;
  private _viewW = 0;
  private _viewH = 0;

  private readonly _betLevels = [0.20, 0.50, 1, 2, 5, 10, 20];

  override async onEnter(data?: unknown): Promise<void> {
    if (data && typeof data === 'object' && 'engine' in (data as any)) {
      this._engine = (data as any).engine;
    }

    this.createUI();
    this.createSettingsModal();
    this.createPaytableModal();
    this.createStateMachine();

    const sdkBalance = this._engine?.initData?.balance;
    if (sdkBalance != null) {
      this._balance.setValue(sdkBalance);
      this._fsm.context.balance = sdkBalance;
    }

    this._engine?.input?.on('keydown', ({ key }: { key: string }) => {
      if (key === ' ') this.onSpin();
    });

    await this._fsm.start('idle');
  }

  override onUpdate(dt: number): void {
    this._fsm?.update(dt);
    this._musicBar?.update(dt);
    this._sfxBar?.update(dt);
  }

  override onResize(width: number, height: number): void {
    if (!this._fsm) return;
    this._viewW = width;
    this._viewH = height;
    this.layoutUI(width, height);
  }

  // ═══════════════════════════════════════════════════════════
  // UI Creation
  // ═══════════════════════════════════════════════════════════

  private createUI(): void {
    // Background
    const bg = new Graphics();
    bg.label = 'background';
    this.container.addChild(bg);

    // ── Top bar: balance (left) + win display (right) ──
    this._topBar = new FlexContainer({
      direction: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: [12, 24, 12, 24],
    });

    this._balance = new BalanceDisplay({
      prefix: 'BALANCE',
      currency: 'USD',
      animated: true,
      animationDuration: 400,
      style: { fontSize: 14 },
    });

    this._winDisplay = new WinDisplay({
      currency: 'USD',
      countupDuration: 1200,
      style: { fontSize: 32, stroke: { color: 0x000000, width: 2 } },
    });

    this._topBar.addFlexChild(this._balance);
    this._topBar.addFlexChild(this._winDisplay);
    this.container.addChild(this._topBar);

    // ── Reel area ──
    this._reelArea = new Container();
    this._reelBg = new Graphics();
    this._reelArea.addChild(this._reelBg);
    this.createReelGrid();
    this.container.addChild(this._reelArea);

    // ── Spin counter — Layout with anchor (top-right) ──
    this._spinCounter = new Layout({
      direction: 'horizontal',
      gap: 8,
      alignment: 'center',
      anchor: 'top-right',
      padding: [8, 16, 8, 16],
    });
    this._spinCountLabel = new Label({
      text: 'SPINS: 0',
      style: { fontSize: 14, fill: 0x888888 },
    });
    this._spinCounter.addItem(this._spinCountLabel);
    this.container.addChild(this._spinCounter);

    // ── Bottom bar: [paytable] [bet-] [bet label] [bet+] [SPIN] [auto] [settings] ──
    this._bottomBar = new FlexContainer({
      direction: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 12,
      padding: [12, 24, 12, 24],
    });

    const paytableBtn = new Button({
      width: 50, height: 50, borderRadius: 25,
      colors: { default: 0x334455, hover: 0x445566, pressed: 0x223344, disabled: 0x222222 },
      text: 'i',
      textStyle: { fontSize: 22, fontStyle: 'italic' },
      onPress: () => this.openPaytable(),
    });

    const betMinus = new Button({
      width: 50, height: 50, borderRadius: 25,
      colors: { default: 0x444444, hover: 0x555555, pressed: 0x333333, disabled: 0x222222 },
      text: '-',
      textStyle: { fontSize: 28 },
      onPress: () => this.changeBet(-1),
    });

    this._betLabel = new Label({
      text: 'BET: $1.00',
      style: { fontSize: 18, fill: 0xcccccc, fontWeight: 'bold' },
    });

    const betPlus = new Button({
      width: 50, height: 50, borderRadius: 25,
      colors: { default: 0x444444, hover: 0x555555, pressed: 0x333333, disabled: 0x222222 },
      text: '+',
      textStyle: { fontSize: 28 },
      onPress: () => this.changeBet(1),
    });

    this._spinButton = new Button({
      width: 140, height: 60, borderRadius: 30,
      colors: { default: 0x22aa44, hover: 0x33cc55, pressed: 0x1a8833, disabled: 0x333333 },
      pressScale: 0.92,
      text: 'SPIN',
      textStyle: { fontSize: 22, letterSpacing: 3 },
      onPress: () => this.onSpin(),
    });

    const autoBtn = new Button({
      width: 50, height: 50, borderRadius: 25,
      colors: { default: 0x334455, hover: 0x445566, pressed: 0x223344, disabled: 0x222222 },
      text: 'A',
      textStyle: { fontSize: 18 },
      onPress: () => this._toast.show('Auto-spin coming soon', 'warning', this._viewW, this._viewH),
    });

    const settingsBtn = new Button({
      width: 50, height: 50, borderRadius: 25,
      colors: { default: 0x334455, hover: 0x445566, pressed: 0x223344, disabled: 0x222222 },
      text: '⚙',
      textStyle: { fontSize: 22 },
      onPress: () => this.openSettings(),
    });

    this._bottomBar.addFlexChild(paytableBtn);
    this._bottomBar.addFlexChild(betMinus);
    this._bottomBar.addFlexChild(this._betLabel);
    this._bottomBar.addFlexChild(betPlus);
    this._bottomBar.addFlexChild(this._spinButton);
    this._bottomBar.addFlexChild(autoBtn);
    this._bottomBar.addFlexChild(settingsBtn);
    this.container.addChild(this._bottomBar);

    // Toast overlay (on top of everything except modals)
    this._toast = new Toast({ duration: 2000 });
    this.container.addChild(this._toast);
  }

  // ═══════════════════════════════════════════════════════════
  // Settings Modal — Panel + ProgressBar + Button
  // ═══════════════════════════════════════════════════════════

  private createSettingsModal(): void {
    this._settingsModal = new Modal({
      overlayAlpha: 0.75,
      closeOnOverlay: true,
      animationDuration: 250,
    });
    this._settingsModal.onClose = () => {
      this._toast.show('Settings saved', 'success', this._viewW, this._viewH);
    };

    // Card panel
    const card = new Panel({
      width: 420,
      height: 360,
      backgroundColor: 0x1a1a2e,
      borderRadius: 20,
      borderColor: 0x3a3a5e,
      borderWidth: 2,
      padding: 28,
      layout: { direction: 'column', gap: 20, alignItems: 'center' },
    });

    // Title
    const title = new Label({
      text: 'SETTINGS',
      style: { fontSize: 28, fill: 0xffd700, fontWeight: 'bold', letterSpacing: 4 },
    });
    card.addContent(title);

    // Music volume row
    const musicRow = this.createVolumeRow('MUSIC', 0.5);
    this._musicBar = musicRow.bar;
    card.addContent(musicRow.container);

    // SFX volume row
    const sfxRow = this.createVolumeRow('SFX', 1.0);
    this._sfxBar = sfxRow.bar;
    card.addContent(sfxRow.container);

    // Separator
    const sep = new Graphics();
    sep.rect(0, 0, 360, 1).fill({ color: 0x3a3a5e, alpha: 0.5 });
    card.addContent(sep);

    // Close button
    const closeBtn = new Button({
      width: 160, height: 44, borderRadius: 22,
      colors: { default: 0x3a3a6e, hover: 0x4a4a7e, pressed: 0x2a2a5e, disabled: 0x222222 },
      text: 'CLOSE',
      textStyle: { fontSize: 16, letterSpacing: 2 },
      onPress: () => this._settingsModal.hide(),
    });
    card.addContent(closeBtn);

    this._settingsModal.content.addChild(card);
    card.x = -210;
    card.y = -180;

    this.container.addChild(this._settingsModal);
  }

  private createVolumeRow(label: string, initialValue: number): { container: FlexContainer; bar: ProgressBar } {
    const row = new FlexContainer({
      direction: 'row',
      alignItems: 'center',
      gap: 16,
    });

    const lbl = new Label({
      text: label,
      style: { fontSize: 16, fill: 0xaaaaaa },
    });

    const bar = new ProgressBar({
      width: 220,
      height: 12,
      borderRadius: 6,
      fillColor: 0xffd700,
      trackColor: 0x2a2a4a,
      borderColor: 0x3a3a5e,
      borderWidth: 1,
      animated: true,
      animationSpeed: 0.15,
    });
    bar.progress = initialValue;

    // Tap to change volume
    bar.eventMode = 'static';
    bar.cursor = 'pointer';
    bar.on('pointertap', (e: any) => {
      const local = e.getLocalPosition(bar);
      bar.progress = Math.max(0, Math.min(1, local.x / 220));
    });

    row.addFlexChild(lbl);
    row.addFlexChild(bar);
    row.updateLayout();

    return { container: row, bar };
  }

  // ═══════════════════════════════════════════════════════════
  // Paytable Modal — ScrollContainer + Panel + Label
  // ═══════════════════════════════════════════════════════════

  private createPaytableModal(): void {
    this._paytableModal = new Modal({
      overlayAlpha: 0.8,
      closeOnOverlay: true,
      animationDuration: 300,
    });

    const wrapper = new Container();

    // Header panel
    const header = new Panel({
      width: 500,
      height: 60,
      backgroundColor: 0x1a1a3e,
      borderRadius: 16,
      padding: 12,
      layout: { direction: 'row', justifyContent: 'center', alignItems: 'center' },
    });
    const headerTitle = new Label({
      text: 'PAYTABLE',
      style: { fontSize: 24, fill: 0xffd700, fontWeight: 'bold', letterSpacing: 6 },
    });
    header.addContent(headerTitle);
    header.x = -250;
    header.y = -280;
    wrapper.addChild(header);

    // Scrollable symbol list
    const scroll = new ScrollContainer({
      width: 500,
      height: 440,
      direction: 'vertical',
      elementsMargin: 8,
      padding: 12,
      backgroundColor: 0x12122a,
      borderRadius: 16,
    });

    for (const sym of SYMBOLS) {
      scroll.addItem(this.createPaytableRow(sym));
    }

    // Extra info rows
    scroll.addItem(this.createInfoRow('WILD', '⭐ substitutes for all symbols'));
    scroll.addItem(this.createInfoRow('SCATTER', '3+ 💎 trigger Free Spins'));
    scroll.addItem(this.createInfoRow('RTP', 'Theoretical return: 96.5%'));

    scroll.x = -250;
    scroll.y = -210;
    wrapper.addChild(scroll);

    // Close button
    const closeBtn = new Button({
      width: 140, height: 44, borderRadius: 22,
      colors: { default: 0x3a3a6e, hover: 0x4a4a7e, pressed: 0x2a2a5e, disabled: 0x222222 },
      text: 'CLOSE',
      textStyle: { fontSize: 16, letterSpacing: 2 },
      onPress: () => this._paytableModal.hide(),
    });
    closeBtn.y = 250;
    wrapper.addChild(closeBtn);

    this._paytableModal.content.addChild(wrapper);
    this.container.addChild(this._paytableModal);
  }

  private createPaytableRow(sym: typeof SYMBOLS[0]): Container {
    const row = new FlexContainer({
      direction: 'row',
      alignItems: 'center',
      gap: 16,
      padding: [8, 16, 8, 16],
    });

    // Symbol icon
    const icon = new Container();
    const iconBg = new Graphics();
    iconBg.roundRect(0, 0, 52, 52, 10).fill({ color: 0x1a1a3e, alpha: 0.9 });
    iconBg.roundRect(0, 0, 52, 52, 10).stroke({ color: sym.color, width: 1, alpha: 0.4 });
    icon.addChild(iconBg);
    const iconText = new Text({
      text: sym.label,
      style: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: sym.label.length > 2 ? 18 : 28,
        fill: sym.color,
        fontWeight: 'bold',
      },
    });
    iconText.anchor.set(0.5);
    iconText.x = 26;
    iconText.y = 26;
    icon.addChild(iconText);

    // Pay info
    const payText = new Label({
      text: `x3 = ${sym.pay3}   x4 = ${sym.pay4}   x5 = ${sym.pay5}`,
      style: { fontSize: 16, fill: 0xcccccc },
    });

    row.addFlexChild(icon);
    row.addFlexChild(payText);
    row.updateLayout();

    return row;
  }

  private createInfoRow(title: string, description: string): Container {
    const row = new FlexContainer({
      direction: 'row',
      alignItems: 'center',
      gap: 16,
      padding: [8, 16, 8, 16],
    });

    const lbl = new Label({
      text: title,
      style: { fontSize: 16, fill: 0xffd700, fontWeight: 'bold' },
    });
    const desc = new Label({
      text: description,
      style: { fontSize: 14, fill: 0x999999 },
    });

    row.addFlexChild(lbl);
    row.addFlexChild(desc);
    row.updateLayout();

    return row;
  }

  // ═══════════════════════════════════════════════════════════
  // Reel Grid
  // ═══════════════════════════════════════════════════════════

  private createReelGrid(): void {
    this._grid = [];
    for (let col = 0; col < COLS; col++) {
      this._grid[col] = [];
      for (let row = 0; row < ROWS; row++) {
        const cell = this.createSymbolCell(this.randomSymbol());
        this._reelArea.addChild(cell);
        this._grid[col][row] = cell;
      }
    }
    this.positionGrid();
  }

  private positionGrid(): void {
    const totalW = COLS * CELL_SIZE + (COLS - 1) * CELL_GAP;
    const totalH = ROWS * CELL_SIZE + (ROWS - 1) * CELL_GAP;
    const startX = -totalW / 2;
    const startY = -totalH / 2;

    this._reelBg.clear();
    this._reelBg.roundRect(startX - 16, startY - 16, totalW + 32, totalH + 32, 16)
      .fill({ color: 0x0a0a1e, alpha: 0.8 });
    this._reelBg.roundRect(startX - 16, startY - 16, totalW + 32, totalH + 32, 16)
      .stroke({ color: 0x2a2a5a, width: 2 });

    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const cell = this._grid[col][row];
        cell.x = startX + col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
        cell.y = startY + row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
      }
    }
  }

  private createSymbolCell(symbolIdx: number): Container {
    const sym = SYMBOLS[symbolIdx];
    const cell = new Container();

    const bg = new Graphics();
    bg.roundRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 12)
      .fill({ color: 0x1a1a3e, alpha: 0.9 });
    bg.roundRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 12)
      .stroke({ color: 0x2a2a5a, width: 1 });
    cell.addChild(bg);

    const text = new Text({
      text: sym.label,
      style: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: sym.label.length > 2 ? 28 : 44,
        fill: sym.color,
        fontWeight: 'bold',
      },
    });
    text.anchor.set(0.5);
    cell.addChild(text);

    return cell;
  }

  private randomSymbol(): number {
    return Math.floor(Math.random() * SYMBOLS.length);
  }

  // ═══════════════════════════════════════════════════════════
  // Spin Animation
  // ═══════════════════════════════════════════════════════════

  private async spinReels(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (let col = 0; col < COLS; col++) {
      promises.push(this.spinColumn(col, col * 120));
    }
    await Promise.all(promises);
  }

  private async spinColumn(col: number, delay: number): Promise<void> {
    if (delay > 0) await Tween.delay(delay);

    for (let row = 0; row < ROWS; row++) {
      const cell = this._grid[col][row];
      Tween.to(cell, { alpha: 0, 'scale.x': 0.5, 'scale.y': 0.5 }, 150, Easing.easeInQuad);
    }

    await Tween.delay(200);

    for (let row = 0; row < ROWS; row++) {
      const oldCell = this._grid[col][row];
      const newCell = this.createSymbolCell(this.randomSymbol());
      newCell.x = oldCell.x;
      newCell.y = oldCell.y;
      newCell.alpha = 0;
      newCell.scale.set(0.5);

      this._reelArea.removeChild(oldCell);
      oldCell.destroy();
      this._reelArea.addChild(newCell);
      this._grid[col][row] = newCell;

      await Tween.to(newCell, { alpha: 1, 'scale.x': 1, 'scale.y': 1 }, 200, Easing.easeOutBack);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Layout
  // ═══════════════════════════════════════════════════════════

  private layoutUI(width: number, height: number): void {
    const bg = this.container.getChildByLabel('background') as Graphics;
    if (bg) {
      bg.clear();
      bg.rect(0, 0, width, height).fill(0x0f0f23);
      const cx = width / 2;
      const cy = height * 0.42;
      bg.circle(cx, cy, 400).fill({ color: 0x1a1a4a, alpha: 0.35 });
      bg.circle(cx, cy, 250).fill({ color: 0x1a1a5a, alpha: 0.25 });
    }

    const padding = 20;

    // Top bar
    this._topBar.resize(width, 60);
    this._topBar.updateLayout();
    this._topBar.x = 0;
    this._topBar.y = padding;

    // Bottom bar
    this._bottomBar.resize(width, 80);
    this._bottomBar.updateLayout();
    this._bottomBar.x = 0;
    this._bottomBar.y = height - 80 - padding;

    // Reel area — centered between top and bottom
    const topEnd = this._topBar.y + 60 + 10;
    const bottomStart = this._bottomBar.y - 10;
    const availH = bottomStart - topEnd;
    this._reelArea.x = width / 2;
    this._reelArea.y = topEnd + availH / 2;

    const gridW = COLS * CELL_SIZE + (COLS - 1) * CELL_GAP + 32;
    const gridH = ROWS * CELL_SIZE + (ROWS - 1) * CELL_GAP + 32;
    const scaleX = Math.min(1, (width - padding * 4) / gridW);
    const scaleY = Math.min(1, availH / gridH);
    this._reelArea.scale.set(Math.min(scaleX, scaleY));

    // Spin counter — anchored top-right via Layout
    this._spinCounter.updateViewport(width, height);
  }

  // ═══════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════

  private changeBet(delta: number): void {
    if (this._fsm.current !== 'idle') return;
    const ctx = this._fsm.context;
    ctx.betIndex = Math.max(0, Math.min(this._betLevels.length - 1, ctx.betIndex + delta));
    ctx.bet = this._betLevels[ctx.betIndex];
    this._betLabel.text = `BET: $${ctx.bet.toFixed(2)}`;
  }

  private onSpin(): void {
    if (this._fsm.current === 'idle') {
      this._fsm.transition('spinning');
    }
  }

  private async openSettings(): Promise<void> {
    if (this._settingsModal.isShowing) return;
    await this._settingsModal.show(this._viewW, this._viewH);
  }

  private async openPaytable(): Promise<void> {
    if (this._paytableModal.isShowing) return;
    await this._paytableModal.show(this._viewW, this._viewH);
  }

  // ═══════════════════════════════════════════════════════════
  // State Machine
  // ═══════════════════════════════════════════════════════════

  private createStateMachine(): void {
    const initialBalance = this._engine?.initData?.balance ?? 5000;
    const betIndex = 2;
    const ctx: GameContext = {
      balance: initialBalance,
      bet: this._betLevels[betIndex],
      betIndex,
      lastWin: 0,
      totalSpins: 0,
    };

    this._betLabel.text = `BET: $${ctx.bet.toFixed(2)}`;
    this._fsm = new StateMachine<GameContext>(ctx);

    // IDLE
    this._fsm.addState('idle', {
      enter: () => {
        this._spinButton.enable();
      },
    });

    // SPINNING
    this._fsm.addState('spinning', {
      enter: async (ctx) => {
        this._spinButton.disable();
        this._winDisplay.hide();

        ctx.balance -= ctx.bet;
        this._balance.setValue(ctx.balance);

        ctx.totalSpins++;
        this._spinCountLabel.text = `SPINS: ${ctx.totalSpins}`;

        await this.spinReels();

        const isWin = Math.random() > 0.35;
        ctx.lastWin = isWin
          ? Math.round(ctx.bet * (1 + Math.random() * 20) * 100) / 100
          : 0;

        if (ctx.lastWin > 0) {
          ctx.balance += ctx.lastWin;
          this._balance.setValue(ctx.balance);
          setTimeout(() => this._fsm.transition('presenting'), 0);
        } else {
          setTimeout(() => this._fsm.transition('idle'), 0);
        }
      },
    });

    // PRESENTING
    this._fsm.addState('presenting', {
      enter: async (ctx) => {
        await this._winDisplay.showWin(ctx.lastWin);
        await Tween.delay(800);
        setTimeout(() => this._fsm.transition('idle'), 0);
      },
    });
  }
}
