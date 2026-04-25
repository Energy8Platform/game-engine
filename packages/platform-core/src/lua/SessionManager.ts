import type { SessionData } from '@energy8platform/game-sdk';
import type { TransitionRule } from './types';

interface SessionState {
  spinsRemaining: number;
  spinsPlayed: number;
  totalWin: number;
  completed: boolean;
  maxWinReached: boolean;
  bet: number;
  maxWinCap: number | undefined;
  spinsVarName: string | undefined;
  persistentVarNames: string[];
  persistentVars: Record<string, number>;
  persistentData: Record<string, unknown>;
}

const MAX_SESSION_SPINS = 200;

/**
 * Manages session lifecycle matching the platform server behavior:
 * - createSession: initial spin counted (spinsPlayed=1, totalWin=spinWin)
 * - updateSession: accumulates win, decrements spins, checks max win cap on session level
 * - completeSession: returns cumulative totalWin, cleans up session vars
 * - Safety cap: 200 spins max per session
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

  /** Get the fixed bet amount from the session (server uses session bet, not request bet) */
  get sessionBet(): number | undefined {
    return this.session?.bet;
  }

  /** Get spinsVarName to restore free_spins_remaining into variables */
  get spinsVarName(): string | undefined {
    return this.session?.spinsVarName;
  }

  get spinsRemaining(): number {
    return this.session?.spinsRemaining ?? 0;
  }

  /**
   * Create a new session from a transition rule.
   * Server behavior: initial spin is already counted (spinsPlayed=1, totalWin includes spinWin).
   */
  createSession(
    rule: TransitionRule,
    variables: Record<string, number>,
    bet: number,
    spinWin: number,
    maxWinCap: number | undefined,
  ): SessionData {
    let spinsRemaining = -1;
    let spinsVarName: string | undefined;
    if (rule.session_config?.total_spins_var) {
      spinsVarName = rule.session_config.total_spins_var;
      spinsRemaining = variables[spinsVarName] ?? -1;
    }

    const persistentVarNames: string[] = rule.session_config?.persistent_vars ?? [];
    const persistentVars: Record<string, number> = {};
    for (const varName of persistentVarNames) {
      persistentVars[varName] = variables[varName] ?? 0;
    }

    this.session = {
      spinsRemaining,
      spinsPlayed: 1, // initial spin counts
      totalWin: spinWin, // initial spin win included
      completed: false,
      maxWinReached: false,
      bet,
      maxWinCap,
      spinsVarName,
      persistentVarNames,
      persistentVars,
      persistentData: {},
    };

    return this.toSessionData();
  }

  /**
   * Update session after a bonus spin.
   * Server behavior: accumulate win, decrement spins, check retrigger, check max win cap,
   * safety cap at 200 spins.
   */
  updateSession(
    rule: TransitionRule,
    variables: Record<string, number>,
    spinWin: number,
  ): SessionData {
    if (!this.session) throw new Error('No active session');

    // Accumulate win and count spin
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

    // Safety cap: server limits sessions to 200 spins
    if (this.session.spinsPlayed >= MAX_SESSION_SPINS) {
      this.session.spinsRemaining = 0;
    }

    // Update session persistent vars from current variables
    for (const varName of this.session.persistentVarNames) {
      if (varName in variables) {
        this.session.persistentVars[varName] = variables[varName];
      }
    }

    // Check max win cap (on session level, not per spin)
    if (this.session.maxWinCap !== undefined && this.session.totalWin >= this.session.maxWinCap) {
      this.session.totalWin = this.session.maxWinCap;
      this.session.spinsRemaining = 0;
      this.session.maxWinReached = true;
    }

    // Auto-complete if spins exhausted or explicit complete
    if (this.session.spinsRemaining === 0 || rule.complete_session) {
      this.session.completed = true;
    }

    return this.toSessionData();
  }

  /**
   * Complete the session explicitly.
   * Returns cumulative totalWin and list of session-scoped var names to clean up.
   */
  completeSession(): { totalWin: number; session: SessionData; sessionVarNames: string[] } {
    if (!this.session) throw new Error('No active session to complete');

    this.session.completed = true;
    const totalWin = this.session.totalWin;
    const session = this.toSessionData();
    const sessionVarNames = [...this.session.persistentVarNames];

    this.session = null;

    return { totalWin, session, sessionVarNames };
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

  /** Get persistent params to inject into next execute() call */
  getPersistentParams(): Record<string, unknown> {
    if (!this.session) return {};

    const params: Record<string, unknown> = {};

    // Session persistent vars (float64) → state.variables
    for (const [key, value] of Object.entries(this.session.persistentVars)) {
      params[key] = value;
    }

    // _persist_ complex data → _ps_* in state.params
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
