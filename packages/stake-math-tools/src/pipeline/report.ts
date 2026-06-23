import { formatNativeResult } from '@energy8platform/platform-core/simulation';
import type { NativeSimulationResult } from '@energy8platform/platform-core/simulation';

/** Full go-native report for one mode (formatNativeResult already includes per-stage + distribution). */
export function formatGoReport(mode: string, result: NativeSimulationResult): string {
  return `── ${mode} ──\n${formatNativeResult(result)}`;
}
