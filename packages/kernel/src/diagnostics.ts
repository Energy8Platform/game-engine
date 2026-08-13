/**
 * Diagnostics are how this package reports every failure. Nothing here throws: a bad manifest, a
 * mistyped setting or a broken factory becomes a value that travels to the IDE and to the player-
 * facing error screen. The previous editor lost patch rejections silently; that class of bug is
 * designed out by making refusal a return value.
 */

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  /** Stable machine code, e.g. 'schema/type-mismatch'. Tests and the IDE match on this, not on prose. */
  code: string;
  /** Human-readable sentence, shown verbatim in the IDE. */
  message: string;
  pluginId?: string;
  pointId?: string;
  contributionId?: string;
  /** Dotted path inside the value being validated, e.g. 'motion.speed' or 'stops[1]'. */
  path?: string;
  /** Actionable next step, shown verbatim in the IDE. */
  fix?: string;
}

export function error(code: string, message: string, rest: Partial<Diagnostic> = {}): Diagnostic {
  return { ...rest, severity: 'error', code, message };
}

export function warning(code: string, message: string, rest: Partial<Diagnostic> = {}): Diagnostic {
  return { ...rest, severity: 'warning', code, message };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
