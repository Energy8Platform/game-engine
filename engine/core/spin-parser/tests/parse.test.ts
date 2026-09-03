import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpinSchema } from '../src/index';

const MINIMAL = `
record Vars { max_win_reached: bool }
enum SpinData tag stage {
  base_game { grid: [[int]]  win: float }
}
game "demo" {
  bet_levels = [0.2, 1.0]
  max_win = 500.0
  vars = Vars
  data = SpinData
}
action spin { stage = base_game  cost = 1.0 }
`;

describe('parseSpinSchema', () => {
  it('reads the game block', () => {
    const { schema, diagnostics } = parseSpinSchema(MINIMAL);
    expect(diagnostics).toEqual([]);
    expect(schema).toMatchObject({ gameId: 'demo', betLevels: [0.2, 1], maxWin: 500 });
  });

  it('reads a stage from the tagged enum', () => {
    const { schema } = parseSpinSchema(MINIMAL);
    expect(schema!.stages.base_game).toEqual({
      grid: { kind: 'list', of: { kind: 'list', of: { kind: 'int' } } },
      win: { kind: 'float' },
    });
  });

  it('reads records, so a record-typed field can be followed', () => {
    const src = MINIMAL.replace('record Vars', 'record LineWin { line: int  win: float }\nrecord Vars');
    expect(parseSpinSchema(src).schema!.records.LineWin).toEqual({
      line: { kind: 'int' }, win: { kind: 'float' },
    });
  });

  it('reads an action with its session declarations', () => {
    const src = MINIMAL + `
action free_spin {
  stage = base_game
  cost = 1.0
  session = true
  extends = retrigger_spins
  ends when max_win_reached
  opens = free_spin count free_spins_awarded
}`;
    const free = parseSpinSchema(src).schema!.actions.find((a) => a.name === 'free_spin')!;
    expect(free).toMatchObject({
      stage: 'base_game', cost: 1, session: true,
      extendsVar: 'retrigger_spins', endsWhenVar: 'max_win_reached',
      opens: { action: 'free_spin', countVar: 'free_spins_awarded' },
    });
  });

  it('reads optional and fixed-size array types', () => {
    const src = MINIMAL.replace('win: float', 'win: float  mult: int?  reels: [int; 5]');
    expect(parseSpinSchema(src).schema!.stages.base_game.mult).toEqual({
      kind: 'optional', of: { kind: 'int' },
    });
    expect(parseSpinSchema(src).schema!.stages.base_game.reels).toEqual({
      kind: 'array', of: { kind: 'int' }, length: 5,
    });
  });

  it('ignores everything that is not a declaration', () => {
    const src = MINIMAL + `
const W: [int; 3] = [1, 2, 3]
fn helper(c: ctx) -> int { return 1 }
fn execute(c: ctx, v: Vars) -> outcome { return outcome { win: 0.0 } }`;
    expect(parseSpinSchema(src).diagnostics).toEqual([]);
    expect(parseSpinSchema(src).schema!.gameId).toBe('demo');
  });

  it('a source with no game block is a diagnostic, not a throw', () => {
    const { schema, diagnostics } = parseSpinSchema('record V { a: int }');
    expect(schema).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('game');
  });

  it('a broken record does not lose the rest of the file', () => {
    const src = MINIMAL.replace('record Vars { max_win_reached: bool }', 'record Vars { max_win_reached: }');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema).not.toBeNull();
    expect(schema!.gameId).toBe('demo');
    expect(diagnostics.some((d) => d.message.includes('Vars'))).toBe(true);
  });

  it('parses first-slot for real', () => {
    // The one test that stops this being a parser for a language of one file.
    const src = readFileSync(
      new URL('../../../examples/first-slot/game/script.spin', import.meta.url), 'utf8');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.gameId).toBe('first-slot');
    expect(Object.keys(schema!.stages)).toEqual(['base_game']);
    expect(schema!.stages.base_game.cascade_history).toEqual({
      kind: 'list', of: { kind: 'record', name: 'CascadeStep' },
    });
    expect(schema!.actions).toEqual([{ name: 'spin', stage: 'base_game', cost: 1 }]);
  });
});
