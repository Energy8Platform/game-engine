import { resolve } from 'node:path';
import type { MathConfig } from '../mathConfig';
/** Load a node-only math.config.ts (the CLI runs under tsx, so .ts import works). */
export async function loadMathConfig(path: string): Promise<MathConfig> {
  const mod = await import(resolve(process.cwd(), path));
  return (mod.default ?? mod.config) as MathConfig;
}
