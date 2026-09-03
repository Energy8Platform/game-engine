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
      opens: [{ action: 'free_spin', countVar: 'free_spins_awarded' }],
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

// Regressions from the review of this parser's first pass — each one here
// because a real `.spin` file broke silently on it, not because it was
// guessed at.
describe('parseSpinSchema — regressions found against real files', () => {
  it('splits clauses separated by a single space, not just two or a newline', () => {
    // logic.spin (platform-core's game-spec fixtures) writes
    // `stage = base_game cost = 1.0` with ONE space. The original
    // whitespace-run splitter required 2+ spaces or a newline, so it read
    // this as one clause named "stage", losing `cost` entirely and
    // reporting "missing stage or cost" — when both were right there.
    const src = MINIMAL.replace(
      'action spin { stage = base_game  cost = 1.0 }',
      'action spin { stage = base_game cost = 1.0 }',
    );
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.actions).toEqual([{ name: 'spin', stage: 'base_game', cost: 1 }]);
  });

  it('reads more than one "opens" on the same action, the second carrying a "when"', () => {
    // kitsune-wrath's `spin` opens both `free_spin` (unconditionally) and
    // `spirit_gate` (guarded). ActionDef.opens was a single object, which
    // can't hold two — see the report and task 1's follow-up commit.
    const src = MINIMAL + `
action spin2 {
  stage = base_game
  cost = 1.0
  opens = free_spin count free_spins_awarded
  opens = spirit_gate count spirit_gate_open when spirit_gate_open == -1
}`;
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    const spin2 = schema!.actions.find((a) => a.name === 'spin2')!;
    expect(spin2.opens).toEqual([
      { action: 'free_spin', countVar: 'free_spins_awarded' },
      { action: 'spirit_gate', countVar: 'spirit_gate_open', when: 'spirit_gate_open == -1' },
    ]);
  });

  it('an unrecognized clause between two known ones does not corrupt either', () => {
    // kitsune-wrath's `spirit_gate_spin` has `session = true` immediately
    // followed by `group = spirit_gate` — a session-grouping clause this
    // vocabulary doesn't model (see the report's "known limitation").
    // `group` must still terminate `session`'s value instead of trailing
    // onto it ("true\n  group = spirit_gate" !== "true", silently losing
    // the session flag).
    const src = MINIMAL + `
action gated {
  stage = base_game
  cost = 1.0
  session = true
  group = some_group
  ends when max_win_reached
}`;
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    const gated = schema!.actions.find((a) => a.name === 'gated')!;
    expect(gated.session).toBe(true);
    expect(gated.endsWhenVar).toBe('max_win_reached');
  });

  it('an inline "feature { ... }" block does not corrupt the clause before it', () => {
    // feature.spin's `buy_bonus` action was lost entirely: `cost = 5.0`
    // immediately followed by `feature { buy = 1 }` made `cost`'s value
    // read as "5.0  feature { buy = 1 }", which fails Number(...).
    const src = MINIMAL + `
action buy { stage = base_game  cost = 5.0  feature { buy = 1 }  opens = spin count free_spins_awarded }`;
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    const buy = schema!.actions.find((a) => a.name === 'buy')!;
    expect(buy.cost).toBe(5);
    expect(buy.feature).toEqual({ buy: 1 });
    expect(buy.opens).toEqual([{ action: 'spin', countVar: 'free_spins_awarded' }]);
  });

  it('a field with no type after the colon is diagnosed without dropping its good siblings', () => {
    // Critical C: partial success is field-granular, not record-granular
    // — one bad field must not take a good one down with it.
    const src = MINIMAL.replace(
      'record Vars { max_win_reached: bool }',
      'record Vars { max_win_reached: bool  broken: }',
    );
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema!.vars).toEqual({ max_win_reached: { kind: 'bool' } });
    expect(diagnostics.some((d) => d.message.includes('broken'))).toBe(true);
  });

  it('a bare identifier with no colon is diagnosed, not silently dropped', () => {
    const src = MINIMAL.replace(
      'record Vars { max_win_reached: bool }',
      'record Vars { stray_word max_win_reached: bool }',
    );
    const { schema, diagnostics } = parseSpinSchema(src);
    // The good field still comes through...
    expect(schema!.vars).toEqual({ max_win_reached: { kind: 'bool' } });
    // ...and the noise that preceded it is named, not silently eaten.
    expect(diagnostics.some((d) => d.message.includes('stray_word'))).toBe(true);
  });
});

