import { describe, it, expect } from 'vitest';
import { parseFlags } from '../src/cli';
import { formatGoReport } from '../src/pipeline/report';

describe('parseFlags', () => {
  it('parses --config/--mode', () => {
    expect(parseFlags(['--config', './math.config.ts', '--mode', 'BASE'])).toEqual({ config: './math.config.ts', mode: 'BASE' });
  });
});

describe('formatGoReport', () => {
  it('prefixes the mode and renders the full native report (total RTP, max win, per-stage, distribution)', () => {
    const result: any = {
      gameId: 'g', iterations: 1000, durationMs: 500, totalRtp: 96.1, baseGameRtp: 90, bonusRtp: 6.1,
      hitFrequency: 25, maxWin: 5000, maxWinHits: 2, bonusTriggered: 0, bonusSpinsPlayed: 0,
      perStage: { base_game: { totalWin: 900, spinCount: 1000, hitCount: 300, maxWin: 50, rtp: 90, perSpinRtp: 90, hitFrequency: 30, avgWin: 3 } },
      winDistribution: [{ label: '0-1x', count: 750, pct: 75 }],
    };
    const out = formatGoReport('BASE', result);
    expect(out).toContain('── BASE ──');
    expect(out).toContain('96.10');               // Total RTP: 96.10%
    expect(out).toContain('Max Win');
    expect(out).toContain('Per-Stage Breakdown');
    expect(out).toContain('base_game');
    expect(out).toContain('0-1x');                // win distribution bucket
  });
});
