/**
 * The pool manifest: what it takes to run the same rounds again.
 *
 * The two-pass build simulates twice — once light (payout per round), once
 * heavy (full JSON for the ~5% of rounds that survived curation) — and the
 * second run MUST reproduce the first one's rounds exactly, or a book ends up
 * describing a round its lookUpTable row never saw. Nothing about that failure
 * looks wrong: the artifacts stay valid JSON, the sizes check out, and the
 * game just deals the wrong grid.
 *
 * A round's content is a pure function of (master seed, round index) — the lane
 * is `round % 64`, its seed `sha256(master:lane)`, its nonce `round / 64 + 1` —
 * so per-round seeds never need storing. What does need storing is everything
 * that would silently change the answer:
 *
 *   masterSeed   the seed the light pass ACTUALLY used. `math.config.ts` may
 *                leave `sim.seed` unset, in which case the engine invents one
 *                per run and a second run would draw different rounds.
 *   rng          `provably-fair` or `fast`; both reproduce from a seed.
 *   action/bet/iterations/params   the rest of the run's shape.
 *   spinHash     the math itself. Edit the `.spin` between the passes and the
 *                heavy run silently produces different rounds.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedMode } from '../mathConfig';

export interface PoolManifest {
  mode: string;
  action: string;
  bet: number;
  iterations: number;
  rng: string;
  /** The master seed the light pass actually ran with (never undefined). */
  masterSeed: string;
  params?: unknown;
  /** sha256 of the `.spin` source the pool was simulated from. */
  spinHash: string;
  /** Rows the light pass wrote (== rounds simulated). */
  rounds: number;
  /** ISO timestamp, for humans reading a stale pool directory. */
  createdAt: string;
}

export const manifestPath = (poolDir: string, mode: string): string =>
  join(poolDir, `pool_${mode}.manifest.json`);

/** sha256 of the math source — the identity the heavy pass is checked against. */
export function hashSpin(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function writeManifest(poolDir: string, manifest: PoolManifest): void {
  writeFileSync(manifestPath(poolDir, manifest.mode), JSON.stringify(manifest, null, 2) + '\n');
}

export function readManifest(poolDir: string, mode: string): PoolManifest | null {
  const path = manifestPath(poolDir, mode);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PoolManifest;
  } catch {
    return null;
  }
}

/**
 * Fail unless the manifest still describes the run the current config asks for.
 *
 * Everything checked here changes which rounds come out, so a mismatch means
 * the pool and the config have drifted apart and the heavy pass would build
 * books from rounds the lookUpTable never saw. Loud is the only safe answer:
 * the alternative is a published game that deals grids nobody simulated.
 */
export function assertManifestMatches(
  manifest: PoolManifest,
  mode: ResolvedMode,
  spinHash: string,
): void {
  const drift: string[] = [];
  if (manifest.spinHash !== spinHash) drift.push('the .spin source changed');
  if (manifest.action !== mode.action) drift.push(`action ${manifest.action} → ${mode.action}`);
  if (manifest.rng !== mode.sim.rng) drift.push(`rng ${manifest.rng} → ${mode.sim.rng}`);
  if (manifest.bet !== mode.sim.bet) drift.push(`bet ${manifest.bet} → ${mode.sim.bet}`);
  if (manifest.iterations !== mode.sim.iterations) {
    drift.push(`iterations ${manifest.iterations} → ${mode.sim.iterations}`);
  }
  if (JSON.stringify(manifest.params ?? null) !== JSON.stringify(mode.sim.params ?? null)) {
    drift.push('sim.params changed');
  }
  if (mode.sim.seed && mode.sim.seed !== manifest.masterSeed) {
    drift.push('sim.seed changed');
  }
  if (drift.length > 0) {
    throw new Error(
      `[${mode.mode}] the pool was simulated from a different run than the config now describes ` +
        `(${drift.join('; ')}). The books stage would serialize rounds the lookUpTable never saw. ` +
        `Re-run \`e8-math pool --mode ${mode.mode}\`.`,
    );
  }
}