// The flat-record dialect (no `enum ... tag stage`): stage NAMES come from
// the actions, stage SHAPE comes from the one record `data =` names. Real
// corpus coverage lives in "the full real-world corpus" below; these are
// isolated, so the derivation itself is pinned independent of any one
// fixture file.
describe('parseSpinSchema — the flat "data = Record" dialect', () => {
  it('derives one stage per distinct action.stage, each pointing at the flat record', () => {
    const src = `
record Flat { win: float  roll: int }
game "demo" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Flat
  data = Flat
}
action spin { stage = base_game  cost = 1.0 }
action free_spin { stage = free_spins  cost = 1.0  session = true }
`;
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    const flatShape = { win: { kind: 'float' }, roll: { kind: 'int' } };
    expect(schema!.stages).toEqual({ base_game: flatShape, free_spins: flatShape });
    // Same object, not just equal — the derivation's cost: one record
    // backs every stage, so nothing here can distinguish them by shape.
    expect(schema!.stages.base_game).toBe(schema!.stages.free_spins);
  });

  it('two actions naming the same stage still produce exactly one entry', () => {
    const src = `
record Flat { win: float }
game "demo" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Flat
  data = Flat
}
action spin { stage = base_game  cost = 1.0 }
action respin { stage = base_game  cost = 1.0 }
`;
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(schema!.stages)).toEqual(['base_game']);
  });

  it('a flat record with no action declaring any stage is genuinely undecidable', () => {
    // Critical distinction from the derivable case above: here there is no
    // stage NAME anywhere in the file (no actions at all), so there is
    // nothing to key `stages` by, and refusing is correct rather than
    // guessing one.
    const src = `
record Flat { win: float }
game "demo" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Flat
  data = Flat
}
`;
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema).not.toBeNull();
    expect(schema!.stages).toEqual({});
    expect(diagnostics.some((d) => d.message.includes('no action declares a stage'))).toBe(true);
  });

  it('data naming a record that was never declared is also undecidable, distinctly worded', () => {
    // Actions DO declare stages here — the record itself is what's
    // missing, a different reason than "no action declares a stage".
    const src = `
record Flat { win: float }
game "demo" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Flat
  data = NeverDeclared
}
action spin { stage = base_game  cost = 1.0 }
`;
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema!.stages).toEqual({});
    expect(diagnostics.some((d) => d.message.includes('no record "NeverDeclared" to fall back to'))).toBe(true);
  });
});

// Branches the first mutation pass didn't exercise — flagged by review
// because 38 (well, 9) green tests survived mutating them to always
// succeed. Each gets its own targeted test here.
describe('parseSpinSchema — previously-unexercised diagnostic branches', () => {
  it('a game block missing "bet_levels" is a diagnostic, not a throw', () => {
    const src = MINIMAL.replace('  bet_levels = [0.2, 1.0]\n', '');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema).toBeNull();
    expect(diagnostics.some((d) => d.message.includes('bet_levels'))).toBe(true);
  });

  it('a game block missing "max_win" is a diagnostic, not a throw', () => {
    const src = MINIMAL.replace('  max_win = 500.0\n', '');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema).toBeNull();
    expect(diagnostics.some((d) => d.message.includes('max_win'))).toBe(true);
  });

  it('a field with unreadable (non-empty) type text is diagnosed and dropped', () => {
    // Distinct from the "nothing after the colon" case above — this is
    // text that IS there but doesn't parse as any known type.
    const src = MINIMAL.replace('max_win_reached: bool', 'max_win_reached: bool  odd: not$a$type');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema!.vars).toEqual({ max_win_reached: { kind: 'bool' } });
    expect(diagnostics.some((d) => d.message.includes('odd') && d.message.includes('not$a$type'))).toBe(true);
  });

  it('a record with no name is diagnosed', () => {
    const src = MINIMAL.replace('record Vars { max_win_reached: bool }', 'record { max_win_reached: bool }\nrecord Vars { max_win_reached: bool }');
    const { diagnostics } = parseSpinSchema(src);
    expect(diagnostics.some((d) => d.message.includes('no name'))).toBe(true);
  });

  it('a missing tagged-stage enum is diagnosed, naming the data type it looked for', () => {
    const src = MINIMAL.replace(/enum SpinData tag stage \{[\s\S]*?\n\}\n/, '');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema).not.toBeNull();
    expect(schema!.stages).toEqual({});
    expect(diagnostics.some((d) => d.message.includes('enum SpinData tag stage'))).toBe(true);
    // No enum exists at all, so there is nothing to list as "found" — this
    // is the distinct branch from the "wrongly-named" case below.
    expect(diagnostics.some((d) => d.message.includes('found:'))).toBe(false);
  });

  it('a wrongly-named enum is diagnosed by name, listing what was actually found', () => {
    const src = MINIMAL.replace('enum SpinData tag stage', 'enum WrongName tag stage');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema!.stages).toEqual({});
    const message = diagnostics.find((d) => d.message.includes('enum SpinData tag stage'))!.message;
    expect(message).toContain('WrongName');
  });

  it('an unreadable "opens" clause is diagnosed, not silently dropped', () => {
    const src = MINIMAL + `
action bonus { stage = base_game  cost = 1.0  opens = not_a_valid_opens_clause }`;
    const { schema, diagnostics } = parseSpinSchema(src);
    const bonus = schema!.actions.find((a) => a.name === 'bonus')!;
    expect(bonus.opens).toBeUndefined();
    expect(diagnostics.some((d) => d.message.includes('opens') && d.message.includes('bonus'))).toBe(true);
  });
});

