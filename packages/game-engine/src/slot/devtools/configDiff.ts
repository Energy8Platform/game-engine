// packages/game-engine/src/slot/devtools/configDiff.ts
//
// Compute the minimal override diff of a reel config against the defaults, and emit a
// paste-ready `resolveReelConfig({...})` TypeScript snippet. Pure — no pixi, no DOM.

import { resolveReelConfig, type ReelSystemConfig } from '../config/ReelSystemConfig';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Deep diff `obj` against `base`: arrays compared whole, objects recursed, scalars by !==. */
export function configDiff(base: any, obj: any): any {
  const out: any = {};
  for (const k of Object.keys(obj ?? {})) {
    const a = base?.[k];
    const b = obj[k];
    if (Array.isArray(b)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
    } else if (b && typeof b === 'object') {
      const d = configDiff(a ?? {}, b);
      if (Object.keys(d).length) out[k] = d;
    } else if (a !== b) {
      out[k] = b;
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Diff a working config against DEFAULT_REEL_CONFIG (via resolveReelConfig()). */
export function diffFromDefaults(config: ReelSystemConfig): Partial<ReelSystemConfig> {
  return configDiff(resolveReelConfig(), config) as Partial<ReelSystemConfig>;
}

/** Emit a paste-ready TS module exporting the reel config as overrides-only. */
export function emitReelConfigTs(config: ReelSystemConfig): string {
  const diff = diffFromDefaults(config);
  return (
    `import { resolveReelConfig } from '@energy8platform/game-engine/slot';\n\n` +
    `// Only the overrides vs DEFAULT_REEL_CONFIG.\n` +
    `export const reelConfig = resolveReelConfig(${JSON.stringify(diff, null, 2)} as const);\n`
  );
}
