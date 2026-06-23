import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

export interface FreeSpinsSessionConfig {
  initialSpins: number;
  /** Optional: extra spins to award from a result (retrigger). Default: none. */
  retrigger?: (result: SlotSpinResultBase) => number;
  /** Optional hard exit (e.g. max-win reached). */
  isMaxWin?: () => boolean;
}

/** Headless free-spins state machine. The scene drives it; rendering/HUD reflect it. */
export class FreeSpinsSession {
  remaining: number;
  total: number;
  totalWin = 0;
  private readonly cfg: FreeSpinsSessionConfig;

  constructor(cfg: FreeSpinsSessionConfig) {
    this.cfg = cfg;
    this.remaining = cfg.initialSpins;
    this.total = cfg.initialSpins;
  }

  award(extra: number): void {
    if (extra > 0) { this.remaining += extra; this.total += extra; }
  }

  /** Convenience: award using the configured retrigger rule. */
  applyRetrigger(result: SlotSpinResultBase): void {
    this.award(this.cfg.retrigger?.(result) ?? 0);
  }

  addWin(amount: number): void { this.totalWin += amount; }

  consume(): void { if (this.remaining > 0) this.remaining -= 1; }

  get isComplete(): boolean {
    return this.remaining <= 0 || (this.cfg.isMaxWin?.() ?? false);
  }
}
