import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPoolCsv } from '../src/pipeline/lut-io';
import { readSelection, selectionPath } from '../src/pipeline/curate';
import { finalizeLightPool } from '../src/pipeline/pool';
import {
  assertManifestMatches, hashSpin, readManifest, type PoolManifest,
} from '../src/pipeline/manifest';
import type { ResolvedMode } from '../src/mathConfig';

/**
 * The light half of the two-pass build: the engine's `round,payoutCents` CSV
 * becomes the lookUpTable curate optimizes, plus the manifest that lets the
 * heavy pass replay the very same rounds. What must hold is that nothing about
 * the run can drift between the passes without someone being told.
 */

const CAP_X = 500;
const SPIN = 'game "x" { max_win = 500.0 }';

const mode: ResolvedMode = {
  mode: 'BASE', action: 'spin', costMultiplier: 1,
  sim: { iterations: 6, bet: 1, rng: 'provably-fair', seed: undefined },
  curate: { capMaxWin: CAP_X * 100, costMultiplier: 1 },
};

let dir: string, poolDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e8-twopass-'));
  poolDir = join(dir, 'pool');
  mkdirSync(poolDir, { recursive: true });
});

afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

/** Six rounds; the last one pays past the cap. */
function writePoolCsvFixture(): string {
  const path = join(poolDir, 'pool_BASE.csv');
  writeFileSync(path, '0,0\n1,50\n2,0\n3,1234\n4,7\n5,9999999\n');
  return path;
}

describe('light pool', () => {
  it('turns the engine CSV into 1-weight rows, capped at the mode maxWin', async () => {
    const rows = await readPoolCsv(writePoolCsvFixture(), CAP_X * 100);

    expect(rows.map((r) => r.sim)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.every((r) => r.weight === 1)).toBe(true);
    expect(rows.map((r) => r.payoutCents)).toEqual([0, 50, 0, 1234, 7, CAP_X * 100]);
  });

  it('writes the lookUpTable and a manifest that pins the actual run', async () => {
    const csvPath = writePoolCsvFixture();

    const fin = await finalizeLightPool(mode, {
      poolDir, csvPath, masterSeed: 'deadbeef', spinHash: hashSpin(SPIN),
    });

    expect(fin.rows).toBe(6);
    expect(readFileSync(join(poolDir, 'lookUpTable_BASE_0.csv'), 'utf-8').split('\n')[1])
      .toBe('1,1,50');
    const manifest = readManifest(poolDir, 'BASE')!;
    // The seed the engine actually used — the config left `sim.seed` unset, and
    // without recording it the heavy pass would draw entirely different rounds.
    expect(manifest.masterSeed).toBe('deadbeef');
    expect(manifest.rounds).toBe(6);
    expect(manifest.iterations).toBe(6);
    expect(manifest.spinHash).toBe(hashSpin(SPIN));
  });
});

describe('manifest guard', () => {
  const base: PoolManifest = {
    mode: 'BASE', action: 'spin', bet: 1, iterations: 6, rng: 'provably-fair',
    masterSeed: 'deadbeef', spinHash: hashSpin(SPIN), rounds: 6, createdAt: '2026-01-01T00:00:00Z',
  };

  it('passes when the pool still describes the configured run', () => {
    expect(() => assertManifestMatches(base, mode, hashSpin(SPIN))).not.toThrow();
  });

  // Every one of these silently changes WHICH rounds come out, so a book would
  // end up describing a round its lookUpTable row never saw.
  it.each([
    ['the .spin changed', base, { ...mode }, hashSpin('game "x" { max_win = 501.0 }'), /\.spin source changed/],
    ['iterations moved', { ...base, iterations: 5 }, mode, hashSpin(SPIN), /iterations 5/],
    ['action moved', { ...base, action: 'buy' }, mode, hashSpin(SPIN), /action buy/],
    ['rng moved', { ...base, rng: 'fast' }, mode, hashSpin(SPIN), /rng fast/],
    ['bet moved', { ...base, bet: 2 }, mode, hashSpin(SPIN), /bet 2/],
  ])('fails loudly when %s', (_label, manifest, m, hash, pattern) => {
    expect(() => assertManifestMatches(manifest as PoolManifest, m as ResolvedMode, hash as string))
      .toThrow(pattern as RegExp);
  });

  it('fails when the config pins a seed the pool was not run with', () => {
    const pinned: ResolvedMode = { ...mode, sim: { ...mode.sim, seed: 'cafe01' } };
    expect(() => assertManifestMatches(base, pinned, hashSpin(SPIN))).toThrow(/sim\.seed changed/);
  });

  it('fails when sim.params drifted', () => {
    const withParams: ResolvedMode = { ...mode, sim: { ...mode.sim, params: { ante: true } } };
    expect(() => assertManifestMatches(base, withParams, hashSpin(SPIN))).toThrow(/params changed/);
  });
});

