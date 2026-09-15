import { execSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { percentiles, spin } from '../src/compute';

const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game');

// A copy, not the example itself: its path is unique, so `e8Servers()` can
// count exactly the processes THIS file spawned and no other suite's.
const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'e8-spin-')));
cpSync(GAME, join(cwd, 'game'), { recursive: true });
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

/** Live `e8-server` processes serving this copy's `game/` — 0 when none. */
function e8Servers(): number {
  try {
    return execSync(`pgrep -f 'e8-server.*--games-dir ${join(cwd, 'game')}'`)
      .toString()
      .split('\n')
      .filter(Boolean).length;
  } catch {
    return 0; // pgrep exits 1 on no match
  }
}

describe('spin on a real e8-server', () => {
  it('plays n spins and reports them', async () => {
    const progress: [number, number][] = [];
    const before = e8Servers();
    const r = await spin({ cwd, n: 20, seed: 'abc', onProgress: (d, n) => progress.push([d, n]) });
    expect(r.diagnostics).toEqual([]);
    expect(r.spins).toBe(20);
    expect(r.bet).toBe(0.2); // spec.json's first betLevel
    expect(r.seed).toBe('abc');
    expect(r.rtp).toBeGreaterThanOrEqual(0);
    // Measured on seed 'abc': some spins pay and some do not, so a rate
    // that counts every spin (or none) is wrong, not merely unlucky.
    expect(r.hitRate).toBeGreaterThan(0);
    expect(r.hitRate).toBeLessThan(1);
    for (const p of Object.values(r.wins)) expect(r.maxWin).toBeGreaterThanOrEqual(p);
    expect(Object.values(r.stages).reduce((a, b) => a + b, 0)).toBe(20);
    expect(r.scriptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(progress.at(-1)).toEqual([20, 20]);
    expect(e8Servers()).toBe(before);
  }, 30_000);

  it('the same seed gives the same report; the bet does not change the multipliers', async () => {
    const a = await spin({ cwd, n: 20, seed: 'abc' });
    const b = await spin({ cwd, n: 20, seed: 'abc' });
    expect(b.rtp).toBe(a.rtp);
    expect(b.stages).toEqual(a.stages);
    // `win` is a bet multiplier (measured: identical under 0.2/1/5), so
    // rtp must come out the same at another bet — Σwin/(n·bet) would not.
    const c = await spin({ cwd, n: 20, seed: 'abc', bet: 5 });
    expect(c.bet).toBe(5);
    expect(c.rtp).toBe(a.rtp);
    // Another seed is another stream — measured: 'xyz' pays 0.025 to
    // 'abc''s 0.2 over these 20 spins. Deterministic, so not a coin flip;
    // and the only way to tell the seed reaching the server from
    // `startE8Server`'s own constant default, which same-seed runs cannot.
    const x = await spin({ cwd, n: 20, seed: 'xyz' });
    expect(x.rtp).not.toBe(a.rtp);
  }, 60_000);

  it('a binary that is not there is a session diagnostic, and leaves no process', async () => {
    const before = e8Servers();
    const r = await spin({ cwd, n: 5, seed: 'abc', binPath: '/nonexistent/e8-server' });
    expect(r.spins).toBe(0);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0].plugin).toBe('session');
    expect(e8Servers()).toBe(before);
  }, 30_000);

  it('a spin refused mid-run ends the loop: the report covers what was played, plus why', async () => {
    // Measured: the in-flight gRPC call rejects at once (`14 UNAVAILABLE`,
    // ~100ms end to end) rather than hanging on a dead socket.
    const r = await spin({
      cwd,
      n: 20,
      seed: 'abc',
      onProgress(done) {
        if (done !== 3) return;
        const pid = execSync(`pgrep -f 'e8-server.*--games-dir ${join(cwd, 'game')}'`)
          .toString()
          .trim();
        process.kill(Number(pid), 'SIGKILL');
      },
    });
    expect(r.spins).toBe(3);
    expect(Object.values(r.stages).reduce((a, b) => a + b, 0)).toBe(3);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', plugin: 'session' });
    expect(e8Servers()).toBe(0);
  }, 30_000);

  it("without an id in spec.json, the game comes from the .spin the spec's scriptPath names", async () => {
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'e8-spin-')));
    cpSync(join(GAME, 'script.spin'), join(other, 'game', 'math.spin'));
    writeFileSync(
      join(other, 'game', 'spec.json'),
      JSON.stringify({ scriptPath: 'math.spin', betLevels: [5] }),
    );
    try {
      const r = await spin({ cwd: other, n: 2, seed: 'abc' });
      expect(r.diagnostics).toEqual([]);
      expect(r.spins).toBe(2);
      expect(r.bet).toBe(0.2); // the .spin's first bet level, not the id-less spec's
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  }, 30_000);

  it('n below 1 is a compute diagnostic, before any server is spawned', async () => {
    const r = await spin({ cwd, n: 0 });
    expect(r.spins).toBe(0);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ plugin: 'compute', message: 'n must be ≥ 1' });
  });
});

describe('percentiles', () => {
  it('nearest-rank on the sorted values', () => {
    expect(percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ p50: 5, p90: 9, p99: 10 });
    expect(percentiles([3, 1, 2])).toEqual({ p50: 2, p90: 3, p99: 3 });
    expect(percentiles([])).toEqual({ p50: 0, p90: 0, p99: 0 });
  });
});
