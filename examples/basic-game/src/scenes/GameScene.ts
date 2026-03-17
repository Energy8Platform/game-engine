import { Graphics } from 'pixi.js';
import '@pixi/layout'; // global type augmentation (adds .layout to Container)
import { LayoutContainer } from '@pixi/layout/components';
import {
  Scene,
  Button,
  Label,
  Layout,
  BalanceDisplay,
  WinDisplay,
  Toast,
  StateMachine,
  Tween,
} from '@energy8platform/game-engine';

/**
 * Main game scene — demonstrates the engine's core capabilities:
 * - Flexbox layout via @pixi/layout (no manual pixel positioning)
 * - Balance display (reacts to SDK balance updates)
 * - Spin button with state management
 * - Win presentation with countup
 * - Toast notifications
 * - State machine for game flow
 */
export class GameScene extends Scene {
  private balance!: BalanceDisplay;
  private winDisplay!: WinDisplay;
  private spinButton!: Button;
  private betLabel!: Label;
  private toast!: Toast;
  private fsm!: StateMachine<GameContext>;
  private _root!: LayoutContainer;

  private _engine: any = null;
  private _currentBetIndex = 2; // default bet index

  override async onEnter(data?: unknown): Promise<void> {
    // Engine reference is passed from LoadingScene
    if (data && typeof data === 'object' && 'engine' in (data as any)) {
      this._engine = (data as any).engine;
    }

    this.createBackground();
    this.createUI();
    this.createStateMachine();

    // Initialize balance from SDK init data
    const sdkBalance = this._engine?.initData?.balance;
    if (sdkBalance != null) {
      this.balance.setValue(sdkBalance);
      this.fsm.context.balance = sdkBalance;
    }

    // Spacebar → spin
    this._engine?.input?.on('keydown', ({ key }: { key: string }) => {
      if (key === ' ') this.onSpinTap();
    });

    // Start in idle state
    await this.fsm.start('idle');
  }

  override onUpdate(dt: number): void {
    this.fsm?.update(dt);
  }

  override onResize(width: number, height: number): void {
    // Guard: onResize may be called before onEnter initializes UI
    if (!this.fsm) return;
    this.layoutUI(width, height);
  }

  // ─── Background ────────────────────────────────────────

  private createBackground(): void {
    const bg = new Graphics();
    // Will be drawn in layoutUI
    bg.label = 'background';
    this.container.addChild(bg);
  }

  // ─── UI (flexbox layout) ────────────────────────────────

  private createUI(): void {
    // ── Root layout: full-screen vertical flex ──
    this._root = new LayoutContainer();
    this._root.layout = {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 40,
    };
    this.container.addChild(this._root);

    // ── Header: title + subtitle + balance ──
    const header = new LayoutContainer();
    header.layout = {
      flexDirection: 'column',
      alignItems: 'center',
      gap: 12,
    };

    const title = new Label({
      text: 'BASIC GAME DEMO',
      style: {
        fontSize: 42,
        fontWeight: 'bold',
        fill: 0xffd700,
        letterSpacing: 4,
      },
    });

    const subtitle = new Label({
      text: '@energy8platform/game-engine',
      style: {
        fontSize: 18,
        fill: 0x888888,
        letterSpacing: 2,
      },
    });

    this.balance = new BalanceDisplay({
      prefix: 'BALANCE',
      currency: 'USD',
      animated: true,
      animationDuration: 400,
    });

    this.betLabel = new Label({
      text: 'BET: $1.00',
      style: {
        fontSize: 22,
        fill: 0xcccccc,
      },
    });

    header.addChild(title, subtitle, this.balance, this.betLabel);
    this._root.addChild(header);

    // ── Center: win display (expands to fill available space) ──
    const center = new LayoutContainer();
    center.layout = {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
    };

    this.winDisplay = new WinDisplay({
      currency: 'USD',
      countupDuration: 1200,
    });

    center.addChild(this.winDisplay);
    this._root.addChild(center);

    // ── Footer: spin button + info text ──
    const footer = new LayoutContainer();
    footer.layout = {
      flexDirection: 'column',
      alignItems: 'center',
      gap: 16,
    };

    this.spinButton = new Button({
      width: 180,
      height: 60,
      borderRadius: 30,
      colors: {
        default: 0x22aa44,
        hover: 0x33cc55,
        pressed: 0x1a8833,
        disabled: 0x444444,
      },
      pressScale: 0.92,
      text: 'SPIN',
    });
    this.spinButton.onPress.connect(() => this.onSpinTap());

    const info = new Label({
      text: 'Press SPIN or SPACEBAR to play. DevBridge provides mock server responses.',
      style: {
        fontSize: 14,
        fill: 0x666666,
      },
    });

    footer.addChild(this.spinButton, info);
    this._root.addChild(footer);

    // Toast sits outside the flex layout (absolute overlay)
    this.toast = new Toast({ duration: 2500 });
    this.container.addChild(this.toast);
  }

  private layoutUI(width: number, height: number): void {
    // Background (drawn manually — artistic element, not UI)
    const bg = this.container.getChildByLabel('background') as Graphics;
    if (bg) {
      const cx = width / 2;
      bg.clear();
      bg.rect(0, 0, width, height).fill(0x0f0f23);
      bg.circle(cx, height * 0.4, 300).fill({ color: 0x1a1a4a, alpha: 0.4 });
      bg.circle(cx, height * 0.4, 200).fill({ color: 0x1a1a5a, alpha: 0.3 });
    }

    // Root flexbox fills the viewport — layout engine handles the rest
    this._root.layout = {
      width,
      height,
    };
  }

  // ─── Game Flow ─────────────────────────────────────────

  private onSpinTap(): void {
    if (this.fsm.current === 'idle') {
      this.fsm.transition('spinning');
    }
  }

  private createStateMachine(): void {
    const initialBalance = this._engine?.initData?.balance;
    const ctx: GameContext = {
      balance: initialBalance,
      bet: 1,
      lastWin: 0,
    };

    this.fsm = new StateMachine<GameContext>(ctx);

    // IDLE — waiting for player input
    this.fsm.addState('idle', {
      enter: (_ctx) => {
        this.spinButton.enable();
        this.winDisplay.hide();
      },
    });

    // SPINNING — request sent, waiting for result
    this.fsm.addState('spinning', {
      enter: async (ctx) => {
        this.spinButton.disable();

        // Show spinning feedback
        await this.toast.show('Spinning...', 'info', 1920, 1080);

        // Simulate a spin result (in real game, use sdk.play())
        await Tween.delay(800);

        // Mock result
        const isWin = Math.random() > 0.4;
        ctx.lastWin = isWin ? Math.round(ctx.bet * (1 + Math.random() * 15) * 100) / 100 : 0;
        ctx.balance += ctx.lastWin - ctx.bet;

        this.balance.setValue(ctx.balance);

        if (ctx.lastWin > 0) {
          setTimeout(() => this.fsm.transition('presenting'), 0);
        } else {
          await this.toast.show('No win — try again!', 'warning', 1920, 1080);
          setTimeout(() => this.fsm.transition('idle'), 0);
        }
      },
    });

    // PRESENTING — showing win
    this.fsm.addState('presenting', {
      enter: async (ctx) => {
        await this.winDisplay.showWin(ctx.lastWin);
        await Tween.delay(1000);
        setTimeout(() => this.fsm.transition('idle'), 0);
      },
    });
  }
}

interface GameContext {
  balance: number;
  bet: number;
  lastWin: number;
}
