import { EventEmitter } from '../core/EventEmitter';

interface StateConfig<TContext> {
  enter?: (ctx: TContext, data?: unknown) => void | Promise<void>;
  exit?: (ctx: TContext) => void | Promise<void>;
  update?: (ctx: TContext, dt: number) => void;
}

interface StateMachineEvents {
  transition: { from: string | null; to: string };
  error: Error;
}

/**
 * Generic finite state machine for game flow management.
 *
 * Supports:
 * - Typed context object shared across all states
 * - Async enter/exit hooks
 * - Per-frame update per state
 * - Transition guards
 * - Event emission on state change
 *
 * @example
 * ```ts
 * interface GameContext {
 *   balance: number;
 *   bet: number;
 *   lastWin: number;
 * }
 *
 * const fsm = new StateMachine<GameContext>({ balance: 1000, bet: 10, lastWin: 0 });
 *
 * fsm.addState('idle', {
 *   enter: (ctx) => console.log('Waiting for spin...'),
 *   update: (ctx, dt) => { // optional per-frame },
 * });
 *
 * fsm.addState('spinning', {
 *   enter: async (ctx) => {
 *     const result = await sdk.play({ action: 'spin', bet: ctx.bet });
 *     ctx.lastWin = result.totalWin;
 *     await fsm.transition('presenting');
 *   },
 * });
 *
 * fsm.addState('presenting', {
 *   enter: async (ctx) => {
 *     await showWinPresentation(ctx.lastWin);
 *     await fsm.transition('idle');
 *   },
 * });
 *
 * // Optional guard
 * fsm.addGuard('idle', 'spinning', (ctx) => ctx.balance >= ctx.bet);
 *
 * await fsm.start('idle');
 * ```
 */
export class StateMachine<TContext = Record<string, unknown>> extends EventEmitter<StateMachineEvents> {
  private static MAX_TRANSITION_DEPTH = 10;

  private _states = new Map<string, StateConfig<TContext>>();
  private _guards = new Map<string, (ctx: TContext) => boolean>();
  private _current: string | null = null;
  private _transitionDepth = 0;
  private _context: TContext;

  constructor(context: TContext) {
    super();
    this._context = context;
  }

  /** Current state name */
  get current(): string | null {
    return this._current;
  }

  /** Whether a transition is in progress */
  get isTransitioning(): boolean {
    return this._transitionDepth > 0;
  }

  /** State machine context (shared data) */
  get context(): TContext {
    return this._context;
  }

  /**
   * Register a state with optional enter/exit/update hooks.
   */
  addState(name: string, config: StateConfig<TContext>): this {
    this._states.set(name, config);
    return this;
  }

  /**
   * Add a transition guard.
   * The guard function must return true to allow the transition.
   *
   * @param from - Source state
   * @param to - Target state
   * @param guard - Guard function
   */
  addGuard(from: string, to: string, guard: (ctx: TContext) => boolean): this {
    this._guards.set(`${from}->${to}`, guard);
    return this;
  }

  /**
   * Start the state machine in the given initial state.
   */
  async start(initialState: string, data?: unknown): Promise<void> {
    if (this._current !== null) {
      throw new Error('[StateMachine] Already started. Use transition() to change states.');
    }

    const state = this._states.get(initialState);
    if (!state) {
      throw new Error(`[StateMachine] State "${initialState}" not registered.`);
    }

    this._current = initialState;
    await state.enter?.(this._context, data);
    this.emit('transition', { from: null, to: initialState });
  }

  /**
   * Transition to a new state.
   *
   * @param to - Target state name
   * @param data - Optional data passed to the new state's enter hook
   * @returns true if the transition succeeded, false if blocked by a guard
   */
  async transition(to: string, data?: unknown): Promise<boolean> {
    if (this._transitionDepth >= StateMachine.MAX_TRANSITION_DEPTH) {
      throw new Error(
        '[StateMachine] Max transition depth exceeded — possible infinite loop',
      );
    }

    const from = this._current;

    // Check guard
    if (from !== null) {
      const guardKey = `${from}->${to}`;
      const guard = this._guards.get(guardKey);
      if (guard && !guard(this._context)) {
        return false;
      }
    }

    const toState = this._states.get(to);
    if (!toState) {
      throw new Error(`[StateMachine] State "${to}" not registered.`);
    }

    this._transitionDepth++;

    try {
      // Exit current state
      if (from !== null) {
        const fromState = this._states.get(from);
        await fromState?.exit?.(this._context);
      }

      // Enter new state
      this._current = to;
      await toState.enter?.(this._context, data);

      this.emit('transition', { from, to });
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      this._transitionDepth--;
    }

    return true;
  }

  /**
   * Call the current state's update function.
   * Should be called from the game loop.
   */
  update(dt: number): void {
    if (this._current === null) return;
    const state = this._states.get(this._current);
    state?.update?.(this._context, dt);
  }

  /**
   * Check if a state is registered.
   */
  hasState(name: string): boolean {
    return this._states.has(name);
  }

  /**
   * Check if a transition is allowed (guard passes).
   */
  canTransition(to: string): boolean {
    if (this._current === null) return false;
    const guardKey = `${this._current}->${to}`;
    const guard = this._guards.get(guardKey);
    if (!guard) return true;
    return guard(this._context);
  }

  /**
   * Reset the state machine (exit current state, clear current).
   */
  async reset(): Promise<void> {
    if (this._current !== null) {
      const state = this._states.get(this._current);
      await state?.exit?.(this._context);
    }
    this._current = null;
    this._transitionDepth = 0;
  }

  /**
   * Destroy the state machine.
   */
  async destroy(): Promise<void> {
    await this.reset();
    this._states.clear();
    this._guards.clear();
    this.removeAllListeners();
  }
}
