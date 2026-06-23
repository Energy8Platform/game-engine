import { describe, it, expect } from 'vitest';
import { genSchema } from '../src/codegen/schema';

describe('genSchema', () => {
  it('cascade game: zod schema with a plain z.array cascades field + free_spins {awarded,total}', () => {
    const s = genSchema({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(s).toContain("import { z } from 'zod'");
    expect(s).toContain('export const spinSchema = z.object(');
    expect(s).toContain('cascades: z.array(');         // plain z.array so deriveArrayFields finds it
    expect(s).toContain('free_spins: z.object({ awarded: z.number(), total: z.number() })');
    expect(s).toContain('export type SpinDataRaw = z.infer<typeof spinSchema>');
    expect(s).not.toContain('@energy8platform/stake-kit');  // schema is plain zod; coercion lives in normalize
  });
  it('reel game: matrix + wins arrays instead of cascades', () => {
    const s = genSchema({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: false, cascades: false });
    expect(s).toContain('matrix: z.array(z.array(z.number()))');
    expect(s).toContain('wins: z.array(');
    expect(s).not.toContain('cascades');
  });
});
