import type { SessionData } from '@energy8platform/game-sdk';
import type { TransitionRule } from './types';

interface SessionState {
  spinsRemaining: number;
  spinsPlayed: number;
  totalWin: number;
  completed: boolean;
  maxWinReached: boolean;
  bet: number;
  persistentVars: Record<string, number>;
  persistentData: Record<string, unknown>;
}

/**
 * Manages session lifecycle: creation, spin counting, retriggers, and completion.
 * Handles both slot sessions (fixed spin count) and table game sessions (unlimited).
 * Also manages _persist_ data roundtrip between Lua calls.
 */
export class SessionManager {
  private session: SessionState | null = null;

  get isActive(): boolean {
    return this.session !== null && !this.session.completed;
  }

  get current(): SessionData | null {
    if (!this.session) return null;
    return this.toSessionData();
  }

  get sessionTotalWin(): number {
    return this.session?.totalWin ?? 0;
  }

  /** Create a new session from a transition rule */
  createSession(
    rule: TransitionRule,
    variables: Record<string, number>,
    bet: number,
  ): SessionData {
    let spinsRemaining = -1; // unlimited by default
    if (rule.session_config?.total_spins_var) {
      const varName = rule.session_config.total_spins_var;
      spinsRemaining = variables[varName] ?? -1;
    }

    const persistentVars: Record<string, number> = {};
    if (rule.session_config?.persistent_vars) {
      for (const varName of rule.session_config.persistent_vars) {
        persistentVars[varName] = variables[varName] ?? 0;
      }
    }

    this.session = {
      spinsRemaining,
      spinsPlayed: 0,
      totalWin: 0,
      completed: false,
      maxWinReached: false,
      bet,
      persistentVars,
      persistentData: {},
    };

    return this.toSessionData();
  }

  /** Update session after a spin: decrement counter, accumulate win, handle retrigger */
  updateSession(
    rule: TransitionRule,
    variables: Record<string, number>,
    spinWin: number,
  ): SessionData {
    if (!this.session) throw new Error('No active session');

    // Accumulate win
    this.session.totalWin += spinWin;
    this.session.spinsPlayed++;

    // Decrement spins (only for non-unlimited sessions)
    if (this.session.spinsRemaining > 0) {
      this.session.spinsRemaining--;
    }

    // Handle retrigger (add_spins_var)
    if (rule.add_spins_var) {
      const extraSpins = variables[rule.add_spins_var] ?? 0;
      if (extraSpins > 0 && this.session.spinsRemaining >= 0) {
        this.session.spinsRemaining += extraSpins;
      }
    }

    // Update persistent vars
    if (this.session.persistentVars) {
      for (const key of Object.keys(this.session.persistentVars)) {
        if (key in variables) {
          this.session.persistentVars[key] = variables[key];
        }
      }
    }

    // Auto-complete if spins exhausted
    if (this.session.spinsRemaining === 0) {
      this.session.completed = true;
    }

    return this.toSessionData();
  }

  /** Complete the session, return accumulated totalWin */
  completeSession(): { totalWin: number; session: SessionData } {
    if (!this.session) throw new Error('No active session to complete');

    this.session.completed = true;
    const totalWin = this.session.totalWin;
    const session = this.toSessionData();

    return { totalWin, session };
  }

  /** Mark max win reached — stops the session */
  markMaxWinReached(): void {
    if (this.session) {
      this.session.maxWinReached = true;
      this.session.completed = true;
    }
  }

  /** Store _persist_* data extracted from Lua result */
  storePersistData(data: Record<string, unknown>): void {
    if (!this.session) return;

    for (const key of Object.keys(data)) {
      if (key.startsWith('_persist_')) {
        const cleanKey = key.slice('_persist_'.length);
        this.session.persistentData[cleanKey] = data[key];
      }
    }
  }

  /** Get _ps_* params to inject into next execute() call */
  getPersistentParams(): Record<string, unknown> {
    if (!this.session) return {};

    const params: Record<string, unknown> = {};

    // Session persistent vars (float64)
    for (const [key, value] of Object.entries(this.session.persistentVars)) {
      params[key] = value;
    }

    // _persist_ complex data → _ps_*
    for (const [key, value] of Object.entries(this.session.persistentData)) {
      params[`_ps_${key}`] = value;
    }

    return params;
  }

  /** Reset all session state */
  reset(): void {
    this.session = null;
  }

  private toSessionData(): SessionData {
    if (!this.session) throw new Error('No session');

    return {
      spinsRemaining: this.session.spinsRemaining,
      spinsPlayed: this.session.spinsPlayed,
      totalWin: Math.round(this.session.totalWin * 100) / 100,
      completed: this.session.completed,
      maxWinReached: this.session.maxWinReached,
      betAmount: this.session.bet,
    };
  }
}
