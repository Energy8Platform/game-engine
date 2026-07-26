/**
 * Gate for the PROGRESSIVE (cascade / tumble) WIN readout.
 *
 * By default the WIN readout is entirely host-driven: cleared to 0 when a segment starts, set to
 * that segment's win once `onSpin` resolves. A cascade game pays in steps, so its scene wants the
 * number to climb WHILE the segment presents — `api.shell.reportWin(amountSoFar)`.
 *
 * The gate keeps the host in charge:
 *   - reports are honoured ONLY between `open()` (segment start, WIN already cleared) and `close()`
 *     (the host paints the segment's final value) — a scene still animating after an abort, or one
 *     reporting from a mode transition, can't overwrite the host's number,
 *   - `amountSoFar` is ABSOLUTE (the segment's win up to now, not the step delta), so a re-report or
 *     a collapse-to-final on skip is idempotent. Reports should be non-decreasing within a segment;
 *     a lower value counts the readout back DOWN,
 *   - garbage (NaN / Infinity) is dropped and negatives clamp to 0, so a math bug can't paint "NaN"
 *     into the bar.
 *
 * Pure + unit-testable: the shell paint is injected.
 */
export interface WinReportOptions {
  /** `false` snaps instead of counting up (e.g. collapsing to the final value on skip). */
  animate?: boolean;
  /** Count-up length in ms (shell default 450) — pass the cascade step's length. */
  durationMs?: number;
}

export interface WinReporter {
  /** Scene-facing (`api.shell.reportWin`): the win accumulated by the presenting segment so far. */
  report(amountSoFar: number, opts?: WinReportOptions): void;
  /** A segment starts presenting — the scene may now grow WIN. */
  open(): void;
  /** The host takes the readout back (final value, round end, or an error). */
  close(): void;
  /** True while reports are honoured. */
  readonly accepting: boolean;
}

export function createWinReporter(
  paint: (amount: number, opts?: WinReportOptions) => void,
): WinReporter {
  let accepting = false;
  return {
    report(amountSoFar: number, opts?: WinReportOptions): void {
      if (!accepting || !Number.isFinite(amountSoFar)) return;
      paint(Math.max(0, amountSoFar), opts);
    },
    open(): void {
      accepting = true;
    },
    close(): void {
      accepting = false;
    },
    get accepting(): boolean {
      return accepting;
    },
  };
}
