/** How much a failure matters. `error` stops the game; `warning` degrades it. */
export type Severity = 'error' | 'warning' | 'info';

/** A failure that reaches a human, in the same shape for the game, the IDE and the agent. */
export interface Diagnostic {
  severity: Severity;
  /** Entry id or package name the failure belongs to. */
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