// The full reach of real `.spin` files in this repo (plus one in the
// sibling kitsune-wrath repo). Testing only the file this parser was
// developed against (first-slot, above) proves the file, not the parser —
// this is the corpus that actually does that job. Every file gets either
// a clean parse or an explicitly named, listed reason it isn't one.
describe('parseSpinSchema — the full real-world corpus', () => {
  it("packages/platform-core/tests/game-spec/fixtures/logic.spin: flat Data record, stages derived from actions' own stage names", () => {
    // This file's `data = D` points at a plain `record D`, not an
    // `enum ... tag stage` — but the stage NAME is still declared, by the
    // action's own `stage = base_game`. `stages.base_game` is D's shape.
    const src = readFileSync(
      new URL('../../../../packages/platform-core/tests/game-spec/fixtures/logic.spin', import.meta.url),
      'utf8',
    );
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.gameId).toBe('spec-integration');
    expect(schema!.betLevels).toEqual([0.1, 1]);
    expect(schema!.maxWin).toBe(1000);
    expect(schema!.actions).toEqual([{ name: 'spin', stage: 'base_game', cost: 1 }]);
    expect(schema!.stages).toEqual({ base_game: { w: { kind: 'float' }, sym_a: { kind: 'int' } } });
  });

  it("packages/platform-core/tests/vite/fixtures/payer.spin: flat Data record, stages derived from TWO actions' stage names sharing one shape", () => {
    const src = readFileSync(
      new URL('../../../../packages/platform-core/tests/vite/fixtures/payer.spin', import.meta.url),
      'utf8',
    );
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.gameId).toBe('payer-game');
    expect(schema!.actions).toEqual([
      {
        name: 'spin', stage: 'base_game', cost: 1,
        opens: [{ action: 'free_spin', countVar: 'free_spins_awarded' }],
      },
      { name: 'free_spin', stage: 'free_spins', cost: 1, session: true, extendsVar: 'retrigger_spins' },
    ]);
    // Same object identity, not just equal shape — the flat dialect's cost:
    // there is exactly one record for both stages, not two coincidentally
    // matching ones.
    expect(schema!.stages.base_game).toBe(schema!.stages.free_spins);
    expect(schema!.stages).toEqual({
      base_game: { stage: { kind: 'str' }, win: { kind: 'float' } },
      free_spins: { stage: { kind: 'str' }, win: { kind: 'float' } },
    });
  });

  it('packages/platform-core/tests/vite/fixtures/meter.spin: clean parse, and the only fixture exercising "globals"', () => {
    const src = readFileSync(
      new URL('../../../../packages/platform-core/tests/vite/fixtures/meter.spin', import.meta.url),
      'utf8',
    );
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.gameId).toBe('meter-game');
    expect(schema!.stages).toEqual({ base_game: { meter: { kind: 'int' } } });
    expect(schema!.globals).toEqual({ meter: { kind: 'int' } });
  });

  it('packages/artube-server/tests/fixtures/rng.spin: flat Data record, stages derived from actions', () => {
    const src = readFileSync(
      new URL('../../../../packages/artube-server/tests/fixtures/rng.spin', import.meta.url),
      'utf8',
    );
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.gameId).toBe('rng-game');
    expect(schema!.actions).toEqual([
      {
        name: 'spin', stage: 'base_game', cost: 1,
        opens: [{ action: 'free_spin', countVar: 'free_spins_awarded' }],
      },
      { name: 'free_spin', stage: 'free_spins', cost: 1, session: true },
    ]);
    expect(schema!.stages).toEqual({
      base_game: { stage: { kind: 'str' }, win: { kind: 'float' }, roll: { kind: 'int' } },
      free_spins: { stage: { kind: 'str' }, win: { kind: 'float' }, roll: { kind: 'int' } },
    });
  });

  it('packages/artube-server/tests/fixtures/one-shot.spin: flat Data record, one action, one derived stage', () => {
    const src = readFileSync(
      new URL('../../../../packages/artube-server/tests/fixtures/one-shot.spin', import.meta.url),
      'utf8',
    );
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.gameId).toBe('one-shot-game');
    expect(schema!.actions).toEqual([{ name: 'one_shot', stage: 'base_game', cost: 1 }]);
    expect(schema!.stages).toEqual({ base_game: { stage: { kind: 'str' }, win: { kind: 'float' } } });
  });

  it('packages/artube-server/tests/fixtures/feature.spin: flat Data record, THREE distinct stages derived, one inline "feature { }" clause', () => {
    const src = readFileSync(
      new URL('../../../../packages/artube-server/tests/fixtures/feature.spin', import.meta.url),
      'utf8',
    );
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.gameId).toBe('feature-game');
    expect(schema!.actions).toEqual([
      {
        name: 'spin', stage: 'base_game', cost: 1,
        opens: [{ action: 'free_spin', countVar: 'free_spins_awarded' }],
      },
      {
        name: 'buy_bonus', stage: 'buy_bonus', cost: 5,
        opens: [{ action: 'free_spin', countVar: 'free_spins_awarded' }],
        feature: { buy: 1 },
      },
      { name: 'free_spin', stage: 'free_spins', cost: 1, session: true, extendsVar: 'retrigger_spins' },
    ]);
    expect(Object.keys(schema!.stages)).toEqual(['base_game', 'buy_bonus', 'free_spins']);
    expect(schema!.stages.base_game).toEqual({ stage: { kind: 'str' }, win: { kind: 'float' } });
    expect(schema!.stages.buy_bonus).toBe(schema!.stages.base_game);
  });

  it('kitsune-wrath/game/script.spin: a full real game, clean parse', () => {
    // Separate repo, read-only — never edited from here. The largest and
    // most structurally demanding file in the corpus: 4 tagged stages,
    // fixed-size array fields ([int; 64]) inside a record, an action with
    // TWO "opens" clauses (one guarded by "when"), and inline "feature { }"
    // blocks share lines with "opens =" and "cost =". All of it is
    // real syntax nobody wrote to suit this parser.
    const src = readFileSync('/Users/mrphelko/Documents/repo/kitsune-wrath/game/script.spin', 'utf8');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.gameId).toBe('kitsune-wrath');
    expect(Object.keys(schema!.stages)).toEqual(['base_game', 'free_spins', 'spirit_gate', 'buy_bonus']);
    expect(schema!.records.Vars.pos_mults).toEqual({ kind: 'array', of: { kind: 'int' }, length: 64 });
    expect(schema!.actions.map((a) => a.name)).toEqual([
      'spin', 'ante_spin', 'free_spin', 'spirit_gate_spin',
      'buy_bonus_fox_fire', 'buy_bonus_spirit_rage', 'buy_bonus_nine_tails',
    ]);
    const spin = schema!.actions.find((a) => a.name === 'spin')!;
    expect(spin.opens).toEqual([
      { action: 'free_spin', countVar: 'free_spins_awarded' },
      { action: 'spirit_gate', countVar: 'spirit_gate_open', when: 'spirit_gate_open == -1' },
    ]);
    const spiritGateSpin = schema!.actions.find((a) => a.name === 'spirit_gate_spin')!;
    // `group = spirit_gate` on this action is a session-grouping clause
    // ActionDef doesn't model (see the report) — it's silently out of
    // vocabulary, same as `feature =`/`data =` on a `game {}` block, and
    // must NOT corrupt the recognized clauses around it.
    expect(spiritGateSpin).toMatchObject({ stage: 'spirit_gate', cost: 1, session: true, endsWhenVar: 'sg_done' });
  });
});
