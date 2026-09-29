import { useEffect, useState } from 'react';
import type { Context } from 'cordis';

const VISIBLE_MS = 4000;

/**
 * Status bar: `ctx.history.last()`, for 4 s after its own `at` (design doc
 * §5) — `Undo: <label>` / `Redo: <label>` on success, the refusal reason
 * as-is on failure (`nothing to undo`, `changed elsewhere since — can't
 * undo`, …), then empty. Subscribes so a later undo/redo replaces what is
 * showing and restarts the 4 s window, rather than the old one just
 * outlasting a fresh result. A `status` region, mounted even while empty,
 * so a screen reader announces each result as it lands.
 */
export function HistoryStatus({ ctx }: { ctx: Context }) {
  const [entry, setEntry] = useState(() => ctx.history.last());

  useEffect(() => {
    setEntry(ctx.history.last());
    return ctx.history.subscribe(() => setEntry(ctx.history.last()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  useEffect(() => {
    if (entry === undefined) return;
    const remaining = VISIBLE_MS - (Date.now() - entry.at);
    if (remaining <= 0) {
      setEntry(undefined);
      return;
    }
    const timer = setTimeout(() => setEntry(undefined), remaining);
    return () => clearTimeout(timer);
  }, [entry]);

  const text =
    entry === undefined
      ? ''
      : entry.result.ok
        ? `${entry.result.kind === 'undo' ? 'Undo' : 'Redo'}: ${entry.result.label}`
        : entry.result.reason;

  return (
    <span className="e8-status-item" data-testid="history-status" role="status">
      {text}
    </span>
  );
}