describe('selection', () => {
  it('reads back in curated-row order, padding rows included', () => {
    writeFileSync(selectionPath(poolDir, 'BASE'), '17,0,100\n4,1,0\n-1,2,0\n4,3,0\n');
    // Order matters: selection[i] is the pool round behind curated row i, and a
    // round may back several rows. `-1` is a synthetic padding row.
    expect(readSelection(poolDir, 'BASE')).toEqual([17, 4, -1, 4]);
  });

  it('explains itself when the books stage runs before curate', () => {
    expect(() => readSelection(poolDir, 'BASE')).toThrow(/run `e8-math curate --mode BASE` first/);
  });
});

describe('pool manifest I/O', () => {
  it('returns null for a missing or corrupt manifest rather than throwing', () => {
    expect(readManifest(poolDir, 'BASE')).toBeNull();
    writeFileSync(join(poolDir, 'pool_BASE.manifest.json'), '{ not json');
    expect(readManifest(poolDir, 'BASE')).toBeNull();
    expect(existsSync(join(poolDir, 'pool_BASE.manifest.json'))).toBe(true);
  });
});

describe('re-pooling a mode invalidates what came after it', () => {
  it('drops a stale round dump and selection when the light pool is rebuilt', async () => {
    // The dangerous shape: a pool dir left over from an older full run. Rows would
    // come from the new lookUpTable and events from the old dump — same round
    // numbers, different simulation, and nothing about the books looks wrong.
    writeFileSync(join(poolDir, 'books_BASE.jsonl.zst'), 'stale');
    writeFileSync(join(poolDir, 'books_BASE.jsonl'), 'stale');
    writeFileSync(join(poolDir, 'selected_BASE.csv'), '1,0,0\n2,1,0\n3,2,0\n');
    writeFileSync(join(poolDir, 'only_BASE.txt'), '1\n');

    await finalizeLightPool(mode, {
      poolDir, csvPath: writePoolCsvFixture(), masterSeed: 'deadbeef', spinHash: hashSpin(SPIN),
    });

    for (const stale of ['books_BASE.jsonl.zst', 'books_BASE.jsonl', 'selected_BASE.csv', 'only_BASE.txt']) {
      expect(existsSync(join(poolDir, stale)), `${stale} must be gone`).toBe(false);
    }
    // A sibling mode's pool is none of our business.
    expect(existsSync(join(poolDir, 'pool_BASE.csv'))).toBe(true);
  });

  it('leaves other modes alone', async () => {
    writeFileSync(join(poolDir, 'books_BONUS.jsonl.zst'), 'other mode');
    await finalizeLightPool(mode, {
      poolDir, csvPath: writePoolCsvFixture(), masterSeed: 'deadbeef', spinHash: hashSpin(SPIN),
    });
    expect(existsSync(join(poolDir, 'books_BONUS.jsonl.zst'))).toBe(true);
  });
});
