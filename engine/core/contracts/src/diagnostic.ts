/** How much a failure matters. `error` stops the game; `warning` degrades it. */
export type Severity = 'error' | 'warning' | 'info';

/** A failure that reaches a human, in the same shape for the game, the IDE and the agent. */
export interface Diagnostic {
  severity: Severity;
  /**
   * The composition entry id (`CompositionRow.id`) this failure belongs to
   * — the same identity `CompositionService.update()` takes and
   * `CompositionRow.id` carries, so a diagnostic can always be traced back
   * to the row it's about. A diagnostic that isn't about any one entry
   * (e.g. a malformed e8.yml, caught before any entry exists) instead
   * carries a fixed sentinel describing what it *is* about (e.g.
   * `'composition'` for the file itself) — never a package name, since two
   * entries can share a package and a package name alone can't be resolved
   * back to a row. Display code resolves id → row name for the human,
   * falling back to the raw value when it doesn't match any row (see
   * `CompositionScreen`'s `pluginLabel`).
   */
  plugin: string;
  /** Where inside the plugin — a config path, a seam name, a file. */
  where: string;
  message: string;
  /** What the human can do about it, when we know. */
  fix?: string;
}

export function diagnostic(
  severity: Severity,
  plugin: string,
  where: string,
  message: string,
  fix?: string,
): Diagnostic {
  return fix === undefined
    ? { severity, plugin, where, message }
    : { severity, plugin, where, message, fix };
}
